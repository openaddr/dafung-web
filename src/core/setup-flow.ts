// 开局三段式域(#324,ADR-0019 委托式拆分):国号设定(setGuohao)、点将定序
// (doDraftRoll)、AI/服务器代选都步进(aiSetupStep/aiSetupStepFor)、选都三选一
// (pickCapital)、三候选滚换(rollOfferedCapitals)与入局收尾(finishSetup)。
// 域逻辑=自由函数,首参接 GameEngine 直接读写引擎状态;GameEngine 侧保留同名公共
// 方法薄委托(authority.ts「开局:Setup」区段),aiChooseCapital/pickCapitalInternal/
// skipCurrentDraftPick 域内自洽不留壳。
// 联机一致性纪律(开发陷阱清单,逐字保留零重排):setup 期骰流顺序敏感——
// offeredCapitals 候选随 rngState 序列化,国号占用冲突处理与 AI 选都的骰流消耗
// 顺序不得改动,e2e 种子演算与联机恢复都依赖它。
import type { GameEngine } from "./authority";
import { GUOHAO_POOL } from "./theme";
import { JINNANG_STARTING_HAND, buildJinnangDeck } from "./jinnang";
import { enterJinnangPhase } from "./jinnang-execution"; // 跨模块直调自由函数(#319 预案,同 #320 抽牌直调)
import { createTreasureDeck } from "./treasures";
import { isSingleCjk } from "./constants";
import { formatMoney } from "./money";
import type { TileDef } from "./types";

/** Fisher-Yates 洗牌(rng 注入,确定性):开局点将的国号分配与招贤三选一
 *  (tryRecruitHero,暂留壳内)共用——随本域迁出,壳侧反向 import。 */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 设置某座位的国号(单汉字);非法/冲突清空拒绝。 */
export function setGuohao(g: GameEngine, seatIndex: number, char: string): boolean {
  if (g.setupPhase !== "Guohao") return false;
  if (seatIndex < 0 || seatIndex >= g.players.length) return false;
  const trimmed = char.trim();
  // 单个 CJK 字
  const isCjk = isSingleCjk(trimmed);
  if (!isCjk) return false;
  // 冲突检查(其他座位已用)
  for (let i = 0; i < g.players.length; i++) {
    if (i !== seatIndex && g.players[i].guohao === trimmed) return false;
  }
  g.players[seatIndex].guohao = trimmed;
  g.usedGuohao.add(trimmed);
  return true;
}

/** 推进:为国号空的 bot 座位从字池随机分配(避开已用),然后进入点将定序。 */
export function doDraftRoll(g: GameEngine): void {
  if (g.setupPhase !== "Guohao") return;
  // 给 guohao 为空者分配(bot 或漏填的人类)
  const pool = shuffle(
    GUOHAO_POOL.filter((c) => !g.usedGuohao.has(c)),
    g.dice.nextFloat,
  );
  let pi = 0;
  for (const p of g.players) {
    if (!p.guohao) {
      while (pi < pool.length && g.usedGuohao.has(pool[pi])) pi++;
      if (pi < pool.length) {
        p.guohao = pool[pi];
        g.usedGuohao.add(pool[pi]);
        pi++;
      }
    }
  }
  // 摇骰定序,平局重摇。d6 只有 6 面:n<=6 重摇至无平局(有上限);
  // n>6(DEV 可达 30)不可能全异 → 接受并列、按玩家序破平,确保终止、不死循环。
  const n = g.players.length;
  const rolls = Array.from({ length: n }, () => 0);
  const canBeAllDistinct = n <= 6;
  for (let attempt = 0; attempt < 50; attempt++) {
    for (let i = 0; i < n; i++) rolls[i] = g.dice.rollDie();
    if (!canBeAllDistinct || new Set(rolls).size === n) break;
  }
  g.draftRolls = rolls;
  g.draftOrder = g.players.map((_, i) => i).sort((a, b) => rolls[b] - rolls[a] || a - b);
  g.logEvent(
    "setup",
    null,
    "点将定序:" +
      g.draftOrder
        .map((i) => `${g.players[i].guohao || g.players[i].name}(${rolls[i]})`)
        .join("→"),
    `draftRolls=${JSON.stringify(rolls)} order=${JSON.stringify(g.draftOrder)}`,
  );
  g.setupPhase = "PickCapital";
  g.currentDraftIndex = 0;
  rollOfferedCapitals(g); // 为首位选都玩家生成三候选
}

/** 当前选都玩家(bots 自动)。返回是否已完成本轮选都(需 UI 再次驱动)。 */
export function aiSetupStep(g: GameEngine): boolean {
  if (g.setupPhase !== "PickCapital") return false;
  const idx = g.currentSetupPlayerIndex;
  if (idx < 0) return false;
  if (!g.players[idx].isBot) return false;
  return aiSetupStepFor(g, idx);
}

/** 服务器代选(L41 联机):为指定座位按 bot 同评分选都,不校验 isBot——
 *  驱动资格(bot 座位 / takeover / 自助托管)由调用方(room.seatControlled)保证,
 *  单机侧真人选都不经此口(UI 手选,aiSetupStep 的 isBot 守卫保护热座)。 */
export function aiSetupStepFor(g: GameEngine, idx: number): boolean {
  if (g.setupPhase !== "PickCapital") return false;
  if (idx < 0) return false;
  const tileIdx = aiChooseCapital(g);
  if (tileIdx >= 0) {
    const r = pickCapitalInternal(g, idx, tileIdx, false);
    if (!r.ok) {
      // 极端地图(buildCost 全 > 现金):pickCapital 失败,推进 draft 防死循环
      g.warn(`AI 选都失败(${r.reason ?? "未知"}),跳过`);
      skipCurrentDraftPick(g);
    }
  } else {
    // 无候选可选(剩余城耗尽):推进 draft 防死循环
    g.warn("AI 无可选都城,跳过");
    skipCurrentDraftPick(g);
  }
  return true;
}

/** AI 选都评分:性价比 + 随机扰动,在三候选中取最高分。 */
function aiChooseCapital(g: GameEngine): number {
  const candidates = g.offeredCapitals.map((i) => g.board.at(i));
  if (candidates.length === 0) return -1;
  const score = (t: TileDef): number => {
    const def = g.catalog.get(t.propertyId);
    if (!def) return -Infinity;
    let value = (def.resupplyPerLevel * 8.0) / def.buildCost; // 都城价值=补给性价比(本作不收租,看 resupplyPerLevel)
    value += g.difficulty === "Simple" ? g.dice.nextFloat() * 2.0 : g.dice.nextFloat() * 0.3;
    return value;
  };
  return [...candidates].sort((a, b) => score(b) - score(a))[0].index;
}

/** 选都辅助:当前三候选首城(无则 -1)。集中"可选都城"判定,供人类选都 UI/测试/e2e 复用。 */
export function firstAvailableCapitalIndex(g: GameEngine): number {
  return g.offeredCapitals[0] ?? -1;
}

/** 公共选都入口:人类落子(单机 UI / 联机 WS)走这里——记 cmd 行(ADR-0014 命令流,
 *  重放的机读层;选都不是 GameCommand,detail 用 {type:"pickCapital",seat,tileIndex})。
 *  bot/接管/托管的代选走 pickCapitalInternal(logCmd=false):确定性,重放自动重算,不记 cmd 行。 */
export function pickCapital(
  g: GameEngine,
  playerIndex: number,
  tileIndex: number,
): { ok: boolean; reason?: string } {
  return pickCapitalInternal(g, playerIndex, tileIndex, true);
}

function pickCapitalInternal(
  g: GameEngine,
  playerIndex: number,
  tileIndex: number,
  logCmd: boolean,
): { ok: boolean; reason?: string } {
  if (g.setupPhase !== "PickCapital") return { ok: false, reason: "非选都阶段" };
  if (g.draftOrder[g.currentDraftIndex] !== playerIndex)
    return { ok: false, reason: "未轮到该玩家" };
  const tile = g.board.at(tileIndex);
  if (!tile.isCapitalEligible) return { ok: false, reason: "该城不可作都城" };
  if (g.takenCapitalIndices.has(tileIndex)) return { ok: false, reason: "该城已被选" };
  if (!g.offeredCapitals.includes(tileIndex)) return { ok: false, reason: "非本轮候选城" };
  const def = g.catalog.get(tile.propertyId);
  if (!def) return { ok: false, reason: "无地产定义" };
  const player = g.players[playerIndex];
  if (player.cash < def.buildCost) return { ok: false, reason: "建城费不足" };

  if (logCmd) {
    g.logEvent(
      "cmd",
      player.guohao,
      `${player.guohao} 提交命令:选都`,
      JSON.stringify({ type: "pickCapital", seat: playerIndex, tileIndex }),
    );
  }
  player.cash -= def.buildCost;
  player.properties.push({
    propertyId: def.id,
    group: def.group,
    purchasePrice: def.buildCost,
    level: 0,
    maxLevel: def.maxLevel,
  });
  player.capitalIndex = tileIndex;
  player.position = tileIndex;
  g.takenCapitalIndices.add(tileIndex);
  g.logEvent(
    "setup",
    player.guohao,
    `${player.guohao} 以 ${formatMoney(def.buildCost)} 建「${tile.name}」为都城`,
    `pickCapital player=${player.id} tile=${tileIndex}(${tile.name}) buildCost=${def.buildCost} cashLeft=${player.cash}`,
    -def.buildCost,
  );
  g.currentDraftIndex++;
  if (g.currentDraftIndex >= g.players.length) {
    g.dispatchMoment("SetupComplete", { subject: playerIndex }); // 时机·SetupComplete:最后一位选都落子成功、finishSetup 收尾前
    finishSetup(g);
  } else rollOfferedCapitals(g); // 为下一位选都玩家滚换三候选
  return { ok: true };
}

/** 选都轮空推进(极端地图 pickCapital 失败 / 无候选时跳过):进下一 draft 位或收尾。 */
function skipCurrentDraftPick(g: GameEngine): void {
  g.currentDraftIndex++;
  if (g.currentDraftIndex >= g.players.length) finishSetup(g);
  else rollOfferedCapitals(g);
}

/** 三选一候选生成:剩余可选城(未选都、未进过任何候选集)按建价分低/中/高三档,
 *  每档各取一城(廉价/中档/高价拉开经济路线);档内地理分布用最远点采样——
 *  首城档内随机,后两城取「与已选候选的最小欧氏距离」最大者前 3 名中随机(避免确定性感)。
 *  退化:候选不足 3 时档位合并跨档补;剩余(排除历史候选)不足 3 时放行复用未中选的历史候选
 *  (小地图如 zhongyuan 8 城仍可完成全员选都);剩余为 0 时候选为空(沿用 pickCapital 失败推进路径)。
 *  全程用引擎骰子(rngState 随快照序列化),联机各端/恢复天然一致。 */
function rollOfferedCapitals(g: GameEngine): void {
  const eligible = g.board.tiles.filter(
    (t) => t.isCapitalEligible && !g.takenCapitalIndices.has(t.index),
  );
  const fresh = eligible.filter((t) => !g.offeredCapitalHistory.has(t.index));
  const pool = fresh.length >= 3 ? fresh : eligible;
  const priced = pool
    .map((t) => ({ tile: t, cost: g.catalog.get(t.propertyId)!.buildCost }))
    .sort((a, b) => a.cost - b.cost);
  const tiers: { tile: TileDef; cost: number }[][] = [[], [], []];
  priced.forEach((x, i) =>
    tiers[Math.min(2, Math.floor((i * 3) / Math.max(1, priced.length)))].push(x),
  );
  const dist2 = (a: TileDef, b: TileDef): number => {
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    return dx * dx + dy * dy;
  };
  const chosen: TileDef[] = [];
  for (let k = 0; k < 3; k++) {
    // 本档取过/空档时跨档补齐:从全部未入候选的剩余城中继续选
    const rest = tiers[k].filter((x) => !chosen.includes(x.tile));
    const src = rest.length > 0 ? rest : priced.filter((x) => !chosen.includes(x.tile));
    if (src.length === 0) break;
    if (chosen.length === 0) {
      chosen.push(src[Math.floor(g.dice.nextFloat() * src.length)].tile);
    } else {
      const ranked = src
        .map((x) => ({ x, d: Math.min(...chosen.map((c) => dist2(c, x.tile))) }))
        .sort((a, b) => b.d - a.d);
      const top = ranked.slice(0, Math.min(3, ranked.length));
      chosen.push(top[Math.floor(g.dice.nextFloat() * top.length)].x.tile);
    }
  }
  g.offeredCapitals = chosen.map((t) => t.index);
  for (const i of g.offeredCapitals) g.offeredCapitalHistory.add(i);
  // 三候选生成入日志(ADR-0014 补洞:候选集是 rng 产物,重放/复盘都要可见)
  const pickerIdx = g.currentSetupPlayerIndex;
  const picker = pickerIdx >= 0 ? g.players[pickerIdx] : null;
  g.logEvent(
    "setup",
    picker?.guohao ?? null,
    `${picker?.guohao ?? "待定"} 择都三候选:${chosen.map((t) => `「${t.name}」`).join("")}`,
    `offerCapitals player=${picker?.id ?? "-"} tiles=[${g.offeredCapitals.join(",")}] names=${chosen.map((t) => t.name).join("|")}`,
  );
}

function finishSetup(g: GameEngine): void {
  g.setupPhase = "Done";
  g.phase = "Playing";
  g.turnPhase = "Roll";
  g.activeIndex = g.draftOrder[0] ?? 0;
  g.roundAnchor = g.activeIndex; // 固定轮次锚点,不随破产漂移
  g.turnNumber = 1;
  g.treasureDeck = createTreasureDeck(); // 初始化珍宝牌堆
  g.round = 1;
  g.logEvent(
    "setup",
    null,
    "群雄起兵,首战由「" + g.activePlayer.guohao + "」先行",
    `gameStart firstPlayer=${g.activePlayer.id}`,
  );
  // 锦囊发牌(#122):牌库洗序后座位序各发起手张数——先于 GameStart 时机,
  // 骰流消耗固定(洗牌 + n 人各一张),重放可复现。
  g.jinnangDeck = buildJinnangDeck(g.dice);
  g.jinnangDeckCount = g.jinnangDeck.length;
  g.players.forEach((_, seat) => g.drawJinnang(seat, JINNANG_STARTING_HAND));
  enterJinnangPhase(g); // 首回合掷骰前即可用锦囊(#122/T2)
  g.dispatchMoment("GameStart", { subject: g.roundAnchor }); // 时机·GameStart:对局开始(主体=首动者),先于首个 TurnStart
  g.dispatchMoment("TurnStart", { subject: g.activeIndex }); // 时机·TurnStart:开局首个回合(进 Playing 时)
}

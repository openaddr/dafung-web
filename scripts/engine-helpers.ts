// 引擎 CLI/Server 共享层:地图加载 + 状态文件 I/O + 状态摘要。
// scripts/cli.ts(每命令一进程,状态落 state.json)与 scripts/server.ts(常驻 HTTP,
// 内存引擎 + 落盘)共同复用,保证两端同一地图、同一序列化格式、同一 bot 语义。
// import 用相对路径(Node 不认 vite alias);core/ 零 DOM,Node 直接可跑。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import sanguoData from "../public/maps/sanguo.json" with { type: "json" };
import { loadMap, type LoadedMap } from "../src/core/board-loader";
import { parseCatalog, type CatalogFileEntry } from "../src/core/map-source";
import { GameEngine } from "../src/core/authority";
import type { SeatConfig, EngineConfig } from "../src/core/authority";
import type { EncounterConfig } from "../src/core/encounters";
import type { TurnPhase, AiDifficulty} from "../src/core/authority";
import { createDice } from "../src/core/dice";

/** 共享地图(主路 + 辅路 + catalog)。CLI 与 Server 用同一份,避免漂移。 */
export const MAP: LoadedMap = loadMap(sanguoData);

// ──────────────────────────── 内置地图清单加载(CLI/Server/replay 共享) ────────────────────────────
const MAPS_DIR = resolve(process.env.MAPS_DIR ?? "./public/maps");

/** 地图清单(entries)。损坏/缺失直接抛(零兜底:清单是唯一事实源)。 */
export function builtinMapCatalog(): CatalogFileEntry[] {
  const catalogPath = join(MAPS_DIR, "index.json");
  if (!existsSync(catalogPath)) {
    throw new Error(`地图清单不存在:${catalogPath}`);
  }
  return parseCatalog(JSON.parse(readFileSync(catalogPath, "utf-8")));
}

const builtinMapCache = new Map<string, LoadedMap>();
/** 按 mapId 加载内置图为 LoadedMap(带缓存;地图只读可跨房间共用)。找不到抛错。 */
export function loadBuiltinMapById(mapId: string): LoadedMap {
  const cached = builtinMapCache.get(mapId);
  if (cached) return cached;
  const entry = builtinMapCatalog().find((e) => e.id === mapId);
  if (!entry) throw new Error(`未知地图 id:${mapId}`);
  const map = loadMap(JSON.parse(readFileSync(join(MAPS_DIR, entry.file), "utf-8")));
  builtinMapCache.set(mapId, map);
  return map;
}

// ──────────────────────────── 状态文件持久化(CLI 与 Server 共用格式) ────────────────────────────
// state.json = { snapshot, config }。snapshot 完整可序列化;config 保存构造参数,
// 这样 restoreFromSnapshot 时能用同 config 重建只读字段后再覆盖可变状态。
export interface GameConfig {
  seats: SeatConfig[];
  targetNetWorth?: number;
  startingCash?: number;
  difficulty?: AiDifficulty;
  seed?: number;
  /** 地图 id(ADR-0014:随引擎写入对局日志局头,重放要素)。 */
  mapId?: string;
  /** 机遇配置(#135):缺省 = 机遇关;经局头行/持久化 config 复刻,重放要素。 */
  encounter?: EncounterConfig;
  /** 反应窗时长覆盖(#284):env E2E_REACTION_MS → registry → 引擎;缺省查 core 常量表。 */
  reactionWindowMs?: number;
}

export interface PersistedState {
  snapshot: ReturnType<GameEngine["snapshot"]>;
  config: GameConfig;
}

/** 全新引擎:构造 +(可选)国号摇骰定序。不落盘。
 *  map 可选:传入则用该地图(联机每房间各持自己的 LoadedMap);省略则用默认 sanguo(CLI / 单机)。 */
export function createEngine(config: GameConfig, doDraft = true, map: LoadedMap = MAP): GameEngine {
  const engine = new GameEngine(
    map.board,
    map.catalog,
    createDice(config.seed),
    config satisfies EngineConfig,
  );
  if (doDraft) engine.doDraftRoll();
  return engine;
}

export function loadEngineAt(path: string): { engine: GameEngine; config: GameConfig } {
  if (!existsSync(path)) {
    throw new Error(`state 文件不存在:${path}(先 new 开新局)`);
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  // 按落盘 mapId 重建引擎(readonly 字段就位 + 同一张地图),再覆盖可变状态;
  // 旧格式 state 无 mapId → 显式抛错重开(无兼容负担,零兜底)。
  if (!raw.config.mapId) throw new Error("state 文件缺 mapId(旧格式):请 new 重开");
  const engine = createEngine(raw.config, false, loadBuiltinMapById(raw.config.mapId));
  engine.restoreFromSnapshot(raw.snapshot);
  return { engine, config: raw.config };
}

export function saveEngineAt(path: string, engine: GameEngine, config: GameConfig): void {
  mkdirSync(dirname(path), { recursive: true }); // I/O 卫生:父目录不存在则建
  const state: PersistedState = { snapshot: engine.snapshot(), config };
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/** 自动跑完选都:Setup/PickCapital → Playing。bot 用 aiSetupStep,人类用首个可用都城。
 *  对纯 CLI / 服务器快速开局都很有用(人类逐个选都交由 Web UI 处理)。 */
export function autoSetup(e: GameEngine): void {
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 100) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const cap = e.firstAvailableCapitalIndex();
      if (cap < 0) break;
      e.pickCapital(idx, cap);
    }
  }
}

// ──────────────────────────── 状态摘要(供 /status 与 CLI 输出) ────────────────────────────
export function statusOf(e: GameEngine) {
  const s = e.snapshot();
  const activePlayer = s.players[s.activeIndex];
  return {
    phase: s.phase,
    setupPhase: s.setupPhase,
    turnPhase: s.turnPhase,
    activeIndex: s.activeIndex,
    active: activePlayer?.guohao ?? null,
    isOver: s.isOver,
    winner: s.winner ? (s.players.find((p) => p.id === s.winner)?.guohao ?? null) : null,
    winReason: s.winReason,
    turnNumber: s.turnNumber,
    round: s.round,
    lastRoll: s.lastRoll?.die ?? null,
    branchStartTile: s.branchStartTile,
    rngState: s.rngState,
    offeredCapitals: s.offeredCapitals,
    // 可用选项集(ADR-0013;快照 choices = engine.choicesFor() 全集,过滤 available;
    // 非选项集相位 choicesFor 返回 [] → 此处亦 [])。
    choices: s.choices.filter((o) => o.available),
    // 反应窗公告(ReactionView | null,快照字段透传,零派生):
    // jinnang 窗含 queriedBySeat/windowMs,march 窗含 ownerSeat。
    reaction: s.reaction,
    players: s.players.map((p) => ({
      guohao: p.guohao,
      isBot: p.isBot,
      cash: p.cash,
      netWorth: p.netWorth,
      warrants: p.warrants,
      position: p.position,
      capitalIndex: p.capitalIndex,
      isBankrupt: p.isBankrupt,
      onBranch: p.onBranch,
      skipTurns: p.skipTurns,
      treasures: p.treasures.length,
      properties: p.properties.length,
      heroes: p.heroes.length,
    })),
    prompt: promptFor(
      s.phase,
      s.setupPhase,
      s.turnPhase,
      activePlayer?.guohao,
      activePlayer?.isBot,
      // 城主视角(AwaitingTreasureOwner):提示该谁抉择
      s.turnPhase === "AwaitingTreasureOwner" ? decisionOwnerGuohao(e) : undefined,
      // 军师幕(AwaitingJinnang):技能目标段残留时一并提示 useHeroSkill
      e.pendingSkill?.skillId,
    ),
  };
}

/** AwaitingTreasureOwner 阶段,真正做抉择的是城主(可能 ≠ active 玩家)。
 *  归属座位统一走 engine.decisionOwner;treasureVisitor 缺失 → 无城主提示(原语义)。 */
function decisionOwnerGuohao(e: GameEngine): string | undefined {
  if (e.turnPhase !== "AwaitingTreasureOwner" || e.treasureVisitor == null) return undefined;
  return e.players[e.decisionOwner]?.guohao;
}

function promptFor(
  phase: string,
  setupPhase: string,
  tp: TurnPhase,
  guohao: string | undefined,
  isBot: boolean | undefined,
  decisionOwner?: string,
  pendingSkillId?: string,
): string {
  if (!guohao) return "";
  const who = `${guohao}${isBot ? "(bot)" : ""}`;
  if (phase === "GameOver") return "游戏结束";
  if (phase === "Setup") {
    if (setupPhase === "Guohao") return `${who} 选国号(cmd 不支持,用 new 时 seats 带入)`;
    if (setupPhase === "PickCapital") {
      return `${guohao} 选都(三选一,见 status.offeredCapitals):pick-capital <tileIndex>(auto-setup 自动跑完)`;
    }
    return `${who} 开局中…`;
  }
  switch (tp) {
    case "Roll":
      return `${who} 的回合:行军(roll)`;
    case "AwaitingBranch":
      return `${who} 到达辅路入口:走大路(main)或入辅路(branch)`;
    case "AwaitingDecision":
      return `${who} 落城:购地(buy)/扩军(upgrade)/跳过(skip)`;
    case "AwaitingHeroPick":
      return `${who} 招贤纳士:选名将(cmd {"type":"resolveHeroPick","index":0..2})`;
    case "AwaitingEncounter":
      return `${who} 抉择机遇(cmd {"type":"resolveEncounterChoice","index":<choices 下标>},见 status.choices)`;
    case "AwaitingExhaustion":
      return `${who} 体力耗竭(cmd {"type":"resolveExhaustionChoice","index":<下标>},见 status.choices)`;
    case "AwaitingJinnang": {
      const skill = pendingSkillId
        ? `;待发动技:cmd {"type":"useHeroSkill","skillId":"${pendingSkillId}"}(或其目标段/cancel 作罢)`
        : "";
      return `${who} 军师幕:用锦囊(cmd {"type":"useJinnang","cardId":"<id>"};今不用 {"type":"useJinnang","cardId":null},牌 id 见 status.choices)${skill}`;
    }
    case "AwaitingReaction":
      return `反应窗(cmd {"type":"respondReaction","seat":<n>,"use":<bool>,"cardId":"<id>"},待应答座位与窗信息见 status.reaction)`;
    case "AwaitingTreasureOwner":
      return `${decisionOwner ?? who} 城主抉择:公道买卖(fair <id>)/坐地起价(premium <id>)/跳过(tskip)`;
    case "AwaitingBankruptcySettle":
      return `${who} 破产清算:变卖(cmd {"type":"sellTreasureBankruptcy",...})或结算(confirm)`;
    case "Land":
    case "EndTurn":
      return `${who} 结算中…(状态过渡,无需操作)`;
    default:
      return `${who} 状态:${tp}`;
  }
}

export function boardOf(e: GameEngine) {
  const tiles = e.board.tiles.map((t) => {
    const def = e.catalog.get(t.propertyId);
    const owner = t.propertyId ? e.findOwner(t.propertyId) : null;
    const holding =
      owner && def ? owner.properties.find((h) => h.propertyId === def.id) : undefined;
    return {
      index: t.index,
      id: t.propertyId,
      name: t.name,
      type: t.type,
      region: t.region,
      group: def?.group,
      owner: owner?.guohao ?? null,
      level: holding?.level ?? 0,
    };
  });
  return {
    tiles,
    branch: e.board.branch
      ? {
          start: e.board.branch.startNode,
          end: e.board.branch.endNode,
          cells: e.board.branch.cells.map((c, i) => ({ step: i, kind: c.kind })),
        }
      : null,
  };
}

// bot 自动驱动已迁出:CLI 侧在 scripts/cli.ts(auto/run-to-end),服务器侧在
// scripts/bot-driver.ts(driveBots);可驱动相位正典 = src/core/bot.ts 的
// BOT_ATTENDED_PHASES。此处不再有共享副本。

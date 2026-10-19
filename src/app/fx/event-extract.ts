// 事件批 → 表现事件 提取器(#385,ADR-0020 折叠切换③):演出因果的单一消费通路。
// 引擎每次状态转移产出类型化 GameEvent 批(词汇表 src/core/game-events.ts);本模块把
// 一批事件直译为 PresentationEvent[](kind+seat+reason+领域字段 → 骰子/行军/浮字/出牌线/
// 印章/音效/城池宣告/横幅),单机(engine.gameEvents)与联机(netStore lastEvents)共用
// 同一函数——diff 启发式随本模块落地退役(lastJinnangPlay 留痕旁路已随 #412 移除)。
//
// 坐标口径与旧提取器一致:提取期按当时引擎态解析棋盘逻辑坐标(浮字锚定依赖提取时刻的
// 玩家位置,事后无法从事件单独还原)。行军路径(#385):marchArrived/capitalHalt 事件
// 自带 MovePath 摘要,marchEvent 按事件内路径播——合并批(联机单 tick 多转移)多段
// 行军各播各段,不再依赖引擎 lastMove 单槽;反应窗续走的余段用转移前位置(prePositions)
// 截短——与单机 remainingMarchPath 同一公式;对不上的路径不播动画、不做 diff 重建。
import type { GameEngine } from "@core/authority";
import type { GameEvent, GameEventBody } from "@core/game-events";
import type { MovePath } from "@core/board";
import { isCityType } from "@core/board";
import { findHolding } from "@core/player";
import { jinnangCardOf } from "@core/jinnang";
import {
  activeSkillDefOf,
  encounterDefOfId,
  eventSeat,
  eventSeatPlayer,
  heroDefOf,
  type AnnounceCursor,
  type FxPresentedKind,
} from "@core/event-tiers";
import { extensionAnimationHandlers } from "@app/extensions/registry";
import { remainingMarchPath } from "./orchestrator";
import type { DuelSide, FxSink, PresentationEvent, PropertyChangedEvent } from "./presentation";

/** 跨批宣布游标(形状单源 core/event-tiers AnnounceCursor,#430 票项 3):最近一次锦囊
 *  宣布(识破线指回被拆计的使用者/目标用——jinnangVoided 不带被拆方座位,ReactionAnswered
 *  亦无指向;反应窗「宣布批 → 应答批」跨批因果由此衔接)。
 *  生命周期 = 引擎实例(一局一实例):WeakMap 键控注册表让换局/换图天然拿到全新游标,
 *  无需任何手工 reset 配对(reset 忘调类 bug 结构性消失);旧模块级 let 与
 *  resetEventExtractCursors 的手工配对已退役,游标在提取链内显式对象传递。 */
interface ExtractCursors {
  lastAnnounce: AnnounceCursor | null;
}

const cursorsByEngine = new WeakMap<GameEngine, ExtractCursors>();

function cursorsOf(engine: GameEngine): ExtractCursors {
  let cursors = cursorsByEngine.get(engine);
  if (cursors == null) {
    cursors = { lastAnnounce: null };
    cursorsByEngine.set(engine, cursors);
  }
  return cursors;
}

// ─────────────────────── 取数辅助(契约违反当场炸出,零兜底) ───────────────────────
// 行动者座位校验单源 core/event-tiers(eventSeat);名将/主动技/机遇目录回查同源
// (heroDefOf/activeSkillDefOf/encounterDefOfId),文案不再分叉。
function guohaoOf(engine: GameEngine, seat: number): string {
  return engine.players[seat].guohao;
}

/** 玩家锚点(逻辑坐标):当前格。 */
function playerAnchor(engine: GameEngine, seat: number): { x: number; y: number; atTile: number } {
  const p = engine.players[seat];
  const board = engine.board;
  const pos = board.positionOf(p.position);
  return { x: pos.x, y: pos.y, atTile: p.position };
}

/** propertyId → 棋盘格(城不在棋盘=数据 bug,炸出)。 */
function tileOfProperty(engine: GameEngine, propertyId: string): number {
  const tile = engine.board.tiles.find((t) => t.propertyId === propertyId);
  if (tile == null) throw new Error(`事件消费:城 ${propertyId} 不在棋盘(数据 bug)`);
  return tile.index;
}

/** 城池宣告事件(ADR-0015):归属色/等级按提取时刻引擎态解析(建城/购地=Lv0 新归属、
 *  扩军=新等级、变卖回无主=无归属;引擎态即权威,不需要事件另带)。 */
function propertyChangedEvent(
  engine: GameEngine,
  propertyId: string,
  dims: { levelChanged: boolean; ownerChanged: boolean },
): PropertyChangedEvent {
  const tileIndex = tileOfProperty(engine, propertyId);
  let ownerColorIndex: number | null = null;
  let level = 0;
  for (const p of engine.players) {
    const h = findHolding(p, propertyId);
    if (h != null) {
      ownerColorIndex = p.colorIndex;
      level = h.level;
      break;
    }
  }
  return {
    kind: "propertyChanged",
    tileIndex,
    level,
    ownerColorIndex,
    ...dims,
  };
}

// 名将/主动技目录回查单源 core/event-tiers(heroDefOf/activeSkillDefOf);旧本地
// heroNameOf 的 `?? heroId` 兜底随单源化退役——名将查无是数据 bug,炸出不静默。
function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
}

/** 浮字事件(文案类,锚玩家位置)。 */
function textFloater(engine: GameEngine, seat: number, text: string): PresentationEvent {
  return {
    kind: "textFloat",
    playerId: engine.players[seat].id,
    text,
    ...playerAnchor(engine, seat),
  };
}

/** 浮字事件(文案类,锚指定格——拦检失败等锚事发现场的文案,不锚玩家自身)。 */
function textFloaterAtTile(engine: GameEngine, seat: number, text: string, tileIndex: number) {
  const pos = engine.board.positionOf(tileIndex);
  return {
    kind: "textFloat" as const,
    playerId: engine.players[seat].id,
    text,
    x: pos.x,
    y: pos.y,
    atTile: tileIndex,
  };
}

/** propertyId → 城名(数据 bug 当场炸出,零兜底)。 */
function tileNameOfProperty(engine: GameEngine, propertyId: string): string {
  return engine.board.at(tileOfProperty(engine, propertyId)).name;
}

// 机遇目录条目按 id 查:单源 core/event-tiers(encounterDefOfId)。

/** 金钱浮字(供应=铜钱雨,余=金额浮字;纳税(S7 铜钱雨扩容)随雨落币——
 *  付税读作钱币离手,与补给同视觉语汇、异方向文案)。 */
function cashFloater(
  engine: GameEngine,
  seat: number,
  delta: number,
  supply: boolean,
  coins = false,
): PresentationEvent {
  const anchor = playerAnchor(engine, seat);
  return supply
    ? { kind: "supplyRain", playerId: engine.players[seat].id, amount: delta, ...anchor }
    : { kind: "cashDelta", playerId: engine.players[seat].id, amount: delta, coins, ...anchor };
}

/** 都城停全屏宣告事件(S7 #513):国号/座色/都城名按提取时刻引擎态解析。 */
function haltBannerEvent(engine: GameEngine, seat: number, tileIndex: number): PresentationEvent {
  const p = engine.players[seat];
  return {
    kind: "haltBanner",
    playerId: p.id,
    guohao: p.guohao,
    colorIndex: p.colorIndex,
    cityName: engine.board.at(tileIndex).name,
  };
}

// ─────────────────────── 行军路径解析 ───────────────────────
/** marchArrived/capitalHalt → tokenMoved(路径取自事件自带 MovePath,#385 不再依赖
 *  引擎 lastMove 单槽——合并批多段行军各播各段):
 *  - 主路落点与事件落点对不上:不播动画(棋子由快照终态落位,不做位置 diff 重建);
 *  - 转移前位置(prePosition)在路径中段=反应窗挂起后续走:截短为余段(不拽回起点
 *    重走,与单机 remainingMarchPath 同公式);pre=路径起点=整段照走;
 *  - pre 不在路径上:无法安全播(陈旧路径),不播。 */
function marchEvent(
  engine: GameEngine,
  seat: number,
  ev: { tileIndex: number; path: MovePath },
  prePosition: number | null,
): PresentationEvent | null {
  const player = engine.players[seat];
  const path = ev.path;
  if (path.landIndex !== ev.tileIndex) return null; // 对不上:不播动画,不重建 diff
  if (prePosition == null || prePosition === player.position) return null;
  const onPath = path.from === prePosition || path.traversed.includes(prePosition);
  if (!onPath) return null;
  const remainder = remainingMarchPath(path, prePosition, ev.tileIndex);
  if (remainder == null) return null; // 挂起点即落点:无余段可播
  return { kind: "tokenMoved", playerId: player.id, path: remainder };
}

/** 行军落位表现(落格 marchArrived / 驻跸 capitalHalt 共用):行军动画 +
 *  驻跸印章与文案。驻跸两态(途经必停 / 恰落己都城)按规则都结算驻跸补给,凡
 *  落点=己都城即盖「驻」章出文案(恰落态无 capitalHalt 事件,由落点字段直读);
 *  补给铜钱雨由随后的 cashChanged(reason="supply") 事件自产,压轴。
 *  announce(S7):插在行军与驻章之间的全屏宣告(都城停横幅),present 串行 await
 *  时序=行军 → 宣告 → 驻章。 */
function arrivalPresentation(
  engine: GameEngine,
  seat: number,
  ev: { tileIndex: number; path: MovePath },
  prePosition: number | null,
  halted: boolean,
  announce?: PresentationEvent,
): PresentationEvent[] {
  const out: PresentationEvent[] = [];
  const march = marchEvent(engine, seat, ev, prePosition);
  if (march) out.push(march);
  if (announce) out.push(announce);
  // 落格定音(S7 #513,BRIEF #9 翻案):落在事件/机遇格(非城池格:税/仓/锦囊/
  // 天命/卧龙)金圈一拍,恰落己都城(驻章即定音)与驻跸(横幅+驻章)不加拍。
  const tile = engine.board.at(ev.tileIndex);
  if (!halted && !isCityType(tile.type) && ev.tileIndex !== engine.players[seat].capitalIndex) {
    out.push({ kind: "landPulse", tileIndex: ev.tileIndex });
  }
  if (halted || ev.tileIndex === engine.players[seat].capitalIndex) {
    out.push({ kind: "sealStamped", tileIndex: ev.tileIndex, char: "驻" });
    out.push(textFloater(engine, seat, "驻跸补给"));
  }
  return out;
}

/** 识破线目标座位:jinnangVoided 带份(shareSeat)指份;不带份按牌域查宣布游标——
 *  连环计/self 指被拆计使用者,one 指原定目标(=宣布时 targetSeats 首位)。游标由
 *  提取链显式传递(生命周期=引擎实例,见文件头)。 */
function voidLineTarget(
  ev: Extract<GameEvent, { kind: "jinnangVoided" }>,
  cursors: ExtractCursors,
): number | null {
  if (ev.shareSeat != null) return ev.shareSeat;
  const announce = cursors.lastAnnounce;
  if (announce == null || announce.cardId !== ev.cardId) return null;
  const domain = jinnangCardOf(ev.cardId).targetDomain;
  if (domain === "one") return announce.targetSeats[0] ?? null;
  return announce.userSeat; // two-others(全计作废)与 self(落空)都指使用者
}

/** 耗竭跳过文案(#385 缺口 6):批内前置 exhaustionChoice(同座)= 处置明细已定,
 *  文案升级为带处置明细的完整版(城名按棋盘查得);孤立 staminaChanged(无可处置
 *  自动路径)维持缺省口径——浮字恒一条,不与处置明细重复弹。 */
function exhaustionTextOf(
  engine: GameEngine,
  events: readonly GameEvent[],
  i: number,
  seat: number,
): string {
  for (let j = i - 1; j >= 0; j--) {
    const prev = events[j];
    if (prev.kind === "exhaustionChoice" && prev.seat === seat) {
      const name = tileNameOfProperty(engine, prev.propertyId);
      const note =
        prev.exhaustionKind === "downgrade" ? `「${name}」降 1 级` : `「${name}」失去城池`;
      return `体力耗竭:${note},倒地不起(跳过一回合)`;
    }
  }
  return "体力耗竭,跳过一回合";
}

// ─────────────────────── 主提取 ───────────────────────
/**
 * 事件批 → 表现事件(单机/联机共用;数组顺序=播放顺序)。
 * @param engine       推进后的引擎(单机=本地权威;联机=快照 hydrate 后的只读引擎),
 *                     提供坐标解析/lastMove 路径/座位表
 * @param events       本转移(或合并 tick)的事件批(词汇表 core/game-events.ts)
 * @param prePositions 转移前各座位棋子位置(行军余段截短基准;null=未知;缺省=全未知)
 */
export function extractBatchEvents(
  engine: GameEngine,
  events: readonly GameEvent[],
  prePositions?: ReadonlyArray<number | null>,
): PresentationEvent[] {
  // 批内预处理:横幅只在最后一个 turnStarted 弹(联机合并 tick 多回合链接时只报终态,
  // 与旧快照级横幅去重同观感;单机批恒 ≤1 个 turnStarted,不受影响)。
  const lastTurnStartIdx = (() => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === "turnStarted") return i;
    return -1;
  })();
  const events_: PresentationEvent[] = [];
  const pre = (seat: number): number | null => prePositions?.[seat] ?? null;
  const cursors = cursorsOf(engine); // 跨批游标(生命周期=引擎实例,显式对象传递)

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    switch (ev.kind) {
      case "diceRolled": {
        const seat = eventSeat(engine, ev);
        events_.push({ kind: "diceRolled", die: ev.die, fast: engine.players[seat].isBot });
        break;
      }
      case "marchArrived": {
        const seat = eventSeat(engine, ev);
        events_.push(...arrivalPresentation(engine, seat, ev, pre(seat), false));
        break;
      }
      case "capitalHalt": {
        // 驻跸必停:引擎此态不发 marchArrived,行军动画由本事件的落点+路径字段直读
        // (#385:截断到都城的路径随事件走);都城停全屏宣告(S7)插行军与驻章之间,
        // 补给铜钱雨由随后 cashChanged(reason="supply") 压轴。
        const seat = eventSeat(engine, ev);
        events_.push(
          ...arrivalPresentation(
            engine,
            seat,
            ev,
            pre(seat),
            true,
            haltBannerEvent(engine, seat, ev.tileIndex),
          ),
        );
        break;
      }
      case "capitalSelected": {
        // 选都建城:「筑」章 + 建城宣告(易主维度;联机旧 diff 同款表现,单机由此补齐)
        eventSeat(engine, ev); // 建城者座位契约校验(章/宣告锚格,不锚人)
        events_.push({ kind: "sealStamped", tileIndex: ev.tileIndex, char: "筑" });
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: false, ownerChanged: true }),
        );
        break;
      }
      case "propertyBought": {
        // 购地成交三件套:据章 → buy 音 → 宣告(易主)→ 价款浮字(音效在前、宣告紧随)
        const seat = eventSeat(engine, ev);
        events_.push({
          kind: "sealStamped",
          tileIndex: tileOfProperty(engine, ev.propertyId),
          char: "据",
        });
        events_.push({ kind: "sound", event: "buy" });
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: false, ownerChanged: true }),
        );
        events_.push(cashFloater(engine, seat, -ev.price, false));
        break;
      }
      case "propertyUpgraded": {
        // 扩军:upgrade 音 → 宣告(等级维度)
        events_.push({ kind: "sound", event: "upgrade" });
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: true, ownerChanged: false }),
        );
        break;
      }
      case "propertyRejected": {
        // 购地被拒/按兵不动(#385):ADR-0013 默认行为自动执行的文案浮字,按 reason 派生
        events_.push(
          textFloater(
            engine,
            eventSeat(engine, ev),
            ev.reason === "no-warrant"
              ? "无委任状,不可购"
              : ev.reason === "insufficient-cash"
                ? "银两不足,未能购城"
                : "城已满级,按兵不动",
          ),
        );
        break;
      }
      case "cashChanged": {
        // 纳税(reason="tax")铜钱雨扩容(S7 #513):负向付税随雨落币
        events_.push(
          cashFloater(
            engine,
            eventSeat(engine, ev),
            ev.delta,
            ev.reason === "supply",
            ev.reason === "tax" && ev.delta < 0,
          ),
        );
        break;
      }
      case "treasureGained": {
        // 探宝拼点胜(S7):漆金「得」印钤在宝物城落点 + treasure 音(拼点胜半场的
        // 印章语义)。探宝拼点是单人 2d6 判定、不走 resolveDuel,无 duelResolved(#636/ADR-0030:
        // 玩家对拼的点数已入事件流,探宝判定不入)。
        const seat = eventSeat(engine, ev);
        events_.push({
          kind: "sealStamped",
          tileIndex: engine.players[seat].position,
          char: "得",
          tone: "gold",
        });
        events_.push({ kind: "sound", event: "treasure" });
        break;
      }
      case "treasureTraded": {
        // 交割两清:买家付款浮字 → 卖家收款浮字(锚各自位置)
        events_.push(cashFloater(engine, ev.buyerSeat, -ev.price, false));
        events_.push(cashFloater(engine, ev.sellerSeat, ev.price, false));
        break;
      }
      case "treasureStolen": {
        // 窃宝宣告(#385,窃玉偷香):文案浮字锚窃方位置
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            `窃得「${engine.players[ev.victimSeat].guohao}」的「${ev.treasureName}」`,
          ),
        );
        break;
      }
      case "assetLiquidated": {
        // 破产三变卖:所得浮字;变卖城池=回无主,补易主宣告(旧留痕通道的易主维度)
        const seat = eventSeat(engine, ev);
        events_.push(cashFloater(engine, seat, ev.amount, false));
        if (ev.asset.kind === "property")
          events_.push(
            propertyChangedEvent(engine, ev.asset.id, { levelChanged: false, ownerChanged: true }),
          );
        break;
      }
      case "assetTransferred": {
        // 破产清算逐城易主(#385):每处城一条宣告(归属按提取时刻引擎态=承让方/无主)
        eventSeat(engine, ev);
        events_.push(
          propertyChangedEvent(engine, ev.propertyId, { levelChanged: false, ownerChanged: true }),
        );
        break;
      }
      case "heroRecruited": {
        events_.push(
          textFloater(engine, eventSeat(engine, ev), `${heroDefOf(ev.heroId).name} 来投`),
        );
        break;
      }
      case "playerBankrupt": {
        // 破产仪式(S7 #513):倒旗→墨渍→撒币三拍由 sink 串行编排(三音随拍发起),
        // 提取期只锚现场(破产者落点=墨渍/撒币坐标)。
        const seat = eventSeat(engine, ev);
        const anchor = playerAnchor(engine, seat);
        events_.push({
          kind: "bankruptCeremony",
          playerId: engine.players[seat].id,
          x: anchor.x,
          y: anchor.y,
        });
        break;
      }
      case "jinnangAnnounced": {
        // 出牌(#281 P2-E):线指方向、字报其名——先各目标出线,再文案浮字。
        // 记宣布游标(跨批,生命周期=引擎实例):识破线指回本计的使用者/目标。
        const seat = eventSeat(engine, ev);
        cursors.lastAnnounce = {
          userSeat: seat,
          cardId: ev.cardId,
          targetSeats: [...ev.targetSeats],
        };
        const from = engine.board.positionOf(engine.players[seat].position);
        const lines = ev.targetSeats
          .filter((s) => s !== seat)
          .map((s) => {
            const to = engine.board.positionOf(engine.players[s].position);
            return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
          });
        if (lines.length > 0) {
          events_.push({
            kind: "jinnangPlayed",
            playerId: engine.players[seat].id,
            cardId: ev.cardId,
            lines,
          });
        }
        // 文案浮字与线独立(自身域无指向也报牌名,与旧 msg 浮字通道同观感)
        events_.push(
          textFloater(engine, seat, `${guohaoOf(engine, seat)} 使用锦囊【${ev.cardId}】`),
        );
        break;
      }
      case "heroSkillActivated": {
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            `${guohaoOf(engine, seat)} 施展【${activeSkillDefOf(ev.skillId).name}】`,
          ),
        );
        break;
      }
      case "jinnangVoided": {
        // 识破生效(#281):线端=应答者 → 被保份/被拆计方(可解析时),字报结果。
        // shareSeat 过座位契约校验(单源 core/event-tiers,#431 移交顺带项):越界座位
        // = 产出侧 bug,当场炸出,不静默写 undefined。
        const seat = eventSeat(engine, ev);
        if (ev.shareSeat != null) eventSeatPlayer(engine, ev.shareSeat, "jinnangVoided.shareSeat");
        const target = voidLineTarget(ev, cursors);
        if (target != null && target !== seat) {
          const from = engine.board.positionOf(engine.players[seat].position);
          const to = engine.board.positionOf(engine.players[target].position);
          events_.push({
            kind: "jinnangPlayed",
            playerId: engine.players[seat].id,
            cardId: ev.cardId,
            lines: [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }],
          });
        }
        const text =
          ev.shareSeat != null
            ? `${guohaoOf(engine, seat)} 识破,${guohaoOf(engine, ev.shareSeat)} 免于【${ev.cardId}】`
            : jinnangCardOf(ev.cardId).targetDomain === "two-others"
              ? `${guohaoOf(engine, seat)} 识破!【${ev.cardId}】作废`
              : `${guohaoOf(engine, seat)} 识破!【${ev.cardId}】落空`;
        events_.push(textFloater(engine, seat, text));
        break;
      }
      case "jinnangInflicted": {
        // 中招宣告(#385,缓兵之计):文案浮字锚中招者位置;实际跳过另有 turnSkipped
        eventSeat(engine, ev);
        events_.push(textFloater(engine, ev.targetSeat, `中【${ev.cardId}】,下回合无法行动`));
        break;
      }
      case "peekApplied": {
        // 窥探弹层(#575,军情密探即时窥探):viewer-only 演出——座位契约校验后按事件
        // 直译(手牌内容随事件走,redactEvents 已逐座位裁、非 viewer 恒空,ADR-0016);
        // 目标国号提取期解析进事件(弹层副题用),无净表现档(hand 空)也照发,弹层
        // 组件按 viewerSeat===本座自门(他座客户端零渲染)。
        const viewerSeat = eventSeat(engine, ev);
        eventSeatPlayer(engine, ev.targetSeat, "peekApplied.targetSeat");
        events_.push({
          kind: "peekRevealed",
          viewerSeat,
          targetSeat: ev.targetSeat,
          guohao: guohaoOf(engine, ev.targetSeat),
          hand: [...ev.hand],
        });
        break;
      }
      case "reactionAnswered": {
        // 拦检出牌(半路杀出,use=true):线=城主 → 行人(本批随后的 marchArrived 即行人落格)。
        if (ev.use && ev.cardId != null) {
          const seat = eventSeat(engine, ev);
          const mover = events
            .slice(i + 1)
            .find(
              (e): e is Extract<GameEvent, { kind: "marchArrived" }> => e.kind === "marchArrived",
            );
          if (mover && mover.seat != null && mover.seat !== seat) {
            const from = engine.board.positionOf(engine.players[seat].position);
            const to = engine.board.positionOf(engine.players[mover.seat].position);
            events_.push({
              kind: "jinnangPlayed",
              playerId: engine.players[seat].id,
              cardId: ev.cardId,
              lines: [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }],
            });
          }
        }
        break;
      }
      case "reactionFailed": {
        // 拦检失败宣告(ADR-0030 单通道):拼点骰面信息全在签面(duelResolved 直译),
        // 此处只余文案浮字(不带点数括注——点数不落第二处),照旧锚拦检城(事发现场)。
        const seat = eventSeat(engine, ev);
        events_.push(textFloaterAtTile(engine, seat, "拦检失败", ev.tileIndex));
        break;
      }
      case "duelResolved": {
        // 拼点签面(#637,ADR-0030):duelResolved 直译——双方座位元数据提取期解析进
        // 事件(签头国号/玩家色、签身掷点),组件零查询;胜者随事件走(winnerSeat,
        // 平局 null)。场景无关:拦检与连环计同式,签面即是信息,点数不落第二处。
        // 落定序=座位号升序(#639 评审必修):aSeat=resolveDuel 首参(拦检=城主/
        // 连环计=首目标)不保证座位号小,照数组序落定会与代码库「座位序」惯用法
        //(升序,如 dispatchMoment)漂移——sides 排序后入事件,左右排布与错拍落定
        // 序随之自然=座位升序。
        if (ev.winnerSeat != null && ev.winnerSeat !== ev.aSeat && ev.winnerSeat !== ev.bSeat)
          throw new Error(
            `事件消费:duelResolved.winnerSeat=${ev.winnerSeat} 不在拼点双方 [${ev.aSeat},${ev.bSeat}](契约违反)`,
          );
        const sides: DuelSide[] = [ev.aSeat, ev.bSeat]
          .sort((x, y) => x - y)
          .map((seat) => {
            const p = eventSeatPlayer(
              engine,
              seat,
              `duelResolved.${seat === ev.aSeat ? "aSeat" : "bSeat"}`,
            );
            return {
              seat,
              playerId: p.id,
              guohao: p.guohao,
              colorIndex: p.colorIndex,
              roll: seat === ev.aSeat ? ev.aRoll : ev.bRoll,
            };
          });
        events_.push({ kind: "duelSigns", sides, winnerSeat: ev.winnerSeat });
        break;
      }
      case "staminaChanged": {
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            ev.reason === "exhaustion"
              ? exhaustionTextOf(engine, events, i, seat)
              : `体力 ${signed(ev.delta)}`,
          ),
        );
        break;
      }
      case "reputationChanged": {
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            ev.reason === "fate" ? `天命眷顾,声望 ${signed(ev.delta)}` : `声望 ${signed(ev.delta)}`,
          ),
        );
        break;
      }
      case "jinnangDrawn": {
        const seat = eventSeat(engine, ev);
        events_.push(
          textFloater(
            engine,
            seat,
            ev.reason === "jinnangTile"
              ? "抽一张锦囊"
              : `获锦囊一封${ev.count > 1 ? ` ×${ev.count}` : ""}`,
          ),
        );
        break;
      }
      case "jinnangReshuffled": {
        // 洗回宣告走 fx 面(引擎不推浮字):单机/联机各端同见,文案与战报同口径
        const seat = eventSeat(engine, ev);
        events_.push(textFloater(engine, seat, `弃牌堆 ${ev.count} 张洗回牌库`));
        break;
      }
      case "encounterChoice": {
        // 机遇抉择文案(#385 缺口 6):文案属静态目录,事件只带 id+下标,fx 查表派生
        const seat = eventSeat(engine, ev);
        const option = encounterDefOfId(ev.encounterId).choices?.[ev.choiceIndex];
        if (option == null)
          throw new Error(
            `事件消费:机遇 ${ev.encounterId} 选项 #${ev.choiceIndex} 不在目录(数据 bug)`,
          );
        events_.push(textFloater(engine, seat, option.text));
        break;
      }
      case "turnSkipped": {
        events_.push(textFloater(engine, eventSeat(engine, ev), "被跳过一回合"));
        break;
      }
      case "turnStarted": {
        if (i === lastTurnStartIdx) {
          const seat = eventSeat(engine, ev);
          const p = engine.players[seat];
          events_.push({ kind: "turnBanner", guohao: p.guohao, colorIndex: p.colorIndex });
        }
        break;
      }
      case "gameOver": {
        events_.push({ kind: "sound", event: "victory" });
        break;
      }
      // ── 无表现档(default 守卫,档位单源 core/event-tiers)──
      // 走到这里的已登记 kind 必须是 fx=silent 档(回合/胜负生命周期、treasureSold、
      // skillFired、encounterTriggered、reactionOpened、exhaustionChoice 等:状态折叠
      // 与卷轴/反应窗 UI 的输入,不产演出)——presented 档漏 case = 下面赋值编译期红
      //(FxPresentedKind 派生集,#430 防遗漏机器)。线上未知 kind 不在联合内,运行时
      // 落此跳过:ADR-0020 既定口径,非吞错。
      default: {
        const silentKind: Exclude<GameEventBody["kind"], FxPresentedKind> = ev.kind;
        void silentKind;
        break;
      }
    }
  }

  // 扩展动画 handler(#378,ADR-0022 三能力之二):主提取完成后让已装包吃同一批事件
  // 补演出(追加在批尾——扩展演出是本转移因果链的下游)。零包时读口为空数组,行为不变。
  for (const handler of extensionAnimationHandlers()) {
    events_.push(...handler({ engine, events }));
  }

  // 铜钱声(旧 spawnFloaters 口径:有正收入就叮一声,每批一次,排在首个浮字之前)
  const firstFloater = events_.findIndex((e) => e.kind === "cashDelta" || e.kind === "supplyRain");
  const coinDue =
    firstFloater >= 0 &&
    events_.some((e) => (e.kind === "cashDelta" || e.kind === "supplyRain") && e.amount > 0);
  if (coinDue) events_.splice(firstFloater, 0, { kind: "sound", event: "coin" });
  // 付出声(2026-10 音效审计对位:收钱有叮、付钱原无声):批内有负向浮字 → pay
  // 每批一次,缀在 coin 之后、首个浮字之前。购地批不压——价款浮字已由 buy 音
  // (摇钱袋)报交易,再叠支出闷响是双声;批粒度粗判(合并批同时含购地与无关
  // 支出时 pay 让位,宁缺勿闹)。
  if (
    firstFloater >= 0 &&
    !events_.some((e) => e.kind === "sound" && e.event === "buy") &&
    events_.some((e) => e.kind === "cashDelta" && e.amount < 0)
  )
    events_.splice(firstFloater + (coinDue ? 1 : 0), 0, { kind: "sound", event: "pay" });
  return events_;
}

/** 行军锚定(present 前、sync 渲染前调用):把 tokenMoved 的路径直传 sink 锚定
 *  marchBegin(#385 起路径随表现事件走,不再注入引擎 lastMove——合并批多段行军
 *  各持各径,sink 调用即带路径,无需 applyPresentationMove 注入/清理往返)。 */
export function anchorMarches(events: PresentationEvent[], sink: FxSink): void {
  for (const ev of events) {
    if (ev.kind !== "tokenMoved") continue;
    sink.marchBegin(ev.playerId, ev.path);
  }
}

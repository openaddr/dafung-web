// 客户端投影层 + 下行装配单口(ADR-0016 per-seat 投影的联机侧)——从 room.ts 拆出
// (模块治理 10/11 #327,纯搬不改),#431 起兼营下行装配与校准触发登记。
// 大厅/快照视图 + 锦囊暗牌 per-seat 裁剪 + 单拍下行装配(assembleDownlinkShot:
// 两个传输面共用的唯一装配口,redaction 必经)+ 关键节点校准触发(CALIBRATION_*,
// 类型化 + 档位表覆盖对账)+ 服务器驱动判定 + 廉价进展指纹。
// 纯函数,零 WS/HTTP/fs 依赖;room.ts 持会话模型,server.ts(传输层)与测试直接消费。
//
// clientView/lobbyView 自 2026-08-14(架构待办③)起:snapshot 消息补齐 seatCount/started/mapId,
// 与 lobby 消息的房间字段对齐——客户端从任一消息都能直接得到完整房间态,无需手抄推断。
// (个人项目,不考虑旧协议兼容;客户端 network-client.ts 同步改。)
import type { GameCommand, GameEngine, TurnPhase } from "../engine/authority";
import type { GameSnapshot } from "../engine/snapshot";
import { capitalChoiceOf } from "../engine/setup-flow";
import {
  COMMAND_WARNING_REASONS,
  isLogWarning,
  LOG_WARNING_PREFIX,
  type LogEvent,
} from "../engine/model";
import type { PendingReaction, ReactionView } from "../engine/reaction-window";
import type { GameEvent } from "../engine/game-events";
import { EVENT_TIERS, type EventKind } from "../engine/event-tiers";
import { HEROES } from "../engine/heroes";
import { SKILLS } from "../engine/skills";
import { createTreasureDeck, SKILL_BOOK_ID_PREFIX } from "../engine/treasures";
import { bankruptcyDecisionOf } from "./bankruptcy-decisions";
import { landDecisionOf } from "./land-decisions";
import { seatDecisionPointOf } from "./player-submissions";
import { reactionTimingOf } from "./reaction-deadline";
import { recruitmentDecisionOf } from "./recruitment-decisions";
import { skillChoiceDecisionOf } from "./skill-choice-decisions";
import { treasureDecisionOf } from "./treasure-decisions";
import type { RoomSession } from "./room";
import { reactionChoicesForSeat } from "../protocol/reaction-choices";
// 下行封装构造收口 wire.ts(#429):装配口只管形状与裁剪,序列化不另起炉灶。
// (wire 对本模块/room 的引用全是 type 导入,构建期擦除,无运行时环。)
import { encodeDownlink, eventsMsg, type DecisionOptions, type GameLogMsg } from "../protocol/wire";

// ──────────────────────────── 纯视图(传输层与持久化都不参与)────────────────────────────
/** 座位元数据:lobbyView/clientView 都从这里取(字段与原 server.ts 一致,客户端依赖)。
 *  guohao(E7/#19):预设国号原样透出(null=未预设/bot,开局由引擎分配)——
 *  大厅据此渲染单字方章;重名预告由客户端用 core/guohao 的同一算法计算。 */
export function seatMeta(r: RoomSession, onlineSeats: Set<number>) {
  return r.seats.map((s, i) => ({
    seat: i,
    kind: s.kind,
    taken: s.token != null,
    online: onlineSeats.has(i),
    // 托管中(bot 代打,但身份仍是真人;UI 据此显示「托管」标记,ADR-0028 单一开关)
    autoPilot: r.autoPilot.has(i),
    guohao: s.guohao,
  }));
}

export interface LobbyView {
  type: "lobby";
  roomId: string;
  seatCount: number;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: ReturnType<typeof seatMeta>;
}

export function lobbyView(r: RoomSession, onlineSeats: Set<number>): LobbyView {
  return {
    type: "lobby" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: r.engine != null,
    mapId: r.mapId,
    seats: seatMeta(r, onlineSeats),
  };
}

/** 匿名座位占位:queriedSeats/queriedBySeat 裁剪后被剥身份的座位一律置换为它——非合法
 *  座位号,消费面(折叠器闭窗算术读 length、控制器/UI 读 includes(自己))都不会把它
 *  当人。事件批(redactEvents)与快照投影(redactReactionView)两条下行路径共用。 */
const ANON_SEAT = -1;

/** 反应窗公开载荷的 per-seat 投影(#281,ADR-0016):公告字段(cardId/userSeat/
 *  targets/counter)public 原样;queriedBySeat 是 per-seat private 档——**身份匿名、数量
 *  保留**(与 redactEvents 同一口径):自己座位保留,他人一律置换 ANON_SEAT。数量必须
 *  保留:出牌阶段开窗拍必带校准全量快照,水合无条件覆盖折叠态——若投影把查询集覆盖成
 *  [自己]/[](长度 ≤1),折叠器(event-fold.ts)闭窗算术「应答数 ≥ queriedBySeat.length」
 *  在首条应答即全员误闭窗(#461:非应答端横幅提前消失、丧失应答入口);匿名化相对
 *  god-view 恰好只裁「谁」,同窗询问数量本就可由公开应答流推出(每被询问座位恰应答
 *  一次),零额外泄漏。march 窗无私有档,原样返回。纯函数。 */
function redactReactionView(v: ReactionView, seat: number): ReactionView {
  if (v.kind !== "jinnang") return v;
  return { ...v, queriedBySeat: v.queriedBySeat.map((s) => (s === seat ? seat : ANON_SEAT)) };
}

/** 座位摘要保留反应窗公告与应答进度，骰流和闭窗续结算只存于权威快照。 */
export type SeatSnapshot = Omit<GameSnapshot, "rngState" | "pendingReaction"> & {
  pendingReaction: Omit<PendingReaction, "payload"> | null;
};

/** 应答者可回读自己的用牌位置与选份，其他座位只见公告与应答进度。 */
export function projectSeatReaction(
  pending: SeatSnapshot["pendingReaction"],
  seat: number,
): SeatSnapshot["pendingReaction"] {
  if (pending === null) return null;
  return {
    seq: pending.seq,
    view: redactReactionView(pending.view, seat),
    answers: pending.answers.map((answer) => {
      if (answer.seat === seat) return answer;
      const { target: _target, handIndex: _handIndex, ...announced } = answer;
      return announced;
    }),
  };
}

type LoggedCommand = GameCommand | { type: "pickCapital"; seat: number; tileIndex: number };

const TREASURE_IDS = new Set(createTreasureDeck().map(({ id }) => id));

function logNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function logCatalogId(value: unknown, catalog: readonly { id: string }[]): string | undefined {
  return typeof value === "string" && catalog.some(({ id }) => id === value) ? value : undefined;
}

function logTreasureId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (TREASURE_IDS.has(value)) return value;
  if (
    value.startsWith(SKILL_BOOK_ID_PREFIX) &&
    logCatalogId(value.slice(SKILL_BOOK_ID_PREFIX.length), SKILLS) !== undefined
  ) {
    return value;
  }
  return undefined;
}

/** 权威记录含上行原文。下行只保留各命令声明的公开字段。 */
function projectLogCommand(cmd: LoggedCommand): Record<string, unknown> | null {
  const { type } = cmd;
  switch (cmd.type) {
    case "rollAndMove":
    case "buyProperty":
    case "upgradeProperty":
    case "endDecision":
    case "declareBankruptcy":
      return { type };
    case "pickCapital":
      return { type, seat: logNumber(cmd.seat), tileIndex: logNumber(cmd.tileIndex) };
    case "resolveHeroPick": {
      if (!("action" in cmd)) return { type, index: logNumber(cmd.index) };
      if (cmd.action === "seekBook" || cmd.action === "skip") return { type, action: cmd.action };
      return { type };
    }
    case "resolveTreasureOwner": {
      const action = cmd.action;
      if (action?.type === "skip") return { type, action: { type: action.type } };
      if (action?.type === "fair" || action?.type === "premium") {
        return {
          type,
          action: { type: action.type, treasureId: logTreasureId(action.treasureId) },
        };
      }
      return { type };
    }
    case "confirmBankruptcySettle":
      return {
        type,
        assets: Array.isArray(cmd.assets)
          ? cmd.assets
              .filter((asset) => asset?.kind === "treasure" || asset?.kind === "property")
              // 摘要未携带地图目录。已成交城池仍由公开结算行记录。
              .map(({ kind, id }) => ({
                kind,
                id: kind === "treasure" ? logTreasureId(id) : undefined,
              }))
          : undefined,
      };
    case "useJinnang":
      // 选牌、选目标与结算走同一命令。公开面只记出牌公告和玩法结果。
      return null;
    case "useHeroSkill":
      return { type, cancel: cmd.cancel === true ? true : undefined };
    case "useBookSkill":
      return {
        type,
        treasureId: logTreasureId(cmd.treasureId),
        heroId: logCatalogId(cmd.heroId, HEROES),
      };
    case "dismissHero":
      return { type, heroId: logCatalogId(cmd.heroId, HEROES) };
    case "respondReaction":
      return { type, use: typeof cmd.use === "boolean" ? cmd.use : undefined };
    case "respondSkillChoice":
      return {
        type,
        seat: logNumber(cmd.seat),
        use: typeof cmd.use === "boolean" ? cmd.use : undefined,
      };
    default: {
      void (cmd satisfies never);
      // 上行只校验外层，未知命令的内容也可能留在权威日志。
      return { type: "unknown" };
    }
  }
}

/** 回执和座位日志只取显式公开的告警分类。 */
export function publicLogWarningReason({ warning }: LogEvent): string {
  if (warning?.kind === "phaseMismatch") {
    return `阶段不符（需要 ${warning.expected}，当前 ${warning.actual}）`;
  }
  if (warning?.kind === "commandGuard") return COMMAND_WARNING_REASONS[warning.code];
  return "对局产生警告";
}

/** 座位摘要、日志尾段和回执共用公开日志行序。 */
function projectGameLogLine(line: LogEvent): LogEvent | null {
  if (line.category === "header") {
    const { seed: _seed, ...publicHeader } = JSON.parse(line.detail) as Record<string, unknown>;
    return { ...line, detail: JSON.stringify(publicHeader) };
  }
  if (line.category === "cmd") {
    const cmd = JSON.parse(line.detail) as LoggedCommand;
    const projected = projectLogCommand(cmd);
    if (projected === null) return null;
    const detail = JSON.stringify(projected);
    return cmd.type === "respondReaction"
      ? { ...line, player: null, brief: "提交反应命令", detail }
      : { ...line, detail };
  }
  if (line.category === "setup" && line.detail.startsWith("offerHeroes ")) {
    return { ...line, detail: line.detail.split(" heroes=")[0] };
  }
  if (line.category !== "system") return line;
  if (line.detail.startsWith("jinnangCancel ")) return null;
  if (line.detail.startsWith("heroSkillCancel ")) {
    return { ...line, brief: `${line.player} 作罢主动技`, detail: line.detail.split(" skill=")[0] };
  }
  if (line.detail.startsWith("reactionWindow kind=jinnang ")) {
    const [announcement, queried] = line.detail.split(" queried=");
    const count = queried === "" ? 0 : queried.split("+").length;
    return { ...line, detail: `${announcement} queriedCount=${count}` };
  }
  if (line.detail.startsWith("reactionRespond ") && line.detail.includes(" use=1 ")) {
    return { ...line, detail: line.detail.split(" share=")[0] };
  }
  if (isLogWarning(line)) {
    const reason = `${publicLogWarningReason(line)}，原文见服务器日志`;
    const { warning: _warning, ...publicLine } = line;
    return { ...publicLine, brief: `[警告] ${reason}`, detail: `${LOG_WARNING_PREFIX}${reason}` };
  }
  return line;
}

export function projectGameLog(
  log: readonly LogEvent[],
  rawOffset = 0,
  end = log.length,
): LogEvent[] {
  return log.slice(rawOffset, end).flatMap((line) => projectGameLogLine(line) ?? []);
}

/** 权威行游标只在宿主内使用。协议、客户端归档和回执按公开行计数。 */
export interface GameLogCursor {
  rawOffset: number;
  publicOffset: number;
}

export const INITIAL_GAME_LOG_CURSOR: GameLogCursor = { rawOffset: 0, publicOffset: 0 };

export function assembleGameLogDelta(
  engine: GameEngine,
  cursor: GameLogCursor,
  capturedAt: number,
): { next: GameLogCursor; message: GameLogMsg | null } {
  const { log, gameId } = engine;
  const { rawOffset, publicOffset } = cursor;
  if (rawOffset > log.length) throw new Error(`对局 ${gameId} 的日志游标越过末行:${rawOffset}`);
  if (rawOffset === log.length) return { next: cursor, message: null };
  const lines = projectGameLog(log, rawOffset);
  return {
    next: { rawOffset: log.length, publicOffset: publicOffset + lines.length },
    message:
      lines.length === 0
        ? null
        : { type: "gameLog", gameId, offset: publicOffset, lines, capturedAt },
  };
}

/** 座位可见性按 ADR-0016、ADR-0076 投影。公开面包括城池、在手珍宝、锦囊弃堆和手牌张数。
 *  决策者可见本步选项、已定目标及招贤候选。窥探牌面仅经当次事件交付。
 *  反应公告隐藏他人的询问身份，已应答座位与出牌公开，已选份供应答者本人回读。
 *  副本再发布时传入已投影的战报，保留原文及游标。 */
export function redactSnapshotForSeat(
  s: GameSnapshot | (SeatSnapshot & { rngState?: never }),
  seat: number,
  logSource: "authority" | "seat" = "authority",
): SeatSnapshot {
  const { rngState: _rngState, ...snapshot } = s;
  const ownsDecision = s.decisionOwner === seat;
  const log = logSource === "authority" ? projectGameLog(s.log) : s.log;
  const players = s.players.map((p, i) => {
    // 数量走引擎态 jinnangHandCount(公开信息),此处只裁内容
    if (i === seat) return p;
    return { ...p, jinnangHand: [] };
  });
  return {
    ...snapshot,
    players,
    choices: ownsDecision ? s.choices : [],
    pendingJinnang: ownsDecision ? s.pendingJinnang : null,
    pendingSkill: ownsDecision ? s.pendingSkill : null,
    offeredHeroes: ownsDecision ? s.offeredHeroes : [],
    treasureDeck: [],
    jinnangDeck: [], // 牌序只裁不给;剩余数走引擎态 jinnangDeckCount
    pendingReaction: projectSeatReaction(s.pendingReaction, seat),
    reaction: s.reaction != null ? redactReactionView(s.reaction, seat) : s.reaction,
    pendingMoment: undefined, // 续作只由权威驱动，客户端消费公开的技能选择事件。
    pendingExtraTurn: undefined, // 客户端按回合事件推进。
    fireWallSeq: undefined, // 分配编号由权威端负责，客户端读城损和归账事件中的编号。
    events: redactEvents(s.events, seat, "snapshot"),
    log,
    logCount: log.length,
  };
}

/** 大厅返回房间字段，开局后同时附上接收座位可见的局面。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>, seat: number) {
  if (!r.engine) return lobbyView(r, onlineSeats);
  const base = {
    type: "snapshot" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: true,
    mapId: r.mapId,
    seats: seatMeta(r, onlineSeats),
  };
  // 摘要是当前局面的锚点。最新一批事件只经事件通路交付。
  const snapshot = { ...r.engine.snapshot(), events: [] };
  return { ...base, ...redactSnapshotForSeat(snapshot, seat) };
}

// ──────────────────────────── 事件批逐座位过滤(#381,发送总口单点)────────────────────────────
/** 事件批逐座位过滤(#381,ADR-0020 决策 2 的发送总口单点):逐 kind 审计隐私档位后
 *  重建批——公开事件原样透传,携带他人隐藏信息的事件按 ADR-0016 三档口径裁剪。
 *  穷尽 switch:词汇表新增 kind 未在此登记 = 编译期炸(default 收 never),与快照
 *  投影「新增载荷登记」同纪律;运行时对未知 kind 同样当场炸(零兜底)。
 *
 *  全 kind 隐私审计(2026-10,#381):
 *  - 透传(全桌公开面,原样):
 *    · 生命周期族 gameStarted/setupCompleted/turnEnded/turnStarted/roundEnded/
 *      roundStarted/gameOver;
 *    · 掷骰/行军族 diceRolled/marchArrived/capitalHalt/capitalSelected;
 *    · 城池族 propertyBought/propertyUpgraded/propertyRejected/exhaustionResolved/
 *      assetTransferred/assetLiquidated;
 *    · 金钱族 cashChanged(delta/reason/counterpartSeat 皆公开结算);
 *    · 珍宝族 treasureGained/treasureSold/treasureTraded/treasureStolen——名字是明置
 *      信息:珍宝列表随快照全员可见(ADR-0016「珍宝不裁」),引擎战报公开记名
 *      (jinnang-execution stealTreasure 的 logEvent),窃宝动作本就公开、被窃珍宝对
 *      失主并非未知(失主清点自己公开列表即知丢哪件);
 *    · 名将族 heroRecruited/playerBankrupt/heroDismissed(#1147 遣散:遣散者/名将/
 *      折书明细皆公开面)/skillFired/heroSkillActivated(麾下名将
 *      是公开信息);
 *    · 锦囊族 jinnangReshuffled(座位+洗回张数:弃堆本明置、洗回张数公开,洗后牌序不外传——
 *      比 ADR-0016 保密口径只少不多)/
 *      jinnangVoided/jinnangRestored/jinnangInflicted/
 *      reactionAnswered(应答逐条公开记入战报——ADR-0016「应答记录不裁」,use=false
 *      无手牌信息,use=true 的牌已面明打出)/reactionFailed/
 *      duelResolved(#636/ADR-0030:拼点本就公开信息,座位/点数/胜者全员同见);
 *    · 体力与回合状态 staminaChanged/turnSkipped。
 *  - 裁剪:
 *    · jinnangDrawn 仅摸牌座位可见 cardIds，座位、张数和来源（含城格）公开。
 *    · jinnangTargetStepChanged 仅交付操作座位。
 *    · jinnangAnnounced 的牌面和目标公开，离手前的手牌位置仅发给出牌座位。
 *    · reactionAnswered 只给持牌席回读所选份与实际扣牌位置。
 *    · reactionOpened 的 jinnang 窗——view.queriedBySeat 是 per-seat private 档(god-view
 *      全集 = 谁持识破诡计,#281/ADR-0016 同案)。裁剪口径=**身份匿名、数量保留**:
 *      接收座位在列保留自己座位,其余一律置换 ANON_SEAT。数量必须保留:折叠器
 *      (event-fold.ts)闭窗算术「应答数 ≥ queriedBySeat.length」按此数组长度收窗,清零
 *      会让非被询问端在首条应答即误闭窗、第二条应答触发「无挂起反应窗」契约炸出;且
 *      应答事件 seat 本就公开(每被询问座位恰应答一次),同窗内询问数量可由公开应答流
 *      推出——匿名化相对 god-view 恰好只裁「谁」,零额外泄漏(march 窗全公开——城主
 *      归属可由棋盘推导,原样透传)。
 *    · peekApplied(#575)——hand 是被窥者锦囊手牌内容,per-seat private:仅窥方
 *      (viewerSeat)座位保留(窥探弹层的阅览权随事件走,快照无窥探放行),其余座位
 *      一律裁空。viewerSeat/targetSeat 本身公开(窥探动作公开:浮字/战报照记),裁的
 *      只是牌面内容;目标座位本人信息自己本就持有,零额外泄漏。 */
export function redactEvents(
  batch: readonly GameEvent[],
  seat: number,
  delivery: "events" | "snapshot" = "events",
): GameEvent[] {
  return batch.flatMap<GameEvent>((ev) => {
    switch (ev.kind) {
      case "reactionOpened":
        return { ...ev, view: redactReactionView(ev.view, seat) };
      case "peekApplied":
        return delivery === "events" && ev.viewerSeat === seat ? ev : { ...ev, hand: [] };
      case "jinnangDrawn": {
        if (ev.seat === seat) return ev;
        const { cardIds: _cardIds, ...publicDraw } = ev;
        return publicDraw;
      }
      case "jinnangTargetStepChanged":
        return ev.seat === seat ? ev : [];
      case "jinnangAnnounced": {
        if (ev.seat === seat) return ev;
        const { handIndex: _handIndex, ...announcement } = ev;
        return announcement;
      }
      case "reactionAnswered": {
        const { handIndex, target, spentCards, ...answer } = ev;
        return {
          ...answer,
          ...(ev.seat === seat && handIndex !== undefined ? { handIndex } : {}),
          ...(ev.seat === seat && target !== undefined ? { target } : {}),
          ...(spentCards === undefined
            ? {}
            : {
                spentCards: spentCards.map((card) => {
                  if (card.seat === seat) return card;
                  const { handIndex: _handIndex, ...announced } = card;
                  return announced;
                }),
              }),
        };
      }
      // ── 透传族(全桌公开,原样)──
      case "gameStarted":
      case "setupCompleted":
      case "turnEnded":
      case "turnStarted":
      case "roundEnded":
      case "roundStarted":
      case "gameOver":
      case "diceRolled":
      case "marchArrived":
      case "landingResolved":
      case "capitalHalt":
      case "capitalSelected":
      case "propertyBought":
      case "propertyUpgraded":
      case "propertyDamaged":
      case "fireWallImpact":
      case "propertyBurningChanged":
      case "propertyBurningTicked":
      case "propertyRejected":
      case "cashChanged":
      case "treasureGained":
      case "treasureSold":
      case "treasureTraded":
      case "treasureStolen":
      case "assetLiquidated":
      case "bankruptcySettled":
      case "assetTransferred":
      case "heroRecruited":
      case "playerBankrupt":
      case "heroDismissed": // #1147 遣散:遣散者/名将/折书明细皆公开面(麾下与招贤池是公开信息,ADR-0016)
      case "skillFired":
      case "skillChoiceOpened": // 名将、已授技能、标记和触发/目标席均为公开状态。
      case "skillChoiceAnswered":
      case "skillMarksChanged":
      case "skillLearned": // #1146 用书学技:习得者/技/消耗书皆公开面(麾下与珍宝列表不裁,ADR-0016)
      case "heroSkillActivated":
      case "jinnangReshuffled":
      case "jinnangExhausted": // #588:双空落空宣告(零转移纯宣告,无座位外隐私字段)
      case "staminaChanged":
      case "turnSkipped":
      case "exhaustionResolved":
      case "jinnangPhaseResumed":
      case "reactionFailed":
      case "duelResolved": // 参与座位、点数与胜者均公开
      case "jinnangVoided":
      case "jinnangRestored":
      case "jinnangInflicted":
        return ev;
      default: {
        const unregistered: never = ev; // 词汇表新增 kind 漏登隐私档位 → 编译期在此炸
        void unregistered;
        throw new Error(
          `redactEvents:事件 kind "${(ev as { kind: string }).kind}" 未登记隐私档位(新增事件必须先在此登记口径,#381)`,
        );
      }
    }
  });
}

// ──────────────────────────── 单拍下行装配(#431,发送总口单点执行体)────────────────────────────
interface DownlinkShot {
  events: string | null;
  decisionPoint: string | null;
}

function decisionOptionsOf(e: GameEngine, seat: number): DecisionOptions | undefined {
  if (e.phase === "Setup") {
    return {
      kind: "pickCapital",
      options: e.offeredCapitals.map((tileIndex) => {
        const option = capitalChoiceOf(e, seat, tileIndex);
        if (!("tileIndex" in option)) throw new Error(`选都候选 ${tileIndex}：${option.reason}`);
        return option;
      }),
    };
  }
  if (e.turnPhase === "AwaitingJinnang") {
    return {
      kind: "playJinnang",
      choices: e.choicesFor(),
      pendingJinnang: e.pendingJinnang,
      pendingSkill: e.pendingSkill,
    };
  }
  if (e.turnPhase === "AwaitingDecision") return landDecisionOf(e);
  if (e.turnPhase === "AwaitingHeroPick") return recruitmentDecisionOf(e);
  if (e.turnPhase === "AwaitingTreasureOwner") return treasureDecisionOf(e);
  if (e.turnPhase === "AwaitingBankruptcySettle") return bankruptcyDecisionOf(e);
  if (e.turnPhase === "AwaitingReaction") return reactionChoicesForSeat(e, seat);
  if (e.turnPhase === "AwaitingSkillChoice") return skillChoiceDecisionOf(e);
  return undefined;
}

/** 单机和联机按接收座位装配同一种 JSON 下行。事件批携带当次授权，首连、重连和校准
 *  附上座位摘要；常规事件拍可跳过整份日志的序列化。日志游标按实际发送的行数计算。 */
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number,
  batch: readonly GameEvent[],
  withSnapshot: true,
): DownlinkShot & { snapshot: string; logCursor: GameLogCursor };
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number,
  batch: readonly GameEvent[],
  withSnapshot: false,
  previousDecisionPoint?: string | null,
): DownlinkShot & { snapshot: null; logCursor: null };
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number,
  batch: readonly GameEvent[],
  withSnapshot: boolean,
  previousDecisionPoint?: string | null,
): DownlinkShot & { snapshot: string | null; logCursor: GameLogCursor | null } {
  const e = r.engine;
  const view = e?.turnPhase === "AwaitingReaction" ? e.pendingReaction?.view : null;
  const reactionTiming =
    view != null &&
    (view.kind === "march"
      ? view.ownerSeat === viewerSeat
      : view.queriedBySeat.includes(viewerSeat))
      ? reactionTimingOf(r)
      : undefined;
  const decisionPoint = seatDecisionPointOf(r, viewerSeat);
  const decisionOptions =
    e !== null && decisionPoint !== null ? decisionOptionsOf(e, viewerSeat) : undefined;
  const visibleEvents = redactEvents(batch, viewerSeat);
  // 房间元数据可单独改变本席的操作权，例如在原反应窗内收回托管。
  const decisionChanged =
    previousDecisionPoint !== undefined && decisionPoint !== previousDecisionPoint;
  const events =
    visibleEvents.length > 0 || decisionChanged
      ? eventsMsg(visibleEvents, reactionTiming, decisionPoint, decisionOptions)
      : null;
  if (!withSnapshot) return { events, decisionPoint, snapshot: null, logCursor: null };
  const snapshot = clientView(r, onlineSeats, viewerSeat);
  return {
    events,
    decisionPoint,
    snapshot: encodeDownlink(
      snapshot.type === "snapshot"
        ? { ...snapshot, reactionTiming, decisionPoint, decisionOptions }
        : snapshot,
    ),
    logCursor:
      snapshot.type === "snapshot"
        ? { rawOffset: e!.log.length, publicOffset: snapshot.log.length }
        : INITIAL_GAME_LOG_CURSOR,
  };
}

// ──────────────────────────── 关键节点校准触发(#388 判定口径,#431 类型化归口)────────────────────────────
// 校准触发登记从 server.ts 归口本模块(#431):与装配口同居一文件——校准判定(何时
// 发 ②)与单拍装配(②怎么配)是同一份下行政策。折叠端不折清单(客户端 event-fold.ts
// 「校准兜底项」)与本校准触发的对账以 #430 档位表(EVENT_TIERS)为底册:
// fold=calibration-only / fold+calibration 的漂移窗即校准的消费面,覆盖关系由下方
// CALIBRATION_COVERAGE 逐 kind 点名(漏点名 = 编译红)。
/** 决策窗校准相位(#388):进入/停留/退出都强制全量(判定依据=引擎公开 turnPhase;
 *  退出沿无相位事件,由 flush 侧 prev/settled 前后沿夹出)。ReadonlySet<TurnPhase>:
 *  相位改名 = 编译红(字符串集合退役,#431;bot-driver INPUT_PHASES 同款纪律的登记面
 *  补齐)。 */
export const CALIBRATION_WINDOWS: ReadonlySet<TurnPhase> = new Set([
  "AwaitingJinnang",
  "AwaitingHeroPick",
  "AwaitingBankruptcySettle",
]);
/** 同一出牌窗内只有私有目标段推进时，由事件交付完整变更。 */
export function isPrivateJinnangStepBatch(
  previous: TurnPhase | null,
  current: TurnPhase | null,
  events: readonly GameEvent[],
): boolean {
  return (
    previous === "AwaitingJinnang" &&
    current === "AwaitingJinnang" &&
    events.length > 0 &&
    events.every((event) => event.kind === "jinnangTargetStepChanged")
  );
}

/** 节点事件校准(#388):开局发牌、破产和中途洗回弃牌时，座位摘要校准可见牌面及数量。
 *  ReadonlySet<EventKind>:kind 改名 = 编译红(同上)。 */
export const CALIBRATION_EVENT_KINDS: ReadonlySet<EventKind> = new Set([
  "gameStarted",
  "playerBankrupt",
  "jinnangReshuffled",
]);
/** 校准兜底 kind 集(#430 档位表推导):fold ∈ {fold+calibration, calibration-only}——
 *  折叠面不精确折/刻意不折,转移由校准快照覆盖(对账底册见下方 CALIBRATION_COVERAGE)。
 *  #529 起兼作窗闭沿校准的判据面:闭沿批为空批或含兜底 kind 才落校准——托管步进经
 *  时钟异步步进(#580 归一单节拍 2s/步)把每个闭沿都冲洗成独立 flush,不限流 doom
 *  全量快照随每次出牌闭沿跟发,退化成逐步广播(违背 ADR-0020「快照不再作为逐步同步
 *  单元」);普通 kind 结算折叠精确,事件批即事实,无需快照随车。 */
export const CALIBRATION_BACKED_KINDS: ReadonlySet<EventKind> = new Set(
  (Object.entries(EVENT_TIERS) as [EventKind, (typeof EVENT_TIERS)[EventKind]][])
    .filter(([, tier]) => tier.fold === "fold+calibration" || tier.fold === "calibration-only")
    .map(([kind]) => kind),
);
/** 校准覆盖对账(#431,吃 #430 档位表):fold=calibration-only 的 kind(折叠面刻意
 *  不折,漂移由校准兜)必须在此逐个点名覆盖触发;词汇表新增 calibration-only kind
 *  未点名 = 编译红(强制先想清楚校准谁兜,或回 EVENT_TIERS 改档/声明漂移纯信任
 *  ADR-0020 决策 5 的具体理由)。覆盖触发的登记本体 = 上面两集合 + flush 侧
 *  phase=Setup 判定(server.ts);fold+calibration 档的漂移窗由同表 why 字段登记,
 *  不在本表重复。 */
export const CALIBRATION_COVERAGE = {
  setupCompleted: "开局校准点:phase=Setup 全程强制全量 + gameStarted 批(finishSetup)",
  treasureStolen: "出牌阶段窗沿:窃玉结算随 AwaitingJinnang 窗闭批,prev/settled 前后沿夹出",
} as const satisfies {
  readonly [
    K in EventKind as (typeof EVENT_TIERS)[K]["fold"] extends "calibration-only" ? K : never
  ]: string;
};

// ──────────────────────────── 驱动/看门狗共用的座位判定 ────────────────────────────
/** 该座位当前是否由服务器驱动(原生 bot,或托管中——ADR-0028 单一开关,含看门狗代开)。 */
export function seatControlled(r: RoomSession, seat: number): boolean {
  return r.engine != null && (r.engine.players[seat]?.isBot || r.autoPilot.has(seat));
}

/** 廉价状态指纹:任何真实进展都会改变它(防 botAct 空转死循环)。
 *  必须覆盖所有"无资源变化的进展":位置移动、跳过轮空消耗、回合推进——
 *  曾经漏了这三者,导致"掷骰落空格 + 对手跳过"被误判 no-progress,全 bot/托管局卡死(症状1根因)。 */
export function fingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.setupPhase,
    e.turnPhase,
    e.turnNumber,
    e.activeIndex,
    e.currentDraftIndex,
    e.players
      .map(
        (p) =>
          `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}:${p.position}:${p.skipTurns}`,
      )
      .join(","),
  ].join("|");
}

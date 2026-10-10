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
import type { GameEngine, TurnPhase } from "../src/core/authority";
import type { GameSnapshot } from "../src/core/snapshot";
import type { ReactionView } from "../src/core/reaction-window";
import type { GameEvent } from "../src/core/game-events";
import { EVENT_TIERS, type EventKind } from "../src/core/event-tiers";
import type { RoomSession } from "./room";
// 下行封装构造收口 wire.ts(#429):装配口只管形状与裁剪,序列化不另起炉灶。
// (wire 对本模块/room 的引用全是 type 导入,构建期擦除,无运行时环。)
import { encodeDownlink, eventsMsg } from "./wire";

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
    // 该座位当前是否由服务器驱动:开局前 bot 座位;开局后 bot 座位或被房主接管的座位
    controlled: r.engine ? r.engine.players[i].isBot || r.takeover.has(i) : s.kind === "bot",
    // 自助托管中(bot 代打,但身份仍是真人;UI 据此显示「托管」标记)
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

/** 反应窗公开载荷的 per-seat 投影(#281,ADR-0016):公告字段(cardId/userSeat/
 *  targetSeats)public 原样;queriedBySeat 是 per-seat private 档——每人只看到「我是否
 *  被询问」(在列→[自己座位],不在列→[]),他人询问集一律裁掉,否则泄漏谁持识破诡计。
 *  march 窗无私有档,原样返回。纯函数。 */
function redactReactionView(v: ReactionView, seat: number): ReactionView {
  if (v.kind !== "jinnang") return v;
  return { ...v, queriedBySeat: v.queriedBySeat.includes(seat) ? [seat] : [] };
}

/** 锦囊暗牌投影(ADR-0016):god-view 快照按「接收座位」裁剪。白名单三档——
 *  public 原样 / count-only 只给数量 / private 只发本人:
 *  - 他人锦囊手牌 → count-only(清空内容 + jinnangHandCount 数量);
 *  - 锦囊牌库牌序 → count-only(牌序决定未来抽牌,泄了等于开了天眼;只留剩余数);
 *  - 含锦囊内容的对局日志行 → 不外发(引擎侧已源头不落内容,此处按机读键过滤抽牌行,防御性双保险);
 *  - 反应窗询问集(#281)→ per-seat private(挂起态 pendingReaction.view 与公开派生
 *    载荷 reaction 两处同裁;应答记录不裁——引擎侧本就逐条公开记入战报);
 *  - 其余(银两/城池/珍宝/弃牌堆…)全部 public 原样——明置信息不裁。
 *  纯函数:不改输入;单测直测(redact 缝,ADR-0016 的落点)。 */
export function redactSnapshotForSeat(s: GameSnapshot, seat: number): GameSnapshot {
  // 军情密探(#122/T4):本座位进行中的窥探目标,内容对 viewer 放行
  const peeked = new Set(s.jinnangPeeks.filter((pk) => pk.viewer === seat).map((pk) => pk.target));
  const players = s.players.map((p, i) => {
    // 数量走引擎态 jinnangHandCount(公开信息),此处只裁内容
    if (i === seat || peeked.has(i)) return p;
    return { ...p, jinnangHand: [] };
  });
  return {
    ...s,
    players,
    jinnangDeck: [], // 牌序只裁不给;剩余数走引擎态 jinnangDeckCount
    // 反应窗询问集(#281):挂起态(god-view)与公开载荷两处都按座位投影——
    // 客户端 restoreFromSnapshot 靠裁剪后的挂起态重建 AwaitingReaction,公开载荷
    // 随之派生,UI 只会看到「我是否被询问」。
    pendingReaction:
      s.pendingReaction != null
        ? { ...s.pendingReaction, view: redactReactionView(s.pendingReaction.view, seat) }
        : s.pendingReaction,
    reaction: s.reaction != null ? redactReactionView(s.reaction, seat) : s.reaction,
    // 日志不裁(ADR-0016 决策3):引擎源头只写「抽了一张锦囊」无内容,抽牌行本身
    // 是公开信息(手牌数),随快照照发
  };
}

/** clientView:snapshot 态把 engine.snapshot() 展开;Lobby 态退化为 lobbyView。
 *  snapshot 分支携带与 lobby 相同的房间字段(roomId/seatCount/host/started/mapId/seats)
 *  + 引擎快照展开(快照无同名键,不冲突)。
 *  seat(ADR-0016):接收方座位——传入即返回该座位的投影(锦囊暗牌/牌序/抽牌日志已裁);
 *  缺省/null = god-view 全量(重放/调试/单测语义;#431 起生产 ws 下行一律经
 *  assembleDownlinkShot 装配,redaction 在装配内必经,直呼本函数不再出现在传输面)。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>, seat?: number | null) {
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
  const snap = r.engine.snapshot();
  return { ...base, ...(seat == null ? snap : redactSnapshotForSeat(snap, seat)) };
}

// ──────────────────────────── 事件批逐座位过滤(#381,发送总口单点)────────────────────────────
/** 匿名座位占位:queriedSeats 裁剪后被剥身份的座位一律置换为它——非合法座位号,
 *  消费面(折叠器闭窗算术读 length、控制器/UI 读 includes(自己))都不会把它当人。 */
const ANON_SEAT = -1;

/** 事件批逐座位过滤(#381,ADR-0020 决策 2 的发送总口单点):逐 kind 审计隐私档位后
 *  重建批——公开事件原样透传,携带他人隐藏信息的事件按 ADR-0016 三档口径裁剪。
 *  穷尽 switch:词汇表新增 kind 未在此登记 = 编译期炸(default 收 never),与快照
 *  投影「新增载荷登记」同纪律;运行时对未知 kind 同样当场炸(零兜底)。
 *
 *  全 38 kind 隐私审计(2026-10,#381):
 *  - 透传(37 kind,全桌公开面,原样):
 *    · 生命周期族 gameStarted/setupCompleted/turnEnded/turnStarted/roundEnded/
 *      roundStarted/gameOver;
 *    · 掷骰/行军族 diceRolled/marchArrived/capitalHalt/capitalSelected;
 *    · 城池族 propertyBought/propertyUpgraded/propertyRejected/exhaustionChoice/
 *      assetTransferred/assetLiquidated;
 *    · 金钱族 cashChanged(delta/reason/counterpartSeat 皆公开结算);
 *    · 珍宝族 treasureGained/treasureSold/treasureTraded/treasureStolen——名字是明置
 *      信息:珍宝列表随快照全员可见(ADR-0016「珍宝不裁」),引擎战报公开记名
 *      (jinnang-execution stealTreasure 的 logEvent),窃宝动作本就公开、被窃珍宝对
 *      失主并非未知(失主清点自己公开列表即知丢哪件);
 *    · 名将族 heroRecruited/playerBankrupt/skillFired/heroSkillActivated(麾下名将
 *      是公开信息);
 *    · 锦囊族 jinnangDrawn(count-only 设计,#384:座位+张数口径不写牌名,核实无需改)/
 *      jinnangAnnounced(出牌本就公开宣布)/jinnangVoided/jinnangInflicted/
 *      reactionAnswered(应答逐条公开记入战报——ADR-0016「应答记录不裁」,use=false
 *      无手牌信息,use=true 的牌已面明打出)/reactionFailed;
 *    · 机遇族 encounterTriggered/encounterChoice;声望/体力/跳过族 reputationChanged/
 *      staminaChanged/turnSkipped。
 *  - 裁剪(1 kind):reactionOpened 的 jinnang 窗——queriedSeats 是 per-seat private 档
 *    (god-view 全集 = 谁持识破诡计,#281/ADR-0016 同案)。裁剪口径=**身份匿名、数量
 *    保留**:接收座位在列保留自己座位,其余一律置换 ANON_SEAT。数量必须保留:折叠器
 *    (event-fold.ts)闭窗算术「应答数 ≥ queriedBySeat.length」按此数组长度收窗,清零
 *    会让非被询问端在首条应答即误闭窗、第二条应答触发「无挂起反应窗」契约炸出;且
 *    应答事件 seat 本就公开(每被询问座位恰应答一次),同窗内询问数量可由公开应答流
 *    推出——匿名化相对 god-view 恰好只裁「谁」,零额外泄漏(march 窗全公开——城主
 *    归属可由棋盘推导,原样透传)。
 *  纯函数:不改输入;单测直测。 */
export function redactEvents(batch: readonly GameEvent[], seat: number): GameEvent[] {
  return batch.map((ev) => {
    switch (ev.kind) {
      case "reactionOpened":
        if (ev.windowKind !== "jinnang") return ev; // march 窗全公开(城主=棋盘可推导)
        return { ...ev, queriedSeats: ev.queriedSeats.map((s) => (s === seat ? seat : ANON_SEAT)) };
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
      case "capitalHalt":
      case "capitalSelected":
      case "propertyBought":
      case "propertyUpgraded":
      case "propertyRejected":
      case "cashChanged":
      case "treasureGained":
      case "treasureSold":
      case "treasureTraded":
      case "treasureStolen":
      case "assetLiquidated":
      case "assetTransferred":
      case "heroRecruited":
      case "playerBankrupt":
      case "skillFired":
      case "heroSkillActivated":
      case "jinnangDrawn":
      case "reputationChanged":
      case "staminaChanged":
      case "turnSkipped":
      case "encounterTriggered":
      case "encounterChoice":
      case "exhaustionChoice":
      case "jinnangAnnounced":
      case "reactionAnswered":
      case "reactionFailed":
      case "jinnangVoided":
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
/** 单拍下行装配(ADR-0020 决策 2「发送总口单点」的执行体,#431):两个传输面
 *  (server.ts flushRoom/open 摘要 + room.ts flushTransport/connectSeat 摘要)的
 *  逐座位下行只此一个装配口——①事件批消息 + ②整房摘要消息在此一次配齐、封装成
 *  线上 JSON,redaction 是装配必经步而非调用纪律:
 *  - viewerSeat 传座位 → 事件批过 redactEvents、摘要过 redactSnapshotForSeat(联机
 *    必裁;将来观战/回放类消费面复用本口,传座位默认拿裁剪流);
 *  - viewerSeat 传 null → 显式 god-view 退化(单机内存直连唯一合法取值:本机单真人
 *    无跨设备泄密面;泄漏面想不走裁剪必须先在签名上写出这个 null,「忘了裁」不存在)。
 *  withSnapshot:②是否随拍构造——联机校准判定为真才发(快照含全量 log,非校准
 *  flush 不白付 O(log) 序列化),单机恒发;①恒装配(空批自然产出 null)。
 *  纯函数:不改输入;零兜底——redactEvents 对未登记 kind 当场炸(编译期穷尽 switch
 *  + 运行期双保险,防遗漏机器见 test/downlink-assembly.test.ts)。
 *  返回型按 withSnapshot 收窄:要摘要必得摘要(true 恒 string),调用方免空判。 */
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number | null,
  batch: readonly GameEvent[],
  withSnapshot: true,
): { events: string | null; snapshot: string };
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number | null,
  batch: readonly GameEvent[],
  withSnapshot: false,
): { events: string | null; snapshot: null };
export function assembleDownlinkShot(
  r: RoomSession,
  onlineSeats: Set<number>,
  viewerSeat: number | null,
  batch: readonly GameEvent[],
  withSnapshot: boolean,
): { events: string | null; snapshot: string | null } {
  const events =
    batch.length > 0
      ? eventsMsg(viewerSeat == null ? [...batch] : redactEvents(batch, viewerSeat))
      : null;
  return {
    events,
    snapshot: withSnapshot ? encodeDownlink(clientView(r, onlineSeats, viewerSeat)) : null,
  };
}

// ──────────────────────────── 关键节点校准触发(#388 判定口径,#431 类型化归口)────────────────────────────
// 校准触发登记从 server.ts 归口本模块(#431):与装配口同居一文件——校准判定(何时
// 发 ②)与单拍装配(②怎么配)是同一份下行政策。折叠端不折清单(客户端 event-fold.ts
// 「校准兜底项」)与本校准触发的对账以 #430 档位表(EVENT_TIERS)为底册:
// fold=calibration-only / fold+calibration 的漂移窗即校准的消费面,覆盖关系由下方
// CALIBRATION_COVERAGE 逐 kind 点名(漏点名 = 编译红)。
/** 决策窗校准相位(#388):进入/停留/退出都强制全量(判定依据=引擎公开 turnPhase;
 *  退出沿无相位事件,由 flush 侧 prev/settled 前后沿夹出——窃玉偷香/火攻降级等
 *  锦囊结算批随窗闭沿落校准)。ReadonlySet<TurnPhase>:相位改名 = 编译红(字符串
 *  集合退役,#431;bot-driver INPUT_PHASES 同款纪律的登记面补齐)。 */
export const CALIBRATION_WINDOWS: ReadonlySet<TurnPhase> = new Set([
  "AwaitingJinnang",
  "AwaitingHeroPick",
  "AwaitingEncounter",
  "AwaitingExhaustion",
  "AwaitingBankruptcySettle",
]);
/** 节点事件校准(#388):批内出现即全量。牌库洗牌只发生在 finishSetup(buildJinnangDeck),
 *  随 gameStarted 批覆盖;core 现无中途洗牌,将来新增须随事件产出在此登记。
 *  ReadonlySet<EventKind>:kind 改名 = 编译红(同上)。 */
export const CALIBRATION_EVENT_KINDS: ReadonlySet<EventKind> = new Set([
  "gameStarted",
  "playerBankrupt",
]);
/** 校准覆盖对账(#431,吃 #430 档位表):fold=calibration-only 的 kind(折叠面刻意
 *  不折,漂移由校准兜)必须在此逐个点名覆盖触发;词汇表新增 calibration-only kind
 *  未点名 = 编译红(强制先想清楚校准谁兜,或回 EVENT_TIERS 改档/声明漂移纯信任
 *  ADR-0020 决策 5 的具体理由)。覆盖触发的登记本体 = 上面两集合 + flush 侧
 *  phase=Setup 判定(server.ts);fold+calibration 档的漂移窗由同表 why 字段登记,
 *  不在本表重复。 */
export const CALIBRATION_COVERAGE = {
  setupCompleted: "开局校准点:phase=Setup 全程强制全量 + gameStarted 批(finishSetup)",
  treasureStolen: "军师窗沿:窃玉结算随 AwaitingJinnang 窗闭批,prev/settled 前后沿夹出",
} as const satisfies {
  readonly [
    K in EventKind as (typeof EVENT_TIERS)[K]["fold"] extends "calibration-only" ? K : never
  ]: string;
};

// ──────────────────────────── 驱动/看门狗共用的座位判定 ────────────────────────────
/** 该座位当前是否由服务器驱动(原始 bot、被房主接管、或自助托管中)。 */
export function seatControlled(r: RoomSession, seat: number): boolean {
  return (
    r.engine != null &&
    (r.engine.players[seat]?.isBot || r.takeover.has(seat) || r.autoPilot.has(seat))
  );
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
          `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}:${p.position}:${p.skipTurns}:${p.warrants}`,
      )
      .join(","),
  ].join("|");
}

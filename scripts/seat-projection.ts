// 客户端投影层(ADR-0016 per-seat 投影的联机侧)——从 room.ts 拆出(模块治理 10/11 #327,纯搬不改)。
// 大厅/快照视图 + 锦囊暗牌 per-seat 裁剪 + 服务器驱动判定 + 廉价进展指纹。
// 纯函数,零 WS/HTTP/fs 依赖;room.ts 持会话模型,server.ts(传输层)与测试直接消费。
//
// clientView/lobbyView 自 2026-08-14(架构待办③)起:snapshot 消息补齐 seatCount/started/mapId,
// 与 lobby 消息的房间字段对齐——客户端从任一消息都能直接得到完整房间态,无需手抄推断。
// (个人项目,不考虑旧协议兼容;客户端 network-client.ts 同步改。)
import type { GameEngine } from "../src/core/game";
import type { GameSnapshot } from "../src/core/snapshot";
import type { ReactionView } from "../src/core/types";
import type { RoomSession } from "./room";

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
 *  缺省 = god-view 全量(重放/调试/单测语义,生产 ws 路径一律传 seat)。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>, seat?: number) {
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

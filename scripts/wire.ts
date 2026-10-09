// wire 协议编解码单源(#429):一条上行消息长什么样、如何分发、失败怎么回报,
// 一条下行消息如何构造,全部收口本模块——server.ts(联机 WS)与 local.ts(单机内存
// 双工)两侧逐 type 双写与「注释互指同契约」就此退役。
//
// 零运行时依赖(单机浏览器 / 联机 bun 双端可 import;类型面仅引 core 与 scripts 内
// 类型,类型导入构建期擦除;依赖方向 app → scripts 已由 local.ts import room 先例成立)。
//
// 契约:
// - 上行(InboundMsg)三族:cmd / pickCapital / autoPilot。dispatchInbound 一次完成
//   解析 + 分发,**错误回报是返回值的一部分**(InboundResult),任何失败都不抛出到
//   传输层之外——传输面(adapter)只负责把失败送到各自通道:WS = error 消息下行,
//   内存 = pushHint(结构性失败在内存面属自身 bug,adapter 自行抛出,零兜底)。
// - 下行(ServerMsg)五族:lobby / snapshot(clientView/lobbyView 产出,编解码只管
//   封装)、events / dismissed / error(本模块构造函数产出)。redaction 归属在
//   seat-projection(下行装配另票),本模块只收编形状。
// - 穷尽纪律:dispatch 对 InboundMsg 穷尽 switch(新增消息类型漏分支 = 编译红,
//   default 收 never),与 seat-projection redactEvents 同机器。
import type { GameCommand } from "../src/core/authority";
import type { AutoPilotSpeed } from "./room";
import type { GameEvent } from "../src/core/game-events";
import type { GameSnapshot } from "../src/core/snapshot";
import type { LobbyView } from "./seat-projection";

// ──────────────────────────── 上行:union + 编码 ────────────────────────────
/** 上行消息(线上形状解析归一后):autoPilot 的 speed 在此归一为 fast|slow
 *  (线上缺省/乱值一律 fast——原 server.ts/local.ts 双写的同一句归一)。 */
export type InboundMsg =
  | { type: "cmd"; cmd: GameCommand }
  | { type: "pickCapital"; tileIndex: number }
  | { type: "autoPilot"; on: boolean; speed: AutoPilotSpeed };

/** 上行编码(客户端发送端单源;手写判别字面量 = 双写复辟)。 */
export function cmdMsg(cmd: GameCommand): string {
  return JSON.stringify({ type: "cmd" as const, cmd });
}
export function pickCapitalMsg(tileIndex: number): string {
  return JSON.stringify({ type: "pickCapital" as const, tileIndex });
}
export function autoPilotMsg(on: boolean, speed: AutoPilotSpeed): string {
  return JSON.stringify({ type: "autoPilot" as const, on, speed });
}

// ──────────────────────────── 下行:union + 构造 ────────────────────────────
/** 事件批消息(#390 唯一对局状态通路;词汇表见 core/game-events.ts)。 */
export interface EventBatchMsg {
  type: "events";
  events: GameEvent[];
}

/** lobby/snapshot 共带的房间字段(与客户端 netStore.NetRoomFields 投影一致;
 *  产出单源 seat-projection 的 clientView/lobbyView)。 */
export interface WireRoomFields {
  roomId: string;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: LobbyView["seats"];
}

/** snapshot 消息 = 房间字段 + 引擎快照展开(快照无同名键,见 seat-projection clientView)。 */
export type SnapshotMsg = { type: "snapshot" } & WireRoomFields & GameSnapshot;

/** 下行消息 union(线上形状单源;客户端 online.ts/local.ts 从此 import)。 */
export type ServerMsg =
  | LobbyView
  | SnapshotMsg
  | EventBatchMsg
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

/** 事件批消息构造(flush 下行;per-seat 过滤在调用方 seat-projection redactEvents)。 */
export function eventsMsg(events: GameEvent[]): string {
  return JSON.stringify({ type: "events" as const, events });
}
/** 错误回报消息构造(WS 面唯一错误通道的形状)。 */
export function errorMsg(error: string): string {
  return JSON.stringify({ type: "error" as const, error });
}
/** 房间解散消息构造。 */
export function dismissedMsg(roomId: string): string {
  return JSON.stringify({ type: "dismissed" as const, roomId });
}
/** 下行封装单口:lobby/snapshot 等已成形的 union 成员原样序列化。 */
export function encodeDownlink(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

// ──────────────────────────── 上行:parse + dispatch ────────────────────────────
/** 上行执行面:每族消息一个执行器(传输面注入,绑定各自的房间/座位/广播回调;
 *  RoomRegistry 公共入口在两侧是同一份,差异只在绑定参数)。 */
export interface InboundOps {
  cmd(cmd: GameCommand): Promise<unknown> | unknown;
  pickCapital(tileIndex: number): Promise<unknown> | unknown;
  setAutoPilot(on: boolean, speed: AutoPilotSpeed): Promise<unknown> | unknown;
}

/** 上行分发结果——错误回报是返回值的一部分,不抛到传输层之外:
 *  - badJson:帧不是合法 JSON(文本 "bad json");
 *  - unknownShape:JSON 合法但不是 InboundMsg 任一成员(缺省文案给 WS 面的
 *    「期望形状」引导;对局未开始的房间由 WS 面覆写 unknownShapeText);
 *  - rejected:ops 执行抛错(房间编排 RoomError / 引擎零兜底 TypeError 等,
 *    文本原样透传给发送者)。 */
export type InboundResult =
  | { ok: true }
  | { ok: false; reason: "badJson"; message: string }
  | { ok: false; reason: "unknownShape"; message: string }
  | { ok: false; reason: "rejected"; message: string };

/** unknownShape 缺省文案(对局已开时的期望形状引导;原 server.ts else 分支同款)。 */
const UNKNOWN_SHAPE_TEXT = "expected {type:'cmd',cmd:...}";

/** 线上形状 → InboundMsg(逐族校验与归一;不匹配返回 null)。 */
function parseInboundMsg(m: unknown): InboundMsg | null {
  if (typeof m !== "object" || m === null) return null;
  const r = m as Record<string, unknown>;
  if (r.type === "cmd" && r.cmd) return { type: "cmd", cmd: r.cmd as GameCommand };
  if (r.type === "pickCapital" && typeof r.tileIndex === "number") {
    return { type: "pickCapital", tileIndex: r.tileIndex };
  }
  if (r.type === "autoPilot" && typeof r.on === "boolean") {
    return { type: "autoPilot", on: r.on, speed: r.speed === "slow" ? "slow" : "fast" };
  }
  return null;
}

/** 解析 + 分发一条上行消息(单机/联机两侧消息处理器的唯一本体):
 *  逐族进 ops,执行抛错(含异步拒绝)捕获为 rejected——非法命令→错误回报值,
 *  不抛到传输层外(#428 口径收编为 codec 契约,漏 catch 无处藏身)。 */
export async function dispatchInbound(
  raw: string,
  ops: InboundOps,
  opts?: { unknownShapeText?: string },
): Promise<InboundResult> {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "badJson", message: "bad json" };
  }
  const msg = parseInboundMsg(m);
  if (!msg) {
    return {
      ok: false,
      reason: "unknownShape",
      message: opts?.unknownShapeText ?? UNKNOWN_SHAPE_TEXT,
    };
  }
  try {
    switch (msg.type) {
      case "cmd":
        await ops.cmd(msg.cmd);
        break;
      case "pickCapital":
        await ops.pickCapital(msg.tileIndex);
        break;
      case "autoPilot":
        await ops.setAutoPilot(msg.on, msg.speed);
        break;
      default: {
        // 穷尽机器:InboundMsg 新增成员漏分支 = 编译红(default 收 never)。
        const _exhaustive: never = msg;
        throw new Error(`wire:未分发的上行消息:${String(_exhaustive)}`);
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: "rejected",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
}

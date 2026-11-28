import type { GameSnapshot } from "../engine/snapshot";
import type { RoomSession } from "./room";
import type { RoomRecord } from "./room-record";
import type { ReactionTiming } from "../protocol/wire";

export interface ReactionDeadline {
  readonly seq: number;
  readonly deadlineAt: number;
}

type ReactionState = Pick<GameSnapshot, "turnPhase" | "pendingReaction"> | null;
const deadlines = new WeakMap<RoomSession, { deadline: ReactionDeadline; now: () => number }>();

function pendingReactionOf(roomId: string, state: ReactionState) {
  if (state?.turnPhase !== "AwaitingReaction") return null;
  if (state.pendingReaction == null) throw new Error(`房间 ${roomId} 缺少挂起的反应窗`);
  return state.pendingReaction;
}

/** 按待保存局面派生截止，同窗沿用已经提交的时刻。 */
export function deriveReactionDeadline(
  room: RoomSession,
  state: ReactionState,
  now: () => number,
): ReactionDeadline | null {
  const pending = pendingReactionOf(room.roomId, state);
  if (pending === null) return null;
  const current = deadlines.get(room);
  if (current?.deadline.seq === pending.seq) return current.deadline;
  return { seq: pending.seq, deadlineAt: now() + pending.view.windowMs };
}

/** 安装已保存的截止。返回登记是否变化，以便撤销上一窗的定时器。 */
export function installReactionDeadline(
  room: RoomSession,
  deadline: ReactionDeadline | null,
  now: () => number,
): boolean {
  if (deadline === null) return deadlines.delete(room);
  const current = deadlines.get(room);
  if (current?.deadline === deadline) return false;
  deadlines.set(room, { deadline, now });
  return true;
}

export function reactionDeadlineFromRecord(record: RoomRecord): ReactionDeadline | null {
  const pending = pendingReactionOf(record.roomId, record.snapshot);
  const deadline = record.reactionDeadline;
  if (pending === null && deadline === undefined) return null;
  if (
    pending !== null &&
    deadline != null &&
    deadline.seq === pending.seq &&
    Number.isFinite(deadline.deadlineAt)
  )
    return deadline;
  throw new Error(`房间 ${record.roomId} 的反应窗截止记录损坏`);
}

export function reactionTimingOf(room: RoomSession): ReactionTiming {
  const current = deadlines.get(room);
  if (current == null || current.deadline.seq !== pendingReactionOf(room.roomId, room.engine)?.seq)
    throw new Error(`房间 ${room.roomId} 的反应窗缺少权威截止时刻`);
  const { deadline, now } = current;
  return { seq: deadline.seq, remainingMs: Math.max(0, deadline.deadlineAt - now()) };
}

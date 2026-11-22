import type { RoomSession } from "./room";
import type { ReactionTiming } from "../protocol/wire";

interface ReactionDeadline {
  seq: number;
  deadlineAt: number;
  now: () => number;
}

const deadlines = new WeakMap<RoomSession, ReactionDeadline>();

/** 每个活窗只登记一次。返回窗号是否变化，以便撤掉上一窗的表。 */
export function syncReactionDeadline(room: RoomSession, now: () => number): boolean {
  const e = room.engine;
  const pending = e?.turnPhase === "AwaitingReaction" ? e.pendingReaction : null;
  const current = deadlines.get(room);
  if (pending == null) return deadlines.delete(room);
  if (pending.seq === current?.seq) return false;
  deadlines.set(room, { seq: pending.seq, deadlineAt: now() + pending.view.windowMs, now });
  return true;
}

export function reactionTimingOf(room: RoomSession): ReactionTiming {
  const deadline = deadlines.get(room);
  if (deadline == null || deadline.seq !== room.engine?.pendingReaction?.seq)
    throw new Error(`房间 ${room.roomId} 的反应窗缺少权威截止时刻`);
  return { seq: deadline.seq, remainingMs: Math.max(0, deadline.deadlineAt - deadline.now()) };
}

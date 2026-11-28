import { jinnangCardOf } from "../engine/jinnang";
import {
  REACTION_EXPECT,
  reactionQueriedOf,
  type PendingReaction,
  type ReactionTarget,
  type ReactionView,
} from "../engine/reaction-window";
import type { GameSnapshot } from "../engine/snapshot";

export type ReactionSeatSnapshot = Pick<
  GameSnapshot,
  "phase" | "turnPhase" | "reaction" | "players"
> & {
  pendingReaction: Pick<PendingReaction, "seq" | "view" | "answers"> | null;
};

export type ReactionIntent = { type: "respondReaction" } & (
  | { use: false }
  | { use: true; cardId: string; target?: ReactionTarget }
);

export function reactionQueriesSeat(view: ReactionView, seat: number): boolean {
  return seat >= 0 && reactionQueriedOf(view).includes(seat);
}

/** 从座位公告和自己的牌推得本席的应答选项。 */
export function reactionChoicesForSeat(snapshot: ReactionSeatSnapshot, seat: number) {
  const { phase, turnPhase, reaction, pendingReaction, players } = snapshot;
  if (phase !== "Playing" || turnPhase !== "AwaitingReaction") return null;
  if (reaction === null || pendingReaction === null)
    throw new Error("AwaitingReaction 相位缺少挂起反应窗");
  const asked = reactionQueriesSeat(reaction, seat);
  const answered = pendingReaction.answers.some((answer) => answer.seat === seat);
  const playable =
    asked && !answered
      ? players[seat].jinnangHand.filter(
          (id) => jinnangCardOf(id).effect.kind === REACTION_EXPECT[reaction.kind],
        )
      : [];
  return {
    kind: reaction.kind,
    asked,
    answered,
    playable,
    targets: reaction.kind === "jinnang" ? reaction.targets : null,
  };
}

import type { GameEngine } from "../engine/authority";
import { jinnangCardOf, SINGLE_TARGET } from "../engine/jinnang";
import {
  REACTION_EXPECT,
  reactionQueriedOf,
  type PendingReaction,
  type ReactionView,
} from "../engine/reaction-window";
import type { GameSnapshot } from "../engine/snapshot";
import type { TargetStep } from "./target-selection";

export type ReactionSeatSnapshot = Pick<GameSnapshot, "phase" | "turnPhase" | "reaction"> & {
  pendingReaction: Pick<PendingReaction, "seq" | "view" | "answers"> | null;
};

export interface ReactionCardOption {
  handIndex: number;
  cardId: string;
}

export interface ReactionDecision {
  kind: "respondReaction";
  playable: readonly ReactionCardOption[];
  shares: TargetStep | null;
}

export function reactionQueriesSeat(view: ReactionView, seat: number): boolean {
  return seat >= 0 && reactionQueriedOf(view).includes(seat);
}

/** 公告与已答进度随逐席事件推进。 */
export function reactionStatusForSeat(snapshot: ReactionSeatSnapshot, seat: number) {
  const { phase, turnPhase, reaction, pendingReaction } = snapshot;
  if (phase !== "Playing" || turnPhase !== "AwaitingReaction") return null;
  if (reaction === null || pendingReaction === null)
    throw new Error("AwaitingReaction 相位缺少挂起反应窗");
  const asked = reactionQueriesSeat(reaction, seat);
  const answered = pendingReaction.answers.some((answer) => answer.seat === seat);
  return { kind: reaction.kind, seq: pendingReaction.seq, asked, answered };
}

/** 房间只给持有决策点的受问席投影手牌引用与候选份。 */
export function reactionChoicesForSeat(engine: GameEngine, seat: number): ReactionDecision {
  const pending = engine.pendingReaction;
  if (pending === null) throw new Error("反应决策点缺少挂起反应窗");
  const { view } = pending;
  const playable = engine.players[seat].jinnangHand.flatMap((cardId, handIndex) =>
    jinnangCardOf(cardId).effect.kind === REACTION_EXPECT[view.kind] ? [{ cardId, handIndex }] : [],
  );
  let shares: TargetStep | null = null;
  if (view.kind === "jinnang" && view.targets.requiresSelection) {
    const { kind, ids } = view.targets;
    shares = {
      domain: kind,
      ...SINGLE_TARGET,
      candidates: ids.map((id) => ({
        id,
        label: kind === "city" ? engine.board.at(id).name : engine.players[id].guohao,
        available: true,
      })),
    };
  }
  return { kind: "respondReaction", playable, shares };
}

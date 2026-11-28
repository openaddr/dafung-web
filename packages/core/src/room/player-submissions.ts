import { GameEngine } from "../engine/authority";
import { checkpointDicePins } from "../engine/dice";
import { isLogWarning } from "../engine/model";
import { capitalChoiceOf } from "../engine/setup-flow";
import type { GameSnapshot } from "../engine/snapshot";
import {
  requiresPlayerSubmission,
  type PlayerSubmission,
  type PlayerSubmissionRejection,
  type PlayerSubmissionResult,
} from "../protocol/wire";
import { reactionQueriedSeats } from "./bot-driver";
import { reactionTimingOf } from "./reaction-deadline";
import type { RoomSession } from "./room";
import { publicLogWarningReason, seatControlled } from "./seat-projection";

export interface RoomSubmissions {
  decisionRevision: number;
  entries: {
    seat: number;
    submissionId: string;
    payload: string;
    result: PlayerSubmissionResult;
  }[];
}

function capitalDecisionPoint(e: GameEngine): string | null {
  return e.phase === "Setup" && e.setupPhase === "PickCapital"
    ? `${e.gameId}/capital/${e.currentDraftIndex}/${e.currentSetupPlayerIndex}`
    : null;
}

/** 选都按当前选都席授权，反应窗各受问席独立，出牌阶段每次推进后的新步骤单独编号。 */
export function seatDecisionPointOf(room: RoomSession, seat: number): string | null {
  const e = room.engine;
  if (!e || seat < 0 || seatControlled(room, seat)) return null;
  if (e.phase === "Setup")
    return e.currentSetupPlayerIndex === seat ? capitalDecisionPoint(e) : null;
  if (e.phase !== "Playing") return null;
  if (e.turnPhase === "AwaitingReaction") {
    const pending = e.pendingReaction!;
    if (
      !reactionQueriedSeats(pending.view).includes(seat) ||
      pending.answers.some((a) => a.seat === seat)
    )
      return null;
    return `${e.gameId}/reaction/${pending.seq}/${seat}`;
  }
  if (e.turnPhase === "AwaitingJinnang" && e.decisionOwner === seat)
    return `${e.gameId}/jinnang/${e.turnNumber}/${room.submissions.decisionRevision}/${seat}`;
  return null;
}

/** 相同 JSON 对象允许换键序，数组仍保留顺序。roomId 与 seat 已由连接校验。 */
export function submissionPayload({ decisionPoint, cmd }: PlayerSubmission): string {
  return JSON.stringify([decisionPoint, cmd], (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(fields)
        .sort()
        .map((key) => [key, fields[key]]),
    );
  });
}

function submissionError(
  room: RoomSession,
  submission: PlayerSubmission,
): Omit<PlayerSubmissionRejection, "outcome"> | null {
  const { seat, decisionPoint, cmd } = submission;
  if (cmd.type === "pickCapital") {
    const e = room.engine;
    if (e === null || decisionPoint !== capitalDecisionPoint(e))
      return { reasonCode: "staleDecisionPoint", reason: "原选都步骤已结束" };
    if (seat !== e.currentSetupPlayerIndex || seatControlled(room, seat))
      return { reasonCode: "wrongSeat", reason: "本席当前无权选都" };
    const choice = capitalChoiceOf(e, seat, cmd.tileIndex);
    return choice.available ? null : { reasonCode: choice.reasonCode, reason: choice.reason };
  }
  if (cmd.type === "respondReaction" && cmd.seat !== seat) return { reason: "不能替其他座位应答" };
  if (decisionPoint !== seatDecisionPointOf(room, seat))
    return {
      reason:
        cmd.type === "respondReaction"
          ? "原反应窗已结束或本席已应答"
          : "原决策点已结束，请按当前步骤重新选择",
    };
  const e = room.engine!;
  if (cmd.type === "respondReaction") {
    if (e.turnPhase !== "AwaitingReaction" || reactionTimingOf(room).remainingMs === 0)
      return { reason: "原反应窗已结束" };
    if (!cmd.use && (cmd.cardId !== undefined || cmd.target !== undefined))
      return { reason: "选择不用时不能指定反应牌或对象" };
    return null;
  }
  if (!requiresPlayerSubmission(cmd, e.pendingJinnang?.cardId ?? null))
    return { reason: "该操作不属于此次玩家提交" };
  if (e.turnPhase !== "AwaitingJinnang") return { reason: "当前不是出牌步骤" };
  if (cmd.handIndex === undefined || !Number.isInteger(cmd.handIndex) || cmd.handIndex < 0)
    return { reason: "请选择具体的手牌" };
  const cardId = e.pendingJinnang?.cardId ?? cmd.cardId;
  if (e.pendingSkill !== null || (cmd.cardId !== null && cmd.cardId !== cardId))
    return { reason: "本次操作与已选锦囊不符" };
  if (e.players[seat].jinnangHand[cmd.handIndex] !== cardId)
    return { reason: "所选手牌不在该位置" };
  return null;
}

export interface StagedEngineChange {
  snapshot: GameSnapshot;
  commitDicePins?: () => void;
}

/** 用独立局面裁决座位提交和房间代答，保存成功后才采用快照与钉骰队列。 */
export function stageEngineChange<T>(
  authority: GameEngine,
  apply: (draft: GameEngine) => T,
): StagedEngineChange & { result: T } {
  const before = authority.snapshot();
  const restoreDicePins = checkpointDicePins(authority.dice);
  try {
    const draft = new GameEngine(authority.board, authority.catalog, authority.dice, {
      seats: authority.players,
      startingCash: authority.startingCash,
      targetNetWorth: authority.targetNetWorth,
      startingTreasures: authority.startingTreasures,
      mapId: authority.mapId,
      reactionWindowMs: authority.reactionWindowMsOverride,
    });
    draft.restoreFromSnapshot(structuredClone(before));
    const result = apply(draft);
    return {
      result,
      snapshot: draft.snapshot(),
      commitDicePins: checkpointDicePins(draft.dice),
    };
  } finally {
    // 保存前恢复权威骰源。提交的快照和剩余钉骰在房间保存成功后一起采用。
    authority.dice.setRngState(before.rngState);
    restoreDicePins?.();
  }
}

export function stagePlayerSubmission(
  room: RoomSession,
  submission: PlayerSubmission,
): { result: PlayerSubmissionResult; change?: StagedEngineChange } {
  const error = submissionError(room, submission);
  if (error !== null) return { result: { outcome: "rejected", ...error } };
  const authority = room.engine!;
  const { cmd, seat } = submission;
  const { result: rejection, ...change } = stageEngineChange(authority, (draft) =>
    cmd.type === "pickCapital"
      ? draft.pickCapital(seat, cmd.tileIndex).reason
      : draft.submitCommand(cmd),
  );
  if (rejection !== undefined) return { result: { outcome: "rejected", reason: rejection } };
  const warning = change.snapshot.log
    .slice(authority.log.length)
    .find((line) => isLogWarning(line) && line.warning !== undefined);
  if (warning) return { result: { outcome: "rejected", reason: publicLogWarningReason(warning) } };
  return { result: { outcome: "accepted" }, change };
}

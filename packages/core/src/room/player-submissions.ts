import { GameEngine } from "../engine/authority";
import { checkpointDicePins } from "../engine/dice";
import { isLogWarning } from "../engine/model";
import type { GameSnapshot } from "../engine/snapshot";
import {
  requiresPlayerSubmission,
  type PlayerSubmission,
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

/** 反应窗各受问席独立；出牌阶段每次推进后的新步骤单独编号，包括返回后重选。 */
export function seatDecisionPointOf(room: RoomSession, seat: number): string | null {
  const e = room.engine;
  if (!e || e.phase !== "Playing" || seat < 0 || seatControlled(room, seat)) return null;
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

function submissionError(room: RoomSession, submission: PlayerSubmission): string | null {
  const { seat, decisionPoint, cmd } = submission;
  if (cmd.type === "respondReaction" && cmd.seat !== seat) return "不能替其他座位应答";
  if (decisionPoint !== seatDecisionPointOf(room, seat))
    return cmd.type === "respondReaction"
      ? "原反应窗已结束或本席已应答"
      : "原决策点已结束，请按当前步骤重新选择";
  const e = room.engine!;
  if (cmd.type === "respondReaction") {
    if (e.turnPhase !== "AwaitingReaction" || reactionTimingOf(room).remainingMs === 0)
      return "原反应窗已结束";
    if (!cmd.use && (cmd.cardId !== undefined || cmd.target !== undefined))
      return "选择不用时不能指定反应牌或对象";
    return null;
  }
  if (!requiresPlayerSubmission(cmd, e.pendingJinnang?.cardId ?? null))
    return "该操作不属于此次玩家提交";
  if (e.turnPhase !== "AwaitingJinnang") return "当前不是出牌步骤";
  if (cmd.handIndex === undefined || !Number.isInteger(cmd.handIndex) || cmd.handIndex < 0)
    return "请选择具体的手牌";
  const cardId = e.pendingJinnang?.cardId ?? cmd.cardId;
  if (e.pendingSkill !== null || (cmd.cardId !== null && cmd.cardId !== cardId))
    return "本次操作与已选锦囊不符";
  if (e.players[seat].jinnangHand[cmd.handIndex] !== cardId) return "所选手牌不在该位置";
  return null;
}

/** 在独立局面上裁决。原房间在文件替换成功后才采用这份快照并通知座位。 */
export function stagePlayerSubmission(
  room: RoomSession,
  submission: PlayerSubmission,
): {
  result: PlayerSubmissionResult;
  snapshot?: GameSnapshot;
  commitDicePins?: () => void;
} {
  const error = submissionError(room, submission);
  if (error !== null) return { result: { outcome: "rejected", reason: error } };
  const authority = room.engine!;
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
    const logOffset = draft.log.length;
    const rejection = draft.submitCommand(submission.cmd);
    const warning = draft.log
      .slice(logOffset)
      .find((line) => isLogWarning(line) && line.warning !== undefined);
    if (rejection !== undefined) return { result: { outcome: "rejected", reason: rejection } };
    if (warning)
      return { result: { outcome: "rejected", reason: publicLogWarningReason(warning) } };
    return {
      result: { outcome: "accepted" },
      snapshot: draft.snapshot(),
      commitDicePins: checkpointDicePins(draft.dice),
    };
  } finally {
    // 保存前恢复权威骰源。提交的快照和剩余钉骰在房间保存成功后一起采用。
    authority.dice.setRngState(before.rngState);
    restoreDicePins?.();
  }
}

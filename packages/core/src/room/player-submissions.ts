import { GameEngine, type TurnPhase } from "../engine/authority";
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
import { isBankruptcyDecisionCommand } from "./bankruptcy-decisions";
import { reactionQueriedSeats } from "./bot-driver";
import { isLandDecisionCommand, landDecisionOf } from "./land-decisions";
import { reactionTimingOf } from "./reaction-deadline";
import { recruitmentDecisionOf } from "./recruitment-decisions";
import type { RoomSession } from "./room";
import { publicLogWarningReason, seatControlled } from "./seat-projection";
import { skillChoiceAnswerError } from "./skill-choice-decisions";
import { treasureDecisionOf } from "./treasure-decisions";

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

const SINGLE_OWNER_DECISIONS = {
  AwaitingJinnang: "jinnang",
  AwaitingDecision: "land",
  AwaitingHeroPick: "recruitment",
  AwaitingTreasureOwner: "treasure",
  AwaitingBankruptcySettle: "bankruptcy",
  AwaitingSkillChoice: "skillChoice",
} as const satisfies Partial<Record<TurnPhase, string>>;

type SingleOwnerDecisionPhase = keyof typeof SINGLE_OWNER_DECISIONS;

function isSingleOwnerDecision(phase: TurnPhase): phase is SingleOwnerDecisionPhase {
  return Object.hasOwn(SINGLE_OWNER_DECISIONS, phase);
}

function singleOwnerDecisionPointOf(
  room: RoomSession,
  phase: SingleOwnerDecisionPhase,
): string | null {
  const engine = room.engine;
  if (engine?.phase !== "Playing" || engine.turnPhase !== phase) return null;
  return `${engine.gameId}/${SINGLE_OWNER_DECISIONS[phase]}/${engine.turnNumber}/${room.submissions.decisionRevision}/${engine.decisionOwner}`;
}

/** 选都按当前选都席授权，反应窗各受问席独立，单属主抉择按权威进度编号。 */
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
  if (isSingleOwnerDecision(e.turnPhase) && e.decisionOwner === seat)
    return singleOwnerDecisionPointOf(room, e.turnPhase);
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

type SubmissionError = Omit<PlayerSubmissionRejection, "outcome">;

const STALE_DECISION = {
  reasonCode: "staleDecisionPoint",
  reason: "原决策点已结束，请按当前步骤重新选择",
} as const;

/** 确认命令仍指向该类抉择的当前步骤，且认证座位仍持有操作权。 */
function singleOwnerSubmissionError(
  room: RoomSession,
  { seat, decisionPoint }: PlayerSubmission,
  phase: SingleOwnerDecisionPhase,
  wrongSeatReason: string,
): SubmissionError | null {
  if (decisionPoint !== singleOwnerDecisionPointOf(room, phase)) return STALE_DECISION;
  if (seat !== room.engine!.decisionOwner || seatControlled(room, seat))
    return { reasonCode: "wrongSeat", reason: wrongSeatReason };
  return null;
}

function submissionError(room: RoomSession, submission: PlayerSubmission): SubmissionError | null {
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
  const e = room.engine;
  if (cmd.type === "respondReaction") {
    if (cmd.seat !== seat) return { reason: "不能替其他座位应答" };
    if (decisionPoint !== seatDecisionPointOf(room, seat))
      return { reason: "原反应窗已结束或本席已应答" };
    if (e?.turnPhase !== "AwaitingReaction" || reactionTimingOf(room).remainingMs === 0)
      return { reason: "原反应窗已结束" };
    if (!cmd.use && (cmd.cardId !== undefined || cmd.target !== undefined))
      return { reason: "选择不用时不能指定反应牌或对象" };
    return null;
  }
  if (cmd.type === "resolveHeroPick") {
    const error = singleOwnerSubmissionError(
      room,
      submission,
      "AwaitingHeroPick",
      "本席当前无权招贤",
    );
    if (error !== null) return error;
    const option = recruitmentDecisionOf(e!).options.find((option) =>
      "action" in cmd
        ? "action" in option && option.action === cmd.action
        : "index" in option && option.index === cmd.index,
    );
    if (option === undefined)
      return { reasonCode: "invalidCandidate", reason: "本次招贤没有此选项" };
    return option.available ? null : { reasonCode: "invalidCandidate", reason: option.reason };
  }
  if (cmd.type === "resolveTreasureOwner") {
    const error = singleOwnerSubmissionError(
      room,
      submission,
      "AwaitingTreasureOwner",
      "本席当前无权处理珍宝交涉",
    );
    if (error !== null) return error;
    const { action } = cmd;
    if (action.type === "skip") return null;
    return treasureDecisionOf(e!).candidates.some(({ id }) => id === action.treasureId)
      ? null
      : { reasonCode: "invalidCandidate", reason: "本次交涉没有这件珍宝" };
  }
  if (isBankruptcyDecisionCommand(cmd))
    return singleOwnerSubmissionError(
      room,
      submission,
      "AwaitingBankruptcySettle",
      "本席当前无权处理这笔债务",
    );
  if (cmd.type === "respondSkillChoice") {
    if (cmd.seat !== seat) return { reasonCode: "wrongSeat", reason: "不能替其他座位应答" };
    const error = singleOwnerSubmissionError(
      room,
      submission,
      "AwaitingSkillChoice",
      "本席当前无权应答此技能",
    );
    if (error !== null) return error;
    const reason = skillChoiceAnswerError(e!, cmd);
    return reason === null ? null : { reasonCode: "invalidCandidate", reason };
  }
  if (isLandDecisionCommand(cmd)) {
    const error = singleOwnerSubmissionError(
      room,
      submission,
      "AwaitingDecision",
      "本席当前无权处理这座城池",
    );
    if (error !== null) return error;
    const option = landDecisionOf(e!).options.find(({ command }) => command === cmd.type);
    if (option === undefined)
      return { reasonCode: "invalidCandidate", reason: "本次落格没有此城池选项" };
    if (!option.available)
      return {
        reasonCode: cmd.type === "buyProperty" ? "insufficientFunds" : "invalidCandidate",
        reason: option.reason,
      };
    return null;
  }
  if (e?.phase !== "Playing" || e.turnPhase !== "AwaitingJinnang") return STALE_DECISION;
  if (seat !== e.decisionOwner || seatControlled(room, seat))
    return { reasonCode: "wrongSeat", reason: "本席当前无权出牌" };
  if (decisionPoint !== seatDecisionPointOf(room, seat)) return STALE_DECISION;
  if (!requiresPlayerSubmission(cmd, e.pendingJinnang?.cardId ?? null))
    return { reason: "该操作不属于此次玩家提交" };
  const pending = e.pendingJinnang;
  if (cmd.cardId === null) {
    if (
      pending !== null ||
      e.pendingSkill !== null ||
      cmd.handIndex !== undefined ||
      cmd.targets !== undefined ||
      cmd.cancel ||
      cmd.back
    )
      return { reasonCode: "invalidCandidate", reason: "请先结束当前目标步骤" };
    return null;
  }
  if (cmd.handIndex === undefined || !Number.isSafeInteger(cmd.handIndex) || cmd.handIndex < 0)
    return { reasonCode: "invalidCandidate", reason: "请选择具体的手牌" };
  if (
    e.pendingSkill !== null ||
    (pending !== null && (cmd.cardId !== pending.cardId || cmd.handIndex !== pending.handIndex))
  )
    return { reasonCode: "invalidCandidate", reason: "本次操作与已选锦囊不符" };
  if (e.players[seat].jinnangHand[cmd.handIndex] !== cmd.cardId)
    return { reasonCode: "invalidCandidate", reason: "所选手牌不在该位置" };
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
  if (warning)
    return {
      result: {
        outcome: "rejected",
        ...(cmd.type === "useJinnang" ||
        cmd.type === "respondSkillChoice" ||
        isBankruptcyDecisionCommand(cmd)
          ? { reasonCode: "invalidCandidate" }
          : {}),
        reason: publicLogWarningReason(warning),
      },
    };
  return { result: { outcome: "accepted" }, change };
}

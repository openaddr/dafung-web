import type { GameCommand } from "../engine/authority";
import { isSkillOption, type ChoiceOption } from "../engine/choices";
import { jinnangCardOf, SINGLE_TARGET, TARGET_DOMAIN_STAGES } from "../engine/jinnang";
import type { PendingJinnang } from "../engine/jinnang-execution";
import { reactionAnswerError } from "../engine/reaction-window";
import { isActiveSkill, skillById } from "../engine/skills";
import type { GameSnapshot } from "../engine/snapshot";
import {
  reactionChoicesForSeat,
  type ReactionIntent,
  type ReactionSeatSnapshot,
} from "./reaction-choices";
import {
  targetCandidates,
  targetSelection,
  toggleTarget,
  type TargetDraft,
  type TargetStep,
} from "./target-selection";

/** 交互只消费已经投给本座的局面。调用方可以保留其余公开字段供查询。 */
type PlayerSeatSnapshot = ReactionSeatSnapshot &
  Pick<
    GameSnapshot,
    | "gameId"
    | "phase"
    | "turnPhase"
    | "decisionOwner"
    | "choices"
    | "pendingJinnang"
    | "pendingSkill"
    | "players"
  >;

export interface SeatInteractionState<S extends PlayerSeatSnapshot> {
  readonly snapshot: S;
  readonly seat: number;
  readonly interactive: boolean;
  readonly autopilotOn: boolean;
  /** 由房间随当前座位局面下发。 */
  readonly decisionPoint: string | null;
  /** 下行时限换算到本席单调时钟的截止时刻。 */
  readonly reactionDeadlineAt?: number | null;
}

export type SeatIntent =
  | { type: "selectCard"; handIndex: number }
  | { type: "selectSkill"; optionId: string }
  | { type: "toggleTarget"; id: number }
  | ReactionIntent
  | { type: "confirm" | "back" | "cancel" | "pass" };

export type SeatIntentResult =
  | { status: "draft" | "submitted" }
  | { status: "unavailable"; reason: string };

export interface JinnangInteractionView {
  readonly stage: "hand" | PendingJinnang["stage"];
  readonly options: readonly ChoiceOption[];
  readonly selectedOption: ChoiceOption | null;
  /** 草选或房间保留的实牌位置。 */
  readonly selectedHandIndex: number | null;
  readonly targets: (TargetStep & ReturnType<typeof targetSelection>) | null;
  readonly confirmAction: "selectTargets" | "nextTarget" | "playCard" | "useSkill";
  readonly canConfirm: boolean;
  readonly confirmUnavailableReason: string | null;
  readonly canBack: boolean;
  readonly canCancel: boolean;
  readonly canPass: boolean;
}

export interface SeatInteractionView<S extends PlayerSeatSnapshot> extends SeatInteractionState<S> {
  readonly ownsJinnangPhase: boolean;
  readonly jinnang: JinnangInteractionView | null;
  readonly reaction:
    | (NonNullable<ReturnType<typeof reactionChoicesForSeat>> & {
        readonly canRespond: boolean;
        readonly deadlineAt: number | null;
      })
    | null;
}

function currentTargets(snapshot: PlayerSeatSnapshot): TargetStep | null {
  const { pendingJinnang: card, pendingSkill, choices } = snapshot;
  if (card !== null) {
    const flow = TARGET_DOMAIN_STAGES[jinnangCardOf(card.cardId).targetDomain];
    if (flow.stages === 0) throw new Error(`锦囊【${card.cardId}】没有目标段`);
    const first = card.picked[0];
    return {
      ...flow.selection,
      candidates: targetCandidates(choices, flow.selection.domain),
      ...(card.stage === "two-a" ? { initial: card.picked } : {}),
      ...(card.stage === "two-b"
        ? { firstSeat: { id: first, label: snapshot.players[first].guohao } }
        : {}),
    };
  }
  if (pendingSkill === null) return null;
  const skill = skillById(pendingSkill.skillId);
  if (!isActiveSkill(skill) || skill.target === "none")
    throw new Error(`技能【${skill.name}】没有目标段`);
  const domain = skill.target === "city" ? "city" : "seat";
  return { domain, ...SINGLE_TARGET, candidates: targetCandidates(choices, domain) };
}

function optionCommand(option: ChoiceOption) {
  if (isSkillOption(option)) {
    return { type: "useHeroSkill" as const, heroId: option.skillHeroId, skillId: option.skillId };
  }
  if (option.handIndex === undefined) throw new Error(`锦囊选项 ${option.id} 缺少手牌位置`);
  return { type: "useJinnang" as const, cardId: option.id, handIndex: option.handIndex };
}

function confirmAction(
  snapshot: PlayerSeatSnapshot,
  selected: ChoiceOption | null,
): JinnangInteractionView["confirmAction"] {
  if (snapshot.pendingJinnang !== null)
    return snapshot.pendingJinnang.stage === "two-a" ? "nextTarget" : "playCard";
  if (snapshot.pendingSkill !== null) return "useSkill";
  if (selected === null) return "selectTargets";
  if (isSkillOption(selected)) {
    const skill = skillById(selected.skillId);
    if (!isActiveSkill(skill)) throw new Error(`出牌选项【${skill.name}】不是主动技`);
    return skill.target === "none" ? "useSkill" : "selectTargets";
  }
  return TARGET_DOMAIN_STAGES[jinnangCardOf(selected.id).targetDomain].stages === 0
    ? "playCard"
    : "selectTargets";
}

function pendingCommand(snapshot: PlayerSeatSnapshot) {
  const card = snapshot.pendingJinnang;
  if (card !== null)
    return { type: "useJinnang" as const, cardId: card.cardId, handIndex: card.handIndex };
  const { heroId, skillId } = snapshot.pendingSkill!;
  return { type: "useHeroSkill" as const, heroId, skillId };
}

/** 每个本地座位独持一份草稿。只有 confirm、back、目标段 cancel 和 pass 走上行。 */
export class SeatInteraction<S extends PlayerSeatSnapshot = PlayerSeatSnapshot> {
  private published: SeatInteractionView<S> | null = null;
  private selected: ChoiceOption | null = null;
  private targetDraft: TargetDraft | null = null;

  constructor(private readonly submit: (command: GameCommand, decisionPoint: string) => void) {}

  get view(): SeatInteractionView<S> {
    if (this.published === null) throw new Error("尚未收到座位局面");
    return this.published;
  }

  publish(state: SeatInteractionState<S>, { reconnect = false } = {}): SeatInteractionView<S> {
    const { seat, snapshot, decisionPoint, interactive, autopilotOn } = state;
    const previous = this.published;
    const reaction = reactionChoicesForSeat(snapshot, seat);
    const ownsJinnangPhase =
      seat >= 0 &&
      snapshot.phase === "Playing" &&
      snapshot.turnPhase === "AwaitingJinnang" &&
      snapshot.decisionOwner === seat &&
      snapshot.choices.some((option) => option.id === "pass" || option.id === "cancel");
    const open = ownsJinnangPhase && !autopilotOn && !snapshot.players[seat].isBot;
    if (
      reconnect ||
      !open ||
      previous === null ||
      previous.decisionPoint !== decisionPoint ||
      previous.seat !== seat ||
      previous.snapshot.gameId !== snapshot.gameId
    ) {
      this.selected = null;
      this.targetDraft = null;
    }
    let jinnang: JinnangInteractionView | null = null;
    if (open) {
      const step = currentTargets(snapshot);
      const targets =
        step === null ? null : { ...step, ...targetSelection(step, this.targetDraft) };
      const options =
        targets === null ? snapshot.choices.filter((option) => option.id !== "pass") : [];
      const selection = this.selected;
      const selectedOption =
        selection === null
          ? null
          : (options.find(
              (option) =>
                option.available &&
                option.id === selection.id &&
                option.handIndex === selection.handIndex,
            ) ?? null);
      this.selected = selectedOption;
      const stage = snapshot.pendingJinnang?.stage ?? (targets === null ? "hand" : "one");
      const enabled = interactive && decisionPoint !== null;
      let confirmUnavailableReason: string | null = null;
      if (!enabled) confirmUnavailableReason = "本座此刻不能操作";
      else if (targets !== null && !targets.canConfirm) confirmUnavailableReason = "请先选择目标";
      else if (targets === null && selectedOption === null) confirmUnavailableReason = "请先选牌";
      jinnang = {
        stage,
        options,
        selectedOption,
        selectedHandIndex: snapshot.pendingJinnang?.handIndex ?? selectedOption?.handIndex ?? null,
        targets,
        confirmAction: confirmAction(snapshot, selectedOption),
        canConfirm: confirmUnavailableReason === null,
        confirmUnavailableReason,
        canBack: enabled && stage === "two-b",
        canCancel: enabled && (targets !== null || selectedOption !== null),
        canPass: enabled && stage === "hand",
      };
    }
    this.published = {
      snapshot,
      seat,
      decisionPoint,
      interactive,
      autopilotOn,
      reactionDeadlineAt: state.reactionDeadlineAt,
      ownsJinnangPhase,
      jinnang,
      reaction:
        reaction === null
          ? null
          : {
              ...reaction,
              canRespond:
                reaction.asked &&
                !reaction.answered &&
                !autopilotOn &&
                interactive &&
                decisionPoint !== null,
              deadlineAt: state.reactionDeadlineAt ?? null,
            },
    };
    return this.published;
  }

  act(intent: SeatIntent, observedPoint = this.view.decisionPoint): SeatIntentResult {
    const state = this.view;
    const { jinnang, decisionPoint, snapshot } = state;
    const unavailable = (reason: string): SeatIntentResult => ({ status: "unavailable", reason });
    if (observedPoint !== decisionPoint) return unavailable("决策点已失效");
    if (!state.interactive || decisionPoint === null) return unavailable("本座此刻不能操作");
    const send = (command: GameCommand): SeatIntentResult => {
      this.submit(command, decisionPoint);
      return { status: "submitted" };
    };
    if (intent.type === "respondReaction") {
      if (!state.reaction?.canRespond) return unavailable("本席当前不能应答此反应窗");
      const command = { ...intent, seat: state.seat };
      const reason = reactionAnswerError(snapshot, snapshot.pendingReaction!, command);
      return reason === null ? send(command) : unavailable(reason);
    }
    if (jinnang === null) return unavailable("当前没有出牌步骤");
    const { selectedOption, targets } = jinnang;
    switch (intent.type) {
      case "selectCard":
      case "selectSkill": {
        if (targets !== null) return unavailable("请先结束当前目标步骤");
        const option = jinnang.options.find((choice) =>
          intent.type === "selectCard"
            ? choice.handIndex !== undefined && choice.handIndex === intent.handIndex
            : isSkillOption(choice) && choice.id === intent.optionId,
        );
        if (option === undefined) return unavailable("本席没有此选项");
        if (!option.available) {
          if (option.reason === undefined) throw new Error(`选项 ${option.id} 缺少不可用原因`);
          return unavailable(option.reason);
        }
        this.selected = option;
        this.publish(state);
        return { status: "draft" };
      }
      case "toggleTarget": {
        if (targets === null) return unavailable("当前没有目标步骤");
        this.targetDraft = toggleTarget(targets, targets.selected, intent.id);
        this.publish(state);
        return this.targetDraft.unavailableReason === undefined
          ? { status: "draft" }
          : unavailable(this.targetDraft.unavailableReason);
      }
      case "pass":
        if (!jinnang.canPass) return unavailable("当前目标步骤不能跳过出牌阶段");
        return send({ type: "useJinnang", cardId: null });
      case "cancel":
        if (!jinnang.canCancel) return unavailable("尚未选牌");
        if (targets !== null) return send({ ...pendingCommand(snapshot), cancel: true });
        this.selected = null;
        this.publish(state);
        return { status: "draft" };
      case "back":
        if (!jinnang.canBack) return unavailable("当前步骤不能返回上一步");
        return send({
          type: "useJinnang",
          cardId: snapshot.pendingJinnang!.cardId,
          handIndex: snapshot.pendingJinnang!.handIndex,
          back: true,
        });
      case "confirm":
        if (jinnang.confirmUnavailableReason !== null)
          return unavailable(jinnang.confirmUnavailableReason);
        if (targets === null) return send(optionCommand(selectedOption!));
        return send({ ...pendingCommand(snapshot), targets: [...targets.selected] });
    }
  }
}

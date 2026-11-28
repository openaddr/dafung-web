import type { BankruptcyAsset } from "../engine/bankruptcy";
import { isSkillOption, type ChoiceOption } from "../engine/choices";
import { jinnangCardOf, SINGLE_TARGET, TARGET_DOMAIN_STAGES } from "../engine/jinnang";
import type { PendingHeroSkill, PendingJinnang } from "../engine/jinnang-execution";
import { isActiveSkill, skillById } from "../engine/skills";
import type { GameSnapshot } from "../engine/snapshot";
import type { BankruptcyDecision } from "../room/bankruptcy-decisions";
import type { HeroDismissalOption, SkillBookOption } from "../room/roster-decisions";
import type { SkillChoiceDecision } from "../room/skill-choice-decisions";
import type {
  TreasureDecision,
  TreasureTradeCandidate,
  TreasureTradeIntent,
  TreasureTradeMode,
} from "../room/treasure-decisions";
import {
  reactionStatusForSeat,
  type ReactionCardOption,
  type ReactionSeatSnapshot,
} from "./reaction-choices";
import {
  targetCandidates,
  targetSelection,
  toggleTarget,
  type TargetDraft,
  type TargetStep,
} from "./target-selection";
import type {
  AutopilotCommand,
  CapitalOption,
  JinnangDecisionOptions,
  LandDecisionCommand,
  PlayerCommand,
  SeatDecision,
} from "./wire";

/** 交互只消费已经投给本座的局面。调用方可以保留其余公开字段供查询。 */
type PlayerSeatSnapshot = ReactionSeatSnapshot &
  Pick<GameSnapshot, "gameId" | "players" | "activeIndex" | "turnNumber">;

export interface SeatInteractionState<S extends PlayerSeatSnapshot> extends SeatDecision {
  readonly snapshot: S;
  readonly seat: number;
  readonly interactive: boolean;
  readonly autopilotOn: boolean;
  readonly autopilotInteractive?: boolean;
  /** 下行时限换算到本席单调时钟的截止时刻。 */
  readonly reactionDeadlineAt?: number | null;
}

export type HeroDismissalIntent =
  | { type: "selectHeroToDismiss"; heroId: string }
  | { type: "confirmHeroDismissal" | "cancelHeroDismissal" };

export type SeatIntent =
  | { type: "selectCapital"; tileIndex: number }
  | AutopilotCommand
  | { type: "chooseLand"; command: LandDecisionCommand["type"] }
  | { type: "chooseRecruitment"; optionId: string }
  | TreasureTradeIntent
  | { type: "addBankruptcyAsset" | "removeBankruptcyAsset"; asset: BankruptcyAsset }
  | { type: "declareBankruptcy" }
  | { type: "selectCard"; handIndex: number }
  | { type: "selectSkill"; optionId: string }
  | { type: "selectSkillBook"; treasureId: string }
  | { type: "selectBookLearner"; heroId: string }
  | HeroDismissalIntent
  | { type: "toggleTarget"; id: number }
  | { type: "muteReactions" }
  | { type: "confirm" | "back" | "cancel" | "pass" };

export type SeatIntentResult =
  | { status: "draft" | "submitted" }
  | { status: "unavailable"; reason: string };

export interface JinnangInteractionView {
  readonly stage: "hand" | PendingJinnang["stage"];
  readonly pendingJinnang: PendingJinnang | null;
  readonly pendingSkill: PendingHeroSkill | null;
  readonly options: readonly ChoiceOption[];
  readonly skillBooks: readonly SkillBookOption[];
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

interface SkillBookStudyView {
  readonly book: SkillBookOption & { available: true };
  readonly learnerHeroId: string | null;
  readonly canConfirm: boolean;
}

export interface HeroDismissalView {
  readonly options: readonly HeroDismissalOption[];
  readonly armedHeroId: string | null;
}

export interface CapitalInteractionView {
  readonly options: readonly CapitalOption[];
  readonly selectedOption: CapitalOption | null;
  readonly canConfirm: boolean;
}

interface TreasureInteractionView {
  readonly decision: TreasureDecision;
  readonly mode: Exclude<TreasureTradeMode, "skip"> | null;
  readonly selectedTreasure: TreasureTradeCandidate | null;
  readonly canConfirm: boolean;
}

export interface BankruptcyInteractionView {
  readonly decision: BankruptcyDecision;
  readonly selected: readonly BankruptcyAsset[];
  readonly selectedValue: number;
  readonly canConfirm: boolean;
}

export interface SkillChoiceInteractionView {
  readonly decision: SkillChoiceDecision;
  readonly targets: (TargetStep & ReturnType<typeof targetSelection>) | null;
  readonly canConfirm: boolean;
  readonly canPass: boolean;
}

type ReactionInteractionView = NonNullable<ReturnType<typeof reactionStatusForSeat>> & {
  readonly playable: readonly ReactionCardOption[];
  readonly shares: TargetStep | null;
  readonly selectedCard: ReactionCardOption | null;
  readonly targets: (TargetStep & ReturnType<typeof targetSelection>) | null;
  readonly canRespond: boolean;
  readonly canConfirm: boolean;
  readonly muted: boolean;
  readonly deadlineAt: number | null;
};

export interface SeatInteractionView<S extends PlayerSeatSnapshot> extends SeatInteractionState<S> {
  readonly capital: CapitalInteractionView | null;
  readonly treasure: TreasureInteractionView | null;
  readonly bankruptcy: BankruptcyInteractionView | null;
  readonly skillChoice: SkillChoiceInteractionView | null;
  readonly ownsJinnangPhase: boolean;
  readonly jinnang: JinnangInteractionView | null;
  readonly skillBookStudy: SkillBookStudyView | null;
  readonly heroDismissal: HeroDismissalView | null;
  readonly reaction: ReactionInteractionView | null;
}

function sameBankruptcyAsset(a: BankruptcyAsset, b: BankruptcyAsset): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function currentTargets(
  { pendingJinnang: card, pendingSkill, choices }: JinnangDecisionOptions,
  players: PlayerSeatSnapshot["players"],
): TargetStep | null {
  if (card !== null) {
    const flow = TARGET_DOMAIN_STAGES[jinnangCardOf(card.cardId).targetDomain];
    if (flow.stages === 0) throw new Error(`锦囊【${card.cardId}】没有目标段`);
    const first = card.picked[0];
    return {
      ...flow.selection,
      candidates: targetCandidates(choices, flow.selection.domain),
      ...(card.stage === "two-a" ? { initial: card.picked } : {}),
      ...(card.stage === "two-b" ? { firstSeat: { id: first, label: players[first].guohao } } : {}),
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
  { pendingJinnang, pendingSkill }: JinnangDecisionOptions,
  selected: ChoiceOption | null,
): JinnangInteractionView["confirmAction"] {
  if (pendingJinnang !== null) return pendingJinnang.stage === "two-a" ? "nextTarget" : "playCard";
  if (pendingSkill !== null) return "useSkill";
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

function pendingCommand({ pendingJinnang: card, pendingSkill }: JinnangInteractionView) {
  if (card !== null)
    return { type: "useJinnang" as const, cardId: card.cardId, handIndex: card.handIndex };
  const { heroId, skillId } = pendingSkill!;
  return { type: "useHeroSkill" as const, heroId, skillId };
}

function reactionTurnOf({ snapshot, seat }: SeatInteractionState<PlayerSeatSnapshot>): string {
  return JSON.stringify([snapshot.gameId, snapshot.turnNumber, snapshot.activeIndex, seat]);
}

function declineReaction(seat: number): PlayerCommand {
  return { type: "respondReaction", seat, use: false };
}

/** 每个座位独持一份草选，确认后的操作经当前决策点提交。 */
export class SeatInteraction<S extends PlayerSeatSnapshot = PlayerSeatSnapshot> {
  private published: SeatInteractionView<S> | null = null;
  private selectedCapital: number | null = null;
  private treasureDraft: {
    mode: Exclude<TreasureTradeMode, "skip">;
    treasureId: string | null;
  } | null = null;
  private selected: ChoiceOption | null = null;
  private bookDraft: { treasureId: string; learnerHeroId: string | null } | null = null;
  private armedHeroId: string | null = null;
  private selectedBankruptcyAssets: BankruptcyAsset[] = [];
  private targetDraft: TargetDraft | null = null;
  private reactionCard: ReactionCardOption | null = null;
  private mutedReactionTurn: string | null = null;
  private autoPassedPoint: string | null = null;

  constructor(private readonly submit: (command: PlayerCommand, decisionPoint: string) => void) {}

  get view(): SeatInteractionView<S> {
    if (this.published === null) throw new Error("尚未收到座位局面");
    return this.published;
  }

  publish(state: SeatInteractionState<S>, { reconnect = false } = {}): SeatInteractionView<S> {
    const { seat, snapshot, decisionPoint, decisionOptions, interactive, autopilotOn } = state;
    const previous = this.published;
    const reactionStatus = reactionStatusForSeat(snapshot, seat);
    const ownsJinnangPhase = decisionOptions?.kind === "playJinnang" && decisionPoint !== null;
    const open = ownsJinnangPhase && !autopilotOn;
    const newDecision =
      reconnect ||
      previous === null ||
      previous.decisionPoint !== decisionPoint ||
      previous.seat !== seat ||
      previous.snapshot.gameId !== snapshot.gameId;
    const skillDecision =
      decisionPoint !== null && decisionOptions?.kind === "skillChoice" && !autopilotOn
        ? decisionOptions
        : null;
    const reactionDecision =
      decisionPoint !== null && decisionOptions?.kind === "respondReaction" && !autopilotOn
        ? decisionOptions
        : null;
    if (this.mutedReactionTurn !== reactionTurnOf(state)) this.mutedReactionTurn = null;
    const muted = this.mutedReactionTurn !== null;
    if (newDecision || !open) {
      this.selected = null;
      this.bookDraft = null;
    }
    const heroDismissals =
      decisionPoint === null || autopilotOn ? undefined : decisionOptions?.heroDismissals;
    if (this.armedHeroId !== null) {
      const previousRoster = previous?.heroDismissal?.options.map(({ heroId }) => heroId).join("|");
      const currentRoster = heroDismissals?.map(({ heroId }) => heroId).join("|");
      if (
        newDecision ||
        !interactive ||
        previousRoster !== currentRoster ||
        !heroDismissals?.some(({ heroId, available }) => available && heroId === this.armedHeroId)
      )
        this.armedHeroId = null;
    }
    if (newDecision || reactionDecision === null || muted) this.reactionCard = null;
    if (newDecision || (!open && skillDecision === null && (reactionDecision === null || muted)))
      this.targetDraft = null;
    const capitalOptions =
      decisionPoint !== null && decisionOptions?.kind === "pickCapital" && !autopilotOn
        ? decisionOptions.options
        : null;
    if (newDecision || capitalOptions === null) this.selectedCapital = null;
    let capital: CapitalInteractionView | null = null;
    if (capitalOptions !== null) {
      const selectedOption =
        capitalOptions.find(({ tileIndex }) => tileIndex === this.selectedCapital) ?? null;
      this.selectedCapital = selectedOption === null ? null : selectedOption.tileIndex;
      capital = {
        options: capitalOptions,
        selectedOption,
        canConfirm: interactive && selectedOption?.available === true,
      };
    }
    const treasureDecision =
      decisionPoint !== null && decisionOptions?.kind === "treasureOwner" && !autopilotOn
        ? decisionOptions
        : null;
    if (newDecision || treasureDecision === null) this.treasureDraft = null;
    let treasure: TreasureInteractionView | null = null;
    if (treasureDecision !== null) {
      const selectedTreasure =
        treasureDecision.candidates.find(({ id }) => id === this.treasureDraft?.treasureId) ?? null;
      treasure = {
        decision: treasureDecision,
        mode: this.treasureDraft?.mode ?? null,
        selectedTreasure,
        canConfirm: interactive && selectedTreasure !== null,
      };
    }
    const bankruptcyDecision =
      decisionPoint !== null && decisionOptions?.kind === "bankruptcy" && !autopilotOn
        ? decisionOptions
        : null;
    if (newDecision || bankruptcyDecision === null) this.selectedBankruptcyAssets = [];
    let bankruptcy: BankruptcyInteractionView | null = null;
    if (bankruptcyDecision !== null) {
      const selectedValue = this.selectedBankruptcyAssets.reduce((sum, asset) => {
        const option = bankruptcyDecision.assets.find((candidate) =>
          sameBankruptcyAsset(candidate, asset),
        );
        if (option === undefined) throw new Error(`清算草选缺少资产 ${asset.id}`);
        return sum + option.price;
      }, 0);
      bankruptcy = {
        decision: bankruptcyDecision,
        selected: this.selectedBankruptcyAssets,
        selectedValue,
        canConfirm:
          interactive && bankruptcyDecision.cash + selectedValue >= bankruptcyDecision.debt.amount,
      };
    }
    let jinnang: JinnangInteractionView | null = null;
    let skillBookStudy: SkillBookStudyView | null = null;
    if (open) {
      const { choices, pendingJinnang, pendingSkill } = decisionOptions;
      const skillBooks = decisionOptions.skillBooks ?? [];
      const step = currentTargets(decisionOptions, snapshot.players);
      const targets =
        step === null ? null : { ...step, ...targetSelection(step, this.targetDraft) };
      const options = targets === null ? choices.filter((option) => option.id !== "pass") : [];
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
      const stage = pendingJinnang?.stage ?? (targets === null ? "hand" : "one");
      const enabled = interactive && decisionPoint !== null;
      if (this.bookDraft !== null) {
        const { treasureId, learnerHeroId } = this.bookDraft;
        const book = skillBooks.find((option) => option.treasureId === treasureId);
        if (book?.available === true) {
          const learner =
            learnerHeroId !== null && book.learnerHeroIds.includes(learnerHeroId)
              ? learnerHeroId
              : null;
          this.bookDraft = { treasureId, learnerHeroId: learner };
          skillBookStudy = {
            book,
            learnerHeroId: learner,
            canConfirm: enabled && learner !== null,
          };
        } else {
          this.bookDraft = null;
        }
      }
      let confirmUnavailableReason: string | null = null;
      if (!enabled) confirmUnavailableReason = "本座此刻不能操作";
      else if (targets !== null && !targets.canConfirm) confirmUnavailableReason = "请先选择目标";
      else if (targets === null && selectedOption === null) confirmUnavailableReason = "请先选牌";
      jinnang = {
        stage,
        pendingJinnang,
        pendingSkill,
        options,
        skillBooks,
        selectedOption,
        selectedHandIndex: pendingJinnang?.handIndex ?? selectedOption?.handIndex ?? null,
        targets,
        confirmAction: confirmAction(decisionOptions, selectedOption),
        canConfirm: confirmUnavailableReason === null,
        confirmUnavailableReason,
        canBack: enabled && stage === "two-b",
        canCancel: enabled && (targets !== null || selectedOption !== null),
        canPass: enabled && choices.some((option) => option.id === "pass" && option.available),
      };
    }
    let skillChoice: SkillChoiceInteractionView | null = null;
    if (skillDecision !== null) {
      const step: TargetStep = {
        domain: "seat",
        ...SINGLE_TARGET,
        candidates: skillDecision.targets,
      };
      const targets =
        skillDecision.fixedTargetSeat === null
          ? { ...step, ...targetSelection(step, this.targetDraft) }
          : null;
      const canFire =
        targets === null
          ? step.candidates.some(
              ({ id, available }) => id === skillDecision.fixedTargetSeat && available,
            )
          : targets.canConfirm;
      skillChoice = {
        decision: skillDecision,
        targets,
        canConfirm: interactive && canFire,
        canPass: interactive && skillDecision.canDecline,
      };
    }
    let reaction: ReactionInteractionView | null = null;
    if (reactionStatus !== null) {
      const playable = reactionDecision?.playable ?? [];
      const chosen = this.reactionCard;
      const selectedCard =
        chosen === null
          ? null
          : (playable.find(
              ({ handIndex, cardId }) => handIndex === chosen.handIndex && cardId === chosen.cardId,
            ) ?? null);
      this.reactionCard = selectedCard;
      const shares = reactionDecision?.shares ?? null;
      const targets =
        selectedCard === null || shares === null
          ? null
          : { ...shares, ...targetSelection(shares, this.targetDraft) };
      const canRespond =
        reactionDecision !== null &&
        reactionStatus.asked &&
        !reactionStatus.answered &&
        interactive;
      reaction = {
        ...reactionStatus,
        playable,
        shares,
        selectedCard,
        targets,
        canRespond,
        canConfirm:
          canRespond && !muted && selectedCard !== null && (targets === null || targets.canConfirm),
        muted: reactionStatus.asked && muted,
        deadlineAt: state.reactionDeadlineAt ?? null,
      };
    }
    this.published = {
      snapshot,
      seat,
      decisionPoint,
      decisionOptions,
      interactive,
      autopilotOn,
      autopilot: state.autopilot,
      autopilotInteractive: state.autopilotInteractive,
      reactionDeadlineAt: state.reactionDeadlineAt,
      capital,
      treasure,
      bankruptcy,
      skillChoice,
      ownsJinnangPhase,
      jinnang,
      skillBookStudy,
      heroDismissal:
        heroDismissals === undefined
          ? null
          : { options: heroDismissals, armedHeroId: this.armedHeroId },
      reaction,
    };
    if (reaction?.muted && reaction.canRespond && decisionPoint !== null)
      this.passMutedReaction(decisionPoint);
    return this.published;
  }

  private passMutedReaction(point: string): void {
    if (this.autoPassedPoint === point) return;
    // 内存通路发送时可同步发布新视图，先让本次发布及命令在途锁完整落位。
    queueMicrotask(() => {
      const { decisionPoint, reaction, seat } = this.view;
      if (
        decisionPoint !== point ||
        !reaction?.muted ||
        !reaction.canRespond ||
        this.autoPassedPoint === point
      )
        return;
      this.autoPassedPoint = point;
      this.submit(declineReaction(seat), point);
    });
  }

  act(intent: SeatIntent, observedPoint?: string | null): SeatIntentResult {
    const state = this.view;
    const {
      capital,
      treasure,
      bankruptcy,
      skillChoice,
      jinnang,
      skillBookStudy,
      reaction,
      decisionPoint,
    } = state;
    const unavailable = (reason: string): SeatIntentResult => ({ status: "unavailable", reason });
    if (intent.type === "setAutoPilot") {
      const { autopilot } = state;
      if (autopilot === undefined || !state.autopilotInteractive)
        return unavailable("本席当前不能切换托管");
      if (observedPoint !== undefined && observedPoint !== autopilot.decisionPoint)
        return unavailable("原托管授权已失效");
      if (intent.on === autopilot.on)
        return unavailable(intent.on ? "本席已托管" : "本席已由本人控制");
      this.submit(intent, autopilot.decisionPoint);
      return { status: "submitted" };
    }
    if (observedPoint !== undefined && observedPoint !== decisionPoint)
      return unavailable("决策点已失效");
    if (capital !== null && intent.type === "cancel") {
      if (capital.selectedOption === null) return unavailable("请先选择都城");
      this.selectedCapital = null;
      this.publish(state);
      return { status: "draft" };
    }
    if (treasure?.mode != null && (intent.type === "cancel" || intent.type === "back")) {
      this.treasureDraft = null;
      this.publish(state);
      return { status: "draft" };
    }
    if (skillBookStudy !== null && intent.type === "cancel") {
      this.bookDraft = null;
      this.publish(state);
      return { status: "draft" };
    }
    if (intent.type === "cancelHeroDismissal") {
      this.armedHeroId = null;
      this.publish(state);
      return { status: "draft" };
    }
    if (!state.interactive || decisionPoint === null) return unavailable("本座此刻不能操作");
    const send = (command: PlayerCommand): SeatIntentResult => {
      this.submit(command, decisionPoint);
      return { status: "submitted" };
    };
    if (intent.type === "selectHeroToDismiss") {
      const option = state.heroDismissal?.options.find(({ heroId }) => heroId === intent.heroId);
      if (option === undefined) return unavailable("本席当前不能遣散此名将");
      if (!option.available) return unavailable(option.reason);
      this.armedHeroId = option.heroId;
      this.publish(state);
      return { status: "draft" };
    }
    if (intent.type === "confirmHeroDismissal") {
      const heroId = this.armedHeroId;
      if (heroId === null) return unavailable("请先选择要遣散的名将");
      this.armedHeroId = null;
      this.publish(state);
      return send({ type: "dismissHero", heroId });
    }
    if (intent.type === "chooseLand") {
      const decision = state.decisionOptions;
      if (decision?.kind !== "landDecision") return unavailable("本席当前没有城池抉择");
      const option = decision.options.find(({ command }) => command === intent.command);
      if (option === undefined) return unavailable("本次落格没有此城池选项");
      return option.available ? send({ type: option.command }) : unavailable(option.reason);
    }
    if (intent.type === "chooseRecruitment") {
      const decision = state.decisionOptions;
      if (decision?.kind !== "recruitment") return unavailable("本席当前没有招贤抉择");
      const option = decision.options.find(({ id }) => id === intent.optionId);
      if (option === undefined) return unavailable("本次招贤没有此选项");
      if (!option.available) return unavailable(option.reason);
      return "index" in option
        ? send({ type: "resolveHeroPick", index: option.index })
        : send({ type: "resolveHeroPick", action: option.action });
    }
    if (intent.type === "chooseTreasureMode") {
      if (treasure === null || !treasure.decision.modes.includes(intent.mode))
        return unavailable("本次交涉没有此选项");
      if (intent.mode === "skip")
        return send({ type: "resolveTreasureOwner", action: { type: "skip" } });
      this.treasureDraft = { mode: intent.mode, treasureId: null };
      this.publish(state);
      return { status: "draft" };
    }
    if (intent.type === "selectTreasure") {
      if (treasure?.mode == null) return unavailable("请先选择交易方式");
      if (!treasure.decision.candidates.some(({ id }) => id === intent.treasureId))
        return unavailable("本次交涉没有这件珍宝");
      this.treasureDraft = { mode: treasure.mode, treasureId: intent.treasureId };
      this.publish(state);
      return { status: "draft" };
    }
    if (treasure !== null && intent.type === "confirm") {
      const { mode, selectedTreasure } = treasure;
      if (mode === null || selectedTreasure === null) return unavailable("请先选定交易方式与珍宝");
      return send({
        type: "resolveTreasureOwner",
        action: { type: mode, treasureId: selectedTreasure.id },
      });
    }
    if (intent.type === "muteReactions") {
      if (!reaction?.canRespond || reaction.muted) return unavailable("本席当前不能应答此反应窗");
      this.mutedReactionTurn = reactionTurnOf(state);
      this.autoPassedPoint = decisionPoint;
      this.publish(state);
      return send(declineReaction(state.seat));
    }
    if (reaction !== null) {
      if (!reaction.canRespond || reaction.muted) return unavailable("本席当前不能应答此反应窗");
      const { selectedCard, targets } = reaction;
      switch (intent.type) {
        case "selectCard": {
          const choice = reaction.playable.find(({ handIndex }) => handIndex === intent.handIndex);
          if (choice === undefined) return unavailable("本席没有此反应锦囊选项");
          this.reactionCard = selectedCard?.handIndex === choice.handIndex ? null : choice;
          this.targetDraft = null;
          this.publish(state);
          return { status: "draft" };
        }
        case "toggleTarget": {
          if (targets === null) return unavailable("本次应答无需选择对象");
          this.targetDraft = toggleTarget(targets, targets.selected, intent.id);
          this.publish(state);
          return this.targetDraft.unavailableReason === undefined
            ? { status: "draft" }
            : unavailable(this.targetDraft.unavailableReason);
        }
        case "cancel":
          if (selectedCard === null) return unavailable("尚未选择反应锦囊");
          this.reactionCard = null;
          this.targetDraft = null;
          this.publish(state);
          return { status: "draft" };
        case "pass":
          return send(declineReaction(state.seat));
        case "confirm":
          if (selectedCard === null) return unavailable("请先选择反应锦囊");
          if (!reaction.canConfirm) return unavailable("请先选择一份");
          return send({
            type: "respondReaction",
            seat: state.seat,
            use: true,
            ...selectedCard,
            ...(targets === null
              ? {}
              : { target: { kind: targets.domain, id: targets.selected[0] } }),
          });
        default:
          return unavailable("当前处于反应窗");
      }
    }
    if (intent.type === "selectCapital") {
      if (!capital?.options.some(({ tileIndex }) => tileIndex === intent.tileIndex))
        return unavailable("本席没有此候选城");
      this.selectedCapital = intent.tileIndex;
      this.publish(state);
      return { status: "draft" };
    }
    if (capital !== null) {
      if (intent.type !== "confirm") return unavailable("当前处于选都步骤");
      const option = capital.selectedOption;
      if (option === null) return unavailable("请先选择都城");
      if (!option.available) return unavailable(option.reason);
      this.selectedCapital = null;
      this.publish(state);
      return send({ type: "pickCapital", tileIndex: option.tileIndex });
    }
    if (intent.type === "addBankruptcyAsset" || intent.type === "removeBankruptcyAsset") {
      if (bankruptcy === null) return unavailable("本席当前没有清算抉择");
      const { kind, id } = intent.asset;
      const matches = (asset: BankruptcyAsset) => sameBankruptcyAsset(asset, intent.asset);
      if (intent.type === "removeBankruptcyAsset") {
        const index = this.selectedBankruptcyAssets.map(matches).lastIndexOf(true);
        if (index === -1) return unavailable("尚未草选该资产");
        this.selectedBankruptcyAssets = this.selectedBankruptcyAssets.filter(
          (_, position) => position !== index,
        );
      } else {
        if (bankruptcy.canConfirm) return unavailable("已凑足债务，不可再卖");
        const option = bankruptcy.decision.assets.find(matches);
        if (option === undefined) return unavailable("本次清算没有这项资产");
        if (this.selectedBankruptcyAssets.filter(matches).length === option.maxQuantity)
          return unavailable("已选完该资产的可卖数量");
        this.selectedBankruptcyAssets = [...this.selectedBankruptcyAssets, { kind, id }];
      }
      this.publish(state);
      return { status: "draft" };
    }
    if (intent.type === "declareBankruptcy")
      return bankruptcy === null
        ? unavailable("本席当前没有清算抉择")
        : send({ type: "declareBankruptcy" });
    if (bankruptcy !== null) {
      if (intent.type !== "confirm") return unavailable("当前处于清算步骤");
      if (!bankruptcy.canConfirm) return unavailable("所选资产不足以清偿债务");
      return send({ type: "confirmBankruptcySettle", assets: [...this.selectedBankruptcyAssets] });
    }
    if (skillChoice !== null) {
      const { targets, canConfirm, canPass } = skillChoice;
      if (intent.type === "toggleTarget") {
        if (targets === null) return unavailable("本次技能目标已定");
        this.targetDraft = toggleTarget(targets, targets.selected, intent.id);
        this.publish(state);
        return this.targetDraft.unavailableReason === undefined
          ? { status: "draft" }
          : unavailable(this.targetDraft.unavailableReason);
      }
      if (intent.type === "confirm") {
        if (!canConfirm) return unavailable("请先选择合法的技能目标");
        return send({
          type: "respondSkillChoice",
          seat: state.seat,
          use: true,
          targetSeat: targets?.selected[0],
        });
      }
      if (intent.type === "pass")
        return canPass
          ? send({ type: "respondSkillChoice", seat: state.seat, use: false })
          : unavailable("本次技能不能放弃");
      return unavailable("当前处于技能抉择");
    }
    if (jinnang === null) return unavailable("当前没有出牌步骤");
    const { selectedOption, targets } = jinnang;
    switch (intent.type) {
      case "selectSkillBook": {
        if (targets !== null) return unavailable("请先结束当前目标步骤");
        const book = jinnang.skillBooks.find(({ treasureId }) => treasureId === intent.treasureId);
        if (book === undefined) return unavailable("本席没有此技能书");
        if (!book.available) return unavailable(book.reason);
        this.selected = null;
        this.bookDraft = { treasureId: book.treasureId, learnerHeroId: null };
        this.publish(state);
        return { status: "draft" };
      }
      case "selectBookLearner": {
        if (skillBookStudy === null) return unavailable("请先选择技能书");
        if (!skillBookStudy.book.learnerHeroIds.includes(intent.heroId))
          return unavailable("所选名将不可习得此技");
        this.bookDraft = {
          treasureId: skillBookStudy.book.treasureId,
          learnerHeroId: intent.heroId,
        };
        this.publish(state);
        return { status: "draft" };
      }
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
        this.bookDraft = null;
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
        if (targets !== null) return send({ ...pendingCommand(jinnang), cancel: true });
        this.selected = null;
        this.publish(state);
        return { status: "draft" };
      case "back":
        if (!jinnang.canBack) return unavailable("当前步骤不能返回上一步");
        return send({
          type: "useJinnang",
          cardId: jinnang.pendingJinnang!.cardId,
          handIndex: jinnang.pendingJinnang!.handIndex,
          back: true,
        });
      case "confirm":
        if (skillBookStudy !== null) {
          const { book, learnerHeroId } = skillBookStudy;
          if (learnerHeroId === null) return unavailable("请先选择研读名将");
          this.bookDraft = null;
          this.publish(state);
          return send({ type: "useBookSkill", treasureId: book.treasureId, heroId: learnerHeroId });
        }
        if (jinnang.confirmUnavailableReason !== null)
          return unavailable(jinnang.confirmUnavailableReason);
        if (targets === null) return send(optionCommand(selectedOption!));
        return send({ ...pendingCommand(jinnang), targets: [...targets.selected] });
    }
  }
}

import type { GameCommand, GameEngine } from "../engine/authority";
import { targetCandidates, type TargetCandidate } from "../protocol/target-selection";

export type SkillChoiceCommand = Extract<GameCommand, { type: "respondSkillChoice" }>;

export interface SkillChoiceDecision {
  kind: "skillChoice";
  heroId: string;
  skillId: string;
  ownerSeat: number;
  fixedTargetSeat: number | null;
  targets: readonly TargetCandidate[];
  canDecline: boolean;
}

/** 权威选项集同时用于下行和校验。 */
export function skillChoiceDecisionOf(engine: GameEngine): SkillChoiceDecision {
  const { heroId, skillId, ownerSeat, targetSeat } = engine.pendingSkillChoices[0];
  const options = engine.choicesFor();
  const decline = options.find(({ id }) => id === "decline");
  if (decline === undefined) throw new Error("「你可」选项集缺少暂不发");
  return {
    kind: "skillChoice",
    heroId,
    skillId,
    ownerSeat,
    fixedTargetSeat: targetSeat ?? null,
    targets: targetCandidates(
      options.filter(({ id }) => id !== decline.id),
      "seat",
    ),
    canDecline: decline.available,
  };
}

export function skillChoiceAnswerError(
  engine: GameEngine,
  { use, targetSeat }: SkillChoiceCommand,
): string | null {
  const decision = skillChoiceDecisionOf(engine);
  if (!use) {
    if (targetSeat !== undefined) return "暂不发时不能指定目标";
    return decision.canDecline ? null : "本次技能不能放弃";
  }
  const { fixedTargetSeat } = decision;
  if (fixedTargetSeat !== null && targetSeat !== undefined) return "本次技能目标已定";
  const target = fixedTargetSeat ?? targetSeat;
  if (target === undefined) return "请先选择技能目标";
  const option = decision.targets.find(({ id }) => id === target);
  if (option === undefined) return "本次技能没有此候选目标";
  if (option.available) return null;
  if (option.reason === undefined) throw new Error(`目标 ${target} 缺少不可用原因`);
  return option.reason;
}

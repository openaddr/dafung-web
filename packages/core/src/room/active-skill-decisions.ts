import type { GameCommand, GameEngine } from "../engine/authority";
import type { ChoiceOption } from "../engine/choices";
import { SINGLE_TARGET } from "../engine/jinnang";

export type ActiveSkillCommand = Extract<GameCommand, { type: "useHeroSkill" }>;

/** 同一份权威选项供座位查看和提交校验。 */
export function activeSkillSubmissionError(
  engine: GameEngine,
  { heroId, skillId, targets, cancel }: ActiveSkillCommand,
): string | null {
  if (engine.pendingJinnang !== null) return "请先结束当前锦囊目标步骤";
  const pending = engine.pendingSkill;
  if (pending === null) {
    if (cancel === true || targets !== undefined) return "当前没有技能目标步骤";
    const option = engine
      .choicesFor()
      .find((choice) => choice.skillHeroId === heroId && choice.skillId === skillId);
    return choiceError(option, "本席没有此主动技实例");
  }
  if (heroId !== pending.heroId || skillId !== pending.skillId) return "本次操作与已选主动技不符";
  if (cancel === true) return targets === undefined ? null : "作罢时不能指定技能目标";
  if (targets === undefined || targets.length !== SINGLE_TARGET.max) return "请选择一项技能目标";
  const [target] = targets;
  const option = engine
    .choicesFor()
    .find(({ targetSeat, targetTileIndex }) => targetSeat === target || targetTileIndex === target);
  return choiceError(option, "本次主动技没有此候选目标");
}

function choiceError(option: ChoiceOption | undefined, missing: string): string | null {
  if (option === undefined) return missing;
  if (option.available) return null;
  if (option.reason === undefined) throw new Error(`主动技选项 ${option.id} 缺少不可用原因`);
  return option.reason;
}

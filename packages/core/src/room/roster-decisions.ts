import type { GameEngine } from "../engine/authority";
import { heroDismissalBlock } from "../engine/hero-dismiss";
import { skillBookLearners, skillBookStudyBlocked } from "../engine/roster";
import { isSkillBook } from "../engine/treasures";

export type SkillBookOption = {
  treasureId: string;
  skillId: string;
  learnerHeroIds: readonly string[];
} & ({ available: true } | { available: false; reason: string });

/** 每册技能书各占一项。同技多册共用书号，研读仍只消耗其中一册。 */
export function skillBookOptionsOf(engine: GameEngine): SkillBookOption[] {
  const player = engine.activePlayer;
  const targeting = skillBookStudyBlocked(engine);
  return player.treasures.filter(isSkillBook).map((book): SkillBookOption => {
    const learnerHeroIds = skillBookLearners(player, book.skillId).map(({ heroId }) => heroId);
    const option = { treasureId: book.id, skillId: book.skillId, learnerHeroIds };
    if (targeting) return { ...option, available: false, reason: "请先结束当前目标步骤" };
    if (learnerHeroIds.length === 0)
      return { ...option, available: false, reason: "麾下无人可习此技（可交易变卖）" };
    return { ...option, available: true };
  });
}

export type HeroDismissalOption = { heroId: string } & (
  | { available: true }
  | { available: false; reason: string }
);

export function heroDismissalOptionsOf(engine: GameEngine): HeroDismissalOption[] {
  return engine.activePlayer.heroes.map(({ heroId }) => {
    const block = heroDismissalBlock(engine, heroId);
    return block === null
      ? { heroId, available: true }
      : { heroId, available: false, reason: block.reason };
  });
}

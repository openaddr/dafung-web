import type { GameEngine } from "../engine/authority";
import type { HeroPick } from "../engine/recruitment";

export type RecruitmentOption = {
  id: string;
  label: string;
} & ({ available: true } | { available: false; reason: string }) &
  ({ index: number; heroId: string; skillIds: string[] } | Extract<HeroPick, { action: string }>);

export interface RecruitmentDecision {
  kind: "recruitment";
  options: readonly RecruitmentOption[];
}

/** 卡面与命令校验共用本次招贤已经掷定的名将、授技和选择。 */
export function recruitmentDecisionOf(engine: GameEngine): RecruitmentDecision {
  if (engine.turnPhase !== "AwaitingHeroPick") throw new Error("当前没有招贤抉择");
  const options = engine
    .choicesFor()
    .map(({ id, label, heroPick, available, reason }): RecruitmentOption => {
      if (heroPick === undefined) throw new Error(`招贤选项 ${id} 缺少选择`);
      if (!available && reason === undefined) throw new Error(`招贤选项 ${id} 缺少不可用原因`);
      const status = available
        ? { available: true as const }
        : { available: false as const, reason: reason! };
      const option = { id, label, ...status };
      if ("action" in heroPick) return { ...option, ...heroPick };
      const { index } = heroPick;
      const offer = engine.offeredHeroes[index];
      if (offer === undefined) throw new Error(`招贤选项 ${id} 缺少名将候选`);
      return { ...option, index, heroId: offer.def.id, skillIds: offer.skillIds };
    });
  return { kind: "recruitment", options };
}

import { isSkillOption, type ChoiceOption } from "@dafung/core/engine/choices";
import { formatMoney } from "@dafung/core/engine/money";
import { skillById } from "@dafung/core/engine/skills";
import type { GameSnapshot } from "@app/store/gameStore";
import type { SeatInteractionView, SeatIntent } from "@dafung/core/protocol/seat-interaction";

const PRIMARY_ACTION = {
  selectTargets: { label: "选目标", variant: "primary" },
  nextTarget: { label: "下一步", variant: "primary" },
  playCard: { label: "出牌", variant: "commit" },
  useSkill: { label: "发动", variant: "commit" },
} as const;

/** 将同一座位视图排成安卓动作条和手牌架，点按直接译为玩家意图。 */
export function jinnangPlay(
  view: SeatInteractionView<GameSnapshot>,
  act: (intent: SeatIntent) => void,
) {
  const { jinnang, snapshot } = view;
  if (jinnang === null) return null;
  const { options, selectedOption: selected, targets, stage, canConfirm } = jinnang;
  const pendingCard = snapshot.pendingJinnang;
  const skill = snapshot.pendingSkill === null ? null : skillById(snapshot.pendingSkill.skillId);
  const detail =
    targets !== null
      ? [
          targets.domain === "city"
            ? "选城"
            : stage === "two-a"
              ? "选第一位诸侯"
              : stage === "two-b"
                ? "选第二位诸侯"
                : "选诸侯",
          ...(targets.selectedLabels.length > 0
            ? [`已选 ${targets.selectedLabels.join("、")}`]
            : []),
          ...(targets.unavailableReason === undefined ? [] : [targets.unavailableReason]),
        ].join(" · ")
      : selected?.levy !== undefined
        ? `对其余 ${selected.levy.affectedSeats.length} 位诸侯各征至多 ${formatMoney(selected.levy.maxPerSeat)}`
        : undefined;
  return {
    hasSkillCards: options.some(isSkillOption),
    hand: {
      options,
      targeting: targets !== null,
      selected,
      selectedHandIndex: jinnang.selectedHandIndex,
      onSelect(option: ChoiceOption | null) {
        if (option === null) act({ type: "cancel" });
        else if (isSkillOption(option)) act({ type: "selectSkill", optionId: option.id });
        else if (option.handIndex !== undefined)
          act({ type: "selectCard", handIndex: option.handIndex });
        else throw new Error(`锦囊选项 ${option.id} 缺少手牌位置`);
      },
    },
    targetStep: targets,
    action: {
      title: pendingCard?.cardId ?? skill?.name ?? selected?.label ?? "出牌阶段",
      detail,
      primaryAction: PRIMARY_ACTION[jinnang.confirmAction],
      cancelLabel: skill !== null ? "作罢" : pendingCard !== null ? "取消选牌" : undefined,
      canConfirm,
      onPlay: () => act({ type: "confirm" }),
      onPass: () => act({ type: targets === null ? "pass" : "cancel" }),
      onBack: stage === "two-b" ? () => act({ type: "back" }) : undefined,
    },
  };
}

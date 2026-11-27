import { useEffect, useMemo, useState } from "react";
import type { GameCommand } from "@dafung/core/engine/authority";
import { isSkillOption } from "@dafung/core/engine/choices";
import { jinnangCardOf, SINGLE_TARGET, TARGET_DOMAIN_STAGES } from "@dafung/core/engine/jinnang";
import { formatMoney } from "@dafung/core/engine/money";
import { isActiveSkill, skillById } from "@dafung/core/engine/skills";
import type { GameSnapshot } from "@dafung/core/engine/snapshot";
import {
  targetCandidates,
  type TargetSelection,
  type TargetSelectionStep,
} from "./target-selection";

/** key 区分同名牌，optionId 是原有的命令语义 id。 */
export interface CardSelection {
  key: string;
  optionId: string;
}

type PlayCommand = Extract<GameCommand, { type: "useJinnang" | "useHeroSkill" }>;

export function useJinnangPlay({
  snapshot,
  seat,
  autopilotOn,
  interactive,
  dispatchCommand,
}: {
  snapshot: GameSnapshot;
  seat: number;
  autopilotOn: boolean;
  interactive: boolean;
  dispatchCommand: (command: GameCommand) => void;
}) {
  const { choices, gameId, turnNumber, players } = snapshot;
  const player = players[seat];
  const ownsPhase =
    snapshot.phase === "Playing" &&
    snapshot.turnPhase === "AwaitingJinnang" &&
    snapshot.decisionOwner === seat &&
    choices.some((option) => option.id === "pass" || option.id === "cancel");
  const open = ownsPhase && !autopilotOn && !player.isBot;
  const pendingCard = open ? snapshot.pendingJinnang : null;
  const pendingSkill = open ? snapshot.pendingSkill : null;
  const targeting = pendingCard != null || pendingSkill != null;
  const options =
    open && !targeting
      ? choices.filter((option) => option.id !== "pass" && option.id !== "cancel")
      : [];
  const turn = JSON.stringify([gameId, turnNumber, seat, player.id]);
  // 同名牌的排列变化后，旧 key 可能指向另一张牌。
  const cardScope =
    open && !targeting
      ? JSON.stringify([turn, options.map((option) => [option.id, option.available])])
      : null;
  const [draft, setDraft] = useState<(CardSelection & { scope: string }) | null>(null);
  useEffect(() => {
    setDraft((current) => (current?.scope === cardScope ? current : null));
  }, [cardScope]);
  const selected =
    draft != null && draft.scope === cardScope
      ? options.find((option) => option.id === draft.optionId && option.available)
      : undefined;

  const card = pendingCard != null ? jinnangCardOf(pendingCard.cardId) : null;
  const skill = pendingSkill != null ? skillById(pendingSkill.skillId) : null;
  const targetStep = useMemo<TargetSelectionStep | null>(() => {
    let rule: Pick<TargetSelectionStep, "domain" | "min" | "max">;
    if (card != null) {
      const flow = TARGET_DOMAIN_STAGES[card.targetDomain];
      if (flow.stages === 0) throw new Error(`锦囊【${card.id}】没有目标段`);
      rule = flow.selection;
    } else if (skill != null) {
      if (!isActiveSkill(skill) || skill.target === "none") {
        throw new Error(`技能【${skill.name}】没有目标段`);
      }
      rule = { domain: skill.target === "city" ? "city" : "seat", ...SINGLE_TARGET };
    } else {
      return null;
    }
    const firstSeat = pendingCard?.stage === "two-b" ? pendingCard.picked[0] : null;
    return {
      scope: JSON.stringify([
        "jinnang",
        turn,
        pendingCard?.cardId,
        pendingCard?.stage,
        pendingSkill,
      ]),
      ...rule,
      candidates: targetCandidates(choices, rule.domain),
      initial: pendingCard?.stage === "two-a" ? pendingCard.picked : undefined,
      firstSeat:
        firstSeat !== null ? { id: firstSeat, label: players[firstSeat].guohao } : undefined,
    };
  }, [card, skill, pendingCard, pendingSkill, turn, choices, players]);

  if (!open) return { ownsPhase, window: null };

  const stage = pendingCard?.stage;
  const selectedSkill =
    selected != null && isSkillOption(selected) ? skillById(selected.skillId) : null;
  const needsTarget =
    selectedSkill != null
      ? isActiveSkill(selectedSkill) && selectedSkill.target !== "none"
      : selected != null &&
        TARGET_DOMAIN_STAGES[jinnangCardOf(selected.id).targetDomain].stages > 0;
  const primaryAction =
    stage === "two-a"
      ? { label: "下一步", variant: "primary" as const }
      : skill != null || (selectedSkill != null && !needsTarget)
        ? { label: "发动", variant: "commit" as const }
        : targeting || (selected != null && !needsTarget)
          ? { label: "出牌", variant: "commit" as const }
          : { label: "选目标", variant: "primary" as const };
  const prompt =
    targetStep?.domain === "city"
      ? "选城"
      : stage === "two-a"
        ? "选第一位诸侯"
        : stage === "two-b"
          ? "选第二位诸侯"
          : "选诸侯";
  const pendingCommand: PlayCommand | null =
    pendingSkill != null
      ? { type: "useHeroSkill", ...pendingSkill }
      : pendingCard != null
        ? { type: "useJinnang", cardId: pendingCard.cardId }
        : null;
  const selectedCommand: PlayCommand | null =
    selected == null
      ? null
      : isSkillOption(selected)
        ? { type: "useHeroSkill", heroId: selected.skillHeroId, skillId: selected.skillId }
        : { type: "useJinnang", cardId: selected.id };

  return {
    ownsPhase,
    window: {
      hasSkillCards: options.some(isSkillOption),
      hand: {
        options,
        pendingCardId: pendingCard?.cardId ?? null,
        pendingSkillId: pendingSkill?.skillId ?? null,
        selectedKey: selected != null ? draft!.key : null,
        onSelect(selection: CardSelection | null) {
          if (interactive && cardScope != null) {
            setDraft(selection != null ? { ...selection, scope: cardScope } : null);
          }
        },
      },
      targetStep,
      actionFor(targets: TargetSelection) {
        const command =
          pendingCommand == null
            ? selectedCommand
            : targets.canConfirm
              ? { ...pendingCommand, targets: targets.selected }
              : null;
        const levy = selected?.levy;
        const detail = targeting
          ? [
              prompt,
              ...(targets.selectedLabels.length > 0
                ? [`已选 ${targets.selectedLabels.join("、")}`]
                : []),
            ].join(" · ")
          : levy != null
            ? `对其余 ${levy.affectedSeats.length} 位诸侯各征至多 ${formatMoney(levy.maxPerSeat)}`
            : undefined;
        return {
          title: card?.id ?? skill?.name ?? selected?.label ?? "出牌阶段",
          detail:
            targets.unavailableReason == null ? detail : `${detail} · ${targets.unavailableReason}`,
          primaryAction,
          cancelLabel: pendingSkill != null ? "作罢" : pendingCard != null ? "取消选牌" : undefined,
          canConfirm: command != null,
          onPlay() {
            if (interactive && command != null) dispatchCommand(command);
          },
          onPass() {
            if (!interactive) return;
            dispatchCommand(
              pendingCommand != null
                ? { ...pendingCommand, cancel: true }
                : { type: "useJinnang", cardId: null },
            );
          },
          onBack:
            pendingCard?.stage === "two-b"
              ? () => {
                  if (interactive) {
                    dispatchCommand({ type: "useJinnang", cardId: pendingCard.cardId, back: true });
                  }
                }
              : undefined,
        };
      },
    },
  };
}

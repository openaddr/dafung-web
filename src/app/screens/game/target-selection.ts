import { useCallback, useEffect, useState } from "react";
import type { ChoiceOption } from "@core/choices";

export interface TargetCandidate {
  id: number;
  label: string;
  available: boolean;
  reason?: string;
}

export interface TargetSelectionStep {
  domain: "seat" | "city";
  min: number;
  max: number;
  candidates: readonly TargetCandidate[];
}

/** 目标编号按域读取；席位号和城格号有各自的编号空间。 */
export function targetCandidates(
  choices: readonly ChoiceOption[],
  domain: TargetSelectionStep["domain"],
): TargetCandidate[] {
  return choices.flatMap((choice) => {
    const { targetTileIndex, targetSeat } = choice;
    if (choice.id === "cancel" && targetTileIndex == null && targetSeat == null) return [];
    const [id, foreignId] =
      domain === "city" ? [targetTileIndex, targetSeat] : [targetSeat, targetTileIndex];
    if (
      choice.id === "cancel" ||
      id == null ||
      !Number.isInteger(id) ||
      id < 0 ||
      foreignId != null
    )
      throw new Error(`目标选项 ${choice.id} 的 ${domain} 编号无效`);
    const { label, available, reason } = choice;
    return [{ id, label, available, reason }];
  });
}

const NO_TARGETS: readonly number[] = [];

function availableIds(step: TargetSelectionStep | null, ids: readonly number[]): number[] {
  return ids.filter((id) =>
    step?.candidates.some((candidate) => candidate.id === id && candidate.available),
  );
}

/** scope 标识本次选择的当前步骤；在途锁只关闭操作，scope 随权威步骤更新。 */
export function useTargetSelection(
  scope: string | null,
  step: TargetSelectionStep | null,
  initial: readonly number[] = NO_TARGETS,
) {
  const [draft, setDraft] = useState<{ scope: string; ids: number[] } | null>(null);
  useEffect(() => {
    setDraft((current) => (current?.scope === scope ? current : null));
  }, [scope]);
  const selected = availableIds(step, draft?.scope === scope ? draft.ids : initial);
  const toggle = useCallback(
    (id: number) => {
      if (
        step == null ||
        scope == null ||
        !step.candidates.some((candidate) => candidate.id === id && candidate.available)
      )
        return;
      setDraft((current) => {
        const ids = availableIds(step, current?.scope === scope ? current.ids : initial);
        if (ids.includes(id)) return { scope, ids: ids.filter((selectedId) => selectedId !== id) };
        if (step.max === 1) return { scope, ids: [id] };
        if (ids.length >= step.max) return current;
        return { scope, ids: [...ids, id] };
      });
    },
    [scope, step, initial],
  );
  return {
    selected,
    canConfirm: step != null && selected.length >= step.min && selected.length <= step.max,
    toggle,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { ChoiceOption } from "@dafung/core/engine/choices";

interface TargetCandidate {
  id: number;
  label: string;
  available: boolean;
  reason?: string;
}

export interface TargetSelectionStep {
  scope: string;
  domain: "seat" | "city";
  min: number;
  max: number;
  candidates: readonly TargetCandidate[];
  /** 返回第一步后，权威保留的首选可继续改选。 */
  initial?: readonly number[];
  /** 第二步展示已提交首选，当前命令只携带本步选择。 */
  firstSeat?: { id: number; label: string };
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

interface TargetDraft {
  scope: string;
  ids?: number[];
  unavailableReason?: string;
}

const NO_TARGETS: readonly number[] = [];

function availableIds(step: TargetSelectionStep | null, ids: readonly number[]): number[] {
  return ids.filter((id) =>
    step?.candidates.some((candidate) => candidate.id === id && candidate.available),
  );
}

/** 出牌阶段与反应窗共用一个目标草稿。命令在途只锁操作，权威换步才更换作用域。 */
export function useTargetSelection(step: TargetSelectionStep | null, interactive: boolean) {
  const scope = step?.scope;
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  useEffect(() => {
    setDraft((current) => (current?.scope === scope ? current : null));
  }, [scope]);

  const current = draft?.scope === scope ? draft : null;
  const initial = step?.initial ?? NO_TARGETS;
  const available = (step?.candidates ?? []).filter((candidate) => candidate.available);
  const selected = availableIds(step, current?.ids ?? initial);
  const selectedLabels = selected.map(
    (id) => available.find((candidate) => candidate.id === id)!.label,
  );
  if (step?.firstSeat != null) selectedLabels.unshift(step.firstSeat.label);

  const toggle = useCallback(
    (id: number) => {
      if (
        !interactive ||
        step == null ||
        !step.candidates.some((candidate) => candidate.id === id && candidate.available)
      )
        return;
      setDraft((draft) => {
        const current = draft?.scope === step.scope ? draft : null;
        const ids = availableIds(step, current?.ids ?? initial);
        if (ids.includes(id))
          return { scope: step.scope, ids: ids.filter((picked) => picked !== id) };
        if (step.max === 1) return { scope: step.scope, ids: [id] };
        if (ids.length < step.max) return { scope: step.scope, ids: [...ids, id] };
        return current?.unavailableReason != null ? { scope: step.scope, ids: current.ids } : draft;
      });
    },
    [interactive, step, initial],
  );
  const reportUnavailable = useCallback(
    (label: string, reason: string) => {
      if (scope == null) return;
      setDraft((current) => ({
        scope,
        ids: current?.scope === scope ? current.ids : undefined,
        unavailableReason: `${label} · ${reason}`,
      }));
    },
    [scope],
  );
  const candidateState = (id: number) => {
    const candidate = step?.candidates.find((candidate) => candidate.id === id);
    const firstPick = step?.firstSeat?.id === id;
    return {
      candidate,
      firstPick,
      selected: firstPick || selected.includes(id),
    };
  };

  return {
    available,
    selected,
    selectedLabels,
    canConfirm: step != null && selected.length >= step.min && selected.length <= step.max,
    unavailableReason: current?.unavailableReason,
    candidateState,
    toggle,
    reportUnavailable,
  };
}

export type TargetSelection = Pick<
  ReturnType<typeof useTargetSelection>,
  "selected" | "selectedLabels" | "canConfirm" | "unavailableReason"
>;

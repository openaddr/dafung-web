import { useCallback, useEffect, useState } from "react";
import {
  targetSelection,
  toggleTarget,
  type TargetDraft,
  type TargetStep,
} from "@dafung/core/protocol/target-selection";

export interface TargetSelectionStep extends TargetStep {
  scope: string;
}

/** 反应窗私有草稿随应答窗或选牌更换；与出牌阶段共用候选、切换和确认规则。 */
export function useReactionTargets(step: TargetSelectionStep | null, interactive: boolean) {
  const scope = step?.scope;
  const [draft, setDraft] = useState<(TargetDraft & { scope: string }) | null>(null);
  useEffect(() => {
    setDraft((current) => (current?.scope === scope ? current : null));
  }, [scope]);

  const selection = targetSelection(step, draft?.scope === scope ? draft : null);
  const toggle = (id: number) => {
    if (!interactive || step === null) return;
    setDraft((current) => {
      const { selected } = targetSelection(step, current?.scope === step.scope ? current : null);
      return { ...toggleTarget(step, selected, id), scope: step.scope };
    });
  };
  const reportUnavailable = useCallback(
    (label: string, reason: string) => {
      if (scope === undefined) return;
      setDraft((current) => ({
        scope,
        ids: current?.scope === scope ? current.ids : undefined,
        unavailableReason: `${label} · ${reason}`,
      }));
    },
    [scope],
  );
  return { ...selection, toggle, reportUnavailable };
}

export type TargetSelection = ReturnType<typeof targetSelection>;

import type { ChoiceOption } from "../engine/choices";

export interface TargetCandidate {
  readonly id: number;
  readonly label: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface TargetStep {
  readonly domain: "seat" | "city";
  readonly min: number;
  readonly max: number;
  readonly candidates: readonly TargetCandidate[];
  /** 两步流返回首段时可继续改选的已确认目标。 */
  readonly initial?: readonly number[];
  /** 第二步保留已确认的第一位，本步提交只携带 selected。 */
  readonly firstSeat?: { readonly id: number; readonly label: string };
}

/** 座位号和城格号独立编号，缺失或混用编号的下行选项直接暴露。 */
export function targetCandidates(
  choices: readonly ChoiceOption[],
  domain: TargetStep["domain"],
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

export interface TargetDraft {
  readonly ids?: readonly number[];
  readonly unavailableReason?: string;
}

export interface TargetSelection {
  readonly available: readonly TargetCandidate[];
  readonly selected: readonly number[];
  readonly selectedLabels: readonly string[];
  readonly canConfirm: boolean;
  readonly unavailableReason?: string;
}

export function targetSelection(
  step: TargetStep | null,
  draft: TargetDraft | null,
): TargetSelection {
  const available = (step?.candidates ?? []).filter((candidate) => candidate.available);
  const selected = (draft?.ids ?? step?.initial ?? []).filter((id) =>
    available.some((candidate) => candidate.id === id),
  );
  const selectedLabels = selected.map((id) => available.find((c) => c.id === id)!.label);
  if (step?.firstSeat !== undefined) selectedLabels.unshift(step.firstSeat.label);
  return {
    available,
    selected,
    selectedLabels,
    canConfirm: step !== null && selected.length >= step.min && selected.length <= step.max,
    unavailableReason: draft?.unavailableReason,
  };
}

export function toggleTarget(
  step: TargetStep,
  selected: readonly number[],
  id: number,
): TargetDraft {
  const candidate = step.candidates.find((choice) => choice.id === id);
  if (candidate === undefined) return { ids: selected, unavailableReason: "不在本次影响范围" };
  if (!candidate.available) {
    const reason = candidate.reason;
    if (reason === undefined) throw new Error(`目标 ${id} 缺少不可用原因`);
    return { ids: selected, unavailableReason: `${candidate.label} · ${reason}` };
  }
  if (selected.includes(id)) return { ids: selected.filter((picked) => picked !== id) };
  if (step.max === 1) return { ids: [id] };
  if (selected.length >= step.max)
    return { ids: selected, unavailableReason: `最多可选 ${step.max} 个目标` };
  return { ids: [...selected, id] };
}

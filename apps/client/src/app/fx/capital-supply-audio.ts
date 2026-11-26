import type { CapitalRecruitmentCue } from "./presentation";
import { FX } from "./timings";

// 当前招贤窗口至多一个。兑现时核对提取拍的对象，旧铜钱抵达不会接上新卷轴。
let pending: {
  cue: CapitalRecruitmentCue;
  sound?: () => void;
  timer?: ReturnType<typeof setTimeout>;
} | null = null;

export function stageCapitalRecruitment(cue: CapitalRecruitmentCue): void {
  discardCapitalRecruitment();
  pending = { cue };
}

export function discardCapitalRecruitment(): void {
  clearTimeout(pending?.timer);
  pending = null;
}

export function finishCapitalSupply(cue: CapitalRecruitmentCue): void {
  if (pending?.cue !== cue || pending.timer !== undefined) return;
  const waiting = pending;
  waiting.timer = setTimeout(() => {
    pending = null;
    waiting.sound?.();
  }, FX.capitalSupplyHandoffMs);
}

export function playRecruitmentAfterSupply(
  { gameId, turn, playerId }: CapitalRecruitmentCue,
  play: () => void,
): void {
  const cue = pending?.cue;
  if (
    pending !== null &&
    cue?.gameId === gameId &&
    cue.turn === turn &&
    cue.playerId === playerId
  ) {
    pending.sound = play;
  } else {
    play();
  }
}

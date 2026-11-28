import {
  cmdMsg,
  requiresPlayerSubmission,
  submissionMsg,
  type PlayerCommand,
  type SubmissionResultMsg,
} from "./wire";

/** 原座重连时重发首次编码的指令。另一笔回执不能解锁当前提交。 */
export class PlayerCommandOutbox {
  private pending: { id: string; frame: string; point: string; requestId?: number } | null = null;
  private settlingPoint: string | null = null;

  get unacknowledged(): string | null {
    return this.pending === null ? null : this.pending.frame;
  }

  get requestId(): number | undefined {
    return this.pending?.requestId;
  }

  /** 回执可能先于事件批。原步获准后维持操作锁，直到本座看到下一步。 */
  waitingFor(point: string | null): boolean {
    return this.pending !== null || (point !== null && this.settlingPoint === point);
  }

  encode(
    cmd: PlayerCommand,
    roomId: string,
    seat: number,
    decisionPoint: string | null,
    requestId?: number,
  ): string {
    if (this.waitingFor(decisionPoint)) throw new Error("已有玩家提交等待回执或局面更新");
    if (!requiresPlayerSubmission(cmd)) return cmdMsg(cmd, requestId);
    if (decisionPoint === null) throw new Error("当前座位没有可提交的决策点");
    const submissionId = crypto.randomUUID();
    const frame = submissionMsg({ cmd, roomId, seat, decisionPoint, submissionId }, requestId);
    this.pending = { id: submissionId, frame, point: decisionPoint, requestId };
    return frame;
  }

  matchesRequest(requestId: number | undefined): boolean {
    return requestId !== undefined && this.pending?.requestId === requestId;
  }

  /** 内存通路会直接提示失败，释放相应提交以允许玩家重试。 */
  discardFailed(requestId: number | undefined): void {
    if (this.matchesRequest(requestId)) this.pending = null;
  }

  acknowledge(result: SubmissionResultMsg): boolean {
    if (this.pending === null || result.submissionId !== this.pending.id) return false;
    this.settlingPoint = result.outcome === "accepted" ? this.pending.point : null;
    this.pending = null;
    return true;
  }
}

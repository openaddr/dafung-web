import {
  cmdMsg,
  requiresPlayerSubmission,
  submissionMsg,
  type PlayerCommand,
  type SubmissionResultMsg,
} from "./wire";

type SubmissionScope = "decision" | "autopilot";
type PendingSubmission = { id: string; frame: string; point: string; requestId?: number };

/** 原座重连时重发首次编码的指令。另一笔回执不能解锁当前提交。 */
export class PlayerCommandOutbox {
  private readonly pending = new Map<SubmissionScope, PendingSubmission>();
  private readonly settlingPoints = new Map<SubmissionScope, string>();

  get unacknowledged(): string[] {
    return [...this.pending.values()].map(({ frame }) => frame);
  }

  get requestIds(): number[] {
    return [...this.pending.values()]
      .map(({ requestId }) => requestId)
      .filter((id) => id !== undefined);
  }

  /** 回执可能先于事件批。原步获准后维持操作锁，直到本座看到下一步。 */
  waitingFor(point: string | null, scope: SubmissionScope = "decision"): boolean {
    return this.pending.has(scope) || this.settlingPoints.get(scope) === point;
  }

  encode(
    cmd: PlayerCommand,
    roomId: string,
    seat: number,
    decisionPoint: string | null,
    requestId?: number,
  ): string {
    const scope = cmd.type === "setAutoPilot" ? "autopilot" : "decision";
    if (this.waitingFor(decisionPoint, scope)) throw new Error("已有玩家提交等待回执或局面更新");
    if (!requiresPlayerSubmission(cmd)) return cmdMsg(cmd, requestId);
    if (decisionPoint === null) throw new Error("当前座位没有可提交的决策点");
    const submissionId = crypto.randomUUID();
    const frame = submissionMsg({ cmd, roomId, seat, decisionPoint, submissionId }, requestId);
    this.pending.set(scope, { id: submissionId, frame, point: decisionPoint, requestId });
    return frame;
  }

  matchesRequest(requestId: number | undefined): boolean {
    return requestId !== undefined && this.requestIds.includes(requestId);
  }

  /** 内存通路会直接提示失败，释放相应提交以允许玩家重试。 */
  discardFailed(requestId: number | undefined): void {
    if (requestId === undefined) return;
    for (const [scope, entry] of this.pending)
      if (entry.requestId === requestId) this.pending.delete(scope);
  }

  acknowledge(result: SubmissionResultMsg): boolean {
    for (const [scope, entry] of this.pending) {
      if (result.submissionId !== entry.id) continue;
      if (result.outcome === "accepted") this.settlingPoints.set(scope, entry.point);
      else this.settlingPoints.delete(scope);
      this.pending.delete(scope);
      return true;
    }
    return false;
  }
}

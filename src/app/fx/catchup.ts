// 落后即校准判据(#610,ADR-0029 不变量③):演出落后于权威产出时,治理演出,
// 不锁人、不硬等。判据 = 混合尺、分类非布尔(#570 决议;#600 colyseus drift 三分同构
// ——瞬时抖动平滑吸收,持续发散才校准):
//   主尺 = 未消费批数(到达序游标差,机器时间:负载免疫、e2e 天然不误触发);
//   辅尺 = 批龄(本批入队至今的等待,防单批超长漏报——主尺的盲区)。
// 三档:steady(在线内)/ catchup(单次超线,升追帧倍率=演出仍在,只是更快)/
// snap(连续 N 批超线,升吸附档=过时演出无因果意义,整块作废)。判据输入非法当场
// 抛错(零兜底):落后度是确定事实,不是可回退值;吸附是生命周期语义,不掩盖引擎 bug。
import { LAG } from "./timings";

export type CatchupTier = "steady" | "catchup" | "snap";

export interface LagInput {
  /** 主尺:未消费批数(到达序游标差;含在队未处置块与到达未入队 surplus)。 */
  gapBatches: number;
  /** 辅尺:本批入队至今的等待毫秒(performance.now 差)。 */
  waitMs: number;
}

export interface CatchupDecision {
  tier: CatchupTier;
  /** 本拍生效的追帧速度倍率(调用方经 setCatchupScale 写入,消费在 timings.scStage
   *  的时长除法:演出时长 = 基准 ÷ 本值——积压越深播得越快,#570 决议正典方向)。 */
  runtimeScale: number;
}

/** 调试桥只读计数(__dafung.fxCatchup 经 E2E_DEBUG_BRIDGE_KEY 门禁透出,e2e 可断言、
 *  现场排查可取)。累计值,不随 resetEventFace 复位——诊断面看全程,不看单局。 */
export const catchupCounters = {
  laggyBatches: 0,
  catchupBatches: 0,
  snapBatches: 0,
  lastGapBatches: 0,
  lastWaitMs: 0,
  lastRuntimeScale: 1,
};

export class LagCalibrator {
  /** 连续超线计数(吸附后重开观察窗归零;steady 归零)。 */
  private streak = 0;
  /** 上一拍是否超线(回落日志只在真回落时打,不刷屏)。 */
  private wasLaggy = false;

  observe(input: LagInput): CatchupDecision {
    const { gapBatches, waitMs } = input;
    if (
      !(Number.isFinite(gapBatches) && gapBatches >= 0) ||
      !(Number.isFinite(waitMs) && waitMs >= 0)
    )
      throw new Error(`LagCalibrator:判据输入非法(差=${gapBatches} 批,批龄=${waitMs}ms)`);
    catchupCounters.lastGapBatches = gapBatches;
    catchupCounters.lastWaitMs = waitMs;
    const lagging = gapBatches >= LAG.gapBatches || waitMs >= LAG.ageMs;
    if (!lagging) {
      if (this.wasLaggy)
        console.debug(
          `[落后校准] 回落:积压清线(差 ${gapBatches} 批/批龄 ${Math.round(waitMs)}ms),倍率回 1`,
        );
      this.streak = 0;
      this.wasLaggy = false;
      catchupCounters.lastRuntimeScale = 1;
      return { tier: "steady", runtimeScale: 1 };
    }
    this.streak += 1;
    this.wasLaggy = true;
    catchupCounters.laggyBatches += 1;
    // 追帧速度倍率随积压深度爬坡:gap 阈值起步 scaleMin,每深一批 +scaleStep,
    // 顶格 scaleMax(追帧倍率上限即两档分界,ADR-0029 ③:追到顶仍追不上才丢;
    // 消费 = scStage 时长除法,倍率越大播得越快)。
    const scale = Math.min(
      LAG.scaleMax,
      LAG.scaleMin + Math.max(0, gapBatches - LAG.gapBatches) * LAG.scaleStep,
    );
    catchupCounters.lastRuntimeScale = scale;
    if (this.streak >= LAG.consecutiveForSnap) {
      this.streak = 0; // 吸附后重开观察窗:下一批从 1 重新计数
      catchupCounters.snapBatches += 1;
      console.debug(
        `[落后校准] 吸附:连续 ${LAG.consecutiveForSnap} 批超线(差 ${gapBatches} 批/批龄 ${Math.round(waitMs)}ms),本批未播块作废`,
      );
      return { tier: "snap", runtimeScale: scale };
    }
    catchupCounters.catchupBatches += 1;
    console.debug(
      `[落后校准] 追帧×${scale}:差 ${gapBatches} 批/批龄 ${Math.round(waitMs)}ms(连超 ${this.streak}/${LAG.consecutiveForSnap})`,
    );
    return { tier: "catchup", runtimeScale: scale };
  }

  /** 边界复位(断线 dropStalledBatch / 重连 resetEventFace):判据态清零、倍率回 1——
   *  边界后旧积压已作废,落后度从零重观察;计数不清(全程累计)。 */
  reset(): void {
    this.streak = 0;
    this.wasLaggy = false;
  }
}

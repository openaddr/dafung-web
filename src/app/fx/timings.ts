// 时长常量(bot 延时/动画节奏),集中调参——迁移自 src/render/timings.ts,
// 并补阶段 6 新增的行军/瞬时特效时长(render/ 删除前两处不要交叉引用)。

export const BOT = {
  stepDelayMs: 750,
} as const;

/** JS 侧动画时长(ms),与 CSS --dur-* 对应。集中处,别散落硬编码。 */
export const ANIM = {
  fast: 150,
  mid: 250,
  slow: 400,
} as const;

/** 令牌行军(旧 animate.ts animateMove 的逐段节奏,语义不变):
 *  每段时长 ∝ 距离(匀速),夹在 [minSegMs, maxSegMs] 之间。 */
export const MARCH = {
  minSegMs: 80,
  maxSegMs: 460,
  /** 像素/秒:距离 ÷ speed = 段时长(旧实现 dist / 720,单位 px/s) */
  speed: 720,
  /** 每段 transition 结束后的额外缓冲(等过渡真正收尾,旧实现 +10ms) */
  segSlackMs: 10,
} as const;

/** 瞬时特效存活时长(与 fx.css 的 keyframe 时长保持一致;超时自清防 store 积压)。 */
export const FX = {
  floaterMs: 1300,
  coinMs: 1500,
  bannerMs: 1900, // banner-fly 1.8s + 余量
  sealMs: 900,
  roadFlowMs: 700, // 驿道流光高亮存留
} as const;

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** 等一帧(requestAnimationFrame 两拍:先让 React commit,再拿稳定 DOM)。 */
export const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

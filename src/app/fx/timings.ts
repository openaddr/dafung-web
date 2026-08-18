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
  /** C3 回合横幅占用编排时长:等横幅走到峰值停留段(1.8s 动画的 20%-75% 区间),
   *  取 1.0s——下一演出(骰子)不再与横幅入场重叠,又不把回合节奏拖满全长。 */
  bannerHoldMs: 1000,
  sealMs: 900,
  roadFlowMs: 700, // 驿道流光高亮存留
} as const;

/** 3D 骰子掷骰节奏(ThreeDice 实播墙钟判据;时长集中调参)。
 *  C1 bot 掷骰半速:bot 回合节奏优先,翻滚/硬上限/落定停留全面减半。 */
export const DICE = {
  minRollMs: 500,   // 至少滚 0.5s(人类掷骰的翻滚感)
  hardCapMs: 1500,  // 墙钟硬上限(与 GPU 帧率无关)
  holdMs: 600,      // 落定后结果停留,再隐藏 overlay
  botMinRollMs: 250,
  botHardCapMs: 900,
  botHoldMs: 250,
} as const;

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** 等一帧(requestAnimationFrame 两拍:先让 React commit,再拿稳定 DOM)。 */
export const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

// 时长常量(bot 延时/动画节奏),集中调参——迁移自 src/render/timings.ts,
// 并补阶段 6 新增的行军/瞬时特效时长(render/ 删除前两处不要交叉引用)。
// 与 CSS 动效 token 的关系(C8 #107):唯一源 core/theme.ts Motion,gen:theme 产出 tokens.css。
// 本文件数值恰等于某 --dur-* 的字段直接引用 Motion(app→core 单向依赖,theme.ts 零依赖无环),
// 改 Motion 一处 CSS/JS 同步;不等的字段是编排窗口(非 token 节拍),保留字面量单独调参。
import { Motion } from "@core/theme";

/** e2e 时间倍率(#114):共享 fixture 在页面加载前写入 localStorage;生产/真人局
 *  无此键,S===1 时 sc 直通(不落地板——80ms 级短拍必须保持原值)。 */
export const E2E_TIME_SCALE_KEY = "dafung-e2e-time-scale";
/** 地板:headless+软渲下 expect 轮询的可观察下限,保瞬态演出(骰子签面/横幅)可被断言。 */
export const TIME_SCALE_FLOOR_MS = 100;

/** 缩放工厂(纯函数单测缝):乘倍率、四舍五入、地板托底;非法倍率按 1 语义(仍带地板)。 */
export const makeScaler = (scale: number): ((ms: number) => number) => {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (ms) => Math.max(Math.round(ms * s), TIME_SCALE_FLOOR_MS);
};

const S = (() => {
  if (typeof localStorage === "undefined") return 1;
  const raw = Number(localStorage.getItem(E2E_TIME_SCALE_KEY) ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();
const sc = S === 1 ? (ms: number) => ms : makeScaler(S);

export const BOT = {
  stepDelayMs: sc(750),
} as const;

/** 令牌行军(旧 animate.ts animateMove 的逐段节奏,语义不变):
 *  每段时长 ∝ 距离(匀速),夹在 [minSegMs, maxSegMs] 之间。 */
export const MARCH = {
  minSegMs: sc(80),
  maxSegMs: sc(460),
  /** 像素/秒:距离 ÷ speed = 段时长(旧实现 dist / 720,单位 px/s) */
  speed: 720,
  /** 每段 transition 结束后的额外缓冲。S6(#39):10→0——缓动改 easeInOutSine
   *  (board.css .bv-token-marching)后段尾速度趋零,10ms 硬等待反成顿挫;
   *  无缝衔接读作一气呵成,终点落定感由缓动尾段承担。 */
  segSlackMs: 0,
} as const;

/** 瞬时特效存活时长(与 fx.css 的 keyframe 时长保持一致;超时自清防 store 积压)。
 *  CSS 侧时长/缓动唯一源 core/theme.ts Motion(经 gen:theme 产出 tokens.css):
 *  floaterMs 与 --dur-fx 同源(经 Motion);coinMs/bannerMs/sealMs/roadFlowMs 不等于
 *  任何 token,是编排窗口,保留字面量,与编排类 keyframe 硬同步,改任一侧须两处同改。 */
export const FX = {
  floaterMs: sc(Motion.dur.fx), // 与 --dur-fx 同源(经 Motion)
  coinMs: sc(1500),
  bannerMs: sc(1900), // banner-fly 1.8s + 余量
  /** C3 回合横幅占用编排时长:等横幅走到峰值停留段(1.8s 动画的 20%-75% 区间),
   *  取 1.0s——下一演出(骰子)不再与横幅入场重叠,又不把回合节奏拖满全长。 */
  bannerHoldMs: sc(1000),
  sealMs: sc(900),
  roadFlowMs: sc(700), // 驿道流光高亮存留
} as const;

/** 3D 骰子掷骰节奏(ThreeDice 实播墙钟判据;时长集中调参)。
 *  C1 bot 掷骰半速:bot 回合节奏优先,翻滚/硬上限/落定停留全面减半。
 *  X5:落定后先弹大字签面确认结果,holdMs 满再渐隐退场(fadeOutMs);任何掷骰
 *  (含 bot/软渲 fallback)结束后都有 ≥300ms 可读结果。
 *  与 token 同值者(holdMs=--dur-reveal / botMinRollMs=fadeOutMs=--dur-med /
 *  botHoldMs=--dur-slow)经 Motion 取数;minRollMs/hardCapMs/botHardCapMs/
 *  fallbackHoldMs 是编排判据,保留字面量。 */
export const DICE = {
  minRollMs: sc(500),   // 至少滚 0.5s(人类掷骰的翻滚感)
  hardCapMs: sc(1500),  // 墙钟硬上限(与 GPU 帧率无关)
  holdMs: sc(Motion.dur.reveal),      // 落定后结果(3D 骰 + 大字签面)停留,再渐隐;与 --dur-reveal 同源(经 Motion)
  botMinRollMs: sc(Motion.dur.med),   // 与 --dur-med 同源(经 Motion)
  botHardCapMs: sc(900),
  botHoldMs: sc(Motion.dur.slow),     // X5:250 → 400(签面弹入 ~300ms + 可读停留);与 --dur-slow 同源(经 Motion)
  fallbackHoldMs: sc(650), // X5 软渲/无 WebGL 文字签面的停留
  fadeOutMs: sc(Motion.dur.med),      // X5 overlay 渐隐退场;与 --dur-med 同源(经 Motion),fx.css .dice-overlay-out 消费同一 token
} as const;

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** 等一帧(requestAnimationFrame 两拍:先让 React commit,再拿稳定 DOM)。 */
export const nextFrame = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

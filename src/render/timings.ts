// 时长常量(bot 延时等),集中调参。动画帧/时长命名化见 task 2.8(后续统一 sweep)。
// CSS 侧过渡时长统一口见 style.css :root 的 --dur-fast/mid/slow + --ease(V3)。
export const BOT = {
  stepDelayMs: 750,
} as const;

/** JS 侧动画时长(ms),与 CSS --dur-* 对应。集中处,别散落硬编码。 */
export const ANIM = {
  fast: 150,
  mid: 250,
  slow: 400,
} as const;

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));


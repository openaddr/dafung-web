// 时长常量(bot 延时等),集中调参。动画帧/时长命名化见 task 2.8(后续统一 sweep)。
export const BOT = {
  stepDelayMs: 750,
} as const;

export const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));


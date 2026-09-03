// 共享 Playwright fixtures(#116):全部 spec 从这里 import test/expect,不再直接
// import @playwright/test。page fixture 在页面加载前(addInitScript,先于应用任何
// 模块初始化)写入 e2e 时间倍率 localStorage 键,src/app/fx/timings.ts 模块初始化时
// 读取该键缩放演出编排时长(骰子/横幅/行军/bot 延时),大幅缩短 e2e 墙钟。
// 生产/真人局无此键,倍率恒为 1(逐位恒等直通),零感知。
import { test as base, expect } from "@playwright/test";
// 键名单源:与 timings.ts 共用同一常量,避免字符串双源漂移。
// (timings.ts 自身 import @core/theme——playwright 的 tsconfig paths 解析可处理,
// 若运行时报模块解析失败,回退为字面量 "dafung-e2e-time-scale" 并在此注明。)
import { E2E_TIME_SCALE_KEY } from "../src/app/fx/timings";

export { expect };
export type { Browser, Page } from "@playwright/test";

// 注入值(env 可覆盖):localStorage 只存字符串,注入的必须是数字字符串,
// timings 侧对非法值按 1(全速)解释。
const timeScale = process.env.E2E_TIME_SCALE ?? "0.25";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: E2E_TIME_SCALE_KEY, value: timeScale },
    );
    await use(page);
  },
});

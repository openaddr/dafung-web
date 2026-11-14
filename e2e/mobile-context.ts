import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test";

/** 浏览器回路唯一默认环境(DESIGN §4.7):移动横屏,真触控能力。
 *  Playwright fixture 的 use 不会传给 browser.newContext/newPage;裸上下文经本口创建。
 *  矮横屏/竖屏/真实 hover 专项在对应 spec 中显式覆盖,不另立桌面布局档。 */
export const MOBILE_CONTEXT_OPTIONS = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
} satisfies BrowserContextOptions;

export function newMobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext(MOBILE_CONTEXT_OPTIONS);
}

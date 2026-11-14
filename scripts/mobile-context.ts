import type { BrowserContextOptions } from "playwright";

/** 用户明确要求的单次截图/排查工具默认环境(DESIGN §4.7)。 */
export const MOBILE_CONTEXT_OPTIONS = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
} satisfies BrowserContextOptions;

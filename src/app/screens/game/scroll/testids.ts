// 决策卷轴/胜利屏的 data-testid 常量(kebab-case,与上层 testids.ts 约定一致)。
// 单独文件而不是并入上层 TESTIDS:卷轴组件自成目录,避免主线接线时跨文件合并冲突。
export const SCROLL_TESTIDS = {
  // ── 卷轴容器 ──
  scrollShell: "scroll-shell",
  scrollTitle: "scroll-title",
  scrollClose: "scroll-close",

  // ── 各决策卷轴 ──
  heroPickScroll: "scroll-hero-pick",
  heroPickOption: (index: number) => `scroll-hero-pick-option-${index}` as const,
  heroPickDecline: "scroll-hero-pick-decline",

  treasureScroll: "scroll-treasure",
  treasureModeFair: "scroll-treasure-mode-fair",
  treasureModePremium: "scroll-treasure-mode-premium",
  treasureSkip: "scroll-treasure-skip",
  treasureItem: (treasureId: string) => `scroll-treasure-item-${treasureId}` as const,
  treasureBack: "scroll-treasure-back",

  bankruptcyScroll: "scroll-bankruptcy",
  bankruptcyDebt: "scroll-bankruptcy-debt",
  bankruptcySellTreasure: (treasureId: string) => `scroll-bankruptcy-sell-treasure-${treasureId}` as const,
  bankruptcySellProp: (propId: string) => `scroll-bankruptcy-sell-prop-${propId}` as const,
  bankruptcySellHero: (heroId: string) => `scroll-bankruptcy-sell-hero-${heroId}` as const,
  bankruptcyConfirm: "scroll-bankruptcy-confirm",

  confirmDialog: "scroll-confirm",
  confirmOk: "scroll-confirm-ok",
  confirmCancel: "scroll-confirm-cancel",

  // ── 城池详情 ──
  tileDetailScroll: "scroll-tile-detail",

  // ── 胜利屏 ──
  victoryScreen: "victory-screen",
  victoryTitle: "victory-title",
  victorySub: "victory-sub",
  victoryInfo: "victory-info",
  victoryRestart: "victory-restart",
} as const;

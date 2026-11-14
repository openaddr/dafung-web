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

  // ── 常规决策卷轴(购地/扩军;按钮沿用上层 action-* testid)──
  buyScroll: "scroll-buy",
  upgradeScroll: "scroll-upgrade",

  // ── 抉择机遇(#124):容器 + 选项(下标 = def.choices 序,与 snapshot.choices 一致)──
  encounterScroll: "scroll-encounter",
  encounterOption: (index: number) => `scroll-encounter-option-${index}` as const,
  /** 奇遇金穗纹饰(#1155):宽卷题行两端的金穗侧饰宿主(一对镜像 SVG,纯装饰)。 */
  encounterSpray: "scroll-encounter-spray",

  // (scroll-jinnang* 族已随旧弹窗退役删除,#256/#255:放行点迁 actionbar-pass,
  //  选项/确认 testid 族由 HandRack 的 jinnang-card-* 与动作条 actionbar-* 承担。)

  treasureScroll: "scroll-treasure",
  treasureModeFair: "scroll-treasure-mode-fair",
  treasureModePremium: "scroll-treasure-mode-premium",
  treasureSkip: "scroll-treasure-skip",
  treasureItem: (treasureId: string) => `scroll-treasure-item-${treasureId}` as const,
  treasureBack: "scroll-treasure-back",
  // ── 交涉选宝弹层(#362):模式选定后的点选弹层 + 二段式成交钮 ──
  treasurePick: "scroll-treasure-pick",
  treasureConfirm: "scroll-treasure-confirm",

  bankruptcyScroll: "scroll-bankruptcy",
  bankruptcyDebt: "scroll-bankruptcy-debt",
  bankruptcyProgress: "scroll-bankruptcy-progress",
  // ── 破产变卖选宝(#362):卷轴内入口钮 + 点选弹层(已凑/债务进度)+ 二段式变卖钮 ──
  bankruptcySellTreasureOpen: "scroll-bankruptcy-sell-treasure-open",
  bankruptcySellTreasure: (treasureId: string) =>
    `scroll-bankruptcy-sell-treasure-${treasureId}` as const,
  bankruptcySellTreasureConfirm: "scroll-bankruptcy-sell-treasure-confirm",
  bankruptcyTreasurePick: "scroll-bankruptcy-treasure-pick",
  bankruptcyPickProgress: "scroll-bankruptcy-pick-progress",
  bankruptcySellProp: (propId: string) => `scroll-bankruptcy-sell-prop-${propId}` as const,
  bankruptcySellHero: (heroId: string) => `scroll-bankruptcy-sell-hero-${heroId}` as const,
  bankruptcyConfirm: "scroll-bankruptcy-confirm",

  confirmDialog: "scroll-confirm",
  confirmOk: "scroll-confirm-ok",
  confirmCancel: "scroll-confirm-cancel",

  // ── 城池详情 ──
  tileDetailScroll: "scroll-tile-detail",
  /** 防御值行(#1391 T5,有主城才有):「防御 当前/满值」数值本体,满值=满值表
   *  core/defense.ts 单源;无主城不渲染(免疫,无防御语义)。 */
  tileDetailDefense: "scroll-tile-detail-defense",

  // ── 胜利屏 ──
  victoryScreen: "victory-screen",
  victoryTitle: "victory-title",
  victorySub: "victory-sub",
  victoryInfo: "victory-info",
  /** E4(#16):终榜一行(身价降序 + 破产标注)。 */
  victoryStandings: "victory-standings",
  victoryRestart: "victory-restart",
  /** #642 异常终局(对局作废):作废标题 + 说明文案(壳体沿用 victory-screen,
   *  出口按钮复用 victory-restart,零新增)。 */
  victoryAbortedTitle: "victory-aborted-title",
  victoryAbortedNote: "victory-aborted-note",
} as const;

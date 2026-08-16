// data-testid 常量集中导出:e2e / 测试统一从这里 import,避免散落字符串拼写漂移。
// 命名约定:kebab-case;区域容器 `xxx-panel`,条目 `xxx-item`(可带索引后缀)。
// 棋盘侧的 data 属性由 BoardView/Tile 自带(data-tile=N),此处不重复定义。
export const TESTIDS = {
  // ── 侧栏四区容器 ──
  statusBarPanel: "status-bar-panel",
  handPanel: "hand-panel",
  othersPanel: "others-panel",
  warlogPanel: "warlog-panel",
  /** 侧栏抽屉折叠(S5):展开态容器 / 折叠窄条容器 / 切换按钮(两态同名)。 */
  sidebarPanel: "sidebar-panel",
  sidebarCollapsed: "sidebar-collapsed",
  sidebarToggle: "sidebar-toggle",

  // ── 状态栏(回合区)──
  roundInfo: "round-info",
  statusCard: "status-card",
  statusGuohao: "status-guohao",
  statusMeta: "status-meta",

  // ── 手牌/动作区 ──
  handCash: "hand-cash",
  handWarrants: "hand-warrants",
  handTreasure: (id: string) => `hand-treasure-${id}` as const,
  handHero: (id: string) => `hand-hero-${id}` as const,
  diceFace: "dice-face",
  rollButton: "roll-button",
  /** 珍宝/名士详情卷轴(HandPanel 点卡弹出;UI F5)。 */
  cardDetailScroll: "card-detail-scroll",
  /** 决策按钮(交互重构后按钮本体住在各决策卷轴里,testid 命名不变,减少 e2e 震荡)。 */
  actionButton: (action: string) => `action-${action}` as const, // action-buy / action-skip / …

  // ── 托管(联机;spec: autopilot)──
  autopilotButton: "autopilot-button",
  autopilotSpeed: "autopilot-speed",

  // ── 诸侯列表 ──
  otherPlayer: (seat: number) => `other-player-${seat}` as const,

  // ── 战报 ──
  warlogItem: "warlog-item",
  warlogTabBrief: "warlog-tab-brief",
  warlogTabDetail: "warlog-tab-detail",

  // ── 覆盖提示 ──
  hint: "hint", // App.tsx(设置屏兜底)也引用本常量,勿裸写字符串
  thinking: "thinking",

  // ── 棋盘区小组件 ──
  muteButton: "mute-button",
  /** 总览复位(还原 pan/zoom;等价旧 BoardView.resetView)。 */
  resetView: "reset-view",

  // ── 未开局兜底页(S9)──
  /** 「尚未开局」卡片的「回到首页」按钮(快照缺失时的引导逃生口)。 */
  notStartedBack: "not-started-back",
} as const;

// 本屏 data-testid 常量集中导出:测试选择器唯一来源,避免散落字符串拼写漂移。
// 命名约定:kebab-case,语义 = 区块 + 用途;带参数的用工厂函数。
// screen = 单机配置页(信息架构重构后由原 SetupScreen 迁来;首页 testids 见 home/)。
export const TID = {
  screen: "solo-setup-screen",
  seatCount: "setup-seat-count",
  target: "setup-target",
  difficulty: "setup-difficulty",
  /** 座位行(N = 0 起的座位下标;0 = 真人,其余 bot)。 */
  seatRow: (n: number) => `setup-seat-${n}`,
  seatGuohaoInput: (n: number) => `setup-seat-${n}-guohao`,
  seatType: (n: number) => `setup-seat-${n}-type`,
  guohaoPool: "guohao-pool",
  guohaoChar: (ch: string) => `guohao-char-${ch}`,
  // 机遇折叠区(#125):details 开合杆 + 四个数字输入(触发概率 % / 三档基准)
  encounterToggle: "setup-encounter-toggle",
  encounterTrigger: "setup-encounter-trigger",
  encounterGood: "setup-encounter-good",
  encounterNeutral: "setup-encounter-neutral",
  encounterBad: "setup-encounter-bad",
  hint: "setup-hint",
  startGame: "start-game",
  currentMapName: "current-map-name",
  mapPanel: "map-select-panel",
  mapItem: (id: string) => `map-item-${id}`,
  mapPreview: "map-preview",
  mapConfirm: "map-confirm",
  mapCancel: "map-cancel",
} as const;

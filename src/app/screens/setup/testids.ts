// 本屏 data-testid 常量集中导出:测试选择器唯一来源,避免散落字符串拼写漂移。
// 命名约定:kebab-case,语义 = 区块 + 用途;带参数的用工厂函数。
export const TID = {
  screen: "setup-screen",
  seatCount: "setup-seat-count",
  target: "setup-target",
  difficulty: "setup-difficulty",
  /** 座位行(N = 0 起的座位下标;0 = 真人,其余 bot)。 */
  seatRow: (n: number) => `setup-seat-${n}`,
  seatGuohaoInput: (n: number) => `setup-seat-${n}-guohao`,
  seatType: (n: number) => `setup-seat-${n}-type`,
  guohaoPool: "guohao-pool",
  guohaoChar: (ch: string) => `guohao-char-${ch}`,
  hint: "setup-hint",
  startGame: "start-game",
  editMap: "edit-map",
  selectMap: "select-map",
  onlineGame: "online-game",
  currentMapName: "current-map-name",
  mapPanel: "map-select-panel",
  mapItem: (id: string) => `map-item-${id}`,
  mapPreview: "map-preview",
  mapConfirm: "map-confirm",
  mapCancel: "map-cancel",
} as const;

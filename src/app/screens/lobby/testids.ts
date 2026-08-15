// 大厅屏 data-testid 常量集中导出:e2e 选择器唯一来源(同 setup/game 屏约定)。
export const LID = {
  screen: "lobby-screen",
  // 连接区(未入座时)
  create: "lobby-create",
  seatCount: "lobby-seat-count",
  target: "lobby-target",
  joinInput: "lobby-join-input",
  join: "lobby-join",
  // 房间区(已入座)
  roomCode: "room-code",
  seatRow: (n: number) => `lobby-seat-${n}` as const,
  mapName: "lobby-map-name",
  selectMap: "lobby-select-map",
  start: "lobby-start",
  back: "lobby-back",
} as const;

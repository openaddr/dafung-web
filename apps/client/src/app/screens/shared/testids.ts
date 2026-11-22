// 主页与对局设置共用的对局诊断面板。
export const GAME_DIAG_TID = {
  dialog: "game-diagnostic-dialog",
  game: (id: string) => `game-diagnostic-game-${id}`,
  save: "game-diagnostic-save",
} as const;

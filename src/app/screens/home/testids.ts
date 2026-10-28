// 首页 data-testid 常量(命名约定同 setup/testids.ts)。
export const HOME_TID = {
  screen: "home-screen",
  solo: "home-solo",
  online: "home-online",
  selectMap: "home-select-map",
  editMap: "home-edit-map",
  // #707 矮横屏档横排条带(替代二级选图弹层的首页内联选择器)
  mapStrip: "home-map-strip",
  mapStripItem: (id: string) => `home-map-strip-item-${id}`,
} as const;

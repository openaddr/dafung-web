// 首页 data-testid 常量(命名约定同 setup/testids.ts)。
export const HOME_TID = {
  screen: "home-screen",
  solo: "home-solo",
  online: "home-online",
  selectMap: "home-select-map",
  // 手册入口(#1069 spec T1/#1070:次级行笺钮,点开 ManualModal 弹层)
  manual: "home-manual",
  // #707 矮横屏档横排条带(替代二级选图弹层的首页内联选择器)
  mapStrip: "home-map-strip",
  diagExport: "home-diag-export",
  mapStripItem: (id: string) => `home-map-strip-item-${id}`,
} as const;

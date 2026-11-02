// 首页 data-testid 常量(命名约定同 setup/testids.ts)。
export const HOME_TID = {
  screen: "home-screen",
  solo: "home-solo",
  online: "home-online",
  selectMap: "home-select-map",
  // #707 矮横屏档横排条带(替代二级选图弹层的首页内联选择器)
  mapStrip: "home-map-strip",
  // 性能诊断导出(帧诊通道 ADR-0047:诊断包=历史对局日志全量+最近一局帧诊+设备画像;
  // 入口在主页——用户测试常不打完就退出,不绑对局屏;#1047 起点开导出面板,
  // 复制=Tauri 侧主通路(APK WebView 无下载),下载只在浏览器面出现)
  diagExport: "home-diag-export",
  diagSheet: "home-diag-sheet",
  diagCopy: "home-diag-copy",
  diagDownload: "home-diag-download",
  diagError: "home-diag-error",
  mapStripItem: (id: string) => `home-map-strip-item-${id}`,
} as const;

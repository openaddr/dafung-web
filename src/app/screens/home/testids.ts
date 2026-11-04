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
  // 性能诊断导出(帧诊通道 ADR-0047:诊断包=历史对局日志全量+最近一局帧诊+设备画像;
  // 入口在主页——用户测试常不打完就退出,不绑对局屏;#1047 起点开导出面板,
  // 复制=Tauri 侧快速通路(APK WebView 无下载),下载只在浏览器面出现;
  // #1053 双包拆分,#1056 落盘版:全量复制冻结隐患整钮退役,Tauri 改「保存文件」
  // 走系统存储对话框(dialog+fs 插件),用户在文件管理器自行取件,不怕大小)
  diagExport: "home-diag-export",
  diagSheet: "home-diag-sheet",
  diagCopy: "home-diag-copy",
  diagPerfFail: "home-diag-perf-fail",
  diagSaveFile: "home-diag-save-file",
  diagSaveOk: "home-diag-save-ok",
  diagSaveFail: "home-diag-save-fail",
  diagDownload: "home-diag-download",
  diagClose: "home-diag-close",
  diagError: "home-diag-error",
  mapStripItem: (id: string) => `home-map-strip-item-${id}`,
} as const;

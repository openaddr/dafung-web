// 版本角标:构建时由 vite.config 注入本地构建时刻(格式 v年.月.日.时分,如 v2026.09.26.0102)。
// 每次构建自动更新——页面上戳子变旧即「serve 端了旧 dist」,一眼可辨(2026-09-26 拍板)。
declare const __BUILD_STAMP__: string;
export const VERSION: string = __BUILD_STAMP__;

// 版本角标:构建时由 vite.config 注入本地构建时刻(格式 v年.月.日.时分,如 v2026.09.26.0102)。
// 每次构建自动更新——页面上戳子变旧即「serve 端了旧 dist」,一眼可辨(2026-09-26 拍板)。
declare const __BUILD_STAMP__: string;
export const VERSION: string = __BUILD_STAMP__;

// 版本号(CalVer,单源 package.json,vite.config 注入):诊断包/发版对账用——
// 构建戳只辨「哪次构建」,版本号辨「哪个 release」,归因两把尺都要。
declare const __APP_VERSION__: string;
export const APP_VERSION: string = __APP_VERSION__;

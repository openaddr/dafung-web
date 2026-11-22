// 发版号(单源 package.json,CalVer 如 2026.11.14):构建期由 vite.config 注入
// __APP_VERSION__,消费方=对局设置弹层「版本」行 + 主页角落小字 + 诊断包
// (ADR-0047 修订:#981 的构建戳「两把尺」口径随 #952 拍板全链退役——诊断包
// build 字段删、文件名改用发版号);与 Release tag(v 前缀)、APK versionName
// 同值(release.ts 对账闸兜真)。
declare const __APP_VERSION__: string;
export const VERSION: string = __APP_VERSION__;

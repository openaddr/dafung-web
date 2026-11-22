// 联机引擎服务器地址单源(#279):默认 location.origin(网页与引擎同源部署,
// scripts/server.ts 托管 dist);localStorage 可覆写——APK 打包资源自带 origin
// (tauri://localhost)无引擎,真机联机须指向 LAN 主机/部署服务器。
// 零兜底:覆写非法时 fetch/WS 自然失败,走既有报错通路,这里不做校验不回退;
// 只做归一化(去首尾空白与尾斜杠)。清空保存 = 移除覆写恢复默认同源。
const KEY = "dafung.server-base";

export function getServerBase(): string {
  const override = localStorage.getItem(KEY);
  return normalize(override === null ? location.origin : override);
}

export function setServerBase(url: string): void {
  const v = normalize(url);
  if (v === "" || v === location.origin) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, v);
  }
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

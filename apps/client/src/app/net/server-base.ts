import { isTauri } from "@tauri-apps/api/core";
import serverAddress from "./server-address.json";

const KEY = "dafung.server-base";

function defaultServerBase(): string {
  // 正式 APK 使用预置公网地址，开发和网页通道使用同源地址。
  return normalize(
    import.meta.env.PROD && isTauri() ? serverAddress.publicServerBase : location.origin,
  );
}

export function getServerBase(): string {
  const override = localStorage.getItem(KEY);
  return override === null ? defaultServerBase() : normalize(override);
}

export function setServerBase(url: string): void {
  const v = normalize(url);
  if (v === "" || v === defaultServerBase()) {
    localStorage.removeItem(KEY);
  } else {
    localStorage.setItem(KEY, v);
  }
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

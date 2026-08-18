// P0-8 锁横屏防回归:AndroidManifest.xml 位于 src-tauri/gen/(tauri android init 生成目录),
// 重新 init/build 可能覆盖回默认竖屏——本测试让覆盖即刻显式失败,而非装机后才发现。
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Android 横屏锁定(评审二轮 P0-8)", () => {
  it("AndroidManifest.xml 保持 sensorLandscape", () => {
    const manifest = readFileSync(
      resolve(import.meta.dir, "../src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    expect(manifest).toContain('android:screenOrientation="sensorLandscape"');
  });
});

import { expect, test } from "bun:test";
import { resolve } from "node:path";

function checkServerBase(production: boolean, assertions: string): void {
  // Bun 给源码注入与 Vite 相同的构建常量。子进程持有自己的原生标记和地址存储。
  const code = `
    import assert from "node:assert/strict";
    import { getServerBase, setServerBase } from "./apps/client/src/app/net/server-base";
    const storage = new Map();
    Object.defineProperty(globalThis, "localStorage", { value: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    } });
    Object.defineProperty(globalThis, "location", { value: { origin: "http://tauri.localhost" } });
    globalThis.isTauri = true;
    ${assertions}
  `;
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      "--define",
      `import.meta.env.PROD:${production}`,
      "-e",
      code,
    ],
    { cwd: resolve(import.meta.dir, "../..") },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

test("正式 APK 默认连接公共服务器，清空手动地址后恢复默认", () => {
  checkServerBase(
    true,
    `
    assert.equal(getServerBase(), "https://dafung.o-app.cn");
    setServerBase("  https://lan.example/  ");
    assert.equal(getServerBase(), "https://lan.example");
    setServerBase("");
    assert.equal(getServerBase(), "https://dafung.o-app.cn");
    globalThis.isTauri = false;
    location.origin = "http://localhost:3000";
    assert.equal(getServerBase(), location.origin);
  `,
  );
});

test("开发模式的 Tauri 客户端和网页均走同源", () => {
  checkServerBase(
    false,
    `
    location.origin = "http://localhost:5173";
    assert.equal(getServerBase(), location.origin);
    globalThis.isTauri = false;
    assert.equal(getServerBase(), location.origin);
  `,
  );
});

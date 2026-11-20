import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { copyDiagText } from "@app/diagExport";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const writeNative = mock(() => undefined);

beforeAll(() => {
  ensureHappyDom();
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  mockIPC(writeNative);
});

afterAll(async () => {
  clearMocks();
  Reflect.deleteProperty(globalThis, "isTauri");
  await releaseHappyDom();
});

test("WebView 拒绝剪贴板写入时，APK 通过原生命令复制帧诊", async () => {
  const writeWeb = spyOn(navigator.clipboard, "writeText").mockImplementation(async () => {
    throw new DOMException("Write permission denied.", "NotAllowedError");
  });
  try {
    const text = '{"kind":"dafung-diag-perf","gameId":"帧诊样本"}';
    await copyDiagText(text);
    expect(writeNative).toHaveBeenCalledWith("plugin:clipboard-manager|write_text", { text });
    expect(writeWeb).not.toHaveBeenCalled();
  } finally {
    writeWeb.mockRestore();
  }
});

test("帧诊超出剪贴板字节上限时提示保存文件，并阻止原生写入", async () => {
  writeNative.mockClear();
  await expect(copyDiagText("帧".repeat(150_000))).rejects.toThrow("保存文件");
  expect(writeNative).not.toHaveBeenCalled();
});

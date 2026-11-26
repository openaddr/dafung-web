import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { IDBFactory } from "fake-indexeddb";
import { copyDiagnosticSummary, exportDiagnostics } from "@app/diagExport";
import { archiveGameLog } from "@app/gameLogArchive";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const file = "content://diagnostics/old-game.json";
const writeNative = mock((cmd: string, _payload?: unknown) =>
  cmd === "plugin:dialog|save" ? file : undefined,
);
const indexedDb = new IDBFactory();
let originalIndexedDb: PropertyDescriptor | undefined;

beforeAll(() => {
  ensureHappyDom();
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  mockIPC(writeNative);
});

afterAll(async () => {
  clearMocks();
  Reflect.deleteProperty(globalThis, "isTauri");
  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDb.deleteDatabase("dafung-logs");
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
  });
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await releaseHappyDom();
});

test("旧局只有对局日志时，APK 仍可通过原生命令复制所选局摘要", async () => {
  using writeWeb = spyOn(navigator.clipboard, "writeText").mockImplementation(async () => {
    throw new DOMException("Write permission denied.", "NotAllowedError");
  });
  const ts = Date.now();
  const log = { ts, round: 1, turn: 2, player: "蜀", category: "buy" as const, detail: "" };
  await archiveGameLog(
    { gameId: "old-game", mode: "solo", mapId: "guanzhong" },
    [{ ...log, brief: "蜀购入长安" }],
    ts,
  );
  await archiveGameLog(
    { gameId: "new-game", mode: "solo", mapId: "guanzhong" },
    [{ ...log, brief: "另一局的日志" }],
    ts,
  );

  await copyDiagnosticSummary("old-game");

  const [command, payload] = writeNative.mock.calls[0];
  expect(command).toBe("plugin:clipboard-manager|write_text");
  const { text } = payload as { text: string };
  expect(text).toMatch(/^对局诊断摘要[^\n]*old-game[^\n]*\n[\s\S]*帧诊未采样[\s\S]*蜀购入长安/u);
  expect(text).not.toMatch(/new-game|另一局的日志/u);
  expect(writeWeb).not.toHaveBeenCalled();

  expect(await exportDiagnostics("old-game")).toEqual({ path: file });
  const write = writeNative.mock.calls.find(([cmd]) => cmd === "plugin:fs|write_text_file");
  if (write === undefined) throw new Error("未写入诊断文件");
  const bundle = JSON.parse(new TextDecoder().decode(write[1] as Uint8Array));
  expect(bundle).toMatchObject({
    gameId: "old-game",
    timeline: null,
    perf: null,
    missing: { timeline: expect.any(String), perf: expect.any(String) },
  });
});

import { isTauri } from "@tauri-apps/api/core";
import { loadArchivedGame } from "./gameLogArchive";
import type { ArchivedGame } from "./game-diagnostic-record";

function buildDiagBundle({
  gameId,
  mode,
  mapId,
  appVersion,
  log,
  capture,
  archiveFailures,
}: ArchivedGame) {
  const missing: Partial<Record<"mapId" | "appVersion" | "capture" | "log" | "perf", string>> = {};
  if (mapId === null) missing.mapId = "该局未记录地图。";
  if (appVersion === null) missing.appVersion = "该局未记录版本。";
  if (capture === null) missing.capture = "该局未采集客户端现场与运行环境。";
  if (log === null) missing.log = "本机未保存该局的对局日志。";
  if (capture?.perf == null) missing.perf = "本机未保存该局的帧诊。";
  return {
    kind: "dafung-diag",
    schemaVersion: 2,
    gameId,
    mode,
    mapId,
    appVersion,
    capturedAt: capture?.capturedAt ?? null,
    exportedAt: Date.now(),
    logSource: log === null ? null : mode === "solo" ? "local-authority" : "room-authority",
    logCapturedAt: log?.capturedAt ?? null,
    device: capture?.device ?? null,
    client: capture?.client ?? null,
    connection: capture?.connection ?? null,
    errors: capture?.errors ?? null,
    archiveFailures,
    missing,
    log: log?.lines ?? null,
    perf: capture?.perf ?? null,
  };
}

async function requireArchivedGame(gameId: string): Promise<ArchivedGame> {
  const record = await loadArchivedGame(gameId);
  if (record === null) throw new Error("所选对局的诊断记录已失效。");
  return record;
}

/** 给安卓剪贴板的 Binder 事务留出空间，较大的帧诊通过保存文件取用。 */
const MAX_CLIPBOARD_BYTES = 400_000;

/** 旧的复制帧诊工具使用所选局的采集记录。 */
export async function buildDiagPerfText(gameId: string): Promise<string> {
  const { mode, mapId, appVersion, capture } = await requireArchivedGame(gameId);
  if (capture === null || capture.perf === null) throw new Error("该局未记录帧诊。");
  return JSON.stringify({
    kind: "dafung-diag-perf",
    schemaVersion: 2,
    gameId,
    mode,
    mapId,
    appVersion,
    capturedAt: capture.capturedAt,
    exportedAt: Date.now(),
    device: capture.device,
    perf: capture.perf,
  });
}

export async function copyDiagText(text: string): Promise<void> {
  if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES) {
    throw new Error("帧诊超过剪贴板大小上限，请使用「保存文件」。");
  }
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  if (typeof navigator.clipboard?.writeText !== "function") {
    throw new Error("当前网页环境无法写入剪贴板。");
  }
  await navigator.clipboard.writeText(text);
}

/** Tauri 的系统对话框可返回 content URI；取消返回 null。 */
export async function exportDiagnostics(gameId: string): Promise<{ path: string } | null> {
  const record = await requireArchivedGame(gameId);
  const version = record.appVersion === null ? "" : `-v${record.appVersion}`;
  const fileName = `dafung-diag-${gameId}${version}.json`;
  const [{ save }, { writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (path === null) return null;
  await writeTextFile(path, JSON.stringify(buildDiagBundle(record), null, 2));
  return { path };
}

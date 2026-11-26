import { isTauri } from "@tauri-apps/api/core";
import { loadArchivedGame } from "./gameLogArchive";
import type { ArchivedGame } from "./game-diagnostic-record";
import { formatGameDiagnosticSummary } from "./game-diagnostic-summary";
import { checkpointGameDiagnostics } from "./game-diagnostics";

function buildDiagBundle(
  { gameId, mode, mapId, appVersion, log, capture, archiveFailures }: ArchivedGame,
  captureRefreshFailure: string | undefined,
) {
  const timeline = capture?.timeline ?? null;
  const missing: Partial<
    Record<"mapId" | "appVersion" | "capture" | "log" | "perf" | "timeline", string>
  > = {};
  if (mapId === null) missing.mapId = "该局未记录地图。";
  if (appVersion === null) missing.appVersion = "该局未记录版本。";
  if (capture === null) missing.capture = "该局未采集客户端现场与运行环境。";
  if (log === null) missing.log = "本机未保存该局的对局日志。";
  if (capture?.perf == null) missing.perf = "本机未保存该局的帧诊。";
  if (timeline === null) missing.timeline = "该局未采集客户端时间线。";
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
    captureRefreshFailure,
    missing,
    log: log?.lines ?? null,
    perf: capture?.perf ?? null,
    timeline,
  };
}

async function requireArchivedGame(gameId: string, captureWarning?: string): Promise<ArchivedGame> {
  const record = await loadArchivedGame(gameId);
  if (record === null) {
    const reason = "所选对局的诊断记录已失效。";
    throw new Error(captureWarning === undefined ? reason : `${captureWarning}。${reason}`);
  }
  return record;
}

function captureRefreshFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `当前局现场刷新失败：${detail}`;
}

export async function copyDiagnosticSummary(gameId: string): Promise<void> {
  try {
    await checkpointGameDiagnostics(gameId);
  } catch (error: unknown) {
    throw new Error(captureRefreshFailure(error), { cause: error });
  }
  const text = formatGameDiagnosticSummary(await requireArchivedGame(gameId));
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
export async function exportDiagnostics(
  gameId: string,
): Promise<{ path: string; captureWarning?: string } | null> {
  let captureWarning: string | undefined;
  try {
    await checkpointGameDiagnostics(gameId);
  } catch (error: unknown) {
    captureWarning = captureRefreshFailure(error);
  }
  const record = await requireArchivedGame(gameId, captureWarning);
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
  if (path === null) {
    if (captureWarning !== undefined) throw new Error(captureWarning);
    return null;
  }
  await writeTextFile(path, JSON.stringify(buildDiagBundle(record, captureWarning), null, 2));
  return captureWarning === undefined ? { path } : { path, captureWarning };
}

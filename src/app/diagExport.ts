// 对局诊断按局读归档，经 Tauri 系统对话框保存。
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

/** 安卓剪贴板限长保守阈(ClipboardService 对大 clip 拒收/丢弃,量级 ~500KB);
 *  超阈文本禁走复制(尤其禁 textarea 回退——大串 select+execCommand 主线程冻结
 *  数秒,真机「点了没反应+弹层关不掉」实锤,#1053)。 */
const MAX_CLIPBOARD_CHARS = 400_000;

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

/** 复制诊断包文本到剪贴板。异步 Clipboard API 为主通路;WebView 未授权/非安全
 *  上下文(安卓端 tauri.localhost 走 http)时 API 缺席——此时只允许小文本走
 *  textarea+execCommand 回退(大文本 select 同步冻结主线程数秒,真机实锤),
 *  超限一律抛错交调用方示错,绝不静默。失败以异常表达,调用方给可见反馈。 */
export async function copyDiagText(text: string): Promise<void> {
  // 安卓端 Tauri = http://tauri.localhost(非安全上下文)→ navigator.clipboard 缺席
  if (typeof navigator.clipboard?.writeText === "function") {
    // 大串写剪贴板可能长时间不落定(Android 对大 clip 拒收),10s 不落定按失败报
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_r, reject) => setTimeout(() => reject(new Error("剪贴板写入超时")), 10_000)),
    ]);
    return;
  }
  if (text.length > MAX_CLIPBOARD_CHARS) {
    throw new Error(`剪贴板 API 不可用且文本超限(${Math.round(text.length / 1024)} KB)`);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("execCommand 复制失败");
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

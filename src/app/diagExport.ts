// 诊断包导出(帧诊通道,ADR-0047):设置弹窗一键全量落文件——设备画像 + 全部历史
// 对局日志(IndexedDB 归档,局中增量写,不挑终局;30 天保底内的都在)+ 当前帧诊缓冲。
// 对局日志归档(gameLogArchive)与本件分文件:LogEvent 是 ADR-0014 类型化事件流,
// 性能数据不混入 core schema;两把钥匙同挂设置弹窗。
// 文件名 `dafung-diag-<发版号>.json`(发版号=版本单源,收包即知对方跑的哪个 release;
// #981 原用构建戳,随 #952 拍板构建戳全链退役改用发版号,build 字段同步退役)。
import { loadAllArchive } from "./gameLogArchive";
import { collectFrameDiag, type FrameDiagDump } from "./frameDiag";
import { VERSION } from "../version";

export interface DiagBundle {
  kind: "dafung-diag";
  schemaVersion: 1;
  appVersion: string;
  /** 导出墙钟(epoch ms;帧诊内部时间戳是 performance.now 相对值,锚在此)。 */
  exportedAt: number;
  /** 设备画像:UA(WebView 版本可读)/DPR/视口。 */
  ua: string;
  dpr: number;
  viewport: { w: number; h: number };
  /** 当前帧诊(对局屏未挂载时 null=本会话无采样,如实缺)。 */
  perf: FrameDiagDump | null;
  /** 全部历史对局日志(单机;联机局日志在服务器 data/logs/,不在本包)。
   *  移动端剪贴板小包(#1053)恒 []——剪贴板限长装不下全量,省略数见 gamesOmitted。 */
  games: Awaited<ReturnType<typeof loadAllArchive>>;
  /** 本包省略的历史局数(仅剪贴板小包>0;全量包/文件缺省=未省略)。 */
  gamesOmitted?: number;
}

/** 安卓剪贴板限长保守阈(ClipboardService 对大 clip 拒收/丢弃,量级 ~500KB);
 *  超阈文本禁走复制(尤其禁 textarea 回退——大串 select+execCommand 主线程冻结
 *  数秒,真机「点了没反应+弹层关不掉」实锤,#1053)。 */
export const MAX_CLIPBOARD_CHARS = 400_000;

export async function buildDiagBundle(): Promise<DiagBundle> {
  return {
    kind: "dafung-diag",
    schemaVersion: 1,
    appVersion: VERSION,
    exportedAt: Date.now(),
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    perf: collectFrameDiag(),
    games: await loadAllArchive(),
  };
}

/** 剪贴板小包(架构:#1053):全量包摘掉对局日志(超限主凶)只留帧诊+画像+省略数
 *  ——几 KB~百 KB 级,剪贴板稳定可达;全量走文件下载或桌面复制。 */
export async function buildDiagPerfText(): Promise<string> {
  const bundle = await buildDiagBundle();
  return JSON.stringify({
    ...bundle,
    games: [],
    gamesOmitted: bundle.games.length,
  });
}

/** 诊断包 JSON 文本(全量;导出面板的下载/桌面复制通路共用同一序列化)。 */
export async function buildDiagText(): Promise<string> {
  return JSON.stringify(await buildDiagBundle());
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

/** 导出诊断包(浏览器文件下载通路;APK WebView 没接 DownloadListener,锚点下载
 *  不触发——Tauri 内走导出面板的剪贴板通路,本函数只在浏览器面出现)。 */
export async function exportDiagnostics(): Promise<void> {
  const text = await buildDiagText();
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dafung-diag-${VERSION}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 诊断包导出(帧诊通道,ADR-0047):设置弹窗一键全量落文件——设备画像 + 全部历史
// 对局日志(IndexedDB 归档,局中增量写,不挑终局;30 天保底内的都在)+ 当前帧诊缓冲。
// 与对局日志导出(gameLogExport.ts)分文件:LogEvent 是 ADR-0014 类型化事件流,
// 性能数据不混入 core schema;两把钥匙同挂设置弹窗。
// 文件名 `dafung-diag-<构建戳>.json`(构建戳=版本角标单源,收包即知对方跑的哪次构建)。
import { loadAllArchive } from "./gameLogArchive";
import { collectFrameDiag, type FrameDiagDump } from "./frameDiag";
import { APP_VERSION, VERSION } from "../version";

export interface DiagBundle {
  kind: "dafung-diag";
  schemaVersion: 1;
  appVersion: string;
  build: string;
  /** 导出墙钟(epoch ms;帧诊内部时间戳是 performance.now 相对值,锚在此)。 */
  exportedAt: number;
  /** 设备画像:UA(WebView 版本可读)/DPR/视口。 */
  ua: string;
  dpr: number;
  viewport: { w: number; h: number };
  /** 当前帧诊(对局屏未挂载时 null=本会话无采样,如实缺)。 */
  perf: FrameDiagDump | null;
  /** 全部历史对局日志(单机;联机局日志在服务器 data/logs/,不在本包)。 */
  games: Awaited<ReturnType<typeof loadAllArchive>>;
}

export async function buildDiagBundle(): Promise<DiagBundle> {
  return {
    kind: "dafung-diag",
    schemaVersion: 1,
    appVersion: APP_VERSION,
    build: VERSION,
    exportedAt: Date.now(),
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    perf: collectFrameDiag(),
    games: await loadAllArchive(),
  };
}

/** 导出诊断包(浏览器下载通路,与 gameLogExport 同机制)。 */
export async function exportDiagnostics(): Promise<void> {
  const bundle = await buildDiagBundle();
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `dafung-diag-${VERSION}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

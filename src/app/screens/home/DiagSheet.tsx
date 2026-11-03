// 性能诊断导出面板(#1047 面板,#1053 双包版):主页「性能诊断」点开的导出弹层。
// 为什么不是裸下载:APK 的 Android WebView 没接 DownloadListener,锚点下载点了
// 零反应(用户实测);剪贴板是 WebView 侧唯一可靠通路。
// #1053 双包:全量包(含全部历史对局日志)动辄 MB 级——安卓端 tauri.localhost 走
// http(非安全上下文)navigator.clipboard 缺席,textarea 回退 select 大串会同步
// 冻结主线程数秒(真机「点了没反应+弹层关不掉」实锤),且安卓剪贴板本身限长拒收。
// 故拆两钮:帧诊小包(帧诊+画像+省略数,几 KB~百 KB,推荐,剪贴板稳定)/ 全量包
// (超限大串只走 Clipboard API+10s 超时,失败明示建议浏览器导出,禁冻结回退)。
// 按压态/复制中/结果全部可见反馈,不许静默;面板带显式关闭钮(点外/Esc 照旧)。
import { useEffect, useState } from "react";
import {
  buildDiagBundle,
  buildDiagPerfText,
  buildDiagText,
  copyDiagText,
  exportDiagnostics,
  MAX_CLIPBOARD_CHARS,
} from "@app/diagExport";
import type { DiagBundle } from "@app/diagExport";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { HOME_TID } from "./testids";

/** Tauri 运行时探测:v2 注入 __TAURI_INTERNALS__(浏览器无此物),导出通路分派的
 *  唯一判据——平台能力分支,非环境兜底。 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 单钮复制状态机:idle → busy → ok / fail(失败带原因)。 */
type CopyState = { phase: "idle" | "busy" } | { phase: "ok" } | { phase: "fail"; reason: string };

export function DiagSheet({ onClose }: { onClose: () => void }) {
  const [bundle, setBundle] = useState<DiagBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perfState, setPerfState] = useState<CopyState>({ phase: "idle" });
  const [fullState, setFullState] = useState<CopyState>({ phase: "idle" });

  // 挂载构建一次(IndexedDB 全量 + 帧诊快照);失败如实示错(零兜底)。
  useEffect(() => {
    let alive = true;
    buildDiagBundle()
      .then((b) => {
        if (alive) setBundle(b);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const fullKb = bundle == null ? null : Math.round(JSON.stringify(bundle).length / 1024);
  const busy = perfState.phase === "busy" || fullState.phase === "busy";

  const copy = async (
    build: () => Promise<string>,
    set: (s: CopyState) => void,
    capNote: string,
  ): Promise<void> => {
    set({ phase: "busy" });
    try {
      const text = await build();
      if (isTauri && text.length > MAX_CLIPBOARD_CHARS) {
        // 剪贴板大 clip 安卓拒收且禁冻结回退(见 diagExport MAX_CLIPBOARD_CHARS 注)
        set({
          phase: "fail",
          reason: `全量 ${Math.round(text.length / 1024)} KB 超剪贴板限长,${capNote}`,
        });
        return;
      }
      await copyDiagText(text);
      set({ phase: "ok" });
    } catch (e: unknown) {
      set({ phase: "fail", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const stateLabel = (s: CopyState, label: string): string =>
    s.phase === "busy"
      ? "复制中…"
      : s.phase === "ok"
        ? `${label} ✓ 已复制`
        : s.phase === "fail"
          ? `${label} ✕ 失败`
          : label;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={HOME_TID.diagSheet}
        aria-label="性能诊断"
        initialFocus={false}
        className="w-[min(92vw,420px)]"
      >
        <DialogTitle className="font-title text-lg text-paper">性能诊断</DialogTitle>
        <p className="mt-1 font-wenkai text-[13px] leading-relaxed text-paper-dim">
          诊断包 = 最近一局帧诊 + 全部历史对局日志 + 设备画像。
          {fullKb != null ? `本次全量 ${fullKb} KB。` : ""}
        </p>
        {error != null && (
          <p className="mt-2 font-wenkai text-[13px] text-danger" data-testid={HOME_TID.diagError}>
            诊断包构建失败:{error}
          </p>
        )}
        {/* 帧诊小包(推荐):帧诊+画像+省略局数,剪贴板稳定可达——真机归因主要吃它 */}
        <button
          type="button"
          data-testid={HOME_TID.diagCopy}
          disabled={bundle == null || busy}
          className="mt-3 cursor-pointer select-none rounded border border-lacquer-gold/40 bg-panel px-3 py-2 font-wenkai text-[14px] text-paper transition active:translate-y-[0.5px] active:opacity-80 hover:border-lacquer-gold disabled:opacity-50"
          onClick={() => void copy(buildDiagPerfText, setPerfState, "请用浏览器面导出文件")}
        >
          {stateLabel(perfState, "复制帧诊(推荐)")}
        </button>
        {perfState.phase === "ok" && (
          <p className="mt-1 font-wenkai text-[12px] text-paper-dim">
            帧诊已进剪贴板:粘贴到聊天发给开发者即可。
          </p>
        )}
        {perfState.phase === "fail" && (
          <p
            className="mt-1 font-wenkai text-[12px] text-danger"
            data-testid={HOME_TID.diagPerfFail}
          >
            复制失败:{perfState.reason}
          </p>
        )}
        {/* 全量包:含全部历史对局日志;大串只走 Clipboard API,失败明示 */}
        <button
          type="button"
          data-testid={HOME_TID.diagCopyFull}
          disabled={bundle == null || busy}
          className="mt-2 cursor-pointer select-none rounded border border-lacquer/40 bg-panel px-3 py-1.5 font-wenkai text-[13px] text-paper-dim transition active:translate-y-[0.5px] active:opacity-80 hover:border-lacquer-gold hover:text-paper disabled:opacity-50"
          onClick={() => void copy(buildDiagText, setFullState, "请用浏览器面导出文件")}
        >
          {stateLabel(
            fullState,
            `复制全量(含全部对局日志${fullKb != null ? `,${fullKb} KB` : ""})`,
          )}
        </button>
        {fullState.phase === "ok" && (
          <p className="mt-1 font-wenkai text-[12px] text-paper-dim">
            全量已进剪贴板:粘贴发给开发者(大文本,建议分段或用浏览器导出文件)。
          </p>
        )}
        {fullState.phase === "fail" && (
          <p
            className="mt-1 font-wenkai text-[12px] text-danger"
            data-testid={HOME_TID.diagFullFail}
          >
            复制失败:{fullState.reason}
          </p>
        )}
        {/* 文件下载:浏览器通路;Tauri(WebView 无 DownloadListener)不出现该钮 */}
        {!isTauri && (
          <button
            type="button"
            data-testid={HOME_TID.diagDownload}
            disabled={bundle == null || busy}
            className="mt-2 block cursor-pointer font-wenkai text-[13px] text-paper-dim transition-colors hover:text-paper disabled:opacity-50"
            onClick={() => void exportDiagnostics()}
          >
            下载文件(dafung-diag-&lt;发版号&gt;.json)
          </button>
        )}
        {isTauri && (
          <p className="mt-2 font-wenkai text-[12px] leading-relaxed text-paper-dim">
            应用内没有文件下载通路:帧诊复制即可,全量日志超剪贴板限长时换浏览器版导出文件。
          </p>
        )}
        <button
          type="button"
          data-testid={HOME_TID.diagClose}
          className="mx-auto mt-3 block cursor-pointer select-none font-wenkai text-[13px] text-paper-dim transition active:opacity-70 hover:text-paper"
          onClick={onClose}
        >
          关闭
        </button>
      </DialogContent>
    </Dialog>
  );
}

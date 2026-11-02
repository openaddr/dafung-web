// 性能诊断导出面板(#1047):主页「性能诊断」点开的导出弹层。
// 为什么不是裸下载:APK 的 Android WebView 没接 DownloadListener,锚点下载点了
// 零反应(用户实测);剪贴板是 WebView 侧唯一可靠通路。两通道按平台能力分派——
// Tauri 内只给复制(附「粘贴发给开发者」说明),浏览器(非 Tauri)保留文件下载。
// 构建一次挂面板期缓存(IndexedDB 全量读 + 帧诊快照),摘要行给数据范围与体积,
// 复制结果可见反馈(已复制/复制失败),不许静默。
import { useEffect, useState } from "react";
import { buildDiagText, copyDiagText, exportDiagnostics } from "@app/diagExport";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { HOME_TID } from "./testids";

/** Tauri 运行时探测:v2 注入 __TAURI_INTERNALS__(浏览器无此物),导出通路分派的
 *  唯一判据——平台能力分支,非环境兜底。 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function DiagSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  // 挂载构建一次(IndexedDB 全量 + 帧诊快照);失败如实示错(零兜底)。
  useEffect(() => {
    let alive = true;
    buildDiagText()
      .then((t) => {
        if (alive) setText(t);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const kb = text == null ? null : Math.max(1, Math.round(text.length / 1024));

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
          {kb != null ? `本次 ${kb} KB。` : ""}
        </p>
        {error != null && (
          <p className="mt-2 font-wenkai text-[13px] text-danger" data-testid={HOME_TID.diagError}>
            诊断包构建失败:{error}
          </p>
        )}
        <button
          type="button"
          data-testid={HOME_TID.diagCopy}
          disabled={text == null}
          className="mt-3 cursor-pointer rounded border border-lacquer-gold/40 bg-panel px-3 py-2 font-wenkai text-[14px] text-paper transition-colors hover:border-lacquer-gold disabled:opacity-50"
          onClick={() => {
            if (text == null) return;
            void copyDiagText(text).then((ok) => setCopied(ok));
          }}
        >
          {copied === true ? "已复制 ✓" : copied === false ? "复制失败(剪贴板不可用)" : "复制 JSON"}
        </button>
        {copied === true && (
          <p className="mt-1 font-wenkai text-[12px] text-paper-dim">
            已进剪贴板:粘贴到聊天发给开发者即可。
          </p>
        )}
        {/* 文件下载:浏览器通路;Tauri(WebView 无 DownloadListener)不出现该钮 */}
        {!isTauri && (
          <button
            type="button"
            data-testid={HOME_TID.diagDownload}
            disabled={text == null}
            className="mt-2 block cursor-pointer font-wenkai text-[13px] text-paper-dim transition-colors hover:text-paper disabled:opacity-50"
            onClick={() => void exportDiagnostics()}
          >
            下载文件(dafung-diag-&lt;发版号&gt;.json)
          </button>
        )}
        {isTauri && (
          <p className="mt-2 font-wenkai text-[12px] leading-relaxed text-paper-dim">
            应用内没有文件下载通路,取诊断包用「复制」。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

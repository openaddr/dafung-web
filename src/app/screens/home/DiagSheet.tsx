// 性能诊断导出面板(#1047 面板,#1053 双包,#1056 落盘版):主页「性能诊断」点开的
// 导出弹层。为什么不是裸下载:APK 的 Android WebView 没接 DownloadListener,锚点
// 下载点了零反应(用户实测);剪贴板是 WebView 侧可靠通路但**装不下全量**——安卓
// 端 tauri.localhost 走 http(非安全上下文)navigator.clipboard 缺席,textarea 回退
// select 大串同步冻结主线程数秒(真机「点了没反应+弹层关不掉」实锤),且安卓剪贴
// 板本身限长拒收。#1056 落盘正道(壳升级 tauri-plugin-dialog + tauri-plugin-fs):
// Tauri 内「保存文件」弹系统保存对话框(ACTION_CREATE_DOCUMENT,用户选目录可存
// Download),用户在文件管理器自行取件,不怕大小;content URI 由 fs 插件解析写入,
// 失败在面板如实示错原文(作用域/URI 兼容性真机若有出入,迭代有据)。
// 三通路分派:复制帧诊(小包,双面,快速粘贴)/ 保存文件(全量,Tauri)/ 下载文件
// (全量,浏览器)。全链按压态/进行中/结果可见反馈,不许静默;显式关闭钮保底。
import { useEffect, useState } from "react";
import {
  buildDiagBundle,
  buildDiagPerfText,
  copyDiagText,
  exportDiagnostics,
  MAX_CLIPBOARD_CHARS,
} from "@app/diagExport";
import type { DiagBundle } from "@app/diagExport";
import { Dialog, DialogContent, DialogTitle } from "@app/components/ui/dialog";
import { VERSION } from "../../../version";
import { HOME_TID } from "./testids";

/** Tauri 运行时探测:v2 注入 __TAURI_INTERNALS__(浏览器无此物),导出通路分派的
 *  唯一判据——平台能力分支,非环境兜底。 */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 单钮状态机:idle → busy → ok(带落点)/ fail(带原因)。 */
type CopyState =
  | { phase: "idle" | "busy" }
  | { phase: "ok"; where?: string }
  | { phase: "fail"; reason: string };

export function DiagSheet({ onClose }: { onClose: () => void }) {
  const [bundle, setBundle] = useState<DiagBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perfState, setPerfState] = useState<CopyState>({ phase: "idle" });
  const [saveState, setSaveState] = useState<CopyState>({ phase: "idle" });

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

  const busy = perfState.phase === "busy" || saveState.phase === "busy";
  const fullKb = bundle == null ? null : Math.round(JSON.stringify(bundle).length / 1024);

  /** 复制帧诊小包(限长内才走 textarea 回退,大串 select 同步冻结见
   *  MAX_CLIPBOARD_CHARS 注);失败/超限如实示错,绝不静默。 */
  const copyPerf = async (): Promise<void> => {
    setPerfState({ phase: "busy" });
    try {
      const text = await buildDiagPerfText();
      if (
        typeof navigator.clipboard?.writeText !== "function" &&
        text.length > MAX_CLIPBOARD_CHARS
      ) {
        setPerfState({
          phase: "fail",
          reason: `帧诊包 ${Math.round(text.length / 1024)} KB 超回退限长`,
        });
        return;
      }
      await copyDiagText(text);
      setPerfState({ phase: "ok" });
    } catch (e: unknown) {
      setPerfState({ phase: "fail", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  /** 保存文件(Tauri 通路,#1056):系统保存对话框(ACTION_CREATE_DOCUMENT)选目录
   *  → fs 插件按 content URI 写入。取消=无操作;失败面板示错原文。 */
  const saveFile = async (): Promise<void> => {
    setSaveState({ phase: "busy" });
    try {
      if (bundle == null) return;
      const [{ save }, { writeTextFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await save({
        defaultPath: `dafung-diag-${VERSION}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path == null) {
        setSaveState({ phase: "idle" }); // 用户取消,无操作
        return;
      }
      const text = JSON.stringify(bundle);
      await writeTextFile(path, text);
      const shown = typeof path === "string" ? path : String(path);
      setSaveState({ phase: "ok", where: shown.length > 60 ? "…" + shown.slice(-59) : shown });
    } catch (e: unknown) {
      setSaveState({ phase: "fail", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const saveLabel = (s: CopyState): string =>
    s.phase === "busy"
      ? "保存中…"
      : s.phase === "ok"
        ? "保存文件 ✓"
        : s.phase === "fail"
          ? "保存文件 ✕ 失败"
          : `保存文件(全量${fullKb != null ? `,${fullKb} KB` : ""})`;

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
        {/* 帧诊小包(推荐):帧诊+画像+省略局数,剪贴板快速粘贴——真机归因主要吃它 */}
        <button
          type="button"
          data-testid={HOME_TID.diagCopy}
          disabled={bundle == null || busy}
          className="mt-3 cursor-pointer select-none rounded border border-lacquer-gold/40 bg-panel px-3 py-2 font-wenkai text-[14px] text-paper transition active:translate-y-[0.5px] active:opacity-80 hover:border-lacquer-gold disabled:opacity-50"
          onClick={() => void copyPerf()}
        >
          {perfState.phase === "busy"
            ? "复制中…"
            : perfState.phase === "ok"
              ? "复制帧诊 ✓ 已复制"
              : perfState.phase === "fail"
                ? "复制帧诊 ✕ 失败"
                : "复制帧诊(推荐)"}
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
        {/* 保存文件(全量,Tauri 通路,#1056):系统保存对话框落盘,不怕大小 */}
        {isTauri && (
          <>
            <button
              type="button"
              data-testid={HOME_TID.diagSaveFile}
              disabled={bundle == null || busy}
              className="mt-2 cursor-pointer select-none rounded border border-lacquer/40 bg-panel px-3 py-1.5 font-wenkai text-[13px] text-paper-dim transition active:translate-y-[0.5px] active:opacity-80 hover:border-lacquer-gold hover:text-paper disabled:opacity-50"
              onClick={() => void saveFile()}
            >
              {saveLabel(saveState)}
            </button>
            {saveState.phase === "ok" && (
              <p
                className="mt-1 font-wenkai text-[12px] text-paper-dim"
                data-testid={HOME_TID.diagSaveOk}
              >
                已保存:{saveState.where}
              </p>
            )}
            {saveState.phase === "fail" && (
              <p
                className="mt-1 font-wenkai text-[12px] text-danger"
                data-testid={HOME_TID.diagSaveFail}
              >
                保存失败:{saveState.reason}
              </p>
            )}
          </>
        )}
        {/* 下载文件:浏览器通路;Tauri(WebView 无 DownloadListener)不出现该钮 */}
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
            保存文件走系统存储对话框,存哪儿自己挑,文件管理器里取;帧诊要快速粘贴就点「复制」。
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

// 通用确认弹层:对照旧 createConfirm(选都确认等场景)。
// 不走 ScrollShell 的完整卷轴,用旧 confirm-box 的小卡片形态(标题 + 正文 + 两按钮)。
import { useEffect, useRef, type ReactNode } from "react";
import "./scroll.css";
import { ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 遮罩是否拦截棋盘点击(默认拦截)。选都确认传 true 之外的 false:
   *  弹窗不关的前提下直接点其它可选城即可切换目标(弹窗内容跟随),旧版确认框同体验。 */
  backdropBlocks?: boolean;
  /** 容器 testid 覆盖(默认 scroll-confirm;选都确认框传专用 testid 便于 e2e 定位)。 */
  testid?: string;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  backdropBlocks = true,
  testid,
}: ConfirmDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // G-4:Esc = 取消;挂载即 focus 确认钮 + Tab 圈定在两个按钮间(简单 focus trap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const btns = rootRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!btns || btns.length === 0) return;
      const first = btns[0];
      const last = btns[btns.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!rootRef.current!.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // 挂载时聚焦确认钮(键盘用户可直接 Enter 确认)
    const btns = rootRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    (btns && btns.length > 0 ? btns[0] : null)?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      className={
        "scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(40,30,15,0.35)]" +
        (backdropBlocks ? "" : " pointer-events-none")
      }
    >
      <div
        data-testid={testid ?? T.confirmDialog}
        className={
          "scroll-anim-unroll max-w-[400px] rounded-md border-[3px] border-double border-gold bg-gradient-to-b from-paper-hi to-paper-lo px-7 py-5 shadow-[0_10px_40px_rgba(60,40,10,0.4)]" +
          (backdropBlocks ? "" : " pointer-events-auto")
        }
      >
        <h2 data-testid={T.scrollTitle} className="m-0 mb-2 text-center font-brush text-xl tracking-[3px] text-ink">
          {title}
        </h2>
        <div className="mb-3.5 font-deco text-[17px] text-ink">{children}</div>
        <div className="flex flex-wrap justify-center gap-3">
          {/* 传了专用 testid 时按钮随容器命名(<tid>-ok / <tid>-cancel),
              e2e 无需知道通用/专用两套名字 */}
          <ScrollButton primary testid={testid ? `${testid}-ok` : T.confirmOk} onClick={onConfirm}>
            {confirmLabel}
          </ScrollButton>
          <ScrollButton testid={testid ? `${testid}-cancel` : T.confirmCancel} onClick={onCancel}>
            {cancelLabel}
          </ScrollButton>
        </div>
      </div>
    </div>
  );
}

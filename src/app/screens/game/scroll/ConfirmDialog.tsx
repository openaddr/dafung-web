// 通用确认弹层:对照旧 createConfirm(选都确认等场景)。
// 不走 ScrollShell 的完整卷轴,用旧 confirm-box 的小卡片形态(标题 + 正文 + 两按钮)。
import type { ReactNode } from "react";
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
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel = "确认",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(40,30,15,0.35)]">
      <div
        data-testid={T.confirmDialog}
        className="scroll-anim-unroll max-w-[400px] rounded-md border-[3px] border-double border-gold bg-gradient-to-b from-[#f7ecd0] to-[#ecdcb4] px-7 py-5 shadow-[0_10px_40px_rgba(60,40,10,0.4)]"
      >
        <h2 data-testid={T.scrollTitle} className="m-0 mb-2 text-center font-brush text-xl tracking-[3px] text-ink">
          {title}
        </h2>
        <div className="mb-3.5 font-deco text-[17px] text-ink">{children}</div>
        <div className="flex flex-wrap justify-center gap-3">
          <ScrollButton primary testid={T.confirmOk} onClick={onConfirm}>
            {confirmLabel}
          </ScrollButton>
          <ScrollButton testid={T.confirmCancel} onClick={onCancel}>
            {cancelLabel}
          </ScrollButton>
        </div>
      </div>
    </div>
  );
}

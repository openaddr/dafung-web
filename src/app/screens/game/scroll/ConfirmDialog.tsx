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
        "scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,23,12,0.42)]" +
        (backdropBlocks ? "" : " pointer-events-none")
      }
    >
      <div
        data-testid={testid ?? T.confirmDialog}
        className={
          "scroll-anim-unroll relative max-w-[400px] rounded-[3px] border border-[rgba(43,35,23,0.28)] bg-gradient-to-b from-paper-hi to-paper-lo px-7 py-5 shadow-[var(--ink-shadow-lg)]" +
          (backdropBlocks ? "" : " pointer-events-auto")
        }
      >
        {/* 挂轴单杆(视觉重做 v2):小确认卡也带顶杆,与决策卷轴同一器物语言 */}
        <div aria-hidden="true" className="pointer-events-none absolute -inset-x-4 -top-2.5 z-10 flex h-[17px] items-center">
          <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
          <span className="h-[11px] flex-1 bg-gradient-to-b from-[#56462e] via-[#3a2f1e] to-[#241c11] shadow-[inset_0_1px_0_rgba(217,185,92,0.4)]" />
          <span className="h-[17px] w-[17px] flex-none rounded-full bg-gradient-to-b from-[#5c4c34] to-[#241c11] shadow-[0_1px_3px_rgba(43,35,23,0.5)]" />
        </div>
        <h2 data-testid={T.scrollTitle} className="m-0 mb-2 text-center font-brush text-xl tracking-[3px] text-ink">
          {title}
        </h2>
        {/* #91(R3-C4) 与 ScrollShell 同步两层摊开:标题随卡片壳体(scroll-anim-unroll)
            淡入落位,标题以下的纸身(正文+按钮)以顶缘为轴 scaleY 展开,标题字不压扁。 */}
        <div className="scroll-anim-unroll-paper">
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
    </div>
  );
}

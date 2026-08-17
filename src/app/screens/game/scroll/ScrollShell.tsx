// 卷轴容器:对照旧 render/ui.ts createScroll 的视觉骨架(宣纸底/双金边/标题栏/× 关闭/标题栏拖拽)。
// 用 Tailwind token 重写;入场"展开"动画用 scroll.css 的 scroll-unroll keyframe。
import { useRef, type ReactNode } from "react";
import "./scroll.css";
import { SCROLL_TESTIDS as T } from "./testids";

export interface ScrollShellProps {
  title: string;
  children: ReactNode;
  /** 只有可放弃的卷轴(详情/确认)才传;抉择类必须选,不误关(与旧 createScroll 同策略)。 */
  onClose?: () => void;
  /** 外层容器上的 data-testid(各决策卷轴用自己的 id)。 */
  testid?: string;
  /** 宽度档位:默认决策卷轴宽;详情类可窄一点。 */
  width?: "md" | "lg";
}

/** 通用卷轴按钮(旧 .btn .btn-primary 的 Tailwind 版)。为什么放这:所有决策卷轴共用一套按钮观感。 */
export function ScrollButton({
  children,
  onClick,
  primary,
  testid,
  // UI F1:决策类按钮可能不可选(银两/委任不足、满级)——disabled + title 原因,
  // 口径与旧侧栏内嵌按钮一致,只是搬进卷轴后由 ScrollShell 统一观感
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  testid?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        primary
          ? "cursor-pointer rounded border-2 border-gold bg-gold/25 px-4 py-2 font-brush text-base text-ink shadow-sm transition-colors hover:bg-gold/45 disabled:cursor-not-allowed disabled:opacity-40"
          : "cursor-pointer rounded border border-gold/60 bg-panel-hi px-4 py-2 font-brush text-base text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
      }
    >
      {children}
    </button>
  );
}

export function ScrollShell({ title, children, onClose, testid, width = "md" }: ScrollShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // 标题栏手写拖拽(对照旧 createScroll 的 pointer 拖动):卷轴可被拖到不挡棋盘的位置。
  const drag = useRef<{ active: boolean; sx: number; sy: number; x: number; y: number }>({
    active: false, sx: 0, sy: 0, x: 0, y: 0,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    // 点在按钮(× 关闭)上不触发拖动,与旧行为一致
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { ...drag.current, active: true, sx: e.clientX, sy: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || !bodyRef.current) return;
    d.x += e.clientX - d.sx;
    d.y += e.clientY - d.sy;
    d.sx = e.clientX;
    d.sy = e.clientY;
    bodyRef.current.style.transform = `translate(${d.x}px, ${d.y}px)`;
  };
  const endDrag = () => { drag.current.active = false; };

  return (
    <div
      className="scroll-anim-overlay absolute inset-0 z-30 flex items-center justify-center bg-[rgba(40,30,15,0.35)]"
      // 点遮罩空白处关闭(仅可关卷轴)
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        ref={bodyRef}
        data-testid={testid ?? T.scrollShell}
        className={`scroll-anim-unroll relative rounded-md border-[3px] border-double border-gold bg-gradient-to-b from-paper-hi to-paper-lo px-7 py-5 shadow-[0_10px_40px_rgba(60,40,10,0.4)] ${
          width === "lg" ? "max-w-[560px]" : "max-w-[460px]"
        }`}
      >
        {/* 标题栏:整条可拖(大目标),含 × 关闭 */}
        <div
          className="-mx-7 -mt-5 mb-3.5 flex cursor-move items-center justify-center rounded-t-sm border-b-2 border-[rgba(140,110,60,0.35)] bg-gradient-to-b from-gold/15 to-gold/[0.03] px-7 pb-2.5 pt-3"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <h2
            data-testid={T.scrollTitle}
            className="m-0 font-brush text-[26px] tracking-[4px] text-ink"
          >
            {title}
          </h2>
          {onClose && (
            <button
              type="button"
              data-testid={T.scrollClose}
              aria-label="关闭"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="absolute top-1/2 right-2.5 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[26px] leading-none text-ink-dim hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

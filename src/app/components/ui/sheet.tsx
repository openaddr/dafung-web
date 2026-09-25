// shadcn/ui Sheet(base-vega 风格)的水墨适配底件:Base UI Dialog 行为 + 本项目 token 皮。
// 由 components.json + `bunx shadcn add sheet` 的拷贝管线维护(已按水墨主题改皮,并去掉
// CLI 附带的 button/lucide 依赖——关钮用内联 SVG ×,禁裸排符号字符,DESIGN §4.3);
// 后续 CLI 更新组件时 diff 这里的改皮差异。部件映射同 ui/dialog(Overlay→Backdrop、
// Content→Popup),导出名与 data-slot 沿用 shadcn 惯例不变。
// 行为口径(Esc/点外关/焦点陷阱)归 Base UI 原语;挂载不夺焦(initialFocus=false,
// AGENTS §6——首焦点若落在 × 关钮会促成 Enter 误关)在本件钉死,消费方不可覆盖。
// 简单侧位抽屉直接用本件(对局屏战报抽屉为首用);器物级自定义皮肤仍走 ScrollShell 惯例。
import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "@app/utils/cn";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Backdrop>) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      // 遮罩同 ui/dialog 水墨墨影(不沿用 shadcn 的 bg-black/10+毛玻璃,纸卷世界无玻璃)
      className={cn("fixed inset-0 z-50 bg-[rgba(30,23,12,0.42)]", className)}
      {...props}
    />
  );
}

/** 四向定位/入退场类(side 的实装):贴缘滑入滑出,shadcn 的 2.5rem 短滑改整幅滑
 *  (抽屉语义=从屏缘抽出的纸匣)。尺寸档与圆角按 §4.2:面板圆角 8px(贴缘侧无角)。 */
const SIDE_CLASSES: Record<"top" | "right" | "bottom" | "left", string> = {
  right:
    "inset-y-0 right-0 h-full w-80 max-w-[85vw] border-l rounded-l-[8px] data-starting-style:translate-x-full data-ending-style:translate-x-full",
  left: "inset-y-0 left-0 h-full w-80 max-w-[85vw] border-r rounded-r-[8px] data-starting-style:-translate-x-full data-ending-style:-translate-x-full",
  top: "inset-x-0 top-0 w-full max-w-full border-b rounded-b-[8px] data-starting-style:-translate-y-full data-ending-style:-translate-y-full",
  bottom:
    "inset-x-0 bottom-0 w-full max-w-full border-t rounded-t-[8px] data-starting-style:translate-y-full data-ending-style:translate-y-full",
};

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Popup> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border-[rgba(43,35,23,0.28)] bg-gradient-to-b from-paper-hi to-paper-lo text-ink text-sm shadow-[var(--ink-shadow-lg)] transition-transform duration-200 ease-out",
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
        /* 挂载不夺焦(AGENTS §6,恒定不可覆盖;详情/抽屉类只读浮层,焦点留在触发钮) */
        initialFocus={false}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label="关闭"
            className="absolute top-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-[3px] border border-[rgba(43,35,23,0.25)] bg-panel text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-dashed focus-visible:outline-gold"
          >
            {/* × 符号走内联 SVG(Sym 同款口径:箭头/符号类不在字体栈内裸排,离线字体零 tofu) */}
            <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" focusable="false">
              <path
                d="M3.5 3.5 12.5 12.5 M12.5 3.5 3.5 12.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 border-b border-[rgba(43,35,23,0.18)] px-4 pb-3 pt-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t border-[rgba(43,35,23,0.18)] px-4 py-3", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("m-0 font-brush text-[20px] tracking-[3px] text-ink", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs leading-5 text-ink-dim", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

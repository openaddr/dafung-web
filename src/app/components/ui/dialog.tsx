// shadcn/ui Dialog(base-vega 风格)的水墨适配底件:Base UI 行为 + 本项目 token 皮。
// 由 components.json + `bunx shadcn add dialog` 的拷贝管线维护(已按水墨主题改皮,
// 后续 CLI 更新组件时 diff 这里的改皮差异)。部件映射:Overlay→Backdrop、
// Content→Popup,导出名与 data-slot 沿用 shadcn 惯例不变。
// 简单确认框/纯表单弹层直接用本文件;器物级自定义皮肤(如游戏卷轴 ScrollShell)
// 直接用 @base-ui/react 的 Dialog 原语自行组皮,行为口径(焦点陷阱/aria-modal/
// Esc/点外关闭)与本底件保持一致。
import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@app/utils/cn";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-[rgba(30,23,12,0.42)]", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[86dvh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[3px] border border-[rgba(43,35,23,0.28)] bg-gradient-to-b from-paper-hi to-paper-lo px-6 py-5 text-ink shadow-[var(--ink-shadow-lg)]",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 font-brush text-[22px] tracking-[3px] text-ink", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-ink-dim", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
};

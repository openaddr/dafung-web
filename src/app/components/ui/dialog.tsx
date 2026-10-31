// shadcn/ui Dialog(base-vega 风格)的水墨适配底件:Base UI 行为 + 本项目 token 皮。
// 由 components.json + `bunx shadcn add dialog` 的拷贝管线维护(已按水墨主题改皮,
// 后续 CLI 更新组件时 diff 这里的改皮差异)。部件映射:Overlay→Backdrop、
// Content→Popup,导出名与 data-slot 沿用 shadcn 惯例不变。
// 简单确认框/纯表单弹层直接用本文件;器物级自定义皮肤(如游戏横幅 BannerShell)
// 直接用 @base-ui/react 的 Dialog 原语自行组皮,行为口径(焦点陷阱/aria-modal/
// Esc/点外关闭)与本底件保持一致。
// 题名拖动(#674):底件系弹窗出厂即带——本体外挂 --drag-x/--drag-y 变量消费位,
// 拖拽逻辑单源在 hooks/use-dialog-drag;shell 经 <DialogDragHandle> 组件把手摊在
// 题名行上(PileShell/ConfirmDialog/MapSelectPanel/JinnangDetailSheet 桌面形态),
// 业务弹窗(children)零改动。遮罩随拖离中心减淡,色值单源在 hook 文件。
import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@app/utils/cn";
import {
  DialogDragProvider,
  OVERLAY_TINT,
  OVERLAY_TINT_DIMMED,
  OVERLAY_TINT_STACKED,
  useDialogDrag,
} from "@app/hooks/use-dialog-drag";
import { useDialogStackSlot } from "@app/hooks/dialog-stack";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  dimmed,
  stacked,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop> & {
  /** 拖离中心减淡态(#674;useDialogDrag 的 dimmed,色值单源在 hook 文件)。 */
  dimmed?: boolean;
  /** 叠层减淡态(#767;开栈栈深>1 且本层为上层,计数单源 hooks/dialog-stack)。 */
  stacked?: boolean;
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50", className)}
      style={{
        // 两档减淡取强不叠加:拖离(0.15)强于叠层(0.28)
        backgroundColor: dimmed
          ? OVERLAY_TINT_DIMMED
          : stacked
            ? OVERLAY_TINT_STACKED
            : OVERLAY_TINT,
        ...style,
      }}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  overlayProps,
  ref: contentRef,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & {
  /** 透传给内部遮罩(DialogOverlay)。非模态弹层(modal="trap-focus")需要遮罩
   *  pointer-events 放行底层交互——必须走内联 style:banner.css 等未分层规则里的
   *  pointer-events:auto 恒压过 utilities 层的 pointer-events-none 类。 */
  overlayProps?: React.ComponentProps<typeof DialogPrimitive.Backdrop>;
}) {
  // 题名拖动(#674):拖拽原语住本件,弹窗本体即变量宿主;消费方 ref(如
  // ConfirmDialog 的 popupRef)与本件内部 ref 组合,不覆盖。
  const popupRef = React.useRef<HTMLDivElement | null>(null);
  const drag = useDialogDrag({ popupRef });
  // 叠层开栈(#767):本件挂载即活弹层入栈(Portal 随 open 挂载,卸载=关闭出栈),
  // 栈深>1 且本层为上层 → 遮罩消费减淡档 --mask-dim-stacked。
  const stacked = useDialogStackSlot(true);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay {...overlayProps} dimmed={drag.dimmed} stacked={stacked} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        ref={(node: HTMLDivElement | null) => {
          popupRef.current = node;
          if (typeof contentRef === "function") contentRef(node);
          else if (contentRef != null) contentRef.current = node;
        }}
        className={cn(
          // S9 深底适配:墨发丝边(rgba(43,35,23,·))在玄墨深底上隐形,收口为漆金发丝边
          // (gold/30 = --color-gold 的 alpha 写法);纸面渐变已是 S3 深底 token,不动。
          // 居中位移消费 --drag-x/--drag-y(#674,变量由题名拖动命令式写入,缺省 0px =
          // 原居中);消费方以同组 translate-x/y-* 类经 twMerge 改写(贴底抽屉/宏中距)。
          // paper-skin(#845/P1-A4):Portal 挂 body 罩不到 #app 材质膜,纸面自带颗粒+晕影。
          "paper-skin fixed top-1/2 left-1/2 z-50 flex max-h-[86dvh] translate-x-[calc(-50%_+_var(--drag-x,0px))] translate-y-[calc(-50%_+_var(--drag-y,0px))] flex-col rounded-[3px] border border-gold/30 bg-gradient-to-b from-paper-hi to-paper-lo px-6 py-5 text-ink shadow-[var(--ink-shadow-lg)]",
          className,
        )}
        {...props}
      >
        <DialogDragProvider value={drag}>{children}</DialogDragProvider>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 font-title text-[22px] tracking-[3px] text-ink", className)}
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

// shadcn/ui Tooltip(base-vega 风格)的水墨适配底件:Base UI 行为 + 本项目 token 皮。
// 由 components.json + `bunx shadcn add tooltip` 的拷贝管线维护(已按水墨主题改皮,
// 后续 CLI 更新组件时 diff 这里的改皮差异)。改皮登记(相对 CLI 原样):
//   ① Popup 皮换水墨「墨底纸金」(原型 .proto-tip 口径:rgba(43,35,23,.94) 墨底 +
//      纸色文字 + 金发丝边 + 墨影);② 去 Arrow(原型浮签无箭头);③ 去动画类
//      (tw-animate-css 未入仓,原样保留只会是死类;浮签即时显隐同原型);
//   ④ cn 别名修正为 @app/utils/cn(CLI 生成的是裸 "cn",本仓不可解析)。
// 行为层(hover + 长按同效、贴缘翻面、文案结构)不在此文件——见 game/Tip.tsx。
import type { ComponentProps } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@app/utils/cn";

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 w-max max-w-60 rounded-[4px] border border-[rgba(217,185,92,0.35)] bg-[rgba(43,35,23,0.94)] px-3 py-1.5 text-left text-xs leading-relaxed text-[#f6ecd9] shadow-[var(--ink-shadow-lg)]",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/** 浮签名词行(墨底上的金字标题;新文案走 font-brush,字体安全规约 §4.3)。 */
function TooltipTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="tooltip-title"
      className={cn("block font-brush text-[13px] leading-tight tracking-wide text-lacquer-gold", className)}
      {...props}
    />
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipTitle }

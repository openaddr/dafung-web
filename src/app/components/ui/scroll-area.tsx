// shadcn/ui ScrollArea(base-vega 风格)的水墨适配底件:Base UI 行为 + 本项目 token 皮。
// 由 components.json + `bunx shadcn add scroll-area` 的拷贝管线维护(已按水墨主题改皮,
// 后续 CLI 更新组件时 diff 这里的改皮差异)。改皮差异(cn 导入路径、滚动条常显门控、
// 拇指 token 皮)见 #708 弹层族矮屏规范。
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@app/utils/cn";

function ScrollArea({ className, children, ...props }: ScrollAreaPrimitive.Root.Props) {
  return (
    /* Root 走 flex 列容器(#708 首轮实拍实锤:宿主在 max-height 夹取的 flex 布局里,
       viewport 的 height:100% 拿不到确定高,内滚失灵——改由 min-h-0 flex-1 的
       可收缩滚动项吃满宿主定高,收缩链两层 flex 各持 min-height:0) */
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative flex flex-col", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="min-h-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {/* keepMounted(#708):测量前一拍即挂载轨道,首帧可见滚动提示(是否真溢出由
          data-has-overflow-y 门控透明度,无溢出零残影);缺省沿 Base UI 默认
          (hover/滚动才现)——弹层族矮屏规范恒挂常显轨道。 */}
      <ScrollBar keepMounted />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  keepMounted,
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      keepMounted={keepMounted}
      className={cn(
        "flex touch-none p-px transition-opacity select-none",
        /* 首帧可见滚动提示(#708):有纵向溢出即常显(不伴 hover/滚动态消失),
           无溢出 0 透明零残影;横向轨道同门控不常显(弹层族只用纵向)。 */
        "opacity-0 data-[has-overflow-y]:opacity-100",
        /* 方向档宽高:Base UI 下发 data-orientation(布尔 data-vertical 不存在,
           拷贝管线原版 data-vertical:* 变体永不命中,轨道零宽——#708 实拍修皮) */
        "data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent",
        "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        /* 水墨皮:漆金拇指(默认 bg-border 灰系在玄墨深底上近隐形,#510 同判) */
        className="relative flex-1 rounded-full bg-lacquer-gold/40"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };

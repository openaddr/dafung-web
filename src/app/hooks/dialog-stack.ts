// 弹层开栈(#767 弹窗详情族④「叠层遮罩减淡」):「同帧开了几层弹层」的唯一事实源。
// 每个活弹层实例(横幅系 BannerShell / 底件系 ui-dialog DialogContent)挂载时入栈、
// 卸载时出栈,数组长度即栈深;栈深>1 时**上层**(非栈底)遮罩消费减淡档
// --mask-dim-stacked(app.css,0.28),底层遮罩维持全档 0.42 压暗盘面——上层是玩家
// 正在操作的焦点,双层全档会「双重墨纱」闷掉弹层内容。
// 判定条件写死:入栈成员=活弹层实例;退场幽灵帧(BannerGhostContext)是纯视觉重放
// 不入栈;视觉叠放序与入栈序一致(横幅系 z-30 恒低于底件系 z-50,底件系同层 Portal
// 追加序即视觉序),无任何兜底分支。
import { useLayoutEffect, useRef, useState } from "react";

/** 活跃弹层栈(模块级,数组即计数器;槽位=Symbol 实例身份,挂载/卸载严格配对)。 */
const stack: symbol[] = [];
const listeners = new Set<() => void>();

/** 本实例是否为叠层中的上层:栈深>1 且本实例下标>0。底层实例恒 false(全档遮罩)。
 *  active=false(如幽灵帧)不入栈、恒 false。layout effect:入栈/出栈都发生在绘制前,
 *  上层遮罩首帧即减淡档,不闪全档(遮罩无入场动画,整帧跳变可见)。 */
export function useDialogStackSlot(active: boolean): boolean {
  const slotRef = useRef<symbol | null>(null);
  if (slotRef.current === null) slotRef.current = Symbol("dialog-slot");
  const slot = slotRef.current;
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    if (!active) return;
    stack.push(slot);
    const sync = () => setStacked(stack.indexOf(slot) > 0);
    sync();
    listeners.add(sync);
    return () => {
      const i = stack.indexOf(slot);
      if (i < 0) throw new Error("弹层开栈:卸载时槽位不在栈内(挂载/卸载配对破坏)");
      stack.splice(i, 1);
      listeners.delete(sync);
      // 上层收走后,新的上层(或独层)遮罩回全档——存活实例同步复位
      for (const notify of listeners) notify();
    };
  }, [active, slot]);
  return stacked;
}

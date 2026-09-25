// 长按手势单源(2026-09-25 耗时回顾评审:HandRack 与军师幕各写一份且口径漂移——
// 欧氏 10px vs 切比雪夫 8px;统一为一处,二期反应窗(#188 档 1)长按复用此件)。
// 口径:主指才起按(e.isPrimary);按住 ms(默认 500,交互阈值非演出时长,刻意
// 字面量不进倍率,ScrollShell 210ms 出口同先例)无位移即触发;位移超容差(欧氏
// 10px)视作拖动/滚屏取消;触发后置 fired,消费方在 onClick 首行读后即清,吃掉
// 触屏长按抬起补发的合成 click(同一动作绝不弹两次);卸载自动清 timer。
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export function useLongPress() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => cancel, []);

  return {
    /** 长按已触发标志(ref):onClick 首行读取,为真则吞掉本次 click 并清零。 */
    fired,
    cancel,
    /** 起按。onFire 在按满 ms 后回调(仅主指;位移超容差自动取消)。 */
    start(e: ReactPointerEvent, onFire: () => void, ms = 500) {
      if (!e.isPrimary) return;
      cancel();
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onFire();
      }, ms);
    },
    /** 移动监听:超容差即取消(拖动/滚屏不是长按)。 */
    move(e: ReactPointerEvent, slopPx = 10) {
      if (timer.current === null) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > slopPx) cancel();
    },
  };
}

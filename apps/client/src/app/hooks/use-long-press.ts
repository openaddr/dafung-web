// 长按手势单源(2026-09-25 耗时回顾评审:HandRack 与旧卷轴弹窗各写一份且口径漂移——
// 欧氏 10px vs 切比雪夫 8px;统一为一处,二期反应窗(#188 档 1)长按复用此件)。
// 口径:主指才起按(e.isPrimary);按住 ms(默认 500,交互阈值非演出时长,刻意
// 字面量不进倍率,ScrollShell 210ms 出口同先例)无位移即触发;位移超容差(欧氏
// 10px)视作拖动/滚屏取消;触发后置 fired,消费方在 onClick 首行读后即清,吃掉
// 触屏长按抬起补发的合成 click(同一动作绝不弹两次);卸载自动清 timer。
import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const PRESS_MOVE_SLOP_PX = 10;

/** 主指移动超过长按容差即为拖动；滚动视口复用同一判据抑制尾随点击。 */
export function isPressDrag(
  start: { x: number; y: number },
  point: { x: number; y: number },
  slopPx = PRESS_MOVE_SLOP_PX,
) {
  return Math.hypot(point.x - start.x, point.y - start.y) > slopPx;
}

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
    /** 长按计时是否仍在进行(#768):未起按/已触发/位移超容差取消后均 false。
     *  长按进度类反馈(牌面微光)据此对齐取消时机——容差口径留在本件,消费方
     *  只读状态不抄数字。 */
    armed: () => timer.current !== null,
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
    move(e: ReactPointerEvent, slopPx = PRESS_MOVE_SLOP_PX) {
      if (timer.current === null) return;
      if (isPressDrag(start.current, { x: e.clientX, y: e.clientY }, slopPx)) cancel();
    },
  };
}

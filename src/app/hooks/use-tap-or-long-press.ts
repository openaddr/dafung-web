// 轻点/长按复合手势(2026-09-25 评审 smell 去重:HandRack 窗态牌、JunshiSkillCard、Tip
// 三处同形接线——onPointer 族 + contextMenu 拦菜单 + fired 抑制补发 click——收拢为一,
// 均消费本件;基于 use-long-press.ts 原语扩展)。
// 口径:轻点 = click 且长按未触发 → onTap;长按 = 按满判定窗触发 onLongPress,触发后
// 置 fired,随后的合成 click 由 onClick 首行吞掉(同一动作绝不发两次,use-long-press 同源)。
// 消费差异走配置:onLongPress 为 null = 本次起按不武装(窗态牌仅选中态武装「长按=取消」)、
// ms 可调(Tip 触屏 400ms)、onContextMenu 在拦菜单后追加动作(窗态牌右键=取消选中)。
// 个别事件需在拦截之外追加自有动作时(如 Tip 触屏抬起即收签),在 spread 之后覆写同名
// prop,先调本件再补自己的。
import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useLongPress } from "./use-long-press";

export interface TapOrLongPressOptions {
  /** 轻点(click 且长按未触发)回调。 */
  onTap?: () => void;
  /** 长按满窗回调(参=起按时的触发元素,长按是延迟回调,事后再读事件对象不可靠);
   *  pointerdown 时为 null/undefined = 本次起按不武装长按。 */
  onLongPress?: ((trigger: HTMLElement) => void) | null;
  /** 长按判定窗 ms(缺省走 useLongPress 单源默认 500)。 */
  ms?: number;
  /** contextMenu 拦掉浏览器菜单后的追加动作(窗态牌:右键=取消选中)。 */
  onContextMenu?: () => void;
}

export function useTapOrLongPress(opts: TapOrLongPressOptions) {
  const press = useLongPress();
  // 回调每渲染新引用,读 ref 不进依赖:handlers 只建一次语义,事件时点读最新配置。
  const latest = useRef(opts);
  latest.current = opts;

  return {
    /** 长按已触发 ref(消费方自定义 click 时读后即清;props.onClick 已内置吞抑制)。 */
    fired: press.fired,
    /** 取消未满窗的长按(消费方覆写 pointer 收尾时用,如 Tip 触屏抬起即收签)。 */
    cancel: press.cancel,
    /** onPointer 族 + contextMenu + onClick 整套装法(spread 用)。 */
    props: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        press.cancel();
        const fire = latest.current.onLongPress;
        if (fire) {
          const el = e.currentTarget;
          press.start(e, () => fire(el), latest.current.ms);
        }
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => press.move(e),
      onPointerUp: () => press.cancel(),
      onPointerCancel: () => press.cancel(),
      onPointerLeave: () => press.cancel(),
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        e.preventDefault(); // 长按/右键不出系统菜单(三处同口径)
        latest.current.onContextMenu?.();
      },
      onClick: () => {
        if (press.fired.current) {
          press.fired.current = false; // 长按已触发,吞掉随后的补发 click
          return;
        }
        latest.current.onTap?.();
      },
    },
  };
}

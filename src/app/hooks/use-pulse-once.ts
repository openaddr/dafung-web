// 一次性脉冲闪拍(#751 B1 事件族共用,#1006 评审收口提取):计数变更一次=亮
// PULSE_ONCE_MS 后熄,类摘除再挂可重播;点按连发重置计时不叠影。首次接线拍只
// 对账不闪(防接线动作本身——如收起架——误触发脉冲);卸载兜摘计时器。
// 消费:PileButtons 锦囊钮 .nudge(收起态脉冲重定向)/ HandRack 可用牌金圈脉冲。
import { useEffect, useRef, useState } from "react";

const PULSE_ONCE_MS = 700;

export function usePulseOnce(count: number | null | undefined): boolean {
  const [on, setOn] = useState(false);
  const last = useRef<number | null>(null);
  const timer = useRef(0);
  useEffect(() => {
    if (count == null || count === last.current) return;
    const first = last.current == null;
    last.current = count;
    if (first) return;
    window.clearTimeout(timer.current);
    setOn(true);
    timer.current = window.setTimeout(() => setOn(false), PULSE_ONCE_MS);
  }, [count]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return on;
}

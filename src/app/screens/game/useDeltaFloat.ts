// 数值变化浮标(#44/S11 抽取):G-9 原本只盯现金的跨快照 diff 逻辑收进
// useDeltaFloat hook,现金(G-9)与委任状(#21/X2)复用同一浮标——值跳变时右上
// 浮出 +/− 标记,上浮渐隐时长走 token --dur-fx(game-hud.css 的 game-cash-float),组件侧 1.25s
// 移除(贝塞尔曲线起快收慢,1.25s 时位移/渐隐已基本走完,提前卸载不可见)。
// 观战空态同样消费(S12):浮标跟「被展示的玩家」走,与坐姿分支同款反馈。
// (#255:渲染件 DeltaFloatSpans 随 HandPanel 退役删除——唯一消费方仪表条 DashboardBar
//  漆底直出亮档配色,不复用纸面档色。)
import { useEffect, useRef, useState } from "react";
import { Motion } from "@core/theme";

/** 一条浮标:跨快照差值 + 自增 id(列表 key 与定时移除用)。 */
export interface DeltaFloat {
  id: number;
  delta: number;
}

/**
 * 跨快照数值差值浮标:传入被展示的数值(null = 暂无数据,重置基准不浮)。
 * 值变化 → 生成一条 {id, delta},1.25s 后自行出列;hook 完全自持,调用方只渲染。
 */
export function useDeltaFloat(value: number | null): DeltaFloat[] {
  const prevRef = useRef<number | null>(null);
  const idRef = useRef(0);
  const [floats, setFloats] = useState<DeltaFloat[]>([]);
  useEffect(() => {
    if (value == null) {
      prevRef.current = null;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev == null || prev === value) return;
    const delta = value - prev;
    if (delta === 0) return;
    const id = ++idRef.current;
    setFloats((f) => [...f, { id, delta }]);
    const timer = setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, Motion.dur.fx - 50); // 比 --dur-fx(1300ms)浮字动画提前 50ms 清理防闪尾(#117 评审收口)
    return () => clearTimeout(timer);
  }, [value]);
  return floats;
}

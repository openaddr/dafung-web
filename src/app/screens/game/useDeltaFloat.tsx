// 手牌区数值变化浮标(#44/S11 抽取):G-9 原本只盯现金的跨快照 diff 逻辑收进
// useDeltaFloat hook,现金(G-9)与委任状(#21/X2)复用同一浮标——值跳变时右上
// 浮出 +/− 标记,1.2s 上浮渐隐(game-hud.css 的 game-cash-float),组件侧 1.25s
// 移除(留 50ms 缓冲,动画播完再卸载)。
// 观战空态同样消费(S12):浮标跟「被展示的玩家」走,与坐姿分支同款反馈。
import { useEffect, useRef, useState } from "react";

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
    }, 1250);
    return () => clearTimeout(timer);
  }, [value]);
  return floats;
}

/** 浮标渲染:挂在 relative chip 容器内(chip 右上角);正=gold 负=danger。
 *  format 决定数值文案口径——现金走 formatMoney(锭/两),委任状是计数取整数。 */
export function DeltaFloatSpans({
  floats,
  format,
}: {
  floats: DeltaFloat[];
  format: (absDelta: number) => string;
}) {
  return (
    <>
      {floats.map((f) => (
        <span
          key={f.id}
          className={
            "game-cash-float pointer-events-none absolute -top-2 right-0 font-brush text-xs " +
            (f.delta > 0 ? "text-gold" : "text-danger")
          }
        >
          {f.delta > 0 ? "+" : "−"}
          {format(Math.abs(f.delta))}
        </span>
      ))}
    </>
  );
}

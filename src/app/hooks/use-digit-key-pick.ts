// 数字键直选(G-19 键盘口径)单源(2026-09-25 评审 smell 去重:HandRack 卡牌段与
// GameScreen 目标段各写一份「Number/isInteger/[n-1] + latest-ref window keydown」
// ——收拢为一):按 1..n 选中第 n 个可用项,命中即回调,越界(无第 n 项)零动作。
// enabled 翻转挂/卸唯一 window keydown 监听;items/onPick 每快照新引用,走 latest-ref
// 不进依赖,监听器不随重渲重挂。
import { useEffect, useRef } from "react";

export function useDigitKeyPick<T>(enabled: boolean, items: T[], onPick: (item: T) => void): void {
  const latest = useRef({ items, onPick });
  latest.current = { items, onPick };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      const hit = latest.current.items[n - 1];
      if (hit != null) latest.current.onPick(hit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

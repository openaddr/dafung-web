// 数值变化浮标(#44/S11 抽取):G-9 原本只盯现金的跨快照 diff 逻辑收进
// useDeltaFloat hook,现金(G-9)与委任状(#21/X2)复用同一浮标——值跳变时右上
// 浮出 +/− 标记,上浮渐隐时长走 token --dur-fx(layout.css 的 game-cash-float,#700 自 game-hud.css 并入),组件侧 1.25s
// 移除(贝塞尔曲线起快收慢,1.25s 时位移/渐隐已基本走完,提前卸载不可见)。
// (#255:渲染件 DeltaFloatSpans 随 HandPanel 退役删除——唯一消费方仪表条 DashboardBar
//  漆底直出亮档配色,不复用纸面档色。#495:渲染件 DeltaFloats 随本件共享给席位格
//  SeatRail(全员现金/体力浮标;自机格自 #697 评审收口起同锚——仪表条退役后自机
//  跳变反馈归席位格),hook 与渲染件同域单源,调用方不再各抄一份。)
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

/** 浮标 span 组(#495 自 DashboardBar 收拢至此,与 hook 同域单源):钱色归一(#761 ②)
 *  正差=attr-cash(与席位主数/棋盘浮字正档同绿族)、负差=danger(与棋盘浮字负档同
 *  朱砂)——旧「亮档配色」(正=lacquerGold/负=attr-hero-bright)是漆底仪表条时代的
 *  孤本,随浮标迁驻席位格归一。动画复用 layout.css game-cash-float(#700 自 game-hud.css 并入);
 *  定位锚=调用方的 relative 容器(右上悬出),数值格式化由调用方给(现金走
 *  formatMoney 带单位,裸数值直出)。体力浮标同件共用:正绿/负朱与体力轨
 *  (success/danger)同语言,归一无损。 */
export function DeltaFloats({
  floats,
  fmt,
}: {
  floats: DeltaFloat[];
  fmt: (delta: number) => string;
}) {
  return (
    <>
      {floats.map((f) => (
        <span
          key={f.id}
          aria-hidden="true"
          className={
            "game-cash-float pointer-events-none absolute -top-2 right-0 font-brush text-sm " +
            (f.delta > 0 ? "text-attr-cash" : "text-danger")
          }
        >
          {fmt(f.delta)}
        </span>
      ))}
    </>
  );
}

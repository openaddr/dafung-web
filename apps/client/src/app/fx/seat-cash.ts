// 席位现金数字 juice(#764):count-up 滚动补间 + 飞行归账抵达 bump。
// 为什么是 DOM 级模块而不是 React hook:席位现金数字本体的宿主(SeatRail.tsx)是
// #770 在改文件(工单 #764 禁碰),而挂 testid 的数字 span 是稳定单点——本模块
// 订阅 gameStore 快照 diff,rAF 补间直写 textContent。与 React 的写入不打架:
// React 只在 cash 真变化的重渲里改写该文本节点(其余重渲不动 DOM),补间终值恒等
// 于 React 终值;补间中途再变化时,React 写入新终值、本模块同拍起新补间(从当前
// 展示值续滚),无残留态。bump 同理:类挂摘到 testid span(fx.css 承担样式,
// span 无 className 属性,React 不覆写 class)。
import { useGameStore } from "@app/store/gameStore";
import { TESTIDS } from "@app/screens/game/testids";
import { UI } from "./timings";

/** 大额阈值(#764 口径「小额 ~500ms / 大额 ~900ms」的分界):|Δ| 达此值走长档。 */
const CASH_COUNT_LARGE_AT = 1000;

const countMs = (delta: number): number =>
  Math.abs(delta) >= CASH_COUNT_LARGE_AT ? UI.cashCountLargeMs : UI.cashCountSmallMs;

/** --ease-out 语义的 JS 镜像(cubic-bezier(0.22,1,0.36,1) 的标准 ease-out 近似)。 */
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

function seatCashEl(seat: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${TESTIDS.seatCash(seat)}"]`);
  // 席位格与对局屏同挂同卸,数字 span 缺席 = 接线 bug,炸出不兜底(零兜底)。
  if (!el) throw new Error(`seat-cash:席位 #${seat} 的现金数字元素不存在(接线 bug)`);
  return el;
}

/** 补间/展示账本(key = 玩家 id):shown = 当前展示值(补间中途值),raf = 在途帧句柄。 */
const shown = new Map<string, number>();
const rafs = new Map<string, number>();

function startTween(playerId: string, seat: number, from: number, to: number): void {
  const prev = rafs.get(playerId);
  if (prev != null) cancelAnimationFrame(prev);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // reduced-motion:数字直切(DESIGN §6,补间是一次性演出非状态)
    seatCashEl(seat).textContent = String(to);
    shown.set(playerId, to);
    rafs.delete(playerId);
    return;
  }
  const ms = countMs(to - from);
  const t0 = performance.now();
  const el = seatCashEl(seat);
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const v = Math.round(from + (to - from) * easeOutCubic(t));
    el.textContent = String(v);
    shown.set(playerId, v);
    if (t < 1) rafs.set(playerId, requestAnimationFrame(step));
    else rafs.delete(playerId);
  };
  rafs.set(playerId, requestAnimationFrame(step));
}

/** 金钱归账抵达 bump(#764):席位现金数字 scale 1.15→1 一拍(--dur-fast token)。
 *  摘了再挂重播(补间直写 textContent 与 transform 分属性,互不干扰)。 */
export function bumpSeatCash(seat: number): void {
  const el = seatCashEl(seat);
  el.classList.remove("fx-cash-bump");
  void el.offsetWidth; // 重排一次复位动画:同名类连挂两次也能重播
  el.classList.add("fx-cash-bump");
}

/** 启动席位现金 count-up 订阅(唯一挂载点 = FxLayer,与对局屏同生命周期)。
 *  首拍只立基准并同步展示值(开局铺盘/重挂不滚账),其后跨快照现金 diff 驱动补间。
 *  返回清理函数:退订 + 撤在途补间帧。 */
export function startSeatCashCount(): () => void {
  const baseline = useGameStore.getState().snapshot;
  // 挂载点 = FxLayer(只在对局屏),快照缺位 = 接线 bug,炸出不兜底(零兜底)。
  if (baseline == null) throw new Error("seat-cash:启动时快照缺位(接线 bug)");
  for (const [seat, p] of baseline.players.entries()) {
    shown.set(p.id, p.cash);
    seatCashEl(seat).textContent = String(p.cash);
  }
  const unsub = useGameStore.subscribe((state, prevState) => {
    // snapshot 双空 = 已离屏的过渡拍(订阅拆卸异步于 store 写入,与终局封场收队
    // 同属生命周期规则):不滚账,等卸载收尾。缺位但不缺快照的玩家 diff 才是 bug。
    if (state.snapshot == null || prevState.snapshot == null) return;
    const prevCash = new Map(prevState.snapshot.players.map((p) => [p.id, p.cash]));
    state.snapshot.players.forEach((p, seat) => {
      const prev = prevCash.get(p.id);
      const cur = shown.get(p.id);
      // 快照缺人/账本缺项 = 接线 bug,当场炸出(零兜底,不静默跳过)
      if (prev == null || cur == null)
        throw new Error(`seat-cash:玩家 ${p.id} 跨快照席位账本不一致(接线 bug)`);
      if (prev === p.cash) return;
      startTween(p.id, seat, cur, p.cash);
    });
  });
  return () => {
    unsub();
    for (const raf of rafs.values()) cancelAnimationFrame(raf);
    rafs.clear();
    shown.clear();
  };
}

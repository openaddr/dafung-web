// pan/zoom hook:移植自 src/render/board.ts 的 viewBox 缩放平移段(滚轮锚点缩放 + 拖拽空白平移)。
// 作用于 SVG 根的 viewBox(与旧实现同机制,便于逐步对照)。
//
// F1 性能改造:viewBox 不再走 React state——每次 pointermove setState 会导致
// BoardView 全量 reconciliation(40 城 + 棋子层)。现改为把当前 viewBox 存 ref,
// 直接对 <svg> setAttribute("viewBox") 命令式更新;React 侧只在挂载时写入一次
// 初始总览值(BoardView 传常量 prop,此后 React 不再触碰该属性)。
import { useCallback, useEffect, useRef, useState } from "react";

/** 总览 viewBox(贴紧城池范围 + 边距)。
 *  #58 蛇形全网格重排:7 列 × 400 / 6 行 × 310 → 城池包围盒
 *  x -1236..1436(城台底座半宽 62×2.2)、y -945..906(王旗顶 -91×2.2 ~ 价格字底 46×2.2),
 *  即内容 2672×1851 @中心 (100,-20)。边距 ~3% 并保持宽高比 5/3=1.667
 *  (与 StaticLayers VB 同比例,preserveAspectRatio 不产生新留白)。 */
export const FIT_VIEW = { x: -1490, y: -974, w: 3180, h: 1908 } as const;

/** 总览 viewBox 属性串(BoardView 作初始 prop 一次性下发,React 之后不再改写)。 */
export const FIT_VIEW_BOX = `${FIT_VIEW.x} ${FIT_VIEW.y} ${FIT_VIEW.w} ${FIT_VIEW.h}`;

const MAX_ZOOM = 8;
// #38:允许超出总览边界约 = 边缘渐隐带(EDGE_PAD=700)的一半——pan 到极限时
// 视口恰好落在地形渐隐带中段,能看到"纸面平滑淡出到页面背景"的效果(旧值 140
// 根本平移不到渐隐区,是 #38"看不到效果"的根因之一)。
const OVER = 350;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampVb(v: ViewBox): ViewBox {
  const w = Math.max(FIT_VIEW.w / MAX_ZOOM, Math.min(FIT_VIEW.w, v.w));
  const h = Math.max(FIT_VIEW.h / MAX_ZOOM, Math.min(FIT_VIEW.h, v.h));
  const x = Math.max(FIT_VIEW.x - OVER, Math.min(FIT_VIEW.x + FIT_VIEW.w - w + OVER, v.x));
  const y = Math.max(FIT_VIEW.y - OVER, Math.min(FIT_VIEW.y + FIT_VIEW.h - h + OVER, v.y));
  return { x, y, w, h };
}

export interface PanZoom {
  /** 绑到 <svg> 上的指针事件(拖拽平移;城池/按钮不触发)。 */
  handlers: {
    onPointerDown: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (ev: React.PointerEvent<SVGSVGElement>) => void;
  };
  /** 是否正在拖拽平移(用于切换 cursor)。 */
  grabbing: boolean;
  /** 还原总览。 */
  reset: () => void;
  /** #98 按钮缩放:以当前视口中心为锚按倍率缩放(factor>1 放大,如 1.25/0.8)。 */
  zoomBy: (factor: number) => void;
  /** 当前 viewBox(快照值,读取用)。 */
  getView: () => ViewBox;
}

export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>): PanZoom {
  // 真源:ref 里的当前 viewBox(命令式更新,不触发 React 渲染)。
  const view = useRef<ViewBox>({ ...FIT_VIEW });
  const apply = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const v = view.current;
    el.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }, [svgRef]);
  const setView = useCallback(
    (next: ViewBox) => {
      view.current = clampVb(next);
      apply();
    },
    [apply],
  );

  // 多指追踪(P0-5):单指=平移;双指=按两指距离比缩放、以中点为锚(与 wheel 同源算法)。
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [grabbing, setGrabbing] = useState(false);

  // 滚轮缩放(以光标为锚点)。React 合成 wheel 事件是 passive 监听,preventDefault 无效,
  // 必须原生 addEventListener({ passive: false }) —— 与旧实现行为一致。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = (ev.clientX - rect.left) / rect.width;
      const cy = (ev.clientY - rect.top) / rect.height;
      const vb = view.current;
      const factor = Math.exp(ev.deltaY * 0.0015);
      const lx = vb.x + cx * vb.w;
      const ly = vb.y + cy * vb.h;
      setView({ w: vb.w * factor, h: vb.h * factor, x: lx - cx * vb.w * factor, y: ly - cy * vb.h * factor });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, setView]);

  // 双指几何快照:上一次两指距离与中点(pinch 每帧与上一帧比,增量式缩放)。
  const pinchDist = useRef(0);

  const onPointerDown = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    // 城池/按钮交给各自点击,不触发平移
    if ((ev.target as Element).closest(".bv-tile, button")) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.current.size === 2) {
      // 第二指落下:进入 pinch,记录初始两指距离
      const [a, b] = pointers.current.values();
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    setGrabbing(true);
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!pointers.current.has(ev.pointerId)) return; // 未按下(或目标在城池上)的悬停移动忽略
      const rect = ev.currentTarget.getBoundingClientRect();
      // 先取上一帧位置再写入新位置——顺序颠倒会让 dx/dy 恒为 0(平移失效,波3实踩)
      const prev = pointers.current.get(ev.pointerId)!;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.current.size >= 2) {
        // 双指 pinch:按两指距离比缩放,以中点为锚(与 wheel 锚点算法同源)
        const [a, b] = pointers.current.values();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current > 0 && dist > 0) {
          // 与 wheel 的 Math.exp(deltaY*k) 同向:距离拉大→factor<1→viewBox 变小→放大
          const factor = pinchDist.current / dist;
          const cx = ((a.x + b.x) / 2 - rect.left) / rect.width;
          const cy = ((a.y + b.y) / 2 - rect.top) / rect.height;
          const vb = view.current;
          const lx = vb.x + cx * vb.w;
          const ly = vb.y + cy * vb.h;
          setView({ w: vb.w * factor, h: vb.h * factor, x: lx - cx * vb.w * factor, y: ly - cy * vb.h * factor });
        }
        pinchDist.current = dist;
        return;
      }
      // 单指平移(与 pinch 抬指回落后的行为一致:以剩余指位置为锚,不跳变)
      const dx = ev.clientX - prev.x;
      const dy = ev.clientY - prev.y;
      const vb = view.current;
      setView({ ...vb, x: vb.x - dx * (vb.w / rect.width), y: vb.y - dy * (vb.h / rect.height) });
    },
    [setView],
  );

  const endPan = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size === 0) {
      pinchDist.current = 0;
      setGrabbing(false);
    } else if (pointers.current.size === 1) {
      // pinch 中抬一指:回落为单指平移(锚点即剩余指最新位置,天然不跳变)
      pinchDist.current = 0;
    }
  }, []);

  // #98 按钮缩放:以当前视口中心为锚(锚点算法照抄 wheel——归一化锚点取视口中心
  // (0.5,0.5),lx/ly 即 viewBox 中心,无需读 rect)。factor 直接乘进 w/h 走同一
  // setView→clampVb 管线,与 wheel/pinch 一样靠 clampVb 夹在 1×..MAX_ZOOM 界内
  // (不预夹 factor,不另立状态)。
  const zoomBy = useCallback(
    (factor: number) => {
      const cx = 0.5;
      const cy = 0.5;
      const vb = view.current;
      const lx = vb.x + cx * vb.w;
      const ly = vb.y + cy * vb.h;
      setView({ w: vb.w * factor, h: vb.h * factor, x: lx - cx * vb.w * factor, y: ly - cy * vb.h * factor });
    },
    [setView],
  );

  const reset = useCallback(() => {
    setView({ ...FIT_VIEW });
  }, [setView]);

  const getView = useCallback(() => ({ ...view.current }), []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
    },
    grabbing,
    reset, // 还原总览(供"总览"按钮;BoardViewHandle 暴露)
    zoomBy, // #98 视口中心锚定缩放(供棋盘 +/− 钮;BoardViewHandle 暴露)
    getView,
  };
}

/** 拖拽中的 cursor 提示(绑到 <svg className>):用法见 BoardView。 */
export const panCursorClass = (panning: boolean): string => (panning ? "cursor-grabbing" : "cursor-grab");

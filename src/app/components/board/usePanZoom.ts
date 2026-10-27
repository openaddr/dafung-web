// pan/zoom hook:移植自 src/render/board.ts 的 viewBox 缩放平移段(滚轮锚点缩放 + 拖拽空白平移)。
// 作用于 SVG 根的 viewBox(与旧实现同机制,便于逐步对照)。
//
// F1 性能改造:viewBox 不再走 React state——每次 pointermove setState 会导致
// BoardView 全量 reconciliation(40 城 + 棋子层)。现改为把当前 viewBox 存 ref,
// 直接对 <svg> setAttribute("viewBox") 命令式更新;React 侧只在挂载时写入一次
// 初始总览值(BoardView 传常量 prop,此后 React 不再触碰该属性)。
//
// ADR-0027:总览视口不再硬编码(FIT_VIEW 常量随 #58 老布局漂移,东西延伸列
// 加入后左右各空 ~12%),改由 computeFitView 按当图城池包围盒动态推导——
// 环游图/中原图/自制图统一自适应,「改图忘改视口」这类漂移从此绝根。
//
// #699 触控手势:双指捏合缩放 + 单指拖拽平移直接驱动本 hook 的取景状态。
//   - 缩放数学收敛为纯函数 zoomAt(锚点缩放)/ pinchFrame(捏合帧)/ normAnchor,
//     wheel / pinch / zoomBy(+− 钮)三通路共用同一实现;clamp 全走
//     setView→clampViewBox(1×..MAX_ZOOM)——不存在第二套界。
//   - 单指按下后位移超过 DRAG_THRESHOLD_PX 判拖拽(起手可在城池上);拖拽全程
//     吞 click(落格点击不误触),小于阈值松开 = 普通点击,城池行为零变化。
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardPos } from "@core/board";

const MAX_ZOOM = 8;
// #38:允许超出总览边界约 = 边缘渐隐带(EDGE_PAD=700)的一半——pan 到极限时
// 视口恰好落在地形渐隐带中段,能看到"纸面平滑淡出到页面背景"的效果(旧值 140
// 根本平移不到渐隐区,是 #38"看不到效果"的根因之一)。
const OVER = 350;

/** 总览内容外扩口径(与 Tile 层实际占面对齐,单位 = 世界坐标):
 *  - 两侧:城台半宽 104×2.2/2 ≈ 115;边界竖边避城弧线外凸 ≤160(sideArc 档位上限)
 *  - 上方:王旗顶约 −91×2.2 ≈ −200(旗高于城台)
 *  - 下方:铭牌底约 44×2.2 ≈ 97;横边弧线外凸 ≤160 收于此线内
 *  再加 4% 呼吸边距。宽高比随内容(不再钉 5/3——容器失配交给
 *  preserveAspectRatio meet,地形层 EDGE_PAD 渐隐带负责补边)。 */
const PAD_SIDE = 180;
const PAD_TOP = 220;
const PAD_BOTTOM = 180;
const BREATH = 1.04;

/** 按当图城池包围盒推导总览 viewBox(纯函数;BoardView 挂载时算一次)。 */
export function computeFitView(tiles: readonly { position: BoardPos }[]): ViewBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { position: p } of tiles) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = minX - PAD_SIDE,
    y0 = minY - PAD_TOP,
    x1 = maxX + PAD_SIDE,
    y1 = maxY + PAD_BOTTOM;
  const w = (x1 - x0) * BREATH,
    h = (y1 - y0) * BREATH;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 视口夹界(缩放/平移的唯一 clamp):w/h 夹在 fit/MAX_ZOOM..fit,xy 允许出界 OVER。
 *  wheel/pinch/zoomBy/拖拽四条通路全走 setView→本函数,不存在第二套界。 */
export function clampViewBox(v: ViewBox, fit: ViewBox): ViewBox {
  const w = Math.max(fit.w / MAX_ZOOM, Math.min(fit.w, v.w));
  const h = Math.max(fit.h / MAX_ZOOM, Math.min(fit.h, v.h));
  const x = Math.max(fit.x - OVER, Math.min(fit.x + fit.w - w + OVER, v.x));
  const y = Math.max(fit.y - OVER, Math.min(fit.y + fit.h - h + OVER, v.y));
  return { x, y, w, h };
}

export interface ScreenPt {
  x: number;
  y: number;
}

/** 屏幕矩形(DOMRect 结构兼容:调用方直接传 getBoundingClientRect() 结果)。 */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 屏幕点 → viewBox 归一化锚点(0..1)。 */
export function normAnchor(rect: ScreenRect, x: number, y: number): { ax: number; ay: number } {
  return { ax: (x - rect.left) / rect.width, ay: (y - rect.top) / rect.height };
}

/** 锚点缩放纯函数:以归一化锚点 (ax,ay) 为不动点缩放 viewBox。
 *  wheel(光标锚)/ pinch(两指中点锚)/ zoomBy(视口中心锚)三通路同源。 */
export function zoomAt(v: ViewBox, ax: number, ay: number, factor: number): ViewBox {
  const lx = v.x + ax * v.w;
  const ly = v.y + ay * v.h;
  return {
    w: v.w * factor,
    h: v.h * factor,
    x: lx - ax * v.w * factor,
    y: ly - ay * v.h * factor,
  };
}

/** 捏合帧纯函数:两指屏幕位置 + 上一帧两指距 → 本帧缩放输入。
 *  factor = prevDist/dist(与 wheel 的 Math.exp(deltaY*k) 同向:距离拉大 →
 *  factor<1 → viewBox 变小 = 放大);锚点 = 两指中点的归一化坐标。 */
export function pinchFrame(
  prevDist: number,
  a: ScreenPt,
  b: ScreenPt,
  rect: ScreenRect,
): { factor: number; ax: number; ay: number; dist: number } {
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  const { ax, ay } = normAnchor(rect, (a.x + b.x) / 2, (a.y + b.y) / 2);
  return { factor: prevDist / dist, ax, ay, dist };
}

/** 单指拖拽阈值(屏幕像素,#699 拍板口径):按下点位移超过它判拖拽;
 *  小于阈值松开 = 普通点击(落格),行为零变化。 */
export const DRAG_THRESHOLD_PX = 8;

export function beyondDragThreshold(sx: number, sy: number, x: number, y: number): boolean {
  return Math.hypot(x - sx, y - sy) > DRAG_THRESHOLD_PX;
}

export interface PanZoom {
  /** 绑到 <svg> 上的指针事件(拖拽平移;按钮不触发)与 click 捕获(拖拽/捏合吞点击)。 */
  handlers: {
    onPointerDown: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onClickCapture: (ev: React.MouseEvent<SVGSVGElement>) => void;
  };
  /** 是否正在拖拽平移(用于切换 cursor)。 */
  grabbing: boolean;
  /** #98 按钮缩放:以当前视口中心为锚按倍率缩放(factor>1 放大,如 1.25/0.8)。 */
  zoomBy: (factor: number) => void;
  /** 当前 viewBox(快照值,读取用)。 */
  getView: () => ViewBox;
}

export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>, fit: ViewBox): PanZoom {
  // 真源:ref 里的当前 viewBox(命令式更新,不触发 React 渲染)。
  const view = useRef<ViewBox>({ ...fit });
  const apply = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const v = view.current;
    el.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }, [svgRef]);
  const setView = useCallback(
    (next: ViewBox) => {
      view.current = clampViewBox(next, fit);
      apply();
    },
    [apply, fit],
  );

  // 多指追踪(P0-5 + #699):单指=拖拽平移(8px 阈值判拖);双指=按两指距离比缩放、
  // 以中点为锚(与 wheel 同源算法)。每指记按下点 (sx,sy) 供阈值判定。
  const pointers = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const [grabbing, setGrabbing] = useState(false);
  // #699 点击抑制:本次手势发生过拖拽/捏合时,收尾 click 一律吞(拖拽全程不触发
  // 落格点击)。手势开局(首指 pointerdown)复位;click 捕获消费后也复位,
  // 防「pointercancel 无 click 跟进」的残留误吞下一次点击。
  const draggedRef = useRef(false);
  const multiRef = useRef(false);

  // 滚轮缩放(以光标为锚点)。React 合成 wheel 事件是 passive 监听,preventDefault 无效,
  // 必须原生 addEventListener({ passive: false }) —— 与旧实现行为一致。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const { ax, ay } = normAnchor(rect, ev.clientX, ev.clientY);
      const factor = Math.exp(ev.deltaY * 0.0015);
      setView(zoomAt(view.current, ax, ay, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, setView]);

  // 双指几何快照:上一次两指距离(pinch 每帧与上一帧比,增量式缩放)。
  const pinchDist = useRef(0);

  const onPointerDown = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    // 按钮自有点击语义,不进棋盘手势;城池不再排除——从城池起手也要能拖拽平移
    // (#699),误触由 8px 阈值 + click 吞噬拦住。
    if ((ev.target as Element).closest("button")) return;
    if (pointers.current.size === 0) {
      draggedRef.current = false;
      multiRef.current = false;
    }
    pointers.current.set(ev.pointerId, {
      x: ev.clientX,
      y: ev.clientY,
      sx: ev.clientX,
      sy: ev.clientY,
    });
    if (pointers.current.size === 2) {
      // 第二指落下:进入 pinch,记录初始两指距离;双指手势的收尾 click 一律吞
      // (两指快触城池不应落格)。
      multiRef.current = true;
      const [a, b] = pointers.current.values();
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    // 城池起手不立即夺获也不切 grabbing:pointer capture 会把收尾 click 重定向到
    // svg,城池的落格点击就死了——夺获推迟到跨过拖拽阈值的那一刻(pointermove 内)。
    if ((ev.target as Element).closest(".bv-tile")) return;
    setGrabbing(true);
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      const p = pointers.current.get(ev.pointerId);
      if (!p) return; // 未按下(或目标在按钮上)的悬停移动忽略
      const rect = ev.currentTarget.getBoundingClientRect();
      // 先取上一帧位置再写入新位置——顺序颠倒会让 dx/dy 恒为 0(平移失效,波3实踩)
      const dx = ev.clientX - p.x;
      const dy = ev.clientY - p.y;
      p.x = ev.clientX;
      p.y = ev.clientY;
      if (pointers.current.size >= 2) {
        // 双指 pinch:按两指距离比缩放,以中点为锚(与 wheel 锚点算法同源)
        const [a, b] = pointers.current.values();
        const frame = pinchFrame(pinchDist.current, a, b, rect);
        if (pinchDist.current > 0 && frame.dist > 0) {
          setView(zoomAt(view.current, frame.ax, frame.ay, frame.factor));
        }
        pinchDist.current = frame.dist;
        return;
      }
      // 单指:跨过阈值才算拖拽(此前的一切移动视为点击按压抖动,视口不动)
      if (!draggedRef.current) {
        if (!beyondDragThreshold(p.sx, p.sy, p.x, p.y)) return;
        draggedRef.current = true;
        setGrabbing(true);
        // 跨阈即刻夺获指针:后续 move/up(及其 click)重定向到 svg,城池的
        // onClick 从根上不再收到本次手势的收尾(拖拽全程不触发落格点击)。
        ev.currentTarget.setPointerCapture(ev.pointerId);
      }
      // 拖拽平移(与 pinch 抬指回落后的行为一致:以剩余指位置为锚,不跳变)
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
      // pinch 中抬一指:回落为单指拖拽(锚点即剩余指最新位置,天然不跳变)
      pinchDist.current = 0;
    }
  }, []);

  // 拖拽/捏合收尾的 click 一律吞(capture 相位拦在城池 onClick 之前)。
  // 双保险:跨阈时的 setPointerCapture 通常已把 click 重定向到 svg,此处兜的是
  // 触摸隐式夺获等 click 仍落在城池上的浏览器通路。
  const onClickCapture = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    if (!draggedRef.current && !multiRef.current) return;
    ev.stopPropagation();
    draggedRef.current = false;
    multiRef.current = false;
  }, []);

  // #98 按钮缩放:以当前视口中心为锚(锚点算法照抄 wheel——归一化锚点取视口中心
  // (0.5,0.5),lx/ly 即 viewBox 中心,无需读 rect)。factor 直接乘进 w/h 走同一
  // setView→clampViewBox 管线,与 wheel/pinch 一样靠 clampViewBox 夹在 1×..MAX_ZOOM
  // 界内(不预夹 factor,不另立状态)。
  const zoomBy = useCallback(
    (factor: number) => {
      setView(zoomAt(view.current, 0.5, 0.5, factor));
    },
    [setView],
  );

  const getView = useCallback(() => ({ ...view.current }), []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
      onClickCapture,
    },
    grabbing,
    zoomBy, // #98 视口中心锚定缩放(供棋盘 +/− 钮;BoardViewHandle 暴露)
    getView,
  };
}

/** 拖拽中的 cursor 提示(绑到 <svg className>):用法见 BoardView。 */
export const panCursorClass = (panning: boolean): string =>
  panning ? "cursor-grabbing" : "cursor-grab";

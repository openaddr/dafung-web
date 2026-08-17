// pan/zoom hook:移植自 src/render/board.ts 的 viewBox 缩放平移段(滚轮锚点缩放 + 拖拽空白平移)。
// 作用于 SVG 根的 viewBox(与旧实现同机制,便于逐步对照)。
//
// F1 性能改造:viewBox 不再走 React state——每次 pointermove setState 会导致
// BoardView 全量 reconciliation(40 城 + 棋子层)。现改为把当前 viewBox 存 ref,
// 直接对 <svg> setAttribute("viewBox") 命令式更新;React 侧只在挂载时写入一次
// 初始总览值(BoardView 传常量 prop,此后 React 不再触碰该属性)。
import { useCallback, useEffect, useRef, useState } from "react";

/** 总览 viewBox(贴紧城池范围 + 边距),与旧 board.ts 常量一致。 */
export const FIT_VIEW = { x: -1050, y: -660, w: 2300, h: 1380 } as const;

/** 总览 viewBox 属性串(BoardView 作初始 prop 一次性下发,React 之后不再改写)。 */
export const FIT_VIEW_BOX = `${FIT_VIEW.x} ${FIT_VIEW.y} ${FIT_VIEW.w} ${FIT_VIEW.h}`;

const MAX_ZOOM = 4;
const OVER = 140; // 允许略超边界,便于平移到边缘城池

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

export interface FlyToOptions {
  /** 缓动时长(默认 ~500ms)。 */
  durationMs?: number;
}

export interface PanZoom {
  /** 绑到 <svg> 上的指针事件(拖拽平移;城池/按钮不触发)。 */
  handlers: {
    onPointerDown: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (ev: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  /** 是否正在拖拽平移(用于切换 cursor)。 */
  grabbing: boolean;
  /** 还原总览。 */
  reset: () => void;
  /** C4 镜头跟随:缓动把 viewBox 中心平移到 (cx,cy),不改变当前缩放。 */
  flyTo: (cx: number, cy: number, opts?: FlyToOptions) => void;
  /** 当前 viewBox(快照值,读取用)。 */
  getView: () => ViewBox;
}

/** 跨层镜头访问点:fx 层(useMarch)不在 React 树内拿不到 BoardViewHandle ref,
 *  由本 hook 挂载时注册/卸载时注销;fx 侧经 boardCamera.flyTo 请求镜头跟随。 */
export const boardCamera: {
  flyTo: ((cx: number, cy: number, opts?: FlyToOptions) => void) | null;
  getView: (() => ViewBox) | null;
} = { flyTo: null, getView: null };

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

  const panning = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  // flyTo 动画令牌:新 flyTo / 用户手动交互(pointerdown、滚轮)时作废进行中的缓动。
  const flyToken = useRef(0);

  const cancelFly = useCallback(() => {
    flyToken.current++;
  }, []);

  // 挂载即注册跨层镜头访问点(卸载注销)。
  const flyTo = useCallback(
    (cx: number, cy: number, opts?: FlyToOptions) => {
      const durationMs = opts?.durationMs ?? 500;
      const from = { ...view.current };
      const to = { ...from, x: cx - from.w / 2, y: cy - from.h / 2 };
      const token = ++flyToken.current;
      const t0 = performance.now();
      const tick = (now: number) => {
        if (flyToken.current !== token) return; // 已被新指令/用户交互作废
        const raw = Math.min(1, (now - t0) / durationMs);
        const ease = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2; // easeInOutCubic
        setView({
          ...from,
          x: from.x + (to.x - from.x) * ease,
          y: from.y + (to.y - from.y) * ease,
        });
        if (raw < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [setView],
  );

  useEffect(() => {
    boardCamera.flyTo = flyTo;
    boardCamera.getView = () => ({ ...view.current });
    return () => {
      boardCamera.flyTo = null;
      boardCamera.getView = null;
    };
  }, [flyTo]);

  // 滚轮缩放(以光标为锚点)。React 合成 wheel 事件是 passive 监听,preventDefault 无效,
  // 必须原生 addEventListener({ passive: false }) —— 与旧实现行为一致。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      cancelFly();
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
  }, [svgRef, setView, cancelFly]);

  const onPointerDown = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    // 城池/按钮交给各自点击,不触发平移
    if ((ev.target as Element).closest(".bv-tile, button")) return;
    cancelFly();
    panning.current = true;
    last.current = { x: ev.clientX, y: ev.clientY };
    setGrabbing(true);
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  }, [cancelFly]);

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<SVGSVGElement>) => {
      if (!panning.current) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const dx = ev.clientX - last.current.x;
      const dy = ev.clientY - last.current.y;
      last.current = { x: ev.clientX, y: ev.clientY };
      const vb = view.current;
      setView({ ...vb, x: vb.x - dx * (vb.w / rect.width), y: vb.y - dy * (vb.h / rect.height) });
    },
    [setView],
  );

  const endPan = useCallback(() => {
    if (panning.current) {
      panning.current = false;
      setGrabbing(false);
    }
  }, []);

  const reset = useCallback(() => {
    cancelFly();
    setView({ ...FIT_VIEW });
  }, [setView, cancelFly]);

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
    flyTo,
    getView,
  };
}

/** 拖拽中的 cursor 提示(绑到 <svg className>):用法见 BoardView。 */
export const panCursorClass = (panning: boolean): string => (panning ? "cursor-grabbing" : "cursor-grab");

// pan/zoom hook:移植自 src/render/board.ts 的 viewBox 缩放平移段(滚轮锚点缩放 + 拖拽空白平移)。
// 作用于 SVG 根的 viewBox(与旧实现同机制,便于逐步对照)。
import { useCallback, useEffect, useRef, useState } from "react";

/** 总览 viewBox(贴紧城池范围 + 边距),与旧 board.ts 常量一致。 */
export const FIT_VIEW = { x: -1050, y: -660, w: 2300, h: 1380 } as const;

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

export interface PanZoom {
  /** 当前 viewBox(原始数值)。 */
  view: ViewBox;
  /** 可直接绑到 <svg viewBox> 的字符串。 */
  viewBox: string;
  /** 平移量(viewBox 左上角)与缩放倍数(1=总览)。 */
  pan: { x: number; y: number };
  zoom: number;
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
}

export function usePanZoom(svgRef: React.RefObject<SVGSVGElement | null>): PanZoom {
  const [view, setView] = useState<ViewBox>(FIT_VIEW);
  const panning = useRef(false);
  const last = useRef({ x: 0, y: 0 });
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
      const factor = Math.exp(ev.deltaY * 0.0015);
      setView((vb) => {
        const lx = vb.x + cx * vb.w;
        const ly = vb.y + cy * vb.h;
        const next = { w: vb.w * factor, h: vb.h * factor, x: lx - cx * vb.w * factor, y: ly - cy * vb.h * factor };
        return clampVb(next);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef]);

  const onPointerDown = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    // 城池/按钮交给各自点击,不触发平移
    if ((ev.target as Element).closest(".bv-tile, button")) return;
    panning.current = true;
    last.current = { x: ev.clientX, y: ev.clientY };
    setGrabbing(true);
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerMove = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    if (!panning.current) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const dx = ev.clientX - last.current.x;
    const dy = ev.clientY - last.current.y;
    last.current = { x: ev.clientX, y: ev.clientY };
    setView((vb) =>
      clampVb({ ...vb, x: vb.x - dx * (vb.w / rect.width), y: vb.y - dy * (vb.h / rect.height) }),
    );
  }, []);

  const endPan = useCallback(() => {
    if (panning.current) {
      panning.current = false;
      setGrabbing(false);
    }
  }, []);

  const reset = useCallback(() => setView(FIT_VIEW), []);

  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;
  return {
    view,
    viewBox,
    reset, // 还原总览(供"总览"按钮;类型 PanZoom 要求)
    pan: { x: view.x, y: view.y },
    zoom: FIT_VIEW.w / view.w,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
    },
    grabbing,
  };
}

/** 拖拽中的 cursor 提示(绑到 <svg className>):用法见 BoardView。 */
export const panCursorClass = (panning: boolean): string => (panning ? "cursor-grabbing" : "cursor-grab");

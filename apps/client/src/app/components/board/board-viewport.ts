import type { BoardPos } from "@dafung/core/engine/board";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD_SIDE = 180;
const PAD_TOP = 220;
const PAD_BOTTOM = 180;
const BREATH = 1.04;

/** 按当图城池包围盒推导总览 viewBox(纯函数;ADR-0027)。
 *  #946 起这是唯一的取景通路:棋盘恒定格于本函数的输出,无平移缩放。 */
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

export function fitBoardViewport(view: ViewBox, width: number, height: number) {
  const scale = Math.min(width / view.w, height / view.h);
  return {
    width,
    height,
    scale,
    x: (width - view.w * scale) / 2 - view.x * scale,
    y: (height - view.h * scale) / 2 - view.y * scale,
  };
}

export function readBoardViewport(svg: SVGSVGElement) {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox === null || svg.clientWidth <= 0 || svg.clientHeight <= 0) return null;
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0 && Number.isFinite(x) && Number.isFinite(y)))
    throw new Error("棋盘取景盒无效");
  return fitBoardViewport({ x, y, w, h }, svg.clientWidth, svg.clientHeight);
}

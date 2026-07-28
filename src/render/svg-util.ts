// SVG 渲染小工具:多处共用,避免重复与变量 shadow。
/** 点列 → SVG path 的 d 属性(M 起步、L 后续)。 */
export function polylinePath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/** SVG 逻辑坐标 ↔ 屏幕坐标 互转(基于 getScreenCTM)。 */
export function svgCoordHelpers(svgEl: SVGSVGElement) {
  const toClient = (x: number, y: number): { x: number; y: number } => {
    const pt = svgEl.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const s = pt.matrixTransform(ctm);
    return { x: s.x, y: s.y };
  };
  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  return { toClient, toSvg };
}

// 氛围层 viewBox→客户端矩阵同步(ADR-0039):容器一层 transform 包揽 pan/zoom/resize,
// 装饰子元素一律世界坐标(逻辑单位=px)定位,矩阵写入容器即全体跟随。
// 盒口径 = clientWidth/Height(布局盒):getBoundingClientRect 是含 transform 的视觉盒,
// 撞上祖先入场缩放动画会把动画系数烤进矩阵,而 ResizeObserver 只看布局盒、动画结束
// 不补拍——错值从此固化(2026-10-31 实锤,位移比 268/239=1.12)。祖先变换对 svg 与
// 氛围层同等生效,本就不属于世界→客户端映射;布局盒才是映射真源。
// 单写者:AmbientLayer 自持观察(RO=布局盒变化/MutationObserver=viewBox 变化/
// fonts.ready),无 React 参与,与渲染无竞争。
export function syncAmbientMatrix(svg: SVGSVGElement, el: HTMLElement): void {
  const raw = svg.getAttribute("viewBox");
  if (!raw) return;
  const [vx, vy, vw, vh] = raw.split(/[\s,]+/).map(Number);
  const cw = svg.clientWidth;
  const ch = svg.clientHeight;
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) return;
  // preserveAspectRatio="xMidYMid meet" 的等比换算:scale = min(两向比),内容居中
  const s = Math.min(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2;
  const oy = (ch - vh * s) / 2;
  el.style.transform = `translate(${ox - vx * s}px, ${oy - vy * s}px) scale(${s})`;
}

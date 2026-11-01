// 棋盘锚定 HTML 宿主(ADR-0042 第三波):世界坐标(逻辑单位=px)直铺的合成器通路
// 容器——矩阵同步自持(RO=布局盒变化/MutationObserver=viewBox 变化/fonts.ready),
// 容器一层 transform 包揽布局/换图随动(pan/zoom 已随 #946 退役,取景恒总览定格),子元素零换算跟随。
// 动因:SVG 子元素拿不到合成器层,视口级 SVG 内任何逐帧变动=整幅重绘(低端 WebView
// 掉帧主源);动态内容(棋子/特效)迁入本宿主后,逐帧失效收敛到各件自身小盒。
// 氛围层(ADR-0039)与棋子/特效层(ADR-0042)共用同一同步钩子,单源不复制。
import { memo, useEffect, useRef } from "react";

/** 矩阵同步钩子(AmbientLayer 同款自持生命周期,#608 单源抽取):
 *  每拍一次「读 svg 盒+viewBox → 写容器 transform」,仅在事件拍发生,无常驻逐帧开销。 */
export function useBoardMatrixSync(
  svgRef: React.RefObject<SVGSVGElement | null>,
  rootRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const svg = svgRef.current;
    const el = rootRef.current;
    if (!svg || !el) return;
    const sync = () => syncHostMatrix(svg, el);
    sync();
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(sync);
    });
    const ro = new ResizeObserver(sync);
    ro.observe(svg);
    const mo = new MutationObserver(sync);
    mo.observe(svg, { attributes: true, attributeFilter: ["viewBox"] });
    document.fonts.ready.then(sync);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [svgRef, rootRef]);
}

export const BoardHost = memo(function BoardHost({
  id,
  svgRef,
  className,
  children,
}: {
  /** 宿主 id(=原 SVG 层 g 的 id,如 bv-tokens/bv-fx/bv-flow——useMarch 等
   *  querySelector 消费者的 DOM 契约保号)。 */
  id: string;
  /** 棋盘 svg 根(矩阵同步的 viewBox/尺寸真源)。 */
  svgRef: React.RefObject<SVGSVGElement | null>;
  className?: string;
  children?: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useBoardMatrixSync(svgRef, rootRef);
  return (
    <div
      id={id}
      className={className ? `bv-bhost ${className}` : "bv-bhost"}
      ref={rootRef}
      aria-hidden="true"
    >
      {children}
    </div>
  );
});

/** viewBox→客户端 meet 矩阵(clientWidth 口径,见 ambientMatrix.ts 的 gBCR 教训):
 *  与氛围层同一套换算,抽此单源后 ambientMatrix.ts 退役。 */
export function syncHostMatrix(svg: SVGSVGElement, el: HTMLElement): void {
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

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

/** 「1 逻辑单位 = 多少屏幕像素」缓存(#1024):由 syncHostMatrix 在每个失效拍烤定
 *  ——挂载初始同步/双 RAF/ResizeObserver/viewBox MutationObserver/fonts.ready 全走
 *  syncHostMatrix,全仓一个事实源,不另造失效机械。消费方渲染期只读缓存,绝不触
 *  DOM:render 期 gBCR/gCS 在刚写过 DOM 后布局必脏,强制整页同步布局。 */
let pxPerUnitCache: number | null = null;

/** 缓存读数(零 DOM 触碰):null = 缓存尚未烤定——只应出现在首挂渲染期(底板 svg
 *  尚未入 DOM,同步钩子未跑),消费方以基准初始值渲染,commit 拍经
 *  ensureBoardPxPerUnit 取真值修正。 */
export function boardPxPerUnit(): number | null {
  return pxPerUnitCache;
}

/** commit 拍真值(useLayoutEffect 通路):从底板 svg 几何烤定并回填缓存——每挂载
 *  只调一次,恒重烤不短路:缓存跨卸载存活,短路会在「上局缓存+本局视口已变」时把
 *  真值降级成上会话值(评审 #1022-#1024 修复)。svg 缺席或几何不可用 = 对局屏
 *  接线 bug,显式炸出(零兜底)——本函数只在 commit 拍调,彼时底板 svg 必已随
 *  同一 commit 入 DOM,取不到就是接线错。 */
export function ensureBoardPxPerUnit(svg: SVGSVGElement | null): number {
  if (!svg) throw new Error("ensureBoardPxPerUnit:底板 svg 缺席(对局屏接线 bug)");
  const m = boardMeetMetrics(svg);
  if (!m) throw new Error("ensureBoardPxPerUnit:底板 viewBox/客户尺寸不可用(接线 bug)");
  pxPerUnitCache = m.scale;
  return m.scale;
}

/** viewBox→meet 几何一次解析:viewBox 原点/尺寸、svg 客户尺寸与等比缩放
 *  (scale = 1 逻辑单位的屏幕像素,min(两向比),preserveAspectRatio="xMidYMid meet"
 *  同式)。viewBox 缺失或任一几何量非正 = null,由调用方分诊:矩阵同步静默早退
 *  (挂载早期的既有行为),commit 拍真值读数炸出接线 bug。 */
function boardMeetMetrics(svg: SVGSVGElement): {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  cw: number;
  ch: number;
  scale: number;
} | null {
  const raw = svg.getAttribute("viewBox");
  if (!raw) return null;
  const [vx, vy, vw, vh] = raw.split(/[\s,]+/).map(Number);
  const cw = svg.clientWidth;
  const ch = svg.clientHeight;
  if (!(vw > 0) || !(vh > 0) || !(cw > 0) || !(ch > 0)) return null;
  return { vx, vy, vw, vh, cw, ch, scale: Math.min(cw / vw, ch / vh) };
}

/** viewBox→客户端 meet 矩阵(clientWidth 口径,见 ambientMatrix.ts 的 gBCR 教训):
 *  与氛围层同一套换算,抽此单源后 ambientMatrix.ts 退役。#1024 起缩放缓存在此
 *  同拍烤定(所有失效拍的必经点)。 */
function syncHostMatrix(svg: SVGSVGElement, el: HTMLElement): void {
  const m = boardMeetMetrics(svg);
  if (!m) return;
  pxPerUnitCache = m.scale;
  // preserveAspectRatio="xMidYMid meet" 的等比换算:内容居中
  const ox = (m.cw - m.vw * m.scale) / 2;
  const oy = (m.ch - m.vh * m.scale) / 2;
  el.style.transform = `translate(${ox - m.vx * m.scale}px, ${oy - m.vy * m.scale}px) scale(${m.scale})`;
}

// 棋盘氛围层(ADR-0039):状态驱动常驻装饰的 HTML 合成层——都城光晕/活跃格虚线环/
// 旌旗/自机微光/回合方金环。动画只走 transform/opacity(Blink 对 HTML 元素的可合成
// 属性走合成器线程,主线程零逐帧参与),与棋盘 SVG 分野——SVG 子元素逐帧变动令整张
// SVG 每帧重算(layout+restyle),是低端 WebView 掉帧根因(ADR-0039 归因)。
//
// 行军换装:行军接管期(skipTokenIds 在册)该棋子的旗/微光/金环暂隐——行军强调已有
// 金边拖影+落脚指示环(#30),落定即回(同一响应式 marching 集,无逐帧同步)。
// 旌旗缓倒仪式(desk.ts fallTokenFlag)改查 [data-amb-flag],一次性动画照挂本层节点。
//
// 落点 = TokenLayer 同源槽位公式(computeTokenSlots,单源不复制 #608);层容器
// transform 由 usePanZoom.apply() 同拍写入(ambientMatrix),pan/zoom/resize 全随动。
// 层内 z 序(DOM 序,复刻原 SVG 绘制序):光晕 → 活跃格环 → 自机微光 → 回合金环 → 旌旗。
import { memo, useEffect, useRef } from "react";
import type { Board } from "@core/board";
import { Theme, playerColor, rgba } from "@core/theme";
import { TILE_SCALE } from "./Tile";
import { FlagShapes } from "./flagArt";
import { syncAmbientMatrix } from "./ambientMatrix";
import { TOKEN_CROWD_SCALE, TOKEN_SCALE, computeTokenSlots, type TokenSlot } from "./TokenLayer";
import type { BoardPlayer } from "./BoardView";
import "./ambient.css";

/** 旗面 SVG 盒(旗面局部坐标):锚点(0,0)= 旗杆底,盒内位置 (10,40)
 *  (ambient.css transform-origin 同值);盒含摇曳 ±1.5° 摆幅余量。 */
const FLAG_BOX = { x: -10, y: -40, w: 44, h: 54 } as const;

function AmbientFlag({ slot }: { slot: TokenSlot }) {
  const p = slot.player;
  return (
    <div
      className="bv-amb-anchor"
      style={{ left: slot.x, top: slot.y, opacity: slot.opacity }}
      data-amb-flag={p.id}
    >
      <div
        className="bv-amb-fit"
        style={{
          width: FLAG_BOX.w,
          height: FLAG_BOX.h,
          marginLeft: FLAG_BOX.x,
          marginTop: FLAG_BOX.y,
          transformOrigin: `${-FLAG_BOX.x}px ${-FLAG_BOX.y}px`,
          transform: `scale(${TOKEN_SCALE * (slot.crowded ? TOKEN_CROWD_SCALE : 1)})`,
        }}
      >
        {/* 旗面形制单源 flagArt(与行军换装期棋子层静态旗同源,防美术漂移) */}
        <svg
          className="bv-amb-flag"
          width={FLAG_BOX.w}
          height={FLAG_BOX.h}
          viewBox={`${FLAG_BOX.x} ${FLAG_BOX.y} ${FLAG_BOX.w} ${FLAG_BOX.h}`}
        >
          <FlagShapes p={p} />
        </svg>
      </div>
    </div>
  );
}

export interface AmbientLayerProps {
  board: Board;
  players: BoardPlayer[];
  /** 有主都城的格索引集(BoardView 从 tileStates 单源派生)。 */
  capitalTileIndexes: readonly number[];
  /** 活跃格(「轮到谁」虚线环所在格)。 */
  activeTileIndex?: number | null;
  /** #762 当前回合方玩家 id(棋子金呼吸环)。 */
  activePlayerId?: string;
  /** L47:本地视角玩家 id(自己棋子玩家色微光圈)。 */
  mineId?: string;
  /** 行军动画接管中的玩家 id(换装:该棋子的旗/微光/金环暂隐)。 */
  skipTokenIds?: ReadonlySet<string>;
  /** setup 阶段未选都不显示棋子装饰。 */
  setupUnselected: boolean;
  /** 棋盘 svg 根(矩阵同步的 viewBox/尺寸真源)。 */
  svgRef: React.RefObject<SVGSVGElement | null>;
}

export const AmbientLayer = memo(function AmbientLayer({
  board,
  players,
  capitalTileIndexes,
  activeTileIndex,
  activePlayerId,
  mineId,
  skipTokenIds,
  setupUnselected,
  svgRef,
}: AmbientLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 矩阵同步自持(ADR-0039):层容器 transform 不走 React——svg 尺寸变化(RO)、
  // viewBox 变化(pan/zoom/复位/换图全走 setAttribute,MutationObserver 一网打尽)、
  // 字体就绪与挂载头两帧(布局沉降竞态)各自触发重算;每拍一次「读盒+写容器」,
  // 仅在这些事件发生时发生,无常驻逐帧开销。
  useEffect(() => {
    const svg = svgRef.current;
    const el = rootRef.current;
    if (!svg || !el) return;
    const sync = () => syncAmbientMatrix(svg, el);
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
  }, [svgRef]);

  const slots = computeTokenSlots(board, players, {
    setupUnselected,
    skipTokenIds,
    mineId,
    activeId: activePlayerId,
  });
  // 行军换装:接管中的棋子装饰暂隐(#30 行军强调补位);未选都(opacity 0)不渲染。
  const resting = slots.filter((s) => !s.marching && s.opacity > 0);
  const activeSlot = resting.find((s) => s.player.id === activePlayerId);
  const activeTile = activeTileIndex != null ? board.tiles[activeTileIndex] : undefined;

  return (
    <div className="bv-ambient" ref={rootRef} aria-hidden="true">
      {" "}
      {/* 共享 defs:都城光晕渐变(引用 BoardDefs 同文档单源)+ 城台形挖孔 mask
          (逐像素复刻「亮心被城台遮挡、只露外圈」的原观感;孔形=城池方牌)。
          跨 svg url 引用同文档必然解析(TileThumb 同法先例)。 */}
      <svg className="bv-amb-defs" width={0} height={0} aria-hidden="true">
        <defs>
          <mask
            id="bv-amb-capital-hole"
            maskUnits="userSpaceOnUse"
            x={-70}
            y={-70}
            width={140}
            height={140}
          >
            <rect x={-70} y={-70} width={140} height={140} fill="#fff" />
            <rect x={-52} y={-44} width={104} height={88} rx={10} fill="#000" />
          </mask>
        </defs>
      </svg>
      {/* 都城光晕(原 Tile 内 bv-capital-glow,脉动随层) */}
      {capitalTileIndexes.map((idx) => {
        const t = board.tiles[idx];
        if (!t) return null;
        return (
          <div
            key={`glow-${idx}`}
            className="bv-amb-anchor"
            style={{ left: t.position.x, top: t.position.y }}
          >
            <div
              className="bv-amb-fit"
              style={{
                width: 140,
                height: 140,
                marginLeft: -70,
                marginTop: -70,
                transform: `scale(${TILE_SCALE})`,
              }}
            >
              <svg
                className="bv-amb-capital-glow"
                width={140}
                height={140}
                viewBox="-70 -70 140 140"
              >
                <circle r={70} fill="url(#bv-capital-glow-grad)" mask="url(#bv-amb-capital-hole)" />
              </svg>
            </div>
          </div>
        );
      })}
      {/* 活跃格虚线环(原 Tile 内 bv-active-ring;dashoffset 改整环 rotate 等效,
          时长换算:虚线周期 21 单位/1.3s → r=80 周长 502.7 单位 → 31.12s/圈,同向顺时) */}
      {activeTile && (
        <div
          className="bv-amb-anchor"
          style={{ left: activeTile.position.x, top: activeTile.position.y }}
        >
          <div
            className="bv-amb-fit"
            style={{
              width: 172,
              height: 172,
              marginLeft: -86,
              marginTop: -86,
              transform: `scale(${TILE_SCALE})`,
            }}
          >
            <svg className="bv-amb-tile-ring" width={172} height={172} viewBox="-86 -86 172 172">
              <circle
                r={80}
                fill="none"
                stroke={rgba(Theme.goldBright, 0.85)}
                strokeWidth={3}
                strokeDasharray="12 9"
              />
            </svg>
          </div>
        </div>
      )}
      {/* 自机微光(L47,#557 主环加粗 + 同色细外圈) */}
      {resting.map((s) => {
        if (!s.mine) return null;
        const c = playerColor(s.player.colorIndex);
        return (
          <div
            key={`halo-${s.player.id}`}
            className="bv-amb-anchor"
            style={{ left: s.x, top: s.y, opacity: s.opacity }}
          >
            <div
              className="bv-amb-fit"
              style={{
                width: 48,
                height: 48,
                marginLeft: -24,
                marginTop: -24,
                transform: `scale(${TOKEN_SCALE * (s.crowded ? TOKEN_CROWD_SCALE : 1)})`,
              }}
            >
              <svg className="bv-amb-mine-halo" width={48} height={48} viewBox="-24 -24 48 48">
                <circle r={15} fill="none" stroke={rgba(c, 0.6)} strokeWidth={3.5} />
                <circle r={20} fill="none" stroke={rgba(c, 0.32)} strokeWidth={1.5} />
              </svg>
            </div>
          </div>
        );
      })}
      {/* 回合方金呼吸环(#762/#840:呼吸中程不隐形;同时至多一枚) */}
      {activeSlot && (
        <div className="bv-amb-anchor" style={{ left: activeSlot.x, top: activeSlot.y }}>
          <div
            className="bv-amb-fit"
            style={{
              width: 44,
              height: 44,
              marginLeft: -22,
              marginTop: -22,
              transform: `scale(${TOKEN_SCALE * (activeSlot.crowded ? TOKEN_CROWD_SCALE : 1)})`,
            }}
          >
            <svg className="bv-amb-token-ring" width={44} height={44} viewBox="-22 -22 44 44">
              <circle r={18} fill="none" stroke={rgba(Theme.goldBright, 0.9)} strokeWidth={1.5} />
            </svg>
          </div>
        </div>
      )}
      {/* 旌旗(原 TokenLayer TokenFlag 逐笔搬迁;z 序最顶,与原旗在 token 内最顶一致) */}
      {resting.map((s) => (
        <AmbientFlag key={`flag-${s.player.id}`} slot={s} />
      ))}
    </div>
  );
});

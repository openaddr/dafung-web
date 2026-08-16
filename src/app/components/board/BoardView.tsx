// React 版棋盘(阶段 4):整体结构对照 src/render/board.ts 的 createBoardSvg。
//   defs 滤镜/远山河川/驿道 → 静态 memo 子组件(地图不变即不重渲)
//   40 城池 → Tile(状态 props 驱动,React.memo 逐城重渲)
//   棋子 → TokenLayer(CSS transform + transition 平滑过渡)
//   pan/zoom → usePanZoom(viewBox)
// 旧 src/render/board.ts 保留作视觉对照,勿删。
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { MapData } from "@core/types";
import { loadMap } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { BoardDefs, RoadsLayer, TerrainLayer } from "./StaticLayers";
import { Tile } from "./Tile";
import type { TileVisualState } from "./Tile";
import { TokenLayer } from "./TokenLayer";
import { panCursorClass, usePanZoom } from "./usePanZoom";
import "./board.css";

/** BoardView/TokenLayer 真正消费的玩家最小结构(棋盘渲染只需这些字段):
 *  快照玩家 SnapshotPlayer 是本接口的结构子集,可直接透传——原先 GameScreen 用双重断言
 *  把快照玩家冒充完整 Player(heroes/treasures 等字段棋盘并不消费),按真实消费面
 *  声明后断言即可消灭。 */
export interface BoardPlayer {
  id: string;
  guohao: string;
  colorIndex: number;
  position: number;
  /** 在分岔辅路第几格(null=在主路)。 */
  onBranch: { step: number } | null;
  /** 都城主路索引(-1=未选都)。 */
  capitalIndex: number;
  isBankrupt: boolean;
  /** 持有城(棋盘只用 propertyId/level 推导归属色与等级)。 */
  properties: { propertyId: string; level: number }[];
}

export interface BoardViewProps {
  /** 地图数据(MapData JSON);内部经 loadMap 构建 Board/catalog。 */
  map: MapData;
  /** 全体玩家(归属/都城/棋子位置皆由此派生)。 */
  players: BoardPlayer[];
  /** 当前视角座位 id(预留给镜头跟随/权限判定;当前渲染未用)。 */
  viewSeat?: string;
  /** 点击城池回调(索引)。 */
  onTileClick?: (index: number) => void;
  /** 可交互高亮城池集合(如选都阶段的可选都城)。 */
  selectableTiles?: ReadonlySet<number>;
  /** 当前回合玩家所在城池索引(脉动金环)。 */
  activeTileIndex?: number | null;
  /** 选都阶段标记(已选城标灰、未选都玩家隐藏棋子)。 */
  isSetupPhase?: boolean;
  /** 行军动画接管中的棋子(阶段 6):从声明式定位中剔除。 */
  skipTokenIds?: ReadonlySet<string>;
  /** 暴露棋子层 <g>(阶段 6 动画挂点)。 */
  tokenLayerRef?: React.Ref<SVGGElement>;
  className?: string;
}

/** ref 命令式句柄:还原总览视图(等价旧 BoardView.resetView)。 */
export interface BoardViewHandle {
  reset: () => void;
}

const TileLayer = memo(function TileLayerInner({
  children,
  onHover,
}: {
  children: React.ReactNode;
  onHover: (index: number | null) => void;
}) {
  // 城池接近重叠时:悬停哪个提到最上层(SVG 无 z-index,后渲染=上层)。
  // 仅在未按下按键(buttons===0)时重排 —— 按下期间的重排会把 pointerdown 目标节点
  // 移走导致 Chrome 吞掉 click(旧 board.ts 已踩过的坑,忠实保留此守卫)。
  const handleOver = useCallback(
    (ev: React.PointerEvent<SVGGElement>) => {
      if (ev.buttons !== 0) return;
      const t = (ev.target as Element).closest(".bv-tile");
      onHover(t ? Number((t as Element).getAttribute("data-tile")) : null);
    },
    [onHover],
  );
  return (
    <g id="bv-tiles" onPointerOver={handleOver}>
      {children}
    </g>
  );
});

export const BoardView = forwardRef<BoardViewHandle, BoardViewProps>(function BoardView({
  map,
  players,
  viewSeat,
  onTileClick,
  selectableTiles,
  activeTileIndex,
  isSetupPhase = false,
  skipTokenIds,
  tokenLayerRef,
  className,
}, ref) {
  void viewSeat; // 预留:当前渲染不区分视角
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { viewBox, handlers, grabbing, reset } = usePanZoom(svgRef);
  useImperativeHandle(ref, () => ({ reset }), [reset]);
  const [hoverTile, setHoverTile] = useState<number | null>(null);

  // 地图 → Board/catalog(地图引用不变则不重建;道路避城弧线计算在 RoadsLayer 内做)
  const loaded = useMemo(() => loadMap(map), [map]);

  // propertyId → 持有 {player, level}(players 变化才重算)
  const holdings = useMemo(() => {
    const m = new Map<string, { colorIndex: number; guohao: string; level: number }>();
    for (const p of players) {
      for (const h of p.properties) {
        if (!m.has(h.propertyId)) m.set(h.propertyId, { colorIndex: p.colorIndex, guohao: p.guohao, level: h.level });
      }
    }
    return m;
  }, [players]);

  const handleTileClick = useMemo(() => (onTileClick ? (i: number) => onTileClick(i) : undefined), [onTileClick]);

  // 悬停的城排到最后(=最上层),其余保持索引序,避免 hover 时整层乱序跳动
  const orderedTiles = useMemo(() => {
    const list = loaded.board.tiles;
    if (hoverTile == null) return list;
    return [...list.filter((t) => t.index !== hoverTile), ...list.filter((t) => t.index === hoverTile)];
  }, [loaded.board.tiles, hoverTile]);

  const tiles = (
    <>
      {orderedTiles.map((tile) => {
        const def = loaded.catalog.get(tile.propertyId);
        const holding = tile.propertyId ? holdings.get(tile.propertyId) : undefined;
        const capitalP = players.find((p) => p.capitalIndex === tile.index) ?? null;
        const state: TileVisualState = {
          ownerColorIndex: holding ? holding.colorIndex : null,
          ownerGuohao: holding ? holding.guohao : null,
          level: holding?.level ?? 0,
          capitalColorIndex: capitalP ? capitalP.colorIndex : null,
          capitalGuohao: capitalP ? capitalP.guohao : null,
          isActive: activeTileIndex === tile.index,
          isTaken: !!(isSetupPhase && capitalP),
          isSelectable: selectableTiles?.has(tile.index) ?? false,
        };
        return (
          <Tile
            key={tile.index}
            tile={tile}
            group={def?.group ?? ""}
            price={def ? formatMoney(def.purchasePrice) : ""}
            state={state}
            onClick={handleTileClick ?? undefined}
          />
        );
      })}
    </>
  );

  return (
    <svg
      id="board"
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={`${panCursorClass(grabbing)} block h-full w-full select-none ${className ?? ""}`}
      {...handlers}
    >
      <BoardDefs />
      <TerrainLayer />
      <RoadsLayer board={loaded.board} />
      <TileLayer onHover={setHoverTile}>{tiles}</TileLayer>
      <TokenLayer
        board={loaded.board}
        players={players}
        setupUnselected={isSetupPhase}
        skipTokenIds={skipTokenIds}
        layerRef={tokenLayerRef}
      />
      {/* 特效层挂点(阶段 5/6:floater/coin 文本与道路流光),保持与旧版同顺序置于最上 */}
      <g id="bv-fx" data-fx-layer="" />
      <g id="bv-flow" data-flow-layer="" />
    </svg>
  );
});

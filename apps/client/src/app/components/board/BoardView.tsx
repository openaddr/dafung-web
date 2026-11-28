// 棋盘装配：底板 Canvas，触达和等级徽记走轻量 SVG，棋子与特效走独立宿主。
import { useMemo, useRef } from "react";
import type { Board } from "@dafung/core/engine/board";
import type { BoardSeat, SeatBoard } from "@dafung/core/protocol/seat-queries";
import { AmbientLayer } from "./AmbientLayer";
import { computeFitView } from "./board-viewport";
import { CanvasBoard } from "./CanvasBoard";
import { BoardHost } from "./boardHost";
import type { CityScene, TileVisualState } from "./city-scene";
import { TokenLayer, type PawnTargets } from "./TokenLayer";
import { BoardFxLayer } from "@app/fx/FxLayer";
import "./board.css";

export type BoardPlayer = BoardSeat;

interface BoardViewProps {
  board: Board;
  seatBoard: SeatBoard;
  /** 当前视角玩家 id(L47:自己棋子加玩家色微光圈;未开局不传)。 */
  viewSeat?: string;
  /** 点击城池回调(索引)。 */
  onTileClick?: (index: number) => void;
  onFirstPaint?: (error?: string) => void;
  /** 可交互高亮城池集合(如选都阶段轮到本地的候选)。 */
  selectableTiles?: ReadonlySet<number>;
  /** 目标段选城候选(#1388 T2):主动技城目标段的合法城格集(引擎 choices 城选项,
   *  可用性已闸)——金环呼吸复用选都氛围 crown 通路,选中格出列改实金停持环;
   *  格上另挂 data-city-target 契约(e2e/选择器单源)。 */
  cityTargetTiles?: ReadonlySet<number>;
  /** 目标段选城·选中格(#1388 T2,#417 同族:首点选中/再点取消/点他城改选);
   *  null=未选中。 */
  cityPickedTileIndex?: number | null;
  /** X4(#23) 选都候选集(引擎 offeredCapitals,滚出顺序):全座位可见——
   *  静态低透明金圈 + 壹贰叁序号印是全座档;「轮到本地可点脉冲」由 selectableTiles 升档。 */
  candidateTiles?: readonly number[];
  /** 当前回合玩家所在城池索引(金描边高亮:Tile bv-tile-border 的 isActive 态)。 */
  activeTileIndex?: number | null;
  /** 选都阶段标记(已选城标灰、未选都玩家隐藏棋子)。 */
  isSetupPhase?: boolean;
  /** 行军动画接管中的棋子(阶段 6):从声明式定位中剔除。 */
  skipTokenIds?: ReadonlySet<string>;
  /** 目标段的候选棋子、草选与点按动作。 */
  pawnTargets?: PawnTargets;
  /** #762 当前回合方玩家 id(棋子金呼吸环,「谁在打」的棋盘锚;透传 TokenLayer)。 */
  activePlayerId?: string;
  className?: string;
}

/** TileVisualState 值等(#1023 链 A):键循环浅等,全字段皆原始值——引擎每次 sync
 *  产出新 players 数组,按引用算必然 44 城全新对象、逐城击穿 Tile 的 React.memo;
 *  值等判定让「内容没变的城」复用上一份对象引用,memo 不再被击穿。键循环而非手抄
 *  字段表:类型增字段自动纳入比较,手抄会在类型增长时静默漏比(评审修复)。 */
function tileStateEqual(a: TileVisualState, b: TileVisualState): boolean {
  for (const key in a) {
    if (a[key as keyof TileVisualState] !== b[key as keyof TileVisualState]) {
      return false;
    }
  }
  return true;
}

export function BoardView({
  board,
  seatBoard,
  viewSeat,
  onTileClick,
  onFirstPaint,
  selectableTiles,
  cityTargetTiles,
  cityPickedTileIndex,
  candidateTiles,
  activeTileIndex,
  isSetupPhase = false,
  skipTokenIds,
  pawnTargets,
  activePlayerId,
  className,
}: BoardViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 目标段选城(#1388 T2)两路候选集:全集(selectableFull)供格态 isSelectable——
  // 选中格保持 bv-selectable 类,聚焦压暗(:has 规则的 :not(.bv-selectable) 例外)
  // 不吃它;呼吸 crown 出列集(targetCrowns)=全集摘选中格,实金停持环即位(Tile)。
  const selectableFull = cityTargetTiles ?? selectableTiles;
  const targetCrowns = useMemo(() => {
    if (cityTargetTiles == null) return selectableTiles;
    if (cityPickedTileIndex == null || !cityTargetTiles.has(cityPickedTileIndex))
      return cityTargetTiles;
    const minus = new Set(cityTargetTiles);
    minus.delete(cityPickedTileIndex);
    return minus;
  }, [cityTargetTiles, cityPickedTileIndex, selectableTiles]);
  // ADR-0027:总览视口按当图城池包围盒动态推导(不再硬编码 FIT_VIEW),地图引用不变
  // 则视口不变;#946 取景恒定格于此——viewBox 由 React 声明式下发(底板 svg 同一
  // fitBox 落 DOM,宿主矩阵同源见 boardHost),拖动/滚轮/捏合全形态删,无第二写入者。
  // (驿道恒直线 #928/ADR-0044,绘制在 RoadsLayer 内做)
  const fit = useMemo(() => computeFitView(board.tiles), [board.tiles]);

  // X4(#23) 候选序号表:滚出顺序 → 1 基序号(Tile 内读作 壹/贰/叁 印)。
  const candidateOrder = useMemo(() => {
    const m = new Map<number, number>();
    candidateTiles?.forEach((idx, i) => m.set(idx, i + 1));
    return m;
  }, [candidateTiles]);

  // 城池的绘制输入值等时复用原对象，银两等变化不会触发棋盘重新绘制。
  const previousCities = useRef<CityScene[]>([]);
  const cities = useMemo(() => {
    const previous = previousCities.current;
    const next = seatBoard.cities.map(({ tile, property, owner, capital }, index) => {
      const state: TileVisualState = {
        ownerColorIndex: owner?.colorIndex ?? null,
        ownerGuohao: owner?.guohao ?? null,
        level: owner?.level ?? null,
        capitalColorIndex: capital?.colorIndex ?? null,
        capitalGuohao: capital?.guohao ?? null,
        isActive: activeTileIndex === tile.index,
        isTaken: isSetupPhase && capital !== null,
        isSelectable: selectableFull?.has(tile.index) ?? false,
        capitalCandidateOrder: candidateOrder.get(tile.index) ?? null,
        isCityTarget: cityTargetTiles?.has(tile.index) ?? false,
        isCityPicked: cityPickedTileIndex === tile.index,
        defense: owner?.defense ?? null,
        fireMarks: owner?.burning?.marks ?? 0,
        fireProgress: owner?.burning?.progress ?? 0,
      };
      const stable = previous[index];
      return stable?.tile === tile &&
        stable.tier === property.tier &&
        tileStateEqual(stable.state, state)
        ? stable
        : { tile, tier: property.tier, state };
    });
    if (previous.length === next.length && next.every((city, index) => city === previous[index]))
      return previous;
    previousCities.current = next;
    return next;
  }, [
    seatBoard.cities,
    activeTileIndex,
    isSetupPhase,
    selectableFull,
    candidateOrder,
    cityTargetTiles,
    cityPickedTileIndex,
  ]);

  // 氛围层的光晕落点与城格都读同一个座位查询。
  const capitalTileIndexes = useMemo(
    () =>
      cities.filter(({ state }) => state.capitalColorIndex !== null).map(({ tile }) => tile.index),
    [cities],
  );

  return (
    <div className={`bv-stack ${className ?? ""}`}>
      <CanvasBoard
        svgRef={svgRef}
        board={board}
        fit={fit}
        cities={cities}
        onTileClick={onTileClick}
        onFirstPaint={onFirstPaint}
      />
      {/* 棋子层(HTML 宿主,ADR-0042):每棋子一个合成器提升的包装 div(transform
          过渡走合成器)+ mini-svg 旗面/环原绘;宿主矩阵与底板 viewBox 同拍跟随。 */}
      <TokenLayer
        board={board}
        players={seatBoard.seats}
        setupUnselected={isSetupPhase}
        skipTokenIds={skipTokenIds}
        /* L47:视角玩家 id → 自己棋子玩家色微光圈 */
        mineId={viewSeat}
        targets={pawnTargets}
        /* #762 当前回合方:棋子金呼吸环(与常驻回合胶囊双锚点「谁在打」) */
        activeId={activePlayerId}
        svgRef={svgRef}
      />
      {/* 特效层挂点(HTML 宿主,ADR-0042):浮字/印章/铜钱各自 mini-svg,置于棋子上;
          世界坐标直铺,随宿主矩阵跟随。D1 注释沿革:曾直画进 SVG(坐标系与棋盘一致,
          恒总览取景不脱锚)——HTML 宿主矩阵同步承接同一保证。 */}
      <BoardFxLayer svgRef={svgRef} board={board} fit={fit} />
      {/* 驿道流光宿主(#bv-flow 保号):useMarch.highlightSegment 命令式追加 mini-svg。 */}
      <BoardHost id="bv-flow" svgRef={svgRef} />
      {/* 氛围层(ADR-0039):常驻装饰的 HTML 合成层,DOM 序居最上(pointer-events
          none);矩阵同步自持(RO/viewBox MutationObserver/字体就绪,见 AmbientLayer)。 */}
      <AmbientLayer
        board={board}
        players={seatBoard.seats}
        capitalTileIndexes={capitalTileIndexes}
        activePlayerId={activePlayerId}
        mineId={viewSeat}
        skipTokenIds={skipTokenIds}
        /* 呼吸 crown 集(#1388 T2 目标段选城并入:候选出列选中格停持;选都期即原集) */
        selectableTiles={targetCrowns}
        setupUnselected={isSetupPhase}
        svgRef={svgRef}
      />
    </div>
  );
}

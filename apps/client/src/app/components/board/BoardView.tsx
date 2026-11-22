// 棋盘装配：底板 Canvas，触达和等级徽记走轻量 SVG，棋子与特效走独立宿主。
import { useMemo, useRef } from "react";
import type { PropertyHolding } from "@dafung/core/engine/model";
import { getControllerContext } from "@app/controllers/registry";
import { AmbientLayer } from "./AmbientLayer";
import { computeFitView } from "./board-viewport";
import { CanvasBoard } from "./CanvasBoard";
import { BoardHost } from "./boardHost";
import type { CityScene, TileVisualState } from "./city-scene";
import { capitalHolderOf, holdingsOf, type TileHolding } from "./tileOwnership";
import { TokenLayer } from "./TokenLayer";
import { BoardFxLayer } from "@app/fx/FxLayer";
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
  /** 都城主路索引(-1=未选都)。 */
  capitalIndex: number;
  isBankrupt: boolean;
  /** 持有城(棋盘只用 propertyId/level/defense 推导归属色、等级徽记与防御盾)。
   */
  properties: Pick<PropertyHolding, "propertyId" | "level" | "defense" | "burning">[];
}

interface BoardViewProps {
  /** 全体玩家(归属/都城/棋子位置皆由此派生)。 */
  players: BoardPlayer[];
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
  /** #256 目标段:候选呼吸的棋子 id 集(available 候选席位;透传 TokenLayer)。 */
  targetedPlayerIds?: ReadonlySet<string>;
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

/** holdings 逐城浅等(#1023 链 A):内容键不含 position(行军只改 position,归属/
 *  等级才是 holdings 的输入),players 换引用而归属没变时复用上一份 Map。 */
function holdingsEqual(a: Map<string, TileHolding>, b: Map<string, TileHolding>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, hb] of b) {
    const ha = a.get(key);
    if (
      ha === undefined ||
      ha.colorIndex !== hb.colorIndex ||
      ha.guohao !== hb.guohao ||
      ha.level !== hb.level ||
      ha.defense !== hb.defense ||
      ha.burning?.marks !== hb.burning?.marks ||
      ha.burning?.progress !== hb.burning?.progress
    )
      return false;
  }
  return true;
}

export function BoardView({
  players,
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
  targetedPlayerIds,
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
  // Board/catalog 直接吃 registry 现成对局上下文(#1273):两者是引擎构造入参、对局期
  // 不可变(换局随 setController 整体换新),不再从原始 JSON 第二次全量 loadMap——
  // 开局链上的同图双析就此消失。仅 GameScreenLive 挂载(已守卫 controller 就位),
  // 与 CityLedgerModal/WarlordsOverview 同款 `!` 口径。
  const { board, catalog } = getControllerContext()!;
  // ADR-0027:总览视口按当图城池包围盒动态推导(不再硬编码 FIT_VIEW),地图引用不变
  // 则视口不变;#946 取景恒定格于此——viewBox 由 React 声明式下发(底板 svg 同一
  // fitBox 落 DOM,宿主矩阵同源见 boardHost),拖动/滚轮/捏合全形态删,无第二写入者。
  // (驿道恒直线 #928/ADR-0044,绘制在 RoadsLayer 内做)
  const fit = useMemo(() => computeFitView(board.tiles), [board.tiles]);
  // propertyId → 首见持有者(归属判定单源 tileOwnership.ts,players 变化才重算)。
  // #1023 链 A:每次照算但与上一份逐城浅等,内容不变复用上一份 Map 引用——
  // 归属没变(行军/换回合)时不给下游派生链制造新身份。
  const prevHoldingsRef = useRef<Map<string, TileHolding> | null>(null);
  const holdings = useMemo(() => {
    const next = holdingsOf(players);
    const prev = prevHoldingsRef.current;
    if (prev !== null && holdingsEqual(prev, next)) return prev;
    prevHoldingsRef.current = next;
    return next;
  }, [players]);

  // X4(#23) 候选序号表:滚出顺序 → 1 基序号(Tile 内读作 壹/贰/叁 印)。
  const candidateOrder = useMemo(() => {
    const m = new Map<number, number>();
    candidateTiles?.forEach((idx, i) => m.set(idx, i + 1));
    return m;
  }, [candidateTiles]);

  // F1:TileVisualState 按 index 预生成并 memo——原先每次 render 内联新建对象,
  // 击穿 Tile 的 React.memo 导致 40 城全量重渲;现在只有 players/回合/可选集变化
  // 才重建(state 对象身份稳定)。
  // #1023 链 A:players 每 sync 换新引用,memo 依赖拦不住——照算之后逐城与上一份
  // 浅等,内容不变复用上一份对象引用;全部复用时整表返回上一份(下游 tiles/
  // capitalTileIndexes 派生链连重建都不必)。上一份存本组件 ref,复杂度不出 BoardView。
  const prevStatesRef = useRef<Map<number, TileVisualState> | null>(null);
  const tileStates = useMemo(() => {
    const prev = prevStatesRef.current;
    const m = new Map<number, TileVisualState>();
    let allReused = prev !== null && prev.size === board.tiles.length;
    for (const tile of board.tiles) {
      const holding = tile.propertyId ? holdings.get(tile.propertyId) : undefined;
      const capitalP = capitalHolderOf(players, tile.index);
      const next: TileVisualState = {
        ownerColorIndex: holding ? holding.colorIndex : null,
        ownerGuohao: holding ? holding.guohao : null,
        level: holding ? holding.level : null,
        capitalColorIndex: capitalP ? capitalP.colorIndex : null,
        capitalGuohao: capitalP ? capitalP.guohao : null,
        isActive: activeTileIndex === tile.index,
        isTaken: !!(isSetupPhase && capitalP),
        isSelectable: selectableFull?.has(tile.index) ?? false,
        capitalCandidateOrder: candidateOrder.get(tile.index) ?? null,
        isCityTarget: cityTargetTiles?.has(tile.index) ?? false,
        isCityPicked: cityPickedTileIndex === tile.index,
        // 防御盾直读持有账面当前值，无主城无防御值。
        defense: holding ? holding.defense : null,
        fireMarks: holding?.burning?.marks ?? 0,
        fireProgress: holding?.burning?.progress ?? 0,
      };
      const stable = prev?.get(tile.index);
      if (stable !== undefined && tileStateEqual(stable, next)) {
        m.set(tile.index, stable);
      } else {
        m.set(tile.index, next);
        allReused = false;
      }
    }
    if (allReused && prev !== null) {
      prevStatesRef.current = prev;
      return prev;
    }
    prevStatesRef.current = m;
    return m;
  }, [
    board.tiles,
    holdings,
    players,
    activeTileIndex,
    isSetupPhase,
    selectableFull,
    candidateOrder,
    cityTargetTiles,
    cityPickedTileIndex,
  ]);

  const cities = useMemo<CityScene[]>(
    () =>
      board.tiles.map((tile) => {
        const def = catalog.get(tile.propertyId)!;
        return { tile, tier: def.tier, state: tileStates.get(tile.index)! };
      }),
    [board.tiles, catalog, tileStates],
  );

  // 有主都城格序(氛围层光晕落点;tileStates 单源派生,与 Tile 的 isCapital 同口径)
  const capitalTileIndexes = useMemo(
    () =>
      board.tiles
        .filter((t) => tileStates.get(t.index)?.capitalColorIndex != null)
        .map((t) => t.index),
    [board.tiles, tileStates],
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
        players={players}
        setupUnselected={isSetupPhase}
        skipTokenIds={skipTokenIds}
        /* L47:视角玩家 id → 自己棋子玩家色微光圈 */
        mineId={viewSeat}
        /* #256 目标段:候选棋子金虚线环呼吸(与席位格金圈同步) */
        targetedIds={targetedPlayerIds}
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
        players={players}
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

// 组件收口:器物豁免(永久)——棋盘器物件,交互收口规则不适用(细则 docs/design/组件收口.md)
// React 版棋盘(阶段 4):整体结构对照旧 src/render/board.ts 的 createBoardSvg(对照件已删)。
//   defs 滤镜/远山河川/驿道 → 静态 memo 子组件(地图不变即不重渲)
//   40 城池 → Tile(状态 props 驱动,React.memo 逐城重渲)
//   棋子/特效 → HTML 宿主层(ADR-0042,合成器通路;棋子 transform 过渡/环动画不再
//   令整张 SVG 每帧失效)
//   取景 → 恒 computeFitView 总览定格(#946 平移缩放整退役:拖动/滚轮/捏合全形态删,
//     viewBox 由 React 声明式下发,地图不变则视口不变,无手势无命令式句柄)
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { BoardPos } from "@core/board";
import { getControllerContext } from "@app/controllers/registry";
import { AmbientLayer } from "./AmbientLayer";
import { BoardDefs, RoadsLayer, TerrainLayer, type ViewBox } from "./StaticLayers";
import { BoardHost } from "./boardHost";
import { Tile } from "./Tile";
import type { TileVisualState } from "./Tile";
import { capitalHolderOf, holdingsOf, type TileHolding } from "./tileOwnership";
import { TokenLayer } from "./TokenLayer";
import { BoardFxLayer } from "@app/fx/FxLayer";
import "./board.css";

/** 总览内容外扩口径(与 Tile 层实际占面对齐,单位 = 世界坐标):
 *  - 两侧:城台半宽 104×2.2/2 ≈ 115(驿道恒直线 #928/ADR-0044,无弧线外凸余量)
 *  - 上方:王旗顶约 −91×2.2 ≈ −200(旗高于城台)
 *  - 下方:铭牌底约 44×2.2 ≈ 97
 *  PAD 取值仍含弧线时代余量(sideArc 外凸 ≤160 退役后未收敛,一次只改一个变量):
 *  侧向 180−115=65、下缘 180−97=83 的差值视作额外呼吸量,另票收敛。
 *  再加 4% 呼吸边距。宽高比随内容(不钉 5/3——容器失配交给
 *  preserveAspectRatio meet,地形层 EDGE_PAD 渐隐带负责补边)。 */
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
  /** 持有城(棋盘只用 propertyId/level/defense 推导归属色、等级珠与防御盾排)。
   */
  properties: { propertyId: string; level: number; defense: number }[];
}

interface BoardViewProps {
  /** 全体玩家(归属/都城/棋子位置皆由此派生)。 */
  players: BoardPlayer[];
  /** 当前视角玩家 id(L47:自己棋子加玩家色微光圈;未开局不传)。 */
  viewSeat?: string;
  /** 点击城池回调(索引)。 */
  onTileClick?: (index: number) => void;
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

const TileLayer = memo(function TileLayerInner({
  children,
  onHover,
  onTileClick,
}: {
  children: React.ReactNode;
  onHover: (index: number | null) => void;
  onTileClick?: (index: number) => void;
}) {
  // 城池接近重叠时:悬停哪个提到最上层(SVG 无 z-index,后渲染=上层)。
  // 仅在未按下按键(buttons===0)时重排 —— 按下期间的重排会把 pointerdown 目标节点
  // 移走导致 Chrome 吞掉 click(旧 board.ts 已踩过的坑,忠实保留此守卫)。
  const handleOver = useCallback(
    (ev: React.PointerEvent<SVGGElement>) => {
      if (ev.buttons !== 0) return;
      const t = (ev.target as Element).closest(".bv-tile");
      const next = t ? Number((t as Element).getAttribute("data-tile")) : null;
      // flushSync 同步提交重排:高负载下 React 提交可能延迟到 pointerdown 之后才落地,
      // 目标节点从指针下移走会吞掉 click(波3 e2e 8 并发实踩);同步提交保证 DOM 移动
      // 发生在 pointerover 事件内,必然早于 pointerdown。
      flushSync(() => onHover(next));
    },
    [onHover],
  );
  // #1023 链 B:落格点击事件委托——onClick 挂本层 <g>,closest(".bv-tile")+
  // data-tile 取目标(与 handleOver 同款现成模式)。原先 per-tile onClick prop
  // 经 BoardView 派生、源头是 useCapitalPick 每渲染新建的裸函数,每次 sync 都换
  // 引用,44 城 Tile 的 React.memo 被逐个击穿;委托化后 Tile 不再持有回调 prop。
  // 点在城池之外 closest 为 null 不调,与 per-tile onClick 等价;#699 拖拽吞点击
  // 拦在 svg 捕获相位、先于本 handler,行为不变。
  const handleClick = useCallback(
    (ev: React.MouseEvent<SVGGElement>) => {
      if (!onTileClick) return;
      const t = (ev.target as Element).closest(".bv-tile");
      if (t === null) return;
      onTileClick(Number(t.getAttribute("data-tile")));
    },
    [onTileClick],
  );
  return (
    <g id="bv-tiles" onPointerOver={handleOver} onClick={handleClick}>
      {children}
    </g>
  );
});

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
      ha.defense !== hb.defense
    )
      return false;
  }
  return true;
}

export function BoardView({
  players,
  viewSeat,
  onTileClick,
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
  const fitBox = useMemo(() => `${fit.x} ${fit.y} ${fit.w} ${fit.h}`, [fit]);
  const [hoverTile, setHoverTile] = useState<number | null>(null);

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

  // #1023 链 B:onTileClick 不再派生 per-tile onClick(handleTileClick 派生随
  // useCapitalPick 裸函数每渲染换新,形同虚设已删),点击收编 TileLayer 的 <g>
  // 事件委托,Tile 的 props 从此不随回调身份抖动。

  // 悬停的城排到最后(=最上层),其余保持索引序,避免 hover 时整层乱序跳动
  const orderedTiles = useMemo(() => {
    const list = board.tiles;
    if (hoverTile == null) return list;
    return [
      ...list.filter((t) => t.index !== hoverTile),
      ...list.filter((t) => t.index === hoverTile),
    ];
  }, [board.tiles, hoverTile]);

  // X4(#23) 候选序号表:滚出顺序 → 1 基序号(Tile 内读作 壹/贰/叁 印)。
  const candidateOrder = useMemo(() => {
    const m = new Map<number, number>();
    candidateTiles?.forEach((idx, i) => m.set(idx, i + 1));
    return m;
  }, [candidateTiles]);

  // F1:TileVisualState 按 index 预生成并 memo——原先每次 render 内联新建对象,
  // 击穿 Tile 的 React.memo 导致 40 城全量重渲;现在只有 players/回合/可选集变化
  // 才重建(state 对象身份稳定),hover 重排仅移动 DOM 节点、不触发各城重渲。
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
        level: holding?.level ?? 0,
        capitalColorIndex: capitalP ? capitalP.colorIndex : null,
        capitalGuohao: capitalP ? capitalP.guohao : null,
        isActive: activeTileIndex === tile.index,
        isTaken: !!(isSetupPhase && capitalP),
        isSelectable: selectableFull?.has(tile.index) ?? false,
        capitalCandidateOrder: candidateOrder.get(tile.index) ?? null,
        isCityTarget: cityTargetTiles?.has(tile.index) ?? false,
        isCityPicked: cityPickedTileIndex === tile.index,
        // 防御盾排直读(#1391 T5):有主=持有账面当前值,无主=null 整排不渲染
        defense: holding ? holding.defense : null,
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

  // F1:城池 JSX 整体 memo(依赖都是身份稳定的派生值),hover 等无关重渲不再重建 40 城 vnode。
  const tiles = useMemo(
    () => (
      <>
        {orderedTiles.map((tile) => {
          // 严格 loadMap 下每格 propertyId 必入册(#826 全城池制),def 必非空——
          // 空值是 loader bug,直接炸出来(零兜底;tier 管道顺手收编旧 `??` 档)。
          const def = catalog.get(tile.propertyId)!;
          return (
            <Tile
              key={tile.index}
              tile={tile}
              tier={def.tier}
              maxLevel={def.maxLevel}
              state={tileStates.get(tile.index)!}
              showGlow={false}
            />
          );
        })}
      </>
    ),
    [orderedTiles, catalog, tileStates],
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
      {/* 底板(静态层):纸面/地形/驿道/城池——对局中只吃事件驱动的低频变化
          (归属/档位/宣告),行军/特效逐帧失效不再波及,弱 GPU 栅格欠债时
          合成器棋盘格(整板闪成背景色)的源头就此拔除(ADR-0040)。
          落格点击全在本板:动态层 pointer-events none,触摸穿透落到此处。 */}
      <svg
        id="board"
        ref={svgRef}
        viewBox={fitBox}
        preserveAspectRatio="xMidYMid meet"
        /* 触屏:禁 WebView 原生手势(双击缩放/拖拽滚动)接管棋盘触摸——棋盘自身
         无手势(#946),触摸只服务落格点击;overscroll contain 防拖动外溢滚动页面。 */
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        className={`block h-full w-full select-none ${className ?? ""}`}
      >
        <BoardDefs fit={fit} />
        <TerrainLayer fit={fit} />
        <RoadsLayer board={board} />
        <TileLayer onHover={setHoverTile} onTileClick={onTileClick}>
          {tiles}
        </TileLayer>
      </svg>
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
      <BoardFxLayer svgRef={svgRef} board={board} />
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

// 棋盘逻辑:有序、首尾相接的单环。
// 计算移动路径与下一节点;不含渲染/游戏流程。
// 棋盘类型随域走(#326 types.ts 解散,ADR-0019):坐标/格子/移动路径类型由本文件拥有。

/** 世界坐标(棋盘逻辑单位,View 层映射为像素)。 */
export interface BoardPos {
  x: number;
  y: number;
}

/** 格子类型统一为城池。特殊城池的落格行为由可选 event 字段定义。 */
export type TileType = "Property";

/** 特殊城池固定事件(#823/#824,ADR-0037):城池格的可选 event 字段值。treasure=珍宝城
 *  (#825 迁移接线:落格固定事件位探宝,先于交易链)。 */
export const TILE_EVENTS = ["hero", "market", "treasure"] as const;
export type TileEvent = (typeof TILE_EVENTS)[number];

/** 单个格子定义。一切格子都是城池(#826 全城池制):propertyId 恒为其 id,
 *  isCapitalEligible 恒真;「普通城 vs 特殊城」的差别只在可选 event 字段。 */
export interface TileDef {
  index: number;
  type: TileType;
  name: string;
  position: BoardPos;
  /** 城池目录句柄 = tile id(全城池制下恒非空;类型上保留 null 是编辑器半成品图的过渡态)。 */
  propertyId: string | null;
  isCapitalEligible: boolean;
  /** 特殊城池固定事件(可选)：先结算固定事件，再进入城池交易链。 */
  event?: TileEvent;
}

/** 移动路径。Traversed=真实 tile 索引;Waypoints=行走序列(起点中心+逐格落位中心,
 *  驿道恒直线 #928/ADR-0044,快照 lastMove 随行序列化)。 */
export interface MovePath {
  from: number;
  traversed: number[];
  landIndex: number;
  passedCapital: boolean;
  capitalIndex: number;
  waypoints: BoardPos[];
}

export interface Board {
  readonly count: number;
  readonly tiles: readonly TileDef[];
  at(index: number): TileDef;
  positionOf(index: number): BoardPos;
  next(current: number): number;
  computePath(fromIndex: number, steps: number, capitalIndex: number): MovePath;
  /** 两格距离(#1386):沿环道取前后步数的较小值(自格=0,相邻格=1)。
   *  范围文案的方向写法见 GLOSSARY「距离」。 */
  distance(fromIndex: number, toIndex: number): number;
  /** 前方距离(#1386):自 fromIndex 沿行军方向**正向**数到 toIndex 的步数(自格=0)。 */
  forwardDistance(fromIndex: number, toIndex: number): number;
}

export function createBoard(tiles: TileDef[]): Board {
  const ordered = [...tiles].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) throw new Error("Board must have at least one tile.");

  const count = ordered.length;
  const normalize = (index: number): number => ((index % count) + count) % count;

  const at = (index: number): TileDef => ordered[normalize(index)];
  const positionOf = (index: number): BoardPos => ordered[normalize(index)].position;

  const next = (current: number): number => normalize(current + 1);

  /** 距离谓词(#1386,全局唯一单源):双向最短=沿环道取较短一侧;前方距离=正向步数。
   *  实现注:normalize 已处理负差与越界(跨环双向同式)。 */
  const distance = (fromIndex: number, toIndex: number): number => {
    const d = normalize(toIndex - fromIndex);
    return Math.min(d, count - d);
  };
  const forwardDistance = (fromIndex: number, toIndex: number): number =>
    normalize(toIndex - fromIndex);

  /** 行军:逐格 +1;驿道恒直线(#928/ADR-0044),行走序列=起点中心+逐格落位中心。 */
  const computePath = (fromIndex: number, steps: number, capitalIndex: number): MovePath => {
    if (steps < 0) throw new RangeError("steps must be >= 0");
    const traversed: number[] = [];
    const waypoints: BoardPos[] = [];
    let current = fromIndex;
    for (let i = 0; i < steps; i++) {
      current = normalize(current + 1);
      traversed.push(current);
      waypoints.push(positionOf(current));
    }
    const landIndex = steps === 0 ? normalize(fromIndex) : traversed[traversed.length - 1];
    const passedCapital = capitalIndex >= 0 && traversed.includes(capitalIndex);
    return {
      from: fromIndex,
      traversed,
      landIndex,
      passedCapital,
      capitalIndex,
      waypoints,
    };
  };

  return {
    count,
    tiles: ordered,
    at,
    positionOf,
    next,
    computePath,
    distance,
    forwardDistance,
  };
}

/** 按绝对城格号查棋盘，越界即拒绝。 */
export function tileAtIndex(board: Board, index: number): TileDef {
  if (!Number.isInteger(index) || index < 0 || index >= board.count)
    throw new RangeError(`棋盘城格索引越界(${index})`);
  return board.at(index);
}

/** propertyId → 棋盘格 index 的唯一反查口(城不在棋盘 = 地图数据 bug,响亮炸出)。
 *  消费面全家福:core 侧=引擎留痕(authority tileName/tileIndexOfProperty 薄委托)、
 *  耗竭/破产卷标(choices)、拆城结算(jinnang-execution);app 侧=事件提取(fx)、
 *  名下城池清单、诸侯详情、决策卷轴城名——旧实现曾分「抛错 / 静默回退 id 冒充城名 /
 *  静默塞 -1」三套失败契约,静默侧违零兜底红线,已收口于此。 */
export function tileIndexOfProperty(board: Board, propertyId: string): number {
  const tile = board.tiles.find((t) => t.propertyId === propertyId);
  if (tile == null) throw new Error(`城 ${propertyId} 不在棋盘(数据 bug)`);
  return tile.index;
}

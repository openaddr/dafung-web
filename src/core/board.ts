// 棋盘逻辑:有序、首尾相接的单环。
// 计算移动路径与下一节点;不含渲染/游戏流程。
// 棋盘类型随域走(#326 types.ts 解散,ADR-0019):坐标/格子/移动路径类型由本文件拥有。

/** 世界坐标(棋盘逻辑单位,View 层映射为像素)。 */
export interface BoardPos {
  x: number;
  y: number;
}

/** 格子类型。v2.0 棋盘 Property/TreasureCity/Wolong/Tax/Stock/Chance/Fate 均有落格处理。 */
export type TileType = "Property" | "Tax" | "Chance" | "Fate" | "Stock" | "Wolong" | "TreasureCity"; // 宝物城:不可购买;落格触发珍宝判定

/** 单个格子定义。IsCapitalEligible=可作都城;Region=区域分组(美术配色)。 */
export interface TileDef {
  index: number;
  type: TileType;
  name: string;
  position: BoardPos;
  propertyId: string | null;
  isCapitalEligible: boolean;
  region: string | null;
  waypoints?: BoardPos[]; // 可选:主路该 tile 入边手配途经点(预留,默认自动避城)
  size?: "large" | "medium" | "small";
}

/** 移动路径。Traversed=真实 tile 索引;Waypoints=动画途经位置(避城弧线)。 */
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
  edgeWaypoints(from: number, to: number, threshold?: number): BoardPos[];
}

/** 避城弧线:在 a→b 的两个法向量方向中,选离其他城池更远的弧线途经点。 */
export function sideArc(a: BoardPos, b: BoardPos, others: BoardPos[]): BoardPos[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
  const nx = -dy / len;
  const ny = dx / len;
  const sameP = (p: BoardPos, q: BoardPos) => p.x === q.x && p.y === q.y;
  const pts = others.filter((op) => !sameP(op, a) && !sameP(op, b));
  const make = (off: number, sign: number): BoardPos[] => [
    { x: a.x + dx * 0.33 + nx * off * sign, y: a.y + dy * 0.33 + ny * off * sign },
    { x: a.x + dx * 0.66 + nx * off * sign, y: a.y + dy * 0.66 + ny * off * sign },
  ];
  const minClear = (wps: BoardPos[]): number => {
    let m = Infinity;
    for (const wp of wps)
      for (const op of pts) m = Math.min(m, Math.hypot(wp.x - op.x, wp.y - op.y));
    return m;
  };
  let best = make(90, +1);
  let bestClear = -1;
  for (const off of [90, 125, 160]) {
    const pos = make(off, +1);
    const neg = make(off, -1);
    const cp = minClear(pos),
      cn = minClear(neg);
    const [cand, clear] = cp >= cn ? [pos, cp] : [neg, cn];
    if (clear > bestClear) {
      bestClear = clear;
      best = cand;
    }
    if (clear >= 75) return cand;
  }
  return best;
}

export function createBoard(tiles: TileDef[]): Board {
  const ordered = [...tiles].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) throw new Error("Board must have at least one tile.");

  const count = ordered.length;
  const normalize = (index: number): number => ((index % count) + count) % count;

  const at = (index: number): TileDef => ordered[normalize(index)];
  const positionOf = (index: number): BoardPos => ordered[normalize(index)].position;

  const next = (current: number): number => normalize(current + 1);

  const edgeWaypoints = (from: number, to: number, threshold = 300): BoardPos[] => {
    const a = positionOf(from);
    const b = positionOf(to);
    if (Math.hypot(b.x - a.x, b.y - a.y) < threshold) return [];
    const others = ordered.filter((_, i) => i !== from && i !== to).map((t) => t.position);
    return sideArc(a, b, others);
  };

  /** 行军:逐格 +1,长边带蜿蜒途经点。 */
  const computePath = (fromIndex: number, steps: number, capitalIndex: number): MovePath => {
    if (steps < 0) throw new RangeError("steps must be >= 0");
    const traversed: number[] = [];
    const waypoints: BoardPos[] = [];
    let current = fromIndex;
    for (let i = 0; i < steps; i++) {
      const prev = current;
      current = normalize(current + 1);
      traversed.push(current);
      for (const bp of edgeWaypoints(prev, current)) waypoints.push(bp);
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
    edgeWaypoints,
  };
}

// 棋盘逻辑:有序、首尾相接的不规则主环 + 至多一条分岔辅路。
// 计算移动路径与下一节点;不含渲染/游戏流程。对应 C# 版 Board.cs(GameBoard)。
import type { BoardPos, MovePath, TileDef, BranchCellKind } from "./types";

/** 辅路运行时格(含坐标,由 board-loader 从 JSON 解析)。 */
export interface BranchCell {
  kind: BranchCellKind;
  position: BoardPos;
}
/** 辅路运行时形态:startNode/endNode 为主路 tile index;cells 含坐标。 */
export interface BoardBranch {
  id: string;
  startNode: number;
  endNode: number;
  cells: BranchCell[];
}

export interface Board {
  readonly count: number;
  readonly tiles: readonly TileDef[];
  readonly branch: BoardBranch | null;
  /** 该主路 tile 是否辅路起点。 */
  getBranchStart(tileIndex: number): boolean;
  at(index: number): TileDef;
  positionOf(index: number): BoardPos;
  next(current: number): number;
  computePath(
    fromIndex: number,
    steps: number,
    capitalIndex: number,
    onBranch?: { step: number } | null,
  ): MovePath;
  edgeWaypoints(from: number, to: number, threshold?: number): BoardPos[];
}

/** 避城弧线:在 a→b 的两个法向量方向中,选离其他城池更远的弧线途经点。主路与辅路共用。 */
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
    for (const wp of wps) for (const op of pts) m = Math.min(m, Math.hypot(wp.x - op.x, wp.y - op.y));
    return m;
  };
  let best = make(90, +1);
  let bestClear = -1;
  for (const off of [90, 125, 160]) {
    const pos = make(off, +1);
    const neg = make(off, -1);
    const cp = minClear(pos), cn = minClear(neg);
    const [cand, clear] = cp >= cn ? [pos, cp] : [neg, cn];
    if (clear > bestClear) { bestClear = clear; best = cand; }
    if (clear >= 75) return cand;
  }
  return best;
}

export function createBoard(tiles: TileDef[], branch?: BoardBranch | null): Board {
  const ordered = [...tiles].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) throw new Error("Board must have at least one tile.");

  const count = ordered.length;
  const normalize = (index: number): number => ((index % count) + count) % count;

  const at = (index: number): TileDef => ordered[normalize(index)];
  const positionOf = (index: number): BoardPos => ordered[normalize(index)].position;
  const br: BoardBranch | null = branch ?? null;
  const getBranchStart = (tileIndex: number): boolean =>
    br != null && normalize(tileIndex) === normalize(br.startNode);

  const next = (current: number): number => normalize(current + 1);

  const edgeWaypoints = (from: number, to: number, threshold = 300): BoardPos[] => {
    const a = positionOf(from);
    const b = positionOf(to);
    if (Math.hypot(b.x - a.x, b.y - a.y) < threshold) return [];
    const others = ordered.filter((_, i) => i !== from && i !== to).map((t) => t.position);
    return sideArc(a, b, others);
  };

  /** 主路行军(不含辅路):逐格 +1,长边带蜿蜒途经点。 */
  const computePathMain = (
    fromIndex: number,
    steps: number,
    capitalIndex: number,
  ): MovePath => {
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
      from: fromIndex, traversed, landIndex, passedCapital, capitalIndex,
      waypoints, landBranchStep: null, branchWaypoints: [],
    };
  };

  const computePath = (
    fromIndex: number,
    steps: number,
    capitalIndex: number,
    onBranch: { step: number } | null = null,
  ): MovePath => {
    if (steps < 0) throw new RangeError("steps must be >= 0");

    // 辅路逐格行进
    if (onBranch != null && br != null) {
      const N = br.cells.length;
      const step = onBranch.step;
      // 从当前格 step 走到 endNode(主路)需要 (N - step) 步:经 step+1..N-1 各格,再落 endNode
      const stepsToRejoin = N - step;
      if (steps < stepsToRejoin) {
        // 仍在辅路:落到第 (step + steps) 格
        const newStep = step + steps;
        const branchWaypoints: BoardPos[] = [];
        for (let s = step + 1; s <= newStep; s++) branchWaypoints.push(br.cells[s].position);
        return {
          from: fromIndex,
          traversed: [],
          landIndex: fromIndex, // 占位:辅路落格时主路位置仍是起点
          passedCapital: false,
          capitalIndex,
          waypoints: [],
          landBranchStep: newStep,
          branchWaypoints,
        };
      }
      // 汇入主路:先走完辅路到 endNode,剩余步数走主路
      const mainSteps = steps - stepsToRejoin;
      const branchWaypoints: BoardPos[] = [];
      for (let s = step + 1; s <= N - 1; s++) branchWaypoints.push(br.cells[s].position);
      branchWaypoints.push(positionOf(br.endNode));
      const mainPath = computePathMain(br.endNode, mainSteps, capitalIndex);
      return {
        from: fromIndex,
        traversed: mainPath.traversed,
        landIndex: mainSteps === 0 ? br.endNode : mainPath.landIndex,
        passedCapital: mainPath.passedCapital,
        capitalIndex,
        waypoints: mainPath.waypoints,
        landBranchStep: null, // 已汇入主路
        branchWaypoints,
      };
    }

    // 主路行军
    return computePathMain(fromIndex, steps, capitalIndex);
  };

  return {
    count,
    tiles: ordered,
    branch: br,
    getBranchStart,
    at,
    positionOf,
    next,
    computePath,
    edgeWaypoints,
  };
}

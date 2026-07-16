// 棋盘逻辑:有序、首尾相接的不规则环 + 分歧点支路。计算移动路径与下一节点;不含渲染/游戏流程。
// 对应 C# 版 Board.cs(GameBoard)。
import type { BoardPos, BranchChoice, MovePath, ShortcutDef, TileDef } from "./types";

export interface Board {
  readonly count: number;
  readonly tiles: readonly TileDef[];
  readonly shortcuts: readonly ShortcutDef[];
  getShortcut(branchNode: number): ShortcutDef | null;
  at(index: number): TileDef;
  positionOf(index: number): BoardPos;
  next(current: number, choice: BranchChoice | null): number;
  computePath(
    fromIndex: number,
    steps: number,
    capitalIndex: number,
    pendingBranch?: BranchChoice | null,
  ): MovePath;
  edgeWaypoints(from: number, to: number, threshold?: number): BoardPos[];
}

/** 避城弧线:在 a→b 的两个法向量方向中,选离其他城池更远的弧线途经点。主路与支路共用。 */
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

export function createBoard(tiles: TileDef[], shortcuts: ShortcutDef[]): Board {
  const ordered = [...tiles].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) throw new Error("Board must have at least one tile.");
  const byBranchNode = new Map<number, ShortcutDef>();
  for (const s of shortcuts) byBranchNode.set(s.branchNode, s);

  const count = ordered.length;
  const normalize = (index: number): number => ((index % count) + count) % count;

  const at = (index: number): TileDef => ordered[normalize(index)];
  const positionOf = (index: number): BoardPos => ordered[normalize(index)].position;
  const getShortcut = (branchNode: number): ShortcutDef | null =>
    byBranchNode.get(branchNode) ?? null;

  const next = (current: number, choice: BranchChoice | null): number => {
    if (
      choice != null &&
      choice.fromNode === current &&
      choice.kind === "Shortcut" &&
      byBranchNode.has(current)
    ) {
      return byBranchNode.get(current)!.rejoinNode;
    }
    return normalize(current + 1);
  };

  const edgeWaypoints = (from: number, to: number, threshold = 300): BoardPos[] => {
    const a = positionOf(from);
    const b = positionOf(to);
    if (Math.hypot(b.x - a.x, b.y - a.y) < threshold) return [];
    const others = ordered.filter((_, i) => i !== from && i !== to).map((t) => t.position);
    return sideArc(a, b, others);
  };

  const computePath = (
    fromIndex: number,
    steps: number,
    capitalIndex: number,
    pendingBranch: BranchChoice | null = null,
  ): MovePath => {
    if (steps < 0) throw new RangeError("steps must be >= 0");
    const traversed: number[] = [];
    const waypoints: BoardPos[] = [];
    let current = fromIndex;

    for (let i = 0; i < steps; i++) {
      const stepChoice: BranchChoice | null = i === 0 ? pendingBranch : null;
      const takeShortcut =
        stepChoice?.kind === "Shortcut" &&
        stepChoice.fromNode === current &&
        byBranchNode.has(current);

      if (takeShortcut) {
        const shortcut = byBranchNode.get(current)!;
        for (const wp of shortcut.sideWaypoints) waypoints.push(wp);
        current = shortcut.rejoinNode;
        traversed.push(current);
        waypoints.push(positionOf(current));
      } else {
        const prev = current;
        current = normalize(current + 1);
        traversed.push(current);
        for (const bp of edgeWaypoints(prev, current)) waypoints.push(bp);
        waypoints.push(positionOf(current));
      }
    }

    const landIndex = steps === 0 ? normalize(fromIndex) : traversed[traversed.length - 1];
    const passedCapital = capitalIndex >= 0 && traversed.includes(capitalIndex);
    return { from: fromIndex, traversed, landIndex, passedCapital, capitalIndex, waypoints };
  };

  return {
    count,
    tiles: ordered,
    shortcuts: [...shortcuts],
    getShortcut,
    at,
    positionOf,
    next,
    computePath,
    edgeWaypoints,
  };
}

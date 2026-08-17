// 令牌行军编排(移植自旧 src/render/animate.ts 的 animateMove,时序/弧线算法不变)。
// 介质变化:旧版操作 board.ts 预创建的 token 节点;React 版棋子由 TokenLayer 声明式渲染,
// 行军期间通过两条机制"接管":
//   ① fxStore.marching(id) → GameScreen 传 BoardView.skipTokenIds → TokenLayer 不再
//      对该棋子做声明式定位(等价旧 updateTokens(engine, skipPlayerId));
//   ② marchPos 模块 Map(棋子 id → 当前段坐标):TokenLayer 对"被接管但仍有坐标"的棋子
//      照常渲染(transform 取 marchPos)——这样行军中任何 store 同步触发的重渲都会
//      把 transform 设为「当前段目标」,与命令式写入值一致,棋子不会被拽回起点/终点。
// 动画本体仍命令式:直接改 data-token-player 节点的 style.transform + transitionDuration
// (CSS transition 见 board.css .bv-token),每段时长 ∝ 距离(匀速节奏,常量在 timings.MARCH)。
import type { GameEngine } from "@core/game";
import type { Player } from "@core/types";
import { TOKEN_SLOT_OFFSETS } from "@core/constants";
import { playerSlotKey, tokenRenderPos } from "@app/components/board/TokenLayer";
import { useFxStore } from "./fxStore";
import { delay, FX, MARCH, nextFrame } from "./timings";
import { boardCamera } from "@app/components/board/usePanZoom";

/** 行军接管中的棋子当前坐标(逻辑系)。只在 beginMarch/段推进时写入,被 TokenLayer 读取。 */
export const marchPos = new Map<string, { x: number; y: number }>();

/** 段时长:匀速(时长 ∝ 距离),夹在 [minSegMs, maxSegMs](旧 animate.ts 的口径)。 */
function segDuration(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.min(MARCH.maxSegMs, Math.max(MARCH.minSegMs, (dist / MARCH.speed) * 1000));
}

/** 终点槽位错移:与 TokenLayer 共用 playerSlotKey 分组,避免 mover 先落槽 1 再被
 *  声明式渲染拨回槽 0 的抖动(旧 animate.ts 同款坑,注释照搬)。 */
function slotOffsetFor(engine: GameEngine, player: Player): { x: number; y: number } {
  const board = engine.board;
  const byTile = new Map<string, string[]>();
  for (const p of engine.players) {
    if (p.isBankrupt) continue;
    const key = playerSlotKey(p, board);
    const arr = byTile.get(key) ?? [];
    arr.push(p.id);
    byTile.set(key, arr);
  }
  const slot = Math.max(0, (byTile.get(playerSlotKey(player, board)) ?? [player.id]).indexOf(player.id));
  return TOKEN_SLOT_OFFSETS[slot % TOKEN_SLOT_OFFSETS.length];
}

/** 命令提交后、sync 渲染前调用:把 mover 放进接管集并锚定在起点(path.from)。
 *  必须先于 sync——否则 React 会先渲染终态坐标,棋子闪现终点再被拽回。 */
export function beginMarch(engine: GameEngine, moverId: string): void {
  // 表现态经 presentation 视图读(Wave3 候选4);lastMove 可能是 applyPresentationMove 注入的 diff 轨迹。
  const path = engine.presentation.lastMove;
  if (!path) return;
  const board = engine.board;
  const start = board.positionOf(path.from);
  marchPos.set(moverId, { x: start.x, y: start.y });
  useFxStore.getState().addMarching(moverId);
}

/** 驿道流光:行军每跨一格,沿该段弧线(path)叠加一条金色流光(旧 highlightSegment)。 */
function highlightSegment(engine: GameEngine, from: number, to: number): void {
  const board = engine.board;
  const layer = document.querySelector<SVGGElement>("#bv-flow");
  if (!layer) return;
  const a = board.positionOf(from);
  const b = board.positionOf(to);
  const wps = board.edgeWaypoints(from, to);
  const pts = [a, ...wps, b];
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("class", "road-flow active");
  p.setAttribute("d", d);
  layer.appendChild(p);
  setTimeout(() => p.remove(), FX.roadFlowMs);
}

/**
 * 行军:沿 lastMove 的 branchWaypoints(辅路)与 traversed(主路)逐段推进棋子。
 * - 编排时序/弧线分段完全对照旧 animate.ts animateMove;
 * - 驻跸(haltAtCapital 后)engine.lastMove 仍保留,由 halt/continueMove 后的本函数补走;
 * - 完成后 removeMarching:React 以终态坐标接管(marchPos 同步删除)。
 * lastMove 为 null(非移动命令)时 no-op。
 */
export async function animateMove(engine: GameEngine, moverId: string): Promise<void> {
  const e = engine;
  const path = e.presentation.lastMove;
  const player = e.players.find((p) => p.id === moverId);
  if (!path || !player) return;
  const board = e.board;

  // C4 镜头跟随:放大视图中行军终点可能在视野外——检查当前 viewBox 是否包含
  // 终点(留 15% 边距),不含则缓动把镜头平移过去(不改缩放)。棋盘未挂载时
  // boardCamera 为空(如编辑器),静默跳过。
  followIfOffscreen(tokenRenderPos(player, board));

  // 接管集未含该棋子(调用方漏了 beginMarch):现场补,起点锚定 from。
  if (!marchPos.has(moverId)) beginMarch(e, moverId);
  // 等 React 把「跳过声明式定位 + marchPos 起点」渲染出来,再拿节点开始动画。
  await nextFrame();
  const token = document.querySelector<SVGGElement>(`#bv-tokens [data-token-player="${moverId}"]`);
  if (!token) {
    endMarch(moverId);
    return;
  }

  /** 单段推进:设置 transitionDuration → 写 transform(命令式)→ 同步 marchPos(供重渲对齐)。 */
  const step = async (x: number, y: number): Promise<void> => {
    const from = marchPos.get(moverId) ?? { x, y };
    const dur = segDuration(from, { x, y });
    token.style.transitionDuration = `${dur / 1000}s`;
    token.style.transform = `translate(${x}px, ${y}px)`;
    marchPos.set(moverId, { x, y });
    await delay(dur + MARCH.segSlackMs);
  };

  // 辅路逐格行进:沿 branchWaypoints 推进
  if (path.branchWaypoints && path.branchWaypoints.length > 0) {
    for (const wp of path.branchWaypoints) {
      await step(wp.x, wp.y);
    }
  }

  if (path.traversed.length > 0) {
    const target = player.position;
    const off = slotOffsetFor(e, player);
    let prevTile = path.from;
    for (const tile of path.traversed) {
      const isLast = tile === target;
      // 沿驿道弧线(edgeWaypoints)逐段推进,使棋子贴着路线走而非直线穿行
      const wps = board.edgeWaypoints(prevTile, tile);
      const center = board.positionOf(tile);
      const endPoint = isLast ? { x: center.x + off.x, y: center.y + off.y } : center;
      const pts = [board.positionOf(prevTile), ...wps, endPoint];
      for (let i = 1; i < pts.length; i++) {
        await step(pts[i].x, pts[i].y);
      }
      highlightSegment(e, prevTile, tile);
      prevTile = tile;
      if (isLast) break; // 驻跸:停在都城
    }
  }

  token.style.transitionDuration = "";
  endMarch(moverId);
}

/** C4:终点不在当前视图(含 15% 边距)时请求镜头缓动跟随。 */
function followIfOffscreen(dest: { x: number; y: number }): void {
  const vb = boardCamera.getView?.();
  if (!vb) return;
  const mx = vb.w * 0.15;
  const my = vb.h * 0.15;
  const inside =
    dest.x >= vb.x + mx && dest.x <= vb.x + vb.w - mx && dest.y >= vb.y + my && dest.y <= vb.y + vb.h - my;
  if (!inside) boardCamera.flyTo?.(dest.x, dest.y);
}

/** 结束接管:移除 marchPos + fxStore.marching,React 以终态接管定位。 */
function endMarch(moverId: string): void {
  marchPos.delete(moverId);
  useFxStore.getState().removeMarching(moverId);
}

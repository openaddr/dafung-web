// 动画层:骰子翻滚、令牌匀速行军、驿道流光、金额浮动、铜钱雨、回合旌旗横幅。
import type { Board } from "@core/board";
import type { GameEngine } from "@core/game";
import { playerColor, rgba } from "@core/theme";
import type { BoardView } from "./board";
import { svg, el } from "./dom";
import { formatMoney } from "@core/money";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SIGN_FACES = ["一", "二", "三", "四", "五", "六"]; // 签筒:抽签 1-6 用汉字

export interface Animator {
  animateDice(die: number): Promise<void>;
  animateMove(engine: GameEngine, moverId: string): Promise<void>;
  spawnFloaters(engine: GameEngine): void;
  showTurnBanner(guohao: string, colorIndex: number): void;
  stampSeal(tileIndex: number, char: string): void;
}

export function createAnimator(
  boardWrap: HTMLElement,
  svgEl: SVGSVGElement,
  board: Board,
  boardView: BoardView,
): Animator {
  /** SVG 逻辑坐标 → board-wrap 内像素(用于 HTML 浮层定位)。 */
  function logicToClient(x: number, y: number): { left: number; top: number } {
    const pt = svgEl.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { left: 0, top: 0 };
    const s = pt.matrixTransform(ctm);
    const r = boardWrap.getBoundingClientRect();
    return { left: s.x - r.left, top: s.y - r.top };
  }

  async function animateDice(die: number): Promise<void> {
    const diceEl = document.getElementById("dice-face");
    if (!diceEl) return;
    diceEl.classList.add("rolling");
    for (let i = 0; i < 7; i++) {
      diceEl.textContent = SIGN_FACES[Math.floor(Math.random() * 6)];
      await delay(55);
    }
    diceEl.textContent = SIGN_FACES[die - 1];
    diceEl.classList.remove("rolling");
    await delay(170);
  }

  async function animateMove(engine: GameEngine, moverId: string): Promise<void> {
    const path = engine.lastMove;
    if (!path || path.traversed.length === 0) {
      boardView.updateTokens(engine);
      return;
    }
    const player = engine.players.find((p) => p.id === moverId);
    if (!player) return;
    const token = boardView.tokenOf(moverId);
    const target = player.position;
    if (!token) {
      boardView.updateTokens(engine);
      return;
    }
    // 终点偏移量(与 updateTokens 的同格错位一致):落格时直接落到偏移位,避免"先中心再左移"
    const OFFSETS = [
      { x: -22, y: -8 }, { x: 22, y: -8 }, { x: -22, y: 20 }, { x: 22, y: 20 },
    ];
    const byTile = new Map<number, string[]>();
    for (const p of engine.players) {
      if (p.isBankrupt) continue;
      const arr = byTile.get(p.position) ?? [];
      arr.push(p.id);
      byTile.set(p.position, arr);
    }
    const slot = Math.max(0, (byTile.get(target) ?? [moverId]).indexOf(moverId));
    const off = OFFSETS[slot % OFFSETS.length];

    let prev = path.from;
    for (const tile of path.traversed) {
      const isLast = tile === target;
      // 沿驿道弧线(edgeWaypoints)逐段推进,使棋子贴着路线走而非直线穿行
      const wps = board.edgeWaypoints(prev, tile);
      const center = board.positionOf(tile);
      const endPoint = isLast ? { x: center.x + off.x, y: center.y + off.y } : center;
      const pts = [board.positionOf(prev), ...wps, endPoint];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const dur = Math.min(0.46, Math.max(0.08, dist / 720)); // 匀速:时长 ∝ 距离
        token.style.transitionDuration = `${dur}s`;
        boardView.setTokenPosition(moverId, b.x, b.y, false);
        await delay(dur * 1000 + 10);
      }
      highlightSegment(prev, tile);
      prev = tile;
      if (isLast) break; // 驻跸:停在都城
    }
    token.style.transitionDuration = "";
    boardView.updateTokens(engine);
  }

  function highlightSegment(from: number, to: number): void {
    const a = board.positionOf(from);
    const b = board.positionOf(to);
    const wps = board.edgeWaypoints(from, to);
    const pts = [a, ...wps, b];
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const p = svg("path", { class: "road-flow active", d });
    boardView.flowLayer.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }

  function spawnFloaters(engine: GameEngine): void {
    const fs = engine.drainFloaters();
    for (const f of fs) {
      const player = engine.players[f.playerIndex];
      if (!player) continue;
      const atPos = f.atTile != null ? board.positionOf(f.atTile) : null;
      const tokenPos = board.positionOf(player.position);
      const x = atPos?.x ?? tokenPos.x;
      const y = atPos?.y ?? tokenPos.y;
      const c = logicToClient(x, y);
      spawnFloater(c.left, c.top, f.amount);
      if (f.kind === "supply") spawnCoins(c.left, c.top);
    }
  }

  function spawnFloater(left: number, top: number, amount: number): void {
    const node = el(
      "div",
      {
        class: `floater ${amount >= 0 ? "pos" : "neg"}`,
        style: `left:${left}px;top:${top}px;`,
      },
      [`${amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(amount))}`],
    );
    boardWrap.appendChild(node);
    setTimeout(() => node.remove(), 1300);
  }

  function spawnCoins(left: number, top: number): void {
    for (let i = 0; i < 6; i++) {
      const dx = Math.round((Math.random() - 0.5) * 60);
      const coin = el(
        "div",
        { class: "coin", style: `left:${left}px;top:${top}px;--dx:${dx}px;` },
        ["🪙"],
      );
      boardWrap.appendChild(coin);
      setTimeout(() => coin.remove(), 1500);
    }
  }

  function showTurnBanner(guohao: string, colorIndex: number): void {
    let banner = document.getElementById("turn-banner") as HTMLDivElement | null;
    if (!banner) {
      banner = el("div", { id: "turn-banner", class: "turn-banner" });
      boardWrap.appendChild(banner);
    }
    banner.textContent = `【${guohao}】之回合`;
    banner.style.setProperty("--player-color", rgba(playerColor(colorIndex)));
    banner.classList.remove("show");
    void banner.offsetWidth; // 重启动画
    banner.classList.add("show");
  }

  /** 朱砂印章"啪"地盖在城池上(建都/购地成功时)。 */
  function stampSeal(tileIndex: number, char: string): void {
    const pos = board.positionOf(tileIndex);
    const c = logicToClient(pos.x, pos.y - 20);
    const seal = el(
      "div",
      { class: "seal", style: `left:${c.left}px;top:${c.top}px;` },
      [char],
    );
    boardWrap.appendChild(seal);
    setTimeout(() => seal.remove(), 900);
  }

  return { animateDice, animateMove, spawnFloaters, showTurnBanner, stampSeal };
}

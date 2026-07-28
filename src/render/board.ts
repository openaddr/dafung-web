// 棋盘 SVG 渲染:宣纸背景 + 远山河川 + 主路褐带/支路虚线 + 程序化城门 + 王旗都城 + 旌旗棋子。
// 所有交互元素带语义 id/data,供 Playwright 精确查询。
import type { Board } from "@core/board";
import type { Player, TileDef } from "@core/types";
import type { GameEngine } from "@core/game";
import { playerColor, groupColor, Theme, rgba } from "@core/theme";
import { findHolding } from "@core/player";
import type { MapCatalog } from "@core/board-loader";
import { svg, clear } from "./dom";
import { formatMoney } from "@core/money";
import { TOKEN_SLOT_OFFSETS } from "@core/constants";
import { polylinePath } from "./svg-util";

// viewBox:贴紧城池实际范围 + 少量边距(收紧后城池整体放大约 12%)
const VB_X = -1050;
const VB_Y = -660;
const VB_W = 2300;
const VB_H = 1380;

export interface BoardView {
  root: SVGSVGElement;
  updateTiles(engine: GameEngine): void;
  updateTokens(engine: GameEngine, skipPlayerId?: string): void;
  setTokenPosition(playerId: string, x: number, y: number, instant: boolean): void;
  tokenOf(playerId: string): SVGElement | null;
  tileCenter(tileIndex: number): { x: number; y: number };
  fxLayer: SVGGElement;
  flowLayer: SVGGElement;
  resetView(): void;
}

export function createBoardSvg(board: Board, catalog: MapCatalog, opts?: { panZoom?: boolean }): BoardView {
  const root = svg("svg", {
    id: "board",
    viewBox: `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`,
    preserveAspectRatio: "xMidYMid meet",
  });

  // ── defs:宣纸噪点滤镜、远山渐变 ──
  const defs = svg("defs", {});
  defs.appendChild(
    svg("filter", { id: "paper", x: "-5%", y: "-5%", width: "110%", height: "110%" }, [
      svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.012 0.018", numOctaves: "2", seed: "7", result: "n" }),
      svg("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.28  0 0 0 0.06 0" }),
    ]),
  );
  defs.appendChild(
    svg("radialGradient", { id: "vignette", cx: "50%", cy: "50%", r: "62%" }, [
      svg("stop", { offset: "60%", "stop-color": "#e8dcc0", "stop-opacity": "0" }),
      svg("stop", { offset: "100%", "stop-color": "#6b4f28", "stop-opacity": "0.28" }),
    ]),
  );
  root.appendChild(defs);

  // ── 背景层 ──
  root.appendChild(svg("rect", { x: VB_X, y: VB_Y, width: VB_W, height: VB_H, fill: "#e8dcc0" }));
  root.appendChild(svg("rect", { x: VB_X, y: VB_Y, width: VB_W, height: VB_H, fill: "url(#paper)", opacity: "0.5" }));
  drawMountainsAndRivers(root);
  root.appendChild(svg("rect", { x: VB_X, y: VB_Y, width: VB_W, height: VB_H, fill: "url(#vignette)" }));

  // ── 驿道层(主路 + 支路)──
  const roadLayer = svg("g", { id: "roads" });
  drawRoads(roadLayer, board);
  root.appendChild(roadLayer);

  const flowLayer = svg("g", { id: "flow" });
  root.appendChild(flowLayer);

  // ── 城池层 ──
  const tileLayer = svg("g", { id: "tiles" });
  for (const tile of board.tiles) tileLayer.appendChild(buildGate(tile, board, catalog));
  // 城池接近重叠时:鼠标悬停哪个,哪个提到最上层(SVG 无 z-index,靠 DOM 顺序,后=上)。
  // 关键:仅在「未按下按键」(buttons===0)时重排。按下期间的 pointerover(指针轻微位移跨过
  // 子元素)会再次 appendChild,把 mousedown 目标节点移走,Chrome 据此吞掉随后的 click ——
  // 这正是 Ctrl+滚轮缩放后、带轻微手抖的点击「点都城没反应」的根因。
  tileLayer.addEventListener("pointerover", (ev) => {
    if (ev.buttons !== 0) return; // 按下中(正在点击/拖动)不重排,避免吞 click
    const t = (ev.target as Element).closest(".tile");
    if (t) tileLayer.appendChild(t);
  });
  root.appendChild(tileLayer);

  // ── 棋子层 ──
  const tokenLayer = svg("g", { id: "tokens" });
  root.appendChild(tokenLayer);

  // ── 特效层(floater/coin 文本)──
  const fxLayer = svg("g", { id: "fx" });
  root.appendChild(fxLayer);

  // 预创建棋子(调用 updateTokens 时填色与定位)
  const tokenEls = new Map<string, SVGElement>();

  function tokenOf(playerId: string) {
    return tokenEls.get(playerId) ?? null;
  }
  function tileCenter(tileIndex: number) {
    const p = board.positionOf(tileIndex);
    return { x: p.x, y: p.y };
  }
  function setTokenPosition(playerId: string, x: number, y: number, instant: boolean) {
    const t = tokenEls.get(playerId);
    if (!t) return;
    // 用 CSS transform(而非 SVG transform 属性):CSS transition 只对 CSS 属性生效,
    // 这样 .token 的 transition:transform 才会平滑过渡,不会逐段瞬移
    const tr = `translate(${x}px, ${y}px)`;
    if (instant) {
      t.style.transition = "none";
      t.style.transform = tr;
      // 强制 reflow 后恢复 transition
      void t.getBoundingClientRect();
      t.style.transition = "";
    } else {
      t.style.transform = tr;
    }
  }

  function updateTokens(engine: GameEngine, skipPlayerId?: string) {
    // 同格错位:统计每个 tile 上的玩家
    const byTile = new Map<number, string[]>();
    for (const p of engine.players) {
      if (p.isBankrupt) continue;
      const arr = byTile.get(p.position) ?? [];
      arr.push(p.id);
      byTile.set(p.position, arr);
    }
    const offsets = TOKEN_SLOT_OFFSETS;
    for (const p of engine.players) {
      // setup 阶段未选都:不显示棋子(选完都城后才在都城出现,避免默认堆在长安)
      if (engine.phase === "Setup" && p.capitalIndex < 0) {
        const ex = tokenEls.get(p.id);
        if (ex) ex.style.opacity = "0";
        continue;
      }
      // 跳过指定玩家:行军动画期间由 animateMove 接管,避免 fullRender 把棋子提前拽到终点
      if (p.id === skipPlayerId) continue;
      let t = tokenEls.get(p.id);
      const pos = board.positionOf(p.position);
      const mates = byTile.get(p.position) ?? [p.id];
      const slot = Math.max(0, mates.indexOf(p.id));
      const off = offsets[slot % offsets.length];
      if (!t) {
        t = buildToken(p);
        tokenLayer.appendChild(t);
        tokenEls.set(p.id, t);
        setTokenPosition(p.id, pos.x + off.x, pos.y + off.y, true);
        t.style.opacity = p.isBankrupt ? "0" : "1";
      } else {
        setTokenPosition(p.id, pos.x + off.x, pos.y + off.y, false);
        t.style.opacity = p.isBankrupt ? "0.15" : "1";
      }
    }
  }

  function updateTiles(engine: GameEngine) {
    for (const tile of board.tiles) {
      const g = document.getElementById(`tile-${tile.index}`);
      if (!g) continue;
      const def = engine.catalog.get(tile.propertyId);
      const owner = def ? engine.findOwner(def.id) : null;
      const holding = owner && def ? findHolding(owner, def.id) : null;
      const isCapital = engine.players.some((p) => p.capitalIndex === tile.index);
      const capitalOwner = engine.players.find((p) => p.capitalIndex === tile.index) ?? null;

      // 持有者边框
      const border = g.querySelector(".tile-border") as SVGElement | null;
      if (border) {
        if (owner) {
          const c = playerColor(owner.colorIndex);
          border.setAttribute("stroke", rgba(c));
          border.setAttribute("stroke-opacity", "0.9");
        } else {
          border.setAttribute("stroke", "rgba(60,45,20,0.25)");
          border.setAttribute("stroke-opacity", "0.5");
        }
      }
      // 王旗(都城)
      const flag = g.querySelector(".tile-flag") as SVGElement | null;
      const flagText = g.querySelector(".tile-flag-text") as SVGElement | null;
      if (flag && flagText) {
        if (isCapital && capitalOwner) {
          const c = playerColor(capitalOwner.colorIndex);
          flag.style.display = "";
          flag.setAttribute("fill", rgba(c));
          flagText.textContent = capitalOwner.guohao;
          g.classList.add("tile-capital");
        } else {
          flag.style.display = "none";
          g.classList.remove("tile-capital");
        }
      }
      // 等级 pips
      const pips = g.querySelector(".tile-pips") as SVGElement | null;
      if (pips) {
        clear(pips);
        const lvl = holding?.level ?? 0;
        for (let i = 0; i < lvl; i++) {
          pips.appendChild(
            svg("circle", { cx: -36 + i * 14, cy: 16, r: 4.5, fill: rgba(Theme.goldBright) }),
          );
        }
      }
      // 持有者色带叠加(都城用金色,普通用玩家色淡)
      const band = g.querySelector(".tile-band") as SVGElement | null;
      if (band && def) {
        band.setAttribute("fill", rgba(groupColor(def.group)));
      }
      // 选都阶段:已被选的城标灰禁用
      const taken = engine.phase === "Setup" && isCapital;
      g.classList.toggle("tile-taken", !!taken);
      // 对局焦点:当前回合玩家所在城池(脉动金环,见 .tile-active)
      const isActive = engine.phase === "Playing" && engine.activePlayer.position === tile.index;
      g.classList.toggle("tile-active", isActive);
      (g.querySelector(".tile-name") as SVGElement).setAttribute(
        "fill",
        isCapital ? rgba(Theme.goldBright) : rgba(Theme.ink),
      );
    }
  }

  // ── 缩放平移(默认总览;滚轮缩放、拖拽空白平移、resetView 还原)──
  const fitVb = { x: VB_X, y: VB_Y, w: VB_W, h: VB_H };
  let vb = { x: VB_X, y: VB_Y, w: VB_W, h: VB_H };
  const MAX_ZOOM = 4;
  const applyVb = () => root.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const clampVb = () => {
    vb.w = Math.max(fitVb.w / MAX_ZOOM, Math.min(fitVb.w, vb.w));
    vb.h = Math.max(fitVb.h / MAX_ZOOM, Math.min(fitVb.h, vb.h));
    const over = 140; // 允许略超边界,便于平移到边缘城池
    vb.x = Math.max(fitVb.x - over, Math.min(fitVb.x + fitVb.w - vb.w + over, vb.x));
    vb.y = Math.max(fitVb.y - over, Math.min(fitVb.y + fitVb.h - vb.h + over, vb.y));
  };
  const resetView = () => { vb = { ...fitVb }; applyVb(); };
  if (opts?.panZoom) {
    // 滚轮缩放(以光标为锚点,锚点 local 坐标不变)
    root.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const rect = root.getBoundingClientRect();
      const cx = (ev.clientX - rect.left) / rect.width;
      const cy = (ev.clientY - rect.top) / rect.height;
      const factor = Math.exp(ev.deltaY * 0.0015);
      const lx = vb.x + cx * vb.w, ly = vb.y + cy * vb.h;
      vb.w *= factor; vb.h *= factor;
      vb.x = lx - cx * vb.w; vb.y = ly - cy * vb.h;
      clampVb(); applyVb();
    }, { passive: false });
    // 拖拽空白处平移(城池/按钮交给各自点击,不触发平移)
    let panning = false, psx = 0, psy = 0;
    root.addEventListener("pointerdown", (ev) => {
      if ((ev.target as Element).closest(".tile, button")) return;
      panning = true; psx = ev.clientX; psy = ev.clientY;
      root.style.cursor = "grabbing";
      try { root.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    });
    root.addEventListener("pointermove", (ev) => {
      if (!panning) return;
      const rect = root.getBoundingClientRect();
      vb.x -= (ev.clientX - psx) * (vb.w / rect.width);
      vb.y -= (ev.clientY - psy) * (vb.h / rect.height);
      psx = ev.clientX; psy = ev.clientY;
      clampVb(); applyVb();
    });
    const endPan = () => { if (panning) { panning = false; root.style.cursor = "grab"; } };
    root.addEventListener("pointerup", endPan);
    root.addEventListener("pointercancel", endPan);
    root.style.cursor = "grab";
  }

  return { root, updateTiles, updateTokens, setTokenPosition, tokenOf, tileCenter, fxLayer, flowLayer, resetView };
}

// ── 远山与江河(装饰层)──
function drawMountainsAndRivers(root: SVGSVGElement) {
  // 淡墨远山(北方的太行/燕山意象)——压低存在感,让城池跳出
  const hills = svg("g", { opacity: "0.12", stroke: "none" });
  const ridge = (pts: string, fill: string) =>
    hills.appendChild(svg("path", { d: `M${pts} Z`, fill }));
  ridge(`-1100,-680 -700,-720 -500,-660 -300,-700 -100,-660 100,-690 100,-560 -1100,-560`, "rgba(120,100,70,0.5)");
  ridge(`300,-700 600,-680 900,-700 1200,-660 1200,-560 300,-560`, "rgba(110,95,65,0.4)");
  ridge(`-1100,500 -800,470 -500,500 -200,470 100,500 100,620 -1100,620`, "rgba(110,95,65,0.35)");
  root.appendChild(hills);

  // 江河(长江/黄河蜿蜒带,装饰)——压低存在感
  const rivers = svg("g", { fill: "none", stroke: "rgba(70,110,140,0.28)", "stroke-width": "10", "stroke-linecap": "round", opacity: "0.45" });
  rivers.appendChild(svg("path", { d: "M -1000,260 Q -600,300 -300,250 T 200,280 T 700,300 T 1200,260" }));
  rivers.appendChild(svg("path", { d: "M -1000,-200 Q -500,-160 0,-210 T 600,-180 T 1200,-220", "stroke-width": "8", opacity: "0.5" }));
  root.appendChild(rivers);
}

// ── 驿道:主路(粗褐) + 支路(细虚赭橙)──
function drawRoads(layer: SVGGElement, board: Board) {
  const n = board.count;
  // 主路:逐段,长边带蜿蜒途经点
  for (let i = 0; i < n; i++) {
    const from = i;
    const to = (i + 1) % n;
    const a = board.positionOf(from);
    const b = board.positionOf(to);
    const wps = board.edgeWaypoints(from, to);
    const pts = [a, ...wps, b];
    const d = polylinePath(pts);
    layer.appendChild(
      svg("path", { class: "road-main", d, "data-segment": `${from}-${to}` }),
    );
  }
  // 支路
  for (const sc of board.shortcuts) {
    const a = board.positionOf(sc.branchNode);
    const b = board.positionOf(sc.rejoinNode);
    const pts = [a, ...sc.sideWaypoints, b];
    const d = polylinePath(pts);
    layer.appendChild(
      svg("path", { class: "road-side", d, "data-shortcut": sc.id }),
    );
  }
}

// ── 城池建筑:按规模三档绘制不同形态(重镇堡垒 / 县城城楼 / 村落小屋),非单纯缩放 ──
function drawBuilding(g: SVGGElement, size: "large" | "medium" | "small") {
  const wallFill = "rgba(232,220,192,0.95)";
  const wallStroke = "rgba(90,70,40,0.5)";
  const roofFill = "rgba(120,60,40,0.85)";
  const roofStroke = "rgba(60,30,15,0.6)";
  const crenFill = "rgba(90,70,40,0.55)";
  const archFill = "rgba(90,65,32,0.5)";
  const cren = (x: number) => g.appendChild(svg("rect", { x, y: -11, width: 9, height: 6, fill: crenFill }));
  const arch = () => g.appendChild(svg("path", { d: "M -8,12 L -8,2 Q -8,-1 0,-1 Q 8,-1 8,2 L 8,12 Z", fill: archFill }));

  if (size === "large") {
    // 宽城墙 + 左右角楼 + 中央高城楼 + 歇山顶(重镇/州治)
    g.appendChild(svg("rect", { x: -48, y: -6, width: 96, height: 18, rx: 3, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("rect", { x: -52, y: -22, width: 17, height: 34, rx: 2, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("rect", { x: 35, y: -22, width: 17, height: 34, rx: 2, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("polygon", { points: "-54,-22 -43.5,-32 -33,-22", fill: roofFill, stroke: roofStroke, "stroke-width": 1 }));
    g.appendChild(svg("polygon", { points: "33,-22 43.5,-32 54,-22", fill: roofFill, stroke: roofStroke, "stroke-width": 1 }));
    g.appendChild(svg("rect", { x: -16, y: -24, width: 32, height: 30, rx: 2, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("polygon", { points: "-20,-24 0,-38 20,-24", fill: roofFill, stroke: roofStroke, "stroke-width": 1 }));
    for (let i = -40; i <= 28; i += 17) cren(i);
    arch();
    return;
  }
  if (size === "medium") {
    // 单城楼 + 侧墙 + 单檐顶(县城)
    g.appendChild(svg("rect", { x: -40, y: -6, width: 80, height: 18, rx: 3, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("rect", { x: -13, y: -22, width: 26, height: 28, rx: 2, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
    g.appendChild(svg("polygon", { points: "-16,-22 0,-34 16,-22", fill: roofFill, stroke: roofStroke, "stroke-width": 1 }));
    for (let i = -34; i <= 20; i += 14) cren(i);
    arch();
    return;
  }
  // small:坡顶小屋 + 门(村落/关隘)
  g.appendChild(svg("rect", { x: -20, y: -4, width: 40, height: 16, rx: 2, fill: wallFill, stroke: wallStroke, "stroke-width": 1.5 }));
  g.appendChild(svg("polygon", { points: "-24,-4 0,-22 24,-4", fill: roofFill, stroke: roofStroke, "stroke-width": 1 }));
  g.appendChild(svg("rect", { x: -5, y: 2, width: 10, height: 10, fill: archFill }));
}

// ── 城池图标 ──
function buildGate(tile: TileDef, board: Board, catalog: MapCatalog) {
  const sizeScale = tile.size === "small" ? 0.8 : tile.size === "medium" ? 0.9 : 1;
  const g = svg("g", {
    class: "tile",
    id: `tile-${tile.index}`,
    "data-tile": String(tile.index),
    "data-name": tile.name,
    transform: `translate(${tile.position.x} ${tile.position.y}) scale(${sizeScale})`,
  });
  const isBranch = board.getShortcut(tile.index) != null;

  // 命中高亮底 + 都城/焦点光晕 + 持有者铭牌边框
  g.appendChild(svg("circle", { class: "tile-hilite", r: 62, fill: rgba(Theme.gold), opacity: "0" }));
  g.appendChild(svg("circle", { class: "capital-glow", r: 70, fill: rgba(Theme.goldBright), style: "filter:blur(9px)" }));
  g.appendChild(svg("rect", { class: "tile-border", x: -52, y: -44, width: 104, height: 88, rx: 10, fill: "rgba(247,236,208,0.92)", stroke: "rgba(60,45,20,0.25)", "stroke-width": 2.5 }));

  // 非城池格(锦囊/天命/税关/商市/卧龙岗):大字 icon,无建筑
  if (tile.type === "Chance" || tile.type === "Fate" || tile.type === "Tax" || tile.type === "Stock" || tile.type === "Wolong") {
    const c = tile.type === "Wolong" ? Theme.goldBright : tile.type === "Chance" ? Theme.goldBright : tile.type === "Stock" ? Theme.money : Theme.danger;
    const icon = tile.type === "Wolong" ? "龙" : tile.type === "Chance" ? "吉" : tile.type === "Fate" ? "凶" : tile.type === "Tax" ? "税" : "市";
    g.appendChild(svg("rect", { class: "tile-band", x: -46, y: -44, width: 92, height: 8, rx: 2, fill: rgba(c) }));
    g.appendChild(svg("text", { x: 0, y: 22, "text-anchor": "middle", "font-family": "var(--font-brush)", "font-size": 48, "font-weight": 700, fill: rgba(c) }, [icon]));
    g.appendChild(svg("text", { class: "tile-name", x: 0, y: -16, "text-anchor": "middle", "font-family": "var(--font-deco)", "font-size": 16, fill: rgba(Theme.inkDim) }, [tile.name]));
    return g;
  }

  // 城池建筑(按规模分档)
  drawBuilding(g, tile.size ?? "medium");

  // 分组色带(顶部)
  g.appendChild(svg("rect", { class: "tile-band", x: -46, y: -44, width: 92, height: 8, rx: 2, fill: "rgba(140,110,60,0.5)" }));

  // 城名 + 购入价
  g.appendChild(svg("text", { class: "tile-name", x: 0, y: 28, "text-anchor": "middle", "font-family": "var(--font-deco)", "font-size": 22, "font-weight": 700, fill: rgba(Theme.ink) }, [tile.name]));
  g.appendChild(svg("text", { class: "tile-price", x: 0, y: 42, "text-anchor": "middle", "font-family": "var(--font-deco)", "font-size": 14, fill: rgba(Theme.inkDim) }, [formatMoney(Number(priceOf(tile, catalog)) || 0)]));

  // 等级 pips 容器
  g.appendChild(svg("g", { class: "tile-pips" }));

  // 王旗(都城;默认隐藏)
  const flag = svg("g", { class: "tile-flag", style: "display:none" });
  flag.appendChild(svg("line", { x1: 0, y1: -40, x2: 0, y2: -88, stroke: "rgba(50,35,15,0.8)", "stroke-width": 2 }));
  flag.appendChild(svg("polygon", { points: "0,-88 32,-79 0,-70", fill: "rgba(60,60,60,1)", stroke: "rgba(40,28,10,0.7)", "stroke-width": 1 }));
  flag.appendChild(svg("text", { class: "tile-flag-text", x: 11, y: -77, "text-anchor": "middle", "font-family": "var(--font-brush)", "font-size": 16, fill: "#fff" }));
  g.appendChild(flag);

  // 捷径分歧标记
  if (isBranch) {
    g.appendChild(svg("text", { x: 44, y: -34, "font-size": 28, fill: rgba(Theme.roadSide), "font-weight": 700 }, ["⇄"]));
  }

  return g;
}

// 展示购入价(落格购买用)。
function priceOf(tile: TileDef, catalog: MapCatalog): string {
  const def = catalog.get(tile.propertyId ?? "") ?? null;
  return def ? String(def.purchasePrice) : "";
}

// ── 旌旗棋子(国号 + 玩家色)──
function buildToken(p: Pick<Player, "id" | "guohao" | "colorIndex">): SVGElement {
  const c = playerColor(p.colorIndex);
  const g = svg("g", { class: "token", "data-player": p.id, transform: "translate(0 0)" });
  const flag = svg("g", { class: "token-flag" });
  // 旗杆
  flag.appendChild(svg("line", { x1: 0, y1: 0, x2: 0, y2: -34, stroke: "rgba(40,28,10,0.85)", "stroke-width": 2.5 }));
  // 三角旌旗
  flag.appendChild(svg("polygon", { points: "0,-34 26,-26 0,-16", fill: rgba(c), stroke: "rgba(40,28,10,0.6)", "stroke-width": 1 }));
  // 国号字
  flag.appendChild(svg("text", { x: 9, y: -23, "text-anchor": "middle", "font-family": "var(--font-brush)", "font-size": 13, fill: "#fff", "font-weight": 700 }, [p.guohao || "?"]));
  // 底座印玺
  flag.appendChild(svg("circle", { cx: 0, cy: 2, r: 6, fill: rgba(c), stroke: "rgba(40,28,10,0.7)", "stroke-width": 1.5 }));
  g.appendChild(flag);
  return g;
}

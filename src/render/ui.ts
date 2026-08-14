// UI 结构工厂:整体布局、右侧侧栏、开局设置屏、卷轴抉择/确认/胜利弹层。
import type { GameEngine } from "@core/game";
import type { SeatConfig } from "@core/game";
import { playerColor, rgba, GUOHAO_POOL } from "@core/theme";
import { netWorth } from "@core/networth";
import { formatMoney } from "@core/money";
import { isSingleCjk } from "@core/constants";
import { el, clear } from "./dom";
import { assetImg, treasureAssetImg } from "./assets";
import { IS_DEV } from "../version";
import { createBoardSvg } from "./board";
import type { MapEntry, MapSource } from "@core/map-source";
import { loadMapById } from "@core/map-source";

export interface SidebarRefs {
  root: HTMLElement;
  roundInfo: HTMLElement;
  statusEl: HTMLElement; // P1: 回合状态(活跃玩家大卡)
  playersEl: HTMLElement; // P4 改紧凑条
  diceFace: HTMLElement; // 当前签面(一~六);3D 骰子全屏化后侧栏仅此文字
  rollBtn: HTMLButtonElement;
  actionZone: HTMLElement;
  actionInline: HTMLElement; // P2: 内嵌常规决策按钮(买/扩军/驻跸/选路)
  handEl: HTMLElement; // P3: 手牌(珍宝/名士卡)
  warlogList: HTMLElement;
  tabs: HTMLElement[];
  muteBtn: HTMLButtonElement; // 静音切换
}

export function createLayout(): { boardWrap: HTMLElement; sidebar: SidebarRefs } {
  const app = document.getElementById("app")!;
  clear(app);
  const boardWrap = el("div", { class: "board-wrap" });
  app.appendChild(boardWrap);

  const roundInfo = el("span", { class: "round-info" });
  const statusEl = el("div", { class: "status-bar", id: "status-bar" });
  const playersEl = el("div", { class: "players", id: "players" });
  // 签面:显示当前点数(一~六)。3D 骰子动画已全屏化(overlay),侧栏只留签面文字。
  const diceFace = el("span", { class: "dice-face", id: "dice-face" }, ["签"]);
  const rollBtn = el("button", { class: "btn btn-primary breathe", id: "roll-btn" }, ["行军"]) as HTMLButtonElement;
  const actionInline = el("div", { class: "action-inline", id: "action-inline" });
  const actionZone = el("div", { class: "action-zone" }, [diceFace, rollBtn, actionInline]);
  const handEl = el("div", { class: "hand", id: "hand" });
  const warlogList = el("div", { class: "warlog-list", id: "warlog" });
  const tabBrief = el("span", { class: "tab active", "data-mode": "brief" }, ["简报"]);
  const tabDetail = el("span", { class: "tab", "data-mode": "detail" }, ["详情"]);
  const tabs = [tabBrief, tabDetail];

  // 静音按钮(标题栏右侧)
  const muteBtn = el("button", { class: "mute-btn", id: "mute-btn", title: "静音/开音" }) as HTMLButtonElement;
  const muteIcon = el("img", { class: "mute-icon mute-on", src: "/assets/icons/volume.svg", alt: "" }) as HTMLImageElement;
  const muteIconOff = el("img", { class: "mute-icon mute-off", src: "/assets/icons/mute.svg", alt: "", style: "display:none" }) as HTMLImageElement;
  muteBtn.appendChild(muteIcon);
  muteBtn.appendChild(muteIconOff);

  const sidebar = el("div", { class: "sidebar" }, [
    el("div", { class: "title-banner" }, ["群雄逐鹿", el("small", {}, ["· 三国大富翁 ·"]), muteBtn]),
    // 4 区(玩家为主的重构):状态 / 动作 / 手牌 / 流(其他玩家+战报)
    el("div", { class: "zone status-zone section" }, [
      el("h3", {}, ["回合", roundInfo]),
      statusEl,
    ]),
    actionZone,
    el("div", { class: "zone hand-zone section" }, [
      el("h3", {}, ["手牌"]),
      handEl,
    ]),
    el("div", { class: "zone feed-zone section warlog" }, [
      el("h3", {}, ["诸侯 · 战报", el("span", { class: "tab-row" }, tabs)]),
      playersEl,
      warlogList,
    ]),
  ]);

  app.appendChild(sidebar);
  return {
    boardWrap,
    sidebar: { root: sidebar, roundInfo, statusEl, playersEl, diceFace, rollBtn, actionZone, actionInline, handEl, warlogList, tabs, muteBtn },
  };
}

/** P2: 常规决策(驻跸/选路/买扩军)渲染成侧栏内嵌按钮;非交互或复杂相位 → 清空(由 CSS :empty 收起)。
 *  按钮 data-action 走既有 dispatchAction(halt/continue/main/branch/buy/upgrade/skip)。
 *  复杂相位(招贤/珍宝交涉/破产)不在此处理,仍弹卷轴(要展示卡面)。 */
export function renderActionInline(engine: GameEngine, box: HTMLElement, interactive: boolean): void {
  clear(box);
  if (!interactive || engine.phase !== "Playing") return;
  const add = (label: string, action: string, opts: { primary?: boolean; disabled?: boolean } = {}) => {
    box.appendChild(
      el("button", {
        class: `btn ${opts.primary ? "btn-primary" : ""}`,
        "data-action": action,
        disabled: opts.disabled ?? false,
      }, [label]),
    );
  };
  const tp = engine.turnPhase;
  if (tp === "AwaitingCapitalHalt" && engine.lastMove) {
    const cap = engine.board.at(engine.lastMove.capitalIndex);
    const dest = engine.board.at(engine.lastMove.landIndex);
    add(`驻跸·${cap.name}`, "halt", { primary: true });
    add(`继续→${dest.name}`, "continue");
    return;
  }
  if (tp === "AwaitingBranch") {
    add("走大路", "main", { primary: true });
    add("入辅路", "branch");
    return;
  }
  if (tp === "AwaitingDecision") {
    const o = engine.lastLandOutcome;
    const p = engine.activePlayer;
    if (o?.kind === "PropertyAvailable" && o.property) {
      const def = o.property;
      const canBuy = p.cash >= def.purchasePrice && p.warrants >= 1;
      const reason = p.warrants < 1 ? "委任状不足" : "银两不足";
      add(canBuy ? `购地 ${formatMoney(def.purchasePrice)}·1委任` : `购地(${reason})`, "buy", { primary: canBuy, disabled: !canBuy });
      add("不取", "skip");
      return;
    }
    if (o?.kind === "OwnProperty" && o.property) {
      const def = o.property;
      const h = p.properties.find((x) => x.propertyId === def.id);
      const lvl = h?.level ?? 0;
      const canUp = lvl < def.maxLevel && p.cash >= def.upgradeCost;
      add(canUp ? `扩军 ${formatMoney(def.upgradeCost)}` : `扩军(${lvl >= def.maxLevel ? "满级" : "银两不足"})`, "upgrade", { primary: canUp, disabled: !canUp });
      add("按兵不动", "skip");
      return;
    }
  }
}
/** P3: 手牌区——渲染 viewSeat 玩家的珍宝 + 名士(小卡,带素材;点击 onDetail 看详情)。
 *  viewSeat:热座=activeIndex(屏幕跟随活跃玩家);联机=自己的 seat。 */
export function renderHand(
  engine: GameEngine,
  handEl: HTMLElement,
  viewSeat: number,
  onDetail: (kind: "treasure" | "hero", id: string) => void,
): void {
  clear(handEl);
  const p = engine.players[viewSeat];
  if (!p) return;
  for (const t of p.treasures) {
    const card = el("div", { class: "hand-card hand-treasure", title: `${t.name} · Lv${t.level}` });
    const img = treasureAssetImg(t.id, "hand-icon");
    if (img) card.appendChild(img);
    else card.appendChild(el("div", { class: "hand-icon-fallback" }, [`Lv${t.level}`]));
    card.appendChild(el("div", { class: "hc-name" }, [t.name]));
    card.addEventListener("click", () => onDetail("treasure", t.id));
    handEl.appendChild(card);
  }
  for (const h of p.heroes) {
    const card = el("div", { class: "hand-card hand-hero", title: `${h.name}·${h.title}` });
    const img = assetImg("hero:" + h.id, "hand-portrait");
    if (img) card.appendChild(img);
    else card.appendChild(el("div", { class: "hand-portrait-fallback" }, [h.name.slice(0, 1)]));
    card.appendChild(el("div", { class: "hc-name" }, [h.name]));
    card.addEventListener("click", () => onDetail("hero", h.id));
    handEl.appendChild(card);
  }
}

export function renderStatusBar(engine: GameEngine, statusEl: HTMLElement): void {
  clear(statusEl);
  if (engine.phase === "Setup") {
    statusEl.appendChild(el("div", { class: "status-line" }, ["开局布阵中…"]));
    return;
  }
  if (engine.phase === "GameOver") {
    const w = engine.winner;
    statusEl.appendChild(el("div", { class: "status-line status-over" }, [w ? `「${w.guohao}」称帝` : "终局"]));
    return;
  }
  const p = engine.activePlayer;
  const col = rgba(playerColor(p.colorIndex));
  statusEl.appendChild(
    el("div", { class: "status-card", style: `--player-color:${col};` }, [
      el("div", { class: "st-guohao" }, [p.guohao || "?"]),
      el("div", { class: "st-info" }, [
        el("div", { class: "st-turn" }, [`${p.guohao} 的回合`]),
        el("div", { class: "st-meta" }, [`${formatMoney(p.cash)} · 委任 ${p.warrants} · 身价 ${formatMoney(netWorth(p))}`]),
      ]),
    ]),
  );
}

/** 渲染战报(简报 / 详情)。增量追加已渲染数之后的新日志。 */
/** P4: 其他玩家紧凑条(国号 badge + 银两 + 城数 + 状态)。取代旧大玩家卡,省侧栏纵向空间。 */
export function renderOthers(engine: GameEngine, box: HTMLElement): void {
  clear(box);
  const activeId = engine.phase === "Playing" ? engine.activePlayer.id : null;
  for (const p of engine.players) {
    const col = rgba(playerColor(p.colorIndex));
    const cls = ["po-row"];
    if (p.id === activeId) cls.push("active");
    if (p.isBankrupt) cls.push("bankrupt");
    if (engine.isOver && engine.winner?.id === p.id) cls.push("winner");
    box.appendChild(
      el("div", { class: cls.join(" "), style: `--player-color:${col};` }, [
        el("span", { class: "po-guohao" }, [p.guohao || "?"]),
        el("span", { class: "po-name" }, [`${p.guohao || p.name}${p.isBot ? " 智" : ""}`]),
        el("span", { class: "po-cash" }, [formatMoney(p.cash)]),
        el("span", { class: "po-props" }, [`${p.properties.length}城`]),
      ]),
    );
  }
}

/** P4: 日志分类 → 图标(战报图标化)。 */
const LOG_ICON: Record<string, string> = {
  roll: "🎲", // 掷骰(保留 emoji;CSS .log-icon 统一着色)
  buy: "🏠",
  upgrade: "⬆",
  rent: "💸",
  supply: "🌾",
  branch: "⇄",
  halt: "🏯",
  treasure: "💎",
  trade: "💎",
  victory: "👑",
  system: "·",
  setup: "·",
};

export function renderWarlog(
  engine: GameEngine,
  listEl: HTMLElement,
  mode: "brief" | "detail",
  state: { rendered: number },
): void {
  listEl.classList.toggle("detail", mode === "detail");
  const all = engine.log;
  // 若已渲染数大于当前(切换模式/重置),全量重建
  if (state.rendered > all.length) {
    clear(listEl);
    state.rendered = 0;
  }
  const frag = document.createDocumentFragment();
  // 重建(state.rendered=0)时只渲染最近 300 条,避免渲染数千 DOM 节点再裁剪。
  // 增量(state.rendered>0)时从上次断点继续,不重复渲染旧条目。
  const start = state.rendered === 0 ? Math.max(0, all.length - 300) : state.rendered;
  for (let i = start; i < all.length; i++) {
    const e = all[i];
    const text = mode === "brief" ? e.brief : e.detail;
    const amt =
      e.amount != null
        ? ` (${e.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(e.amount))})`
        : "";
    const amtSpan = amt
      ? el("span", { class: `amt ${e.amount! >= 0 ? "pos" : "neg"}` }, [amt])
      : null;
    const icon = LOG_ICON[e.category] ?? "";
    const iconSpan = icon ? el("span", { class: "log-icon" }, [icon]) : null;
    const line = el("div", { class: `log-line log-cat-${e.category}` }, [iconSpan, text, amtSpan]);
    frag.appendChild(line);
  }
  listEl.appendChild(frag);
  state.rendered = all.length;
  // 限制 DOM 节点数,保留最近 300 条
  while (listEl.children.length > 300) listEl.removeChild(listEl.firstChild!);
  listEl.scrollTop = listEl.scrollHeight;
}

// ── 卷轴抉择弹层(驻跸 / 辅路)──
export function createScroll(
  parent: HTMLElement,
  title: string,
  desc: string,
  choices: { label: string | (Node | string)[]; action: string; primary?: boolean }[],
  onClose?: () => void,
): HTMLElement {
  const overlay = el("div", { class: "scroll-overlay" }, [
    el("div", { class: "scroll" }, [
      el("div", { class: "scroll-header" }, [
        el("h2", { class: "scroll-title" }, [title]),
      ]),
      el("p", {}, [desc]),
      el(
        "div",
        { class: "choices" },
        choices.map((c) =>
          el(
            "button",
            {
              class: `btn ${c.primary ? "btn-primary" : ""}`,
              "data-action": c.action,
            },
            Array.isArray(c.label) ? c.label : [c.label],
          ),
        ),
      ),
    ]),
  ]);
  const scrollEl = overlay.querySelector(".scroll") as HTMLElement;
  const headerEl = overlay.querySelector(".scroll-header") as HTMLElement;

  // × 关闭按钮挂进标题栏右侧;只有传 onClose 才可关(抉择类必须选,不误关)
  if (onClose) {
    const closeBtn = el("button", { class: "scroll-close", "aria-label": "关闭" }, ["×"]) as HTMLButtonElement;
    closeBtn.addEventListener("click", (ev) => { ev.stopPropagation(); onClose(); });
    headerEl.appendChild(closeBtn);
    // 点遮罩空白处关闭
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) onClose(); });
  }

  // 整条标题栏可拖(业界规范 title bar,大目标);在按钮上按下不触发拖动
  let dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
  headerEl.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest("button")) return; // 点按钮不拖
    const pe = ev as PointerEvent;
    dragging = true; sx = pe.clientX; sy = pe.clientY;
    try { headerEl.setPointerCapture(pe.pointerId); } catch { /* ignore */ }
  });
  headerEl.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const pe = ev as PointerEvent;
    bx += pe.clientX - sx; by += pe.clientY - sy;
    sx = pe.clientX; sy = pe.clientY;
    scrollEl.style.transform = `translate(${bx}px, ${by}px)`;
  });
  const endDrag = () => { dragging = false; };
  headerEl.addEventListener("pointerup", endDrag);
  headerEl.addEventListener("pointercancel", endDrag);
  parent.appendChild(overlay);
  return overlay;
}

// ── 确认框(选都)──
export function createConfirm(
  parent: HTMLElement,
  text: string,
  onConfirm: () => void,
  onCancel: () => void,
): HTMLElement {
  const overlay = el("div", { class: "scroll-overlay" }, [
    el("div", { class: "confirm-box" }, [
      el("p", { style: "font-family:var(--font-deco);font-size:17px;margin:0 0 14px;" }, [text]),
      el("div", { class: "choices" }, [
        el("button", { class: "btn btn-primary", "data-action": "confirm" }, ["确认筑城"]),
        el("button", { class: "btn", "data-action": "cancel" }, ["另择他城"]),
      ]),
    ]),
  ]);
  overlay.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.dataset.action === "confirm") {
      onConfirm();
    } else if (t.dataset.action === "cancel") {
      onCancel();
    }
  });
  parent.appendChild(overlay);
  return overlay;
}

// ── 胜利庆典屏 ──
export function createVictory(engine: GameEngine, onRestart: () => void): HTMLElement {
  const w = engine.winner!;
  const overlay = el("div", { class: "victory-overlay" }, [
    el("div", { class: "victory-title" }, ["天下归一"]),
    el("div", { class: "victory-sub", style: `color:${rgba(playerColor(w.colorIndex))}` }, [
      `「${w.guohao}」称帝`,
    ]),
    el("div", { class: "victory-info" }, [
      `终局身价 ${formatMoney(netWorth(w))} · 用时 ${engine.turnNumber} 回合 · ${engine.winReason === "LastStanding" ? "群雄尽灭" : "富甲天下"}`,
    ]),
    el("div", { class: "setup-actions", style: "margin-top:24px;" }, [
      el("button", { class: "btn btn-primary", id: "restart-btn" }, ["再战一局"]),
    ]),
  ]);
  overlay.querySelector("#restart-btn")!.addEventListener("click", onRestart);

  // 烟花粒子:多波随机绽放
  const fwColors = ["#d4af37", "#b23a2e", "#4a7a4a", "#2980b9", "#c47a2a", "#fff"];
  function spawnFireworkBurst(cx: number, cy: number) {
    const count = 16 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const dist = 60 + Math.random() * 80;
      const p = el("div", { class: "firework" });
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.background = fwColors[Math.floor(Math.random() * fwColors.length)];
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--fw-dur", `${1.2 + Math.random() * 0.6}s`);
      overlay.appendChild(p);
      setTimeout(() => p.remove(), 2000);
    }
  }
  // 连续放 5 波
  for (let wave = 0; wave < 5; wave++) {
    setTimeout(() => {
      const cx = 200 + Math.random() * 400;
      const cy = 150 + Math.random() * 250;
      spawnFireworkBurst(cx, cy);
    }, wave * 600 + 300);
  }

  return overlay;
}

// ── 开局设置屏 ──
export interface SetupResult {
  seats: SeatConfig[];
  targetNetWorth: number;
  startingCash: number;
  difficulty: "Simple" | "Normal";
  /** 选中的地图 id(延迟加载:起兵时才 loadMapById)。默认 sanguo。 */
  mapId?: string;
}

/** 选中地图变更回调(由 main.ts 传入:持久化到 localStorage)。 */
export type OnMapChange = (mapId: string) => void;

export function createSetupScreen(
  parent: HTMLElement,
  onStart: (r: SetupResult) => void,
  onEdit?: () => void,
  onOnline?: () => void,
  /** 初始选中的地图 id(来自 localStorage,默认 sanguo)。 */
  initialMapId: string = "sanguo",
  /** 地图源(传入则显示「选择地图」按钮 + 二级屏)。 */
  mapSource?: MapSource,
  /** 选中地图变更时回调(main.ts 用它存 localStorage)。 */
  onMapChange?: OnMapChange,
): void {
  const screen = el("div", { class: "setup-screen" });
  const card = el("div", { class: "setup-card" });

  // DEV 模式:诸侯数 / 目标身价 / 起始现金 自由输入;PROD:下拉受限(身价三档、现金固定 2500)
  const seatCountEl: HTMLElement = IS_DEV
    ? el("input", { id: "seat-count", type: "number", value: "4", min: "1", max: "30", step: "1", style: "width:5em" })
    : el("select", { id: "seat-count" }, [
        el("option", { value: "2" }, ["2 诸侯"]),
        el("option", { value: "3" }, ["3 诸侯"]),
        el("option", { value: "4", selected: true }, ["4 诸侯"]),
      ]);
  const targetEl: HTMLElement = IS_DEV
    ? el("input", { id: "target", type: "number", value: "8000", min: "500", step: "100", style: "width:6em" })
    : el("select", { id: "target" }, [
        el("option", { value: "5000" }, [`速战 ${formatMoney(5000)}`]),
        el("option", { value: "8000", selected: true }, [`标准 ${formatMoney(8000)}`]),
        el("option", { value: "12000" }, [`鏖战 ${formatMoney(12000)}`]),
      ]);
  const cashEl: HTMLElement | null = IS_DEV
    ? el("input", { id: "start-cash", type: "number", value: "2500", min: "0", step: "100", style: "width:6em" })
    : null;

  const diffSel = el("select", { id: "difficulty" }, [
    el("option", { value: "Normal", selected: true }, ["智将(EV)"]),
    el("option", { value: "Simple" }, ["庸才(随机)"]),
  ]) as HTMLSelectElement;

  const seatsBox = el("div", {});
  let focusedSeat = 0;
  const DEFAULT_GUOHAO = ["魏", "蜀", "吴", "燕"];

  function rebuildSeats() {
    clear(seatsBox);
    const n = Math.max(1, Math.min(30, parseInt((seatCountEl as HTMLInputElement).value, 10) || 4));
    focusedSeat = Math.min(focusedSeat, n - 1);
    seatsBox.appendChild(
      el("div", { class: "seat-row", style: "font-family:var(--font-deco);color:var(--ink-dim);border-bottom:2px solid rgba(140,110,60,0.4);" }, [
        el("span", {}, [""]),
        el("span", {}, ["国号"]),
        el("span", {}, ["类型"]),
        el("span", {}, [""]),
      ]),
    );
    for (let i = 0; i < n; i++) {
      const isBot = i >= 1 && i >= n - Math.ceil(n / 2); // 后半默认电脑
      const color = rgba(playerColor(i));
      const input = el("input", { type: "text", maxlength: "1", "data-seat": String(i), placeholder: "？" }) as HTMLInputElement;
      input.disabled = isBot;
      input.value = isBot ? "机" : DEFAULT_GUOHAO[i] ?? "";
      input.addEventListener("focus", () => (focusedSeat = i));
      const sel = el("select", { "data-seat": String(i) }, [
        el("option", { value: "human", selected: !isBot }, ["人类"]),
        el("option", { value: "bot", selected: isBot }, ["电脑"]),
      ]) as HTMLSelectElement;
      sel.addEventListener("change", () => {
        const bot = sel.value === "bot";
        input.disabled = bot;
        input.value = bot ? "机" : DEFAULT_GUOHAO[i] ?? "";
      });
      seatsBox.appendChild(
        el("div", { class: "seat-row" }, [
          el("span", { class: "pc-guohao", style: `background:${color};width:26px;height:26px;font-size:18px;` }, [String(i + 1)]),
          input,
          sel,
          el("span", {}, []),
        ]),
      );
    }
  }
  seatCountEl.addEventListener("change", rebuildSeats);
  rebuildSeats();

  // 字盘快选
  const pool = el("div", { class: "guohao-pool" });
  for (const ch of GUOHAO_POOL.slice(0, 26)) {
    const s = el("span", {}, [ch]);
    s.addEventListener("click", () => {
      const inputs = seatsBox.querySelectorAll("input[data-seat]");
      const target = inputs[focusedSeat] as HTMLInputElement | undefined;
      if (target && !target.disabled) {
        target.value = ch;
        focusedSeat = Math.min(focusedSeat + 1, inputs.length - 1);
        (inputs[focusedSeat] as HTMLInputElement)?.focus();
      }
    });
    pool.appendChild(s);
  }

  const hint = el("div", { class: "setup-hint" }, ["立国号、定诸侯,起兵逐鹿天下。"]);
  const startBtn = el("button", { class: "btn btn-primary", id: "start-btn" }, ["起兵"]) as HTMLButtonElement;
  const editBtn = el("button", { class: "btn", id: "edit-btn", style: "margin-left:10px" }, ["编辑地图"]) as HTMLButtonElement;
  editBtn.addEventListener("click", () => onEdit?.());
  const onlineBtn = onOnline ? (el("button", { class: "btn", id: "online-btn", style: "margin-left:10px" }, ["联机对战"]) as HTMLButtonElement) : null;
  onlineBtn?.addEventListener("click", () => onOnline?.());

  // 当前选中的地图 id(可被「选择地图」二级屏改写)。默认 initialMapId(localStorage 记忆)。
  let selectedMapId = initialMapId;
  // 当前选中地图的展示名(默认用 id 占位,二级屏选定后会刷新为真实 name)。
  const currentMapNameEl = el("span", { id: "selected-map-name", style: "font-family:var(--font-deco);color:var(--ink);" }, [initialMapId]);
  // 「选择地图」按钮:传入 mapSource 才显示。点击打开二级屏。
  const selectMapBtn = mapSource
    ? (el("button", { class: "btn", id: "select-map-btn", style: "margin-left:10px" }, ["选择地图"]) as HTMLButtonElement)
    : null;
  selectMapBtn?.addEventListener("click", () => {
    createMapSelectionScreen(parent, mapSource!, selectedMapId, (mapId, name) => {
      selectedMapId = mapId;
      currentMapNameEl.textContent = name;
      onMapChange?.(mapId);
    }, () => { /* 取消:无操作,保留原选择 */ });
  });
  // 首次显示设置屏:异步解析当前选中地图的展示名(id → name)。
  if (selectMapBtn) {
    void mapSource!.listMaps().then((entries) => {
      const found = entries.find((e) => e.id === selectedMapId);
      if (found) currentMapNameEl.textContent = found.name;
    }).catch(() => { /* 忽略:保留 id 兜底 */ });
  }

  card.appendChild(el("h3", { style: "font-family:var(--font-deco);font-size:16px;margin:0 0 10px;letter-spacing:3px;" }, ["开局布阵"]));
  card.appendChild(
    el(
      "div",
      { class: "seat-row", style: IS_DEV ? "grid-template-columns:1fr 1fr 1fr 1fr;" : "grid-template-columns:1fr 1fr 1fr;" },
      [
        el("label", {}, ["诸侯数 ", seatCountEl]),
        el("label", {}, ["目标身价 ", targetEl]),
        el("label", {}, ["AI 难度 ", diffSel]),
        ...(cashEl ? [el("label", {}, ["起始现金 ", cashEl])] : []),
      ],
    ),
  );
  card.appendChild(seatsBox);
  card.appendChild(el("div", { style: "font-size:12px;color:var(--ink-dim);margin:8px 0 2px;font-family:var(--font-deco);" }, ["字盘快选国号:"]));
  card.appendChild(pool);
  // 当前选中地图展示行(仅在「选择地图」入口可用时显示)
  if (selectMapBtn) {
    card.appendChild(
      el("div", { style: "font-size:13px;margin:10px 0 2px;font-family:var(--font-deco);color:var(--ink-dim);display:flex;align-items:center;gap:8px;" }, [
        el("span", {}, ["当前地图:"]),
        currentMapNameEl,
      ]),
    );
  }
  card.appendChild(
    el(
      "div",
      { class: "setup-actions" },
      [startBtn, editBtn, ...(selectMapBtn ? [selectMapBtn] : []), ...(onlineBtn ? [onlineBtn] : [])],
    ),
  );
  card.appendChild(hint);

  startBtn.addEventListener("click", () => {
    const n = Math.max(1, Math.min(30, parseInt((seatCountEl as HTMLInputElement).value, 10) || 4));
    const seats: SeatConfig[] = [];
    const used = new Set<string>();
    for (let i = 0; i < n; i++) {
      const input = seatsBox.querySelector(`input[data-seat="${i}"]`) as HTMLInputElement;
      const sel = seatsBox.querySelector(`select[data-seat="${i}"]`) as HTMLSelectElement;
      const isBot = sel.value === "bot";
      let guohao = input.value.trim();
      if (!isBot) {
        if (!isSingleCjk(guohao)) {
          hint.textContent = `诸侯 ${i + 1} 的国号需为单个汉字。`;
          return;
        }
        if (used.has(guohao)) {
          hint.textContent = `国号「${guohao}」已被其他诸侯使用。`;
          return;
        }
        used.add(guohao);
      } else {
        guohao = ""; // bot 由引擎分配
      }
      seats.push({ name: `诸侯${i + 1}`, isBot, guohao: isBot ? undefined : guohao });
    }
    const humans = seats.filter((s) => !s.isBot).length;
    if (humans === 0 && !IS_DEV) {
      hint.textContent = "至少需要一位人类诸侯。";
      return;
    }
    const tnw = parseInt((targetEl as HTMLInputElement).value, 10);
    const cash = cashEl ? parseInt((cashEl as HTMLInputElement).value, 10) : 2500;
    onStart({
      seats,
      targetNetWorth: Number.isFinite(tnw) ? tnw : 8000,
      startingCash: Number.isFinite(cash) ? cash : 2500,
      difficulty: diffSel.value as "Simple" | "Normal",
      mapId: selectedMapId,
    });
  });

  screen.appendChild(el("h1", {}, ["群雄逐鹿"]));
  screen.appendChild(el("div", { class: "subtitle" }, ["— 三国大富翁 —"]));
  screen.appendChild(card);
  parent.appendChild(screen);
}

// ── 选择地图二级屏 ──
// 列出 mapSource.listMaps() 的全部条目(内置 + 自建),每项展示名称/城池数/目标身价/描述。
// 点击某项展开实时 SVG 棋盘预览(复用 createBoardSvg,需先 loadMapById)。
// 「确认选择」回设置屏,带回调选定的 mapId。
export function createMapSelectionScreen(
  parent: HTMLElement,
  mapSource: MapSource,
  currentMapId: string,
  onConfirm: (mapId: string, name: string) => void,
  onCancel: () => void,
): void {
  const overlay = el("div", { class: "map-select-overlay" });
  const panel = el("div", { class: "map-select-panel" });

  panel.appendChild(el("h3", { style: "font-family:var(--font-deco);font-size:16px;margin:0 0 12px;letter-spacing:3px;" }, ["选择地图"]));
  const loadingHint = el("div", { style: "color:var(--ink-dim);font-family:var(--font-deco);padding:24px 0;" }, ["载入地图清单…"]);
  panel.appendChild(loadingHint);

  overlay.appendChild(panel);
  parent.appendChild(overlay);

  // 当前在二级屏内选中的 mapId(临时态,确认后才回传)。默认 = 进来时的 currentMapId。
  let picked = currentMapId;
  // 预览容器(点击某项时填充 SVG;一次只渲一张)
  let previewBox: HTMLElement | null = null;

  // 异步加载清单后渲染列表
  void mapSource.listMaps().then((entries: MapEntry[]) => {
    if (!entries.length) {
      loadingHint.textContent = "暂无可用地图。";
      return;
    }
    clear(panel);
    panel.appendChild(el("h3", { style: "font-family:var(--font-deco);font-size:16px;margin:0 0 12px;letter-spacing:3px;" }, ["选择地图"]));
    const list = el("div", { class: "map-list", style: "display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;" });
    for (const e of entries) {
      const isSelected = e.id === currentMapId;
      const card = el(
        "div",
        {
          class: `map-item${isSelected ? " selected" : ""}`,
          "data-map-id": e.id,
          style:
            "border:1px solid rgba(140,110,60,0.4);border-radius:8px;padding:10px 12px;cursor:pointer;background:rgba(247,236,208,0.6);" +
            (isSelected ? "border-color:var(--gold,#b8941f);background:rgba(184,148,31,0.1);" : ""),
        },
        [
          el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:8px;" }, [
            el("span", { style: "font-family:var(--font-deco);font-size:15px;font-weight:700;color:var(--ink);" }, [e.name]),
            el("span", { style: "font-size:12px;color:var(--ink-dim);" }, [`${e.tileCount} 城 · 目标 ${formatMoney(e.targetNetWorth)}`]),
          ]),
          el("div", { style: "font-size:12px;color:var(--ink-dim);margin-top:4px;" }, [e.desc]),
        ],
      );
      // 点击某项:选中 + 展开实时 SVG 预览(异步 loadMapById → createBoardSvg)
      card.addEventListener("click", () => {
        // 更新选中态(单选视觉)
        list.querySelectorAll(".map-item").forEach((n) => n.classList.remove("selected"));
        card.classList.add("selected");
        picked = e.id;
        // 渲染预览:一次只一张,先清旧预览
        if (previewBox) {
          previewBox.remove();
          previewBox = null;
        }
        previewBox = el("div", { class: "map-preview", style: "margin-top:8px;border-top:1px dashed rgba(140,110,60,0.4);padding-top:10px;" });
        const previewLoading = el("div", { style: "color:var(--ink-dim);font-size:12px;font-family:var(--font-deco);padding:8px 0;" }, [`预览「${e.name}」加载中…`]);
        previewBox.appendChild(previewLoading);
        panel.appendChild(previewBox);
        // 异步加载并渲染棋盘(延迟加载:预览时才 loadMapById)
        void loadMapById(mapSource, e.id)
          .then((loaded) => {
            clear(previewBox!);
            const view = createBoardSvg(loaded.board, loaded.catalog);
            const svgRoot = view.root;
            svgRoot.style.maxWidth = "100%";
            svgRoot.style.height = "auto";
            svgRoot.style.maxHeight = "40vh";
            svgRoot.style.background = "#e8dcc0";
            svgRoot.style.borderRadius = "6px";
            previewBox!.appendChild(svgRoot);
          })
          .catch((err) => {
            clear(previewBox!);
            previewBox!.appendChild(el("div", { style: "color:#b23a2e;font-size:12px;" }, [`预览失败:${(err as Error).message}`]));
          });
      });
      list.appendChild(card);
    }
    panel.appendChild(list);

    previewBox = el("div", { class: "map-preview", style: "margin-top:8px;" });
    panel.appendChild(previewBox);

    // 操作栏:确认选择 / 取消
    panel.appendChild(
      el("div", { class: "setup-actions", style: "margin-top:12px;" }, [
        el("button", { class: "btn", id: "map-cancel-btn" }, ["取消"]),
        el("button", { class: "btn btn-primary", id: "map-confirm-btn" }, ["确认选择"]),
      ]),
    );
    const confirmBtn = panel.querySelector("#map-confirm-btn") as HTMLButtonElement;
    const cancelBtn = panel.querySelector("#map-cancel-btn") as HTMLButtonElement;
    confirmBtn.addEventListener("click", () => {
      const entry = entries.find((x) => x.id === picked);
      overlay.remove();
      onConfirm(picked, entry ? entry.name : picked);
    });
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      onCancel();
    });
  });
}

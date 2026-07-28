// UI 结构工厂:整体布局、右侧侧栏、开局设置屏、卷轴抉择/确认/胜利弹层。
import type { GameEngine } from "@core/game";
import type { SeatConfig } from "@core/game";
import { playerColor, rgba, GUOHAO_POOL } from "@core/theme";
import { netWorth } from "@core/networth";
import { formatMoney } from "@core/money";
import { isSingleCjk } from "@core/constants";
import { el, clear } from "./dom";
import { IS_DEV } from "../version";

export interface SidebarRefs {
  root: HTMLElement;
  roundInfo: HTMLElement;
  playersEl: HTMLElement;
  diceFace: HTMLElement;
  rollBtn: HTMLButtonElement;
  actionZone: HTMLElement;
  warlogList: HTMLElement;
  tabs: HTMLElement[];
}

export function createLayout(): { boardWrap: HTMLElement; sidebar: SidebarRefs } {
  const app = document.getElementById("app")!;
  clear(app);
  const boardWrap = el("div", { class: "board-wrap" });
  app.appendChild(boardWrap);

  const roundInfo = el("span", { class: "round-info" });
  const playersEl = el("div", { class: "players", id: "players" });
  const diceFace = el("span", { class: "dice-face", id: "dice-face" }, ["签"]);
  const rollBtn = el("button", { class: "btn btn-primary breathe", id: "roll-btn" }, ["行军"]) as HTMLButtonElement;
  const actionZone = el("div", { class: "action-zone" }, [diceFace, rollBtn]);
  const warlogList = el("div", { class: "warlog-list", id: "warlog" });
  const tabBrief = el("span", { class: "tab active", "data-mode": "brief" }, ["简报"]);
  const tabDetail = el("span", { class: "tab", "data-mode": "detail" }, ["详情"]);
  const tabs = [tabBrief, tabDetail];

  const sidebar = el("div", { class: "sidebar" }, [
    el("div", { class: "title-banner" }, ["群雄逐鹿", el("small", {}, ["· 三国大富翁 ·"])]),
    el("div", { class: "section" }, [
      el("h3", {}, ["诸侯", roundInfo]),
      playersEl,
    ]),
    actionZone,
    el("div", { class: "section warlog" }, [
      el("h3", {}, ["战报", el("span", { class: "tab-row" }, tabs)]),
      warlogList,
    ]),
  ]);

  app.appendChild(sidebar);
  return { boardWrap, sidebar: { root: sidebar, roundInfo, playersEl, diceFace, rollBtn, actionZone, warlogList, tabs } };
}

/** 渲染玩家卡列表。 */
export function renderPlayers(engine: GameEngine, playersEl: HTMLElement): void {
  clear(playersEl);
  const activeId = engine.phase === "Playing" ? engine.activePlayer.id : null;
  for (const p of engine.players) {
    const col = rgba(playerColor(p.colorIndex));
    const cls = ["player-card"];
    if (p.id === activeId) cls.push("active");
    if (p.isBankrupt) cls.push("bankrupt");
    if (engine.isOver && engine.winner?.id === p.id) cls.push("winner");
    const capitalName = p.capitalIndex >= 0 ? engine.board.at(p.capitalIndex).name : "—";
    const card = el(
      "div",
      { class: cls.join(" "), style: `--player-color:${col};` },
      [
        el("div", { class: "pc-guohao" }, [p.guohao || "?"]),
        el("div", { class: "pc-info" }, [
          el("div", { class: "pc-name" }, [
            p.guohao || p.name,
            ...(p.isBot ? [el("span", { class: "bot-tag" }, ["智"])] : []),
          ]),
          el("div", { class: "pc-meta" }, [`${p.properties.length}城 · 都${capitalName}`]),
          ...(p.heroes.length ? [el("div", { class: "pc-heroes" }, [p.heroes.map((h) => h.name).join(" · ")])] : []),
        ]),
        el("div", {}, [
          el("div", { class: "pc-cash" }, [formatMoney(p.cash)]),
          el("div", { class: "pc-warrants" }, [`委任 ${p.warrants}`]),
          el("div", { class: "pc-networth" }, [`身价 ${formatMoney(netWorth(p))}`]),
        ]),
      ],
    );
    playersEl.appendChild(card);
  }
}

/** 渲染战报(简报 / 详情)。增量追加已渲染数之后的新日志。 */
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
  for (let i = state.rendered; i < all.length; i++) {
    const e = all[i];
    const text = mode === "brief" ? e.brief : e.detail;
    const amt =
      e.amount != null
        ? ` (${e.amount >= 0 ? "+" : "−"}${formatMoney(Math.abs(e.amount))})`
        : "";
    const amtSpan = amt
      ? el("span", { class: `amt ${e.amount! >= 0 ? "pos" : "neg"}` }, [amt])
      : null;
    const line = el("div", { class: `log-line log-cat-${e.category}` }, [text, amtSpan]);
    frag.appendChild(line);
  }
  listEl.appendChild(frag);
  state.rendered = all.length;
  // 限制 DOM 节点数,保留最近 300 条
  while (listEl.children.length > 300) listEl.removeChild(listEl.firstChild!);
  listEl.scrollTop = listEl.scrollHeight;
}

// ── 卷轴抉择弹层(驻跸 / 支线)──
export function createScroll(
  parent: HTMLElement,
  title: string,
  desc: string,
  choices: { label: string; action: string; primary?: boolean; danger?: boolean }[],
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
              class: `btn ${c.primary ? "btn-primary" : ""} ${c.danger ? "btn-danger" : ""}`,
              "data-action": c.action,
            },
            [c.label],
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

// ── 决策弹层(买地 / 扩军 / 放弃)──
export function createDecisionScroll(
  parent: HTMLElement,
  engine: GameEngine,
): HTMLElement | null {
  const outcome = engine.lastLandOutcome;
  if (!outcome) return null;
  const tile = engine.board.at(engine.activePlayer.position);
  if (outcome.kind === "PropertyAvailable" && outcome.property) {
    const def = outcome.property;
    const rentList = def.rentByLevel.slice(0, 3).map((r, i) => `L${i} ${formatMoney(r)}`).join(" / ");
    const buyer = engine.activePlayer;
    const canBuy = buyer.cash >= def.purchasePrice && buyer.warrants >= 1;
    const reason = buyer.warrants < 1 ? "委任状不足" : buyer.cash < def.purchasePrice ? "银两不足" : null;
    return createScroll(parent, `进驻「${tile.name}」`, `购入价 ${formatMoney(def.purchasePrice)} · 消耗 1 委任状 · 租金 ${rentList}…`, [
      { label: reason ? `购地(${reason})` : `购地 (1委任 + ${formatMoney(def.purchasePrice)})`, action: "buy", primary: canBuy },
      { label: "不取", action: "skip" },
    ]);
  }
  if (outcome.kind === "OwnProperty" && outcome.property) {
    const def = outcome.property;
    const h = engine.activePlayer.properties.find((x) => x.propertyId === def.id);
    const canUp = (h?.level ?? 0) < def.maxLevel && engine.activePlayer.cash >= def.upgradeCost;
    return createScroll(parent, `经营「${tile.name}」`, `当前 Lv.${h?.level ?? 0} · 扩军 ${formatMoney(def.upgradeCost)} → 升租`, [
      { label: `扩军 ${formatMoney(def.upgradeCost)}`, action: "upgrade", primary: canUp },
      { label: "按兵不动", action: "skip" },
    ]);
  }
  return null;
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
  return overlay;
}

// ── 开局设置屏 ──
export interface SetupResult {
  seats: SeatConfig[];
  targetNetWorth: number;
  startingCash: number;
  difficulty: "Simple" | "Normal";
}

export function createSetupScreen(parent: HTMLElement, onStart: (r: SetupResult) => void, onEdit?: () => void): void {
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
  card.appendChild(el("div", { class: "setup-actions" }, [startBtn, editBtn]));
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
    });
  });

  screen.appendChild(el("h1", {}, ["群雄逐鹿"]));
  screen.appendChild(el("div", { class: "subtitle" }, ["— 三国大富翁 —"]));
  screen.appendChild(card);
  parent.appendChild(screen);
}

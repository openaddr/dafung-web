// 联机客户端(红线 4:state.ts 拆出的 network-client)。
// 与热座 App 并存:不跑引擎,只持一份「只读引擎」——收到服务器 snapshot 即
// restoreFromSnapshot 重 hydrate,复用全部渲染层(renderPlayers/boardView/createScroll…)。
// 本地玩家的操作 → WS 发 GameCommand;bot/远程玩家的动作 → 由服务器逐步广播 snapshot 驱动渲染。
import type { LoadedMap } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { createBoardSvg } from "./board";
import type { BoardView } from "./board";
import { createAnimator } from "./animate";
import type { Animator } from "./animate";
import { ThreeDice } from "./dice3d";
import { SynthAudioPlayer } from "./audio";
import type { AudioPlayer } from "./audio";
import { createLayout, renderActionInline, renderHand, renderOthers, renderStatusBar, renderWarlog, createScroll, createVictory } from "./ui";
import type { SidebarRefs } from "./ui";
import { el } from "./dom";
import { SIGN_FACES, TAP_MAX_MOVE } from "@core/constants";
import { guidePriceOf } from "@core/treasures";
import { loadAssetManifest, assetImg, treasureAssetImg } from "./assets";

type Snapshot = ReturnType<GameEngine["snapshot"]>;
interface SeatMeta {
  seat: number;
  kind: "human" | "bot";
  taken: boolean;
  online: boolean;
  controlled: boolean;
}
type ServerMsg =
  | { type: "lobby"; roomId: string; seatCount: number; host: number; started: boolean; seats: SeatMeta[] }
  | ({ type: "snapshot"; roomId: string; host: number; seats: SeatMeta[] } & Snapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

export class NetworkClient {
  engine: GameEngine; // 只读:每次 snapshot 用 restoreFromSnapshot 重 hydrate
  boardView: BoardView;
  animator: Animator;
  threeDice: ThreeDice;
  audio: AudioPlayer;
  refs: SidebarRefs;
  boardWrap: HTMLElement;

  private serverUrl: string;
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  seat = -1;
  private seatToken: string | null = null;
  private roomMeta: { host: number; seats: SeatMeta[]; seatCount: number; started: boolean } | null = null;

  busy = false;
  private warlogMode: "brief" | "detail" = "brief";
  private warlogState = { rendered: 0 };
  private overlay: HTMLElement | null = null;
  private lobbyOverlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;

  constructor(map: LoadedMap, serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
    // 占位引擎:只为渲染就位(board/catalog 来自真实地图);首帧 snapshot 会覆盖全部可变状态。
    this.engine = new GameEngine(map.board, map.catalog, createDice(), {
      seats: [
        { name: "座 1", isBot: false },
        { name: "座 2", isBot: true },
      ],
    });
    const { boardWrap, sidebar } = createLayout();
    this.boardWrap = boardWrap;
    this.refs = sidebar;
    this.boardView = createBoardSvg(map.board, map.catalog, { panZoom: true });
    boardWrap.appendChild(this.boardView.root);
    const resetBtn = el("button", { class: "btn board-reset", title: "还原总览" }, ["总览"]) as HTMLButtonElement;
    resetBtn.addEventListener("click", () => this.boardView.resetView());
    boardWrap.appendChild(resetBtn);
    const physicsRng = createDice().nextFloat;
    this.threeDice = new ThreeDice(this.refs.dice3d, physicsRng, (i) => this.audio.play("diceHit", { intensity: i }));
    this.audio = new SynthAudioPlayer();
    this.animator = createAnimator(boardWrap, this.boardView.root, map.board, this.boardView, this.threeDice, this.audio);
    this.bindEvents();
    this.fullRender();
    void loadAssetManifest().then(() => this.fullRender());
    this.showConnectScreen();
  }

  // ─────────────────────────── 大厅(REST + WS 握手)───────────────────────────
  private http(path: string, body: unknown): Promise<any> {
    return fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      return j;
    });
  }

  private showConnectScreen() {
    this.hideOverlay();
    const overlay = el("div", { class: "scroll-overlay" });
    const box = el("div", { class: "scroll", style: "max-width:420px;" });
    box.appendChild(el("h2", { class: "scroll-title" }, ["联机对局"]));
    const urlIn = el("input", { class: "input", value: this.serverUrl, placeholder: "服务器地址" }) as HTMLInputElement;
    box.appendChild(el("label", { class: "field" }, ["服务器 ", urlIn]));

    // 建房
    const seatsSel = el("select", { class: "input" }) as HTMLSelectElement;
    for (const n of [2, 3, 4]) seatsSel.appendChild(el("option", { value: String(n) }, [`${n} 座`]));
    const botIn = el("input", { class: "input", placeholder: "bot 座位号,逗号分隔(如 1,2)", style: "width:160px;" }) as HTMLInputElement;
    const seedIn = el("input", { class: "input", placeholder: "种子(可空)", style: "width:100px;" }) as HTMLInputElement;
    const createBtn = el("button", { class: "btn btn-primary" }, ["建房"]) as HTMLButtonElement;
    createBtn.addEventListener("click", async () => {
      try {
        this.serverUrl = urlIn.value.trim().replace(/\/$/, "");
        const seats = parseInt(seatsSel.value, 10);
        const bot = botIn.value.trim();
        const seed = seedIn.value.trim() ? parseInt(seedIn.value, 10) : undefined;
        const r = await this.http("/room/new", { seats, bot, seed });
        this.roomId = r.roomId;
        this.seat = r.seat;
        this.seatToken = r.seatToken;
        this.connect();
        this.showLobby(true);
      } catch (err) {
        this.flashHint((err as Error).message);
      }
    });
    box.appendChild(el("div", { class: "field", style: "margin-top:14px;" }, [
      el("div", { style: "font-weight:600;margin-bottom:6px;" }, ["建房"]),
      seatsSel, botIn, seedIn, createBtn,
    ]));

    // 加入
    const codeIn = el("input", { class: "input", placeholder: "房间码", style: "width:120px;text-transform:uppercase;" }) as HTMLInputElement;
    const joinBtn = el("button", { class: "btn" }, ["加入"]) as HTMLButtonElement;
    joinBtn.addEventListener("click", async () => {
      try {
        this.serverUrl = urlIn.value.trim().replace(/\/$/, "");
        const r = await this.http("/room/join", { roomId: codeIn.value.trim().toUpperCase() });
        this.roomId = r.roomId;
        this.seat = r.seat;
        this.seatToken = r.seatToken;
        this.connect();
        this.showLobby(false);
      } catch (err) {
        this.flashHint((err as Error).message);
      }
    });
    box.appendChild(el("div", { class: "field", style: "margin-top:10px;" }, [
      el("div", { style: "font-weight:600;margin-bottom:6px;" }, ["加入"]),
      codeIn, joinBtn,
    ]));
    overlay.appendChild(box);
    this.lobbyOverlay = overlay;
    this.boardWrap.appendChild(overlay);
  }

  private showLobby(isHost: boolean) {
    this.lobbyOverlay?.remove();
    const overlay = el("div", { class: "scroll-overlay" });
    const box = el("div", { class: "scroll", style: "max-width:380px;" });
    box.appendChild(el("h2", { class: "scroll-title" }, ["大厅"]));
    const codeBox = el("div", { class: "lobby-code", style: "font-size:34px;letter-spacing:6px;font-family:var(--font-deco);text-align:center;margin:10px 0;" }, [this.roomId ?? "????"]);
    box.appendChild(codeBox);
    box.appendChild(el("p", { style: "text-align:center;color:var(--ink-dim,#9c6b3f);" }, [
      isHost ? "把房间码发给同好;点开局后未满座位自动 bot 填充。" : "等待房主开局…",
    ]));
    const seatList = el("div", { class: "lobby-seats", style: "margin:10px 0;" });
    box.appendChild(seatList);
    const renderSeats = () => {
      seatList.innerHTML = "";
      const seats = this.roomMeta?.seats ?? [];
      for (const s of seats) {
        const tag = s.seat === this.seat ? "你" : s.kind === "bot" ? "bot" : s.taken ? "人" : "空";
        const host = s.seat === (this.roomMeta?.host ?? 0) ? " · 房主" : "";
        seatList.appendChild(el("div", { style: `padding:4px 0;${s.seat === this.seat ? "font-weight:700;" : ""}` }, [
          `座 ${s.seat + 1} · ${tag}${host}${s.taken && !s.online ? " · 离线" : ""}`,
        ]));
      }
    };
    renderSeats();
    this.lobbyOverlay = overlay;
    (overlay as any)._renderSeats = renderSeats;
    if (isHost) {
      const startBtn = el("button", { class: "btn btn-primary", style: "display:block;margin:10px auto 0;" }, ["开局"]) as HTMLButtonElement;
      startBtn.addEventListener("click", async () => {
        try {
          startBtn.disabled = true;
          await this.http("/room/start", { roomId: this.roomId, seatToken: this.seatToken });
          // 开局后服务器会广播 snapshot,onSnapshot 收到即进入对局
        } catch (err) {
          startBtn.disabled = false;
          this.flashHint((err as Error).message);
        }
      });
      box.appendChild(startBtn);
    }
    overlay.appendChild(box);
    this.boardWrap.appendChild(overlay);
  }

  private connect() {
    if (!this.roomId || this.seat < 0 || !this.seatToken) return;
    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/ws?room=${this.roomId}&seat=${this.seat}&token=${this.seatToken}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    this.ws.onclose = () => {
      // 非被解散的断开:提示重连(简化:大厅态提示;对局态停留)
      if (this.lobbyOverlay == null && this.engine.phase !== "GameOver") this.flashHint("连接断开,请刷新重连");
    };
    this.ws.onerror = () => this.flashHint("连接错误");
  }

  private onMessage(msg: ServerMsg) {
    if (msg.type === "lobby") {
      this.roomMeta = { host: msg.host, seats: msg.seats, seatCount: msg.seatCount, started: msg.started };
      const rerender = (this.lobbyOverlay as any)?._renderSeats;
      if (rerender) rerender();
      return;
    }
    if (msg.type === "snapshot") {
      this.roomMeta = { host: msg.host, seats: msg.seats, seatCount: msg.seats.length, started: true };
      this.lobbyOverlay?.remove();
      this.lobbyOverlay = null;
      this.engine.restoreFromSnapshot(msg as unknown as Snapshot);
      this.busy = false;
      this.animator.spawnFloaters(this.engine); // 浮动金额反馈(若引擎有)
      this.fullRender();
      this.refreshDecision();
      return;
    }
    if (msg.type === "dismissed") {
      this.lobbyOverlay?.remove();
      this.lobbyOverlay = null;
      this.overlay?.remove();
      this.overlay = null;
      this.flashHint("房主已解散房间");
      setTimeout(() => this.showConnectScreen(), 800);
    }
  }

  // ─────────────────────────── 渲染 ───────────────────────────
  private fullRender() {
    const e = this.engine;
    renderStatusBar(e, this.refs.statusEl);
    renderOthers(e, this.refs.playersEl);
    this.boardView.updateTiles(e);
    this.boardView.updateTokens(e);
    this.refs.roundInfo.textContent =
      e.phase === "Playing" ? `· 第 ${e.turnNumber} 回合` : e.phase === "GameOver" ? "· 终局" : "";
    this.refs.diceFace.textContent = e.lastRoll ? SIGN_FACES[e.lastRoll.die - 1] : "签";
    const interactive = this.isMyDecision() && !this.busy;
    // P2: 常规决策内嵌到侧栏 actionInline;复杂相位仍弹卷轴
    renderActionInline(e, this.refs.actionInline, interactive);
    // P3: 手牌(联机=自己的 seat)
    renderHand(e, this.refs.handEl, this.seat, (k, id) => this.showHandDetail(k, id));
    const canRoll = interactive && e.turnPhase === "Roll";
    this.refs.rollBtn.disabled = !canRoll;
    this.refs.rollBtn.classList.toggle("breathe", canRoll);
    renderWarlog(e, this.refs.warlogList, this.warlogMode, this.warlogState);
  }

  private bindEvents() {
    this.refs.rollBtn.addEventListener("click", () => this.onRoll());
    let downIdx: number | null = null;
    let dx = 0;
    let dy = 0;
    this.boardWrap.addEventListener("pointerdown", (ev) => {
      const tileEl = (ev.target as Element | null)?.closest("[data-tile]") ?? null;
      downIdx = tileEl ? Number(tileEl.getAttribute("data-tile")) : null;
      dx = ev.clientX;
      dy = ev.clientY;
    });
    this.boardWrap.addEventListener("pointerup", (ev) => {
      const idx = downIdx;
      downIdx = null;
      if (idx == null || Number.isNaN(idx)) return;
      if ((ev.clientX - dx) ** 2 + (ev.clientY - dy) ** 2 > TAP_MAX_MOVE * TAP_MAX_MOVE) return;
      this.onTileClick(idx);
    });
    this.boardWrap.addEventListener("click", (ev) => {
      const action = (ev.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action) {
        ev.stopPropagation();
        this.dispatchAction(action);
      }
    });
    // P2: 侧栏内嵌动作按钮(常规决策)走同一 dispatch
    this.refs.root.addEventListener("click", (ev) => {
      const action = (ev.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action) {
        ev.stopPropagation();
        this.dispatchAction(action);
      }
    });
    for (const tab of this.refs.tabs) {
      tab.addEventListener("click", () => {
        this.warlogMode = tab.getAttribute("data-mode") as "brief" | "detail";
        this.refs.tabs.forEach((x) => x.classList.toggle("active", x === tab));
        this.warlogState.rendered = 0;
        this.refs.warlogList.innerHTML = "";
        this.fullRender();
      });
    }
  }

  private onTileClick(idx: number) {
    // 对局中只读查看城池详情(不弹决策卷轴——决策由 refreshDecision 管)
    const e = this.engine;
    if (e.phase !== "Playing" || this.overlay != null) return;
    const tile = e.board.at(idx);
    const def = e.catalog.get(tile.propertyId);
    if (!def) return;
    const owner = e.findOwner(def.id);
    this.openScroll(`「${tile.name}」`, `${tile.region} · ${owner ? "持有:" + owner.guohao : "无主"} · 购入 ${formatMoney(def.purchasePrice)}`, [], () => {
      this.hideOverlay();
      this.refreshDecision();
    });
  }

  // ─────────────────────────── 决策分发 ───────────────────────────
  /** 当前决策归属哪个座位(AwaitingTreasureOwner=城主,其余=active)。 */
  private decisionOwner(): number {
    const e = this.engine;
    return e.turnPhase === "AwaitingTreasureOwner" ? e.treasureVisitor?.ownerIdx ?? e.activeIndex : e.activeIndex;
  }
  private isMyDecision(): boolean {
    return this.engine.phase === "Playing" && this.decisionOwner() === this.seat && !(this.engine.players[this.seat]?.isBot ?? true);
  }

  /** 收到 snapshot 后:若是我的决策相位,弹对应卷轴;否则隐藏 + 提示等待。 */
  private refreshDecision() {
    const e = this.engine;
    if (e.phase === "GameOver") return this.showVictory();
    // 非我的决策:关卷轴(避免覆盖),提示谁的回合
    if (!this.isMyDecision()) {
      this.hideOverlay();
      return;
    }
    switch (e.turnPhase) {
      case "Roll":
      case "AwaitingBranch":
      case "AwaitingCapitalHalt":
      case "AwaitingDecision":
        // P2: 常规决策改侧栏内嵌(fullRender 已渲染 actionInline),关卷轴
        this.hideOverlay();
        break;
      case "AwaitingHeroPick":
        this.showHeroPickScroll();
        break;
      case "AwaitingTreasureOwner":
        this.showTreasureOwnerScroll();
        break;
      case "AwaitingBankruptcySettle":
        this.showBankruptcyScroll();
        break;
    }
  }

  private onRoll() {
    const e = this.engine;
    if (this.busy || !this.isMyDecision()) return;
    if (e.turnPhase !== "Roll") return; // P2: AwaitingBranch 改侧栏内嵌
    this.busy = true;
    this.send({ type: "rollAndMove" });
    this.fullRender();
  }

  private send(cmd: GameCommand) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "cmd", cmd }));
  }

  private dispatchAction(action: string) {
    if (action.startsWith("heropick-")) {
      return this.act({ type: "resolveHeroPick", index: parseInt(action.slice("heropick-".length), 10) });
    }
    if (action.startsWith("treasure-")) {
      const sub = action.slice("treasure-".length);
      if (sub === "skip") return this.act({ type: "resolveTreasureOwner", action: { type: "skip" } });
      const [verb, ...rest] = sub.split("-");
      const treasureId = rest.join("-");
      if (verb === "gift") return this.act({ type: "resolveTreasureOwner", action: { type: "gift", treasureId } });
      if (verb === "trade") return this.act({ type: "resolveTreasureOwner", action: { type: "trade", treasureId } });
    }
    if (action.startsWith("bk-")) {
      const sub = action.slice("bk-".length);
      if (sub === "confirm") return this.act({ type: "confirmBankruptcySettle" });
      const [verb, ...rest] = sub.split("-");
      const id = rest.join("-");
      if (verb === "treasure") return this.act({ type: "sellTreasureBankruptcy", treasureId: id });
      if (verb === "prop") return this.act({ type: "sellPropertyBankruptcy", propId: id });
      if (verb === "hero") return this.act({ type: "cashHeroBankruptcy", heroId: id });
    }
    switch (action) {
      case "halt":
        return this.act({ type: "haltAtCapital" });
      case "continue":
        return this.act({ type: "continueMove" });
      case "main":
        return this.act({ type: "selectBranch", kind: "Main" });
      case "branch":
        return this.act({ type: "selectBranch", kind: "Branch" });
      case "buy":
        return this.act({ type: "buyProperty" });
      case "upgrade":
        return this.act({ type: "upgradeProperty" });
      case "skip":
        return this.act({ type: "endDecision" });
    }
  }

  /** 发命令 + 轻反馈。确认型(endDecision/buy/…)播对应音;结算类不在此处播。 */
  private act(cmd: GameCommand) {
    this.hideOverlay();
    this.busy = true;
    this.send(cmd);
    this.fullRender();
  }

  // ─────────────────────────── 卷轴(复用 createScroll/createDecisionScroll)───────────────────────────
  private hideOverlay() {
    this.overlay?.remove();
    this.overlay = null;
  }
  private openScroll(title: string, desc: string, choices: { label: string | (Node | string)[]; action: string; primary?: boolean }[], onClose?: () => void) {
    this.hideOverlay();
    this.overlay = createScroll(this.boardWrap, title, desc, choices, onClose);
  }

  // (P2) 常规决策卷轴方法 showHaltScroll/showBranchScroll/showDecisionScroll/singleDecisionAction
  // 已移除——改由 renderActionInline 内嵌。赠宝/破产/招贤卷轴保留。

  /** P3: 手牌卡点击 → 详情卷轴。联机读自己 seat 的手牌。 */
  private showHandDetail(kind: "treasure" | "hero", id: string) {
    const p = this.engine.players[this.seat];
    if (!p) return;
    if (kind === "treasure") {
      const t = p.treasures.find((x) => x.id === id);
      if (!t) return;
      this.openScroll(t.name, `Lv${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}　${t.desc}`, [], () => this.hideOverlay());
    } else {
      const h = p.heroes.find((x) => x.id === id);
      if (!h) return;
      this.openScroll(`${h.name}·${h.title}`, h.desc, [], () => this.hideOverlay());
    }
  }

  private showHeroPickScroll() {
    const e = this.engine;
    const offered = e.offeredHeroes;
    if (!offered.length) return;
    const desc = offered.map((h, i) => `${i + 1}. ${h.name}·${h.title} — ${h.desc}`).join("  ／  ");
    this.openScroll(
      "招贤纳士",
      desc,
      offered.map((h, i) => {
        const label: (Node | string)[] = [];
        const img = assetImg("hero:" + h.id, "hero-portrait");
        if (img) label.push(img);
        label.push(h.name);
        return { label, action: `heropick-${i}`, primary: i === 0 };
      }),
    );
  }

  private showTreasureOwnerScroll() {
    const e = this.engine;
    const tv = e.treasureVisitor!;
    const owner = e.players[tv.ownerIdx];
    const mover = e.activePlayer;
    const tile = e.board.at(mover.position);
    const choices: { label: string | (Node | string)[]; action: string; primary?: boolean }[] = [];
    for (const t of owner.treasures) {
      const withIcon = (text: string): (Node | string)[] => {
        const c: (Node | string)[] = [];
        const img = treasureAssetImg(t.id, "treasure-icon");
        if (img) c.push(img);
        c.push(text);
        return c;
      };
      choices.push({ label: withIcon(`赠·${t.name} +${formatMoney(guidePriceOf(t.level))}`), action: `treasure-gift-${t.id}` });
      choices.push({ label: withIcon(`卖·${t.name}`), action: `treasure-trade-${t.id}` });
    }
    choices.push({ label: "不赠不卖", action: "treasure-skip", primary: true });
    this.openScroll(`${owner.guohao}·珍宝抉择`, `${mover.guohao} 落「${tile.name}」。赠宝(访客得宝、城升级、朝廷赏指导价银)或贸易(访客付银得宝)。`, choices);
  }
  private showBankruptcyScroll() {
    const e = this.engine;
    const p = e.activePlayer;
    const debt = e.pendingDebt!;
    const capProp = e.board.at(p.capitalIndex)?.propertyId;
    const choices: { label: string; action: string; primary?: boolean }[] = [];
    for (const t of p.treasures) choices.push({ label: `卖·${t.name} +${formatMoney(guidePriceOf(t.level))}`, action: `bk-treasure-${t.id}` });
    for (const h of p.properties) {
      if (h.propertyId === capProp) continue;
      const name = e.board.tiles.find((t) => t.propertyId === h.propertyId)?.name ?? h.propertyId;
      choices.push({ label: `卖城·${name} +${formatMoney(h.purchasePrice)}`, action: `bk-prop-${h.propertyId}` });
    }
    for (const h of p.heroes) choices.push({ label: `遣·${h.name} +${formatMoney(200)}`, action: `bk-hero-${h.id}` });
    choices.push({ label: "结算", action: "bk-confirm", primary: true });
    const owe = Math.max(0, debt.amount - p.cash);
    this.openScroll(`${p.guohao}·变卖自救`, `现金不足,尚欠 ${formatMoney(owe)}。变卖资产凑够即免破产。`, choices);
  }

  private showVictory() {
    this.hideOverlay();
    const v = createVictory(this.engine, () => this.showConnectScreen());
    this.boardWrap.appendChild(v);
    this.overlay = v;
  }

  // ─────────────────────────── 提示 ───────────────────────────
  private flashHint(text: string) {
    if (!this.hint) {
      this.hint = el("div", { class: "pick-hint" });
      this.boardWrap.appendChild(this.hint);
    }
    this.hint.textContent = text;
  }
}

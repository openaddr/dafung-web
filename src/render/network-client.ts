// 联机客户端(红线 4:state.ts 拆出的 network-client)。
// 与热座 App 并存:不跑引擎,只持一份「只读引擎」——收到服务器 snapshot 即
// restoreFromSnapshot 重 hydrate,复用全部渲染层(renderPlayers/boardView/createScroll…)。
// 本地玩家的操作 → WS 发 GameCommand;bot/远程玩家的动作 → 由服务器逐步广播 snapshot 驱动渲染。
//
// 共享 scaffold/fullRender/bindEvents/openScroll/showHeroPickScroll/showTreasureOwnerScroll/
// showBankruptcyScroll/showHandDetail/showTileDetail/flashHint/destroy 在 ClientController 基类
// (ADR-0006)。本子类提供四个抽象成员 + 大厅(REST + WS)+ 决策归属判定 + 命令发送。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { isCustomId } from "@core/map-source";
import { createVictory, createMapSelectionScreen } from "./ui";
import { el } from "./dom";
import { loadAssetManifest } from "./assets";
import { ClientController } from "./client-controller";
import { createBoardSvg } from "./board";
import { createAnimator } from "./animate";
import { getMapSource } from "./map-sources";
import { loadMapById } from "@core/map-source";

type Snapshot = ReturnType<GameEngine["snapshot"]>;
interface SeatMeta {
  seat: number;
  kind: "human" | "bot";
  taken: boolean;
  online: boolean;
  controlled: boolean;
}
type ServerMsg =
  | { type: "lobby"; roomId: string; seatCount: number; host: number; started: boolean; mapId: string | null; seats: SeatMeta[] }
  | ({ type: "snapshot"; roomId: string; host: number; seats: SeatMeta[] } & Snapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

export class NetworkClient extends ClientController {
  engine: GameEngine; // 只读:每次 snapshot 用 restoreFromSnapshot 重 hydrate
  /** 当前选中地图 id(初始 = 默认图;lobby 广播 mapId 后同步)。 */
  private mapId: string | null = null;

  private serverUrl: string;
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  seat = -1;
  private seatToken: string | null = null;
  private roomMeta: { host: number; seats: SeatMeta[]; seatCount: number; started: boolean; mapId: string | null } | null = null;
  private lobbyOverlay: HTMLElement | null = null;

  constructor(map: LoadedMap, serverUrl: string) {
    super(map); // physicsSeed 不传:联机物理骰子不需要可复现(服务器才是权威)
    this.serverUrl = serverUrl.replace(/\/$/, "");
    // 占位引擎:只为渲染就位(board/catalog 来自真实地图);首帧 snapshot 会覆盖全部可变状态。
    this.engine = this.makePlaceholderEngine(map);
    // 调试/测试钩子:读客户端引擎状态(从 snapshot 还原)+ 自己的 seat
    window.__dafung = {
      engine: this.engine,
      snapshot: () => this.engine.snapshot(),
      seat: () => this.seat,
      busy: () => this.busy,
    };
    this.fullRender();
    void loadAssetManifest().then(() => this.fullRender());
    this.showConnectScreen();
  }

  /** 用一张地图构建占位引擎(只为渲染就位;首帧 snapshot 覆盖可变状态)。 */
  private makePlaceholderEngine(map: LoadedMap): GameEngine {
    return new GameEngine(map.board, map.catalog, createDice(), {
      seats: [
        { name: "诸侯 1", isBot: false },
        { name: "诸侯 2", isBot: true },
      ],
    });
  }

  /** 换图重建:非 Host 收到新 mapId 后,按 id fetch 内置图 + 重建占位引擎,
   *  并替换基类的 boardView/animator(它们在构造时绑死了旧 map 的 board/svg)。
   *  Host 自己选图时本地立即重建(乐观更新),无需等服务端回包。 */
  private async rebuildForMap(mapId: string): Promise<void> {
    if (mapId === this.mapId) return; // 同图不重建
    let map: LoadedMap;
    try {
      map = await loadMapById(getMapSource(), mapId);
    } catch (err) {
      this.flashHint(`加载地图失败:${(err as Error).message}`);
      return;
    }
    this.mapId = mapId;
    // 重建占位引擎(board/catalog 来自新图)
    this.engine = this.makePlaceholderEngine(map);
    // 同步调试钩子指向新引擎
    (window.__dafung as { engine: GameEngine }).engine = this.engine;
    // 替换基类绑定的 boardView:移除旧 svg 根,挂新 svg
    this.boardView.root.remove();
    this.boardView = createBoardSvg(map.board, map.catalog, { panZoom: true });
    this.boardWrap.appendChild(this.boardView.root);
    // 替换 animator(它闭包持有旧 svg/boardView 引用)
    this.animator = createAnimator(this.boardWrap, this.boardView.root, map.board, this.boardView, this.threeDice, this.audio);
    this.fullRender();
  }

  // ─── 抽象成员实现 ───
  get viewSeat(): number {
    return this.seat;
  }
  get interactive(): boolean {
    return this.isMyDecision() && !this.busy;
  }

  /** 联机动作分发:解析 action-string → GameCommand → act→send(发 WS)。与热座对称的解析,
   *  但落到 act(send)而非 onHalt/onDecision(改引擎+动画)。
   *  treasure-mode-fair/premium 与 treasure-back 是纯客户端 UI 跳步(不发命令,只重弹卷轴)。 */
  dispatchAction(action: string): void {
    if (action.startsWith("heropick-")) {
      return this.act({ type: "resolveHeroPick", index: parseInt(action.slice("heropick-".length), 10) });
    }
    if (action.startsWith("treasure-")) {
      const sub = action.slice("treasure-".length);
      if (sub === "skip") return this.act({ type: "resolveTreasureOwner", action: { type: "skip" } });
      if (sub === "back") { this.showTreasureOwnerScroll(); return; }
      if (sub.startsWith("mode-")) {
        const mode = sub.slice("mode-".length);
        if (mode === "fair" || mode === "premium") { this.showTreasurePickerScroll(mode); return; }
        return; // 未知 mode,忽略
      }
      const [verb, ...rest] = sub.split("-");
      const treasureId = rest.join("-");
      if (verb === "fair") return this.act({ type: "resolveTreasureOwner", action: { type: "fair", treasureId } });
      if (verb === "premium") return this.act({ type: "resolveTreasureOwner", action: { type: "premium", treasureId } });
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

  onRoll() {
    const e = this.engine;
    if (this.busy || !this.isMyDecision()) return;
    if (e.turnPhase !== "Roll") return; // P2: AwaitingBranch 改侧栏内嵌
    this.busy = true;
    this.send({ type: "rollAndMove" });
    this.fullRender();
  }

  onTileClick(idx: number) {
    // 对局中只读查看城池详情(不弹决策卷轴——决策由 refreshDecision 管)
    const e = this.engine;
    if (e.phase !== "Playing" || this.overlay != null) return;
    this.showTileDetail(idx);
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
    for (const n of [2, 3, 4]) seatsSel.appendChild(el("option", { value: String(n) }, [`${n} 诸侯`]));
    const botIn = el("input", { class: "input", placeholder: "bot 座位号,逗号分隔(如 1,2)", style: "width:160px;" }) as HTMLInputElement;
    const seedIn = el("input", { class: "input", placeholder: "种子(可空)", style: "width:100px;" }) as HTMLInputElement;
    const targetIn = el("input", { class: "input", placeholder: "目标身价(默认8000)", style: "width:150px;" }) as HTMLInputElement;
    const createBtn = el("button", { class: "btn btn-primary" }, ["建房"]) as HTMLButtonElement;
    createBtn.addEventListener("click", async () => {
      try {
        this.serverUrl = urlIn.value.trim().replace(/\/$/, "");
        const seats = parseInt(seatsSel.value, 10);
        const bot = botIn.value.trim();
        const seed = seedIn.value.trim() ? parseInt(seedIn.value, 10) : undefined;
        const target = targetIn.value.trim() ? parseInt(targetIn.value, 10) : undefined;
        const r = await this.http("/room/new", { seats, bot, seed, target });
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
      seatsSel, botIn, seedIn, targetIn, createBtn,
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
    // 当前选中地图展示行:Host 可点「更换」选图(仅内置图);非 Host 只读显示图名。
    const mapNameEl = el("span", { class: "lobby-map-name", style: "font-family:var(--font-deco);color:var(--ink);" }, ["加载中…"]);
    const mapRow = el("div", { class: "lobby-map", style: "margin:8px 0;text-align:center;font-size:14px;" }, [
      el("span", { style: "color:var(--ink-dim,#9c6b3f);" }, ["当前地图:"]),
      mapNameEl,
    ]);
    box.appendChild(mapRow);
    /** 按 roomMeta.mapId 解析地图名(内置图 fetch 清单;查不到则显示 id)。 */
    const renderMapName = () => {
      const id = this.roomMeta?.mapId ?? null;
      mapNameEl.textContent = id ? id : "未选择";
      if (id) {
        void this.builtinMapName(id).then((name) => { mapNameEl.textContent = name; }).catch(() => { /* 保留 id 兜底 */ });
      }
    };
    const renderSeats = () => {
      seatList.innerHTML = "";
      const seats = this.roomMeta?.seats ?? [];
      for (const s of seats) {
        const tag = s.seat === this.seat ? "你" : s.kind === "bot" ? "bot" : s.taken ? "人" : "空";
        const host = s.seat === (this.roomMeta?.host ?? 0) ? " · 房主" : "";
        const dotClass = s.kind === "bot" ? "bot" : !s.taken ? "empty" : s.online ? "online" : "offline";
        const rowClass = s.seat === this.seat ? "lobby-seat-row is-you" : "lobby-seat-row";
        seatList.appendChild(el("div", { class: rowClass }, [
          el("span", { class: `seat-dot ${dotClass}` }),
          `诸侯 ${s.seat + 1} · ${tag}${host}${s.taken && !s.online ? " · 离线" : ""}`,
        ]));
      }
    };
    renderSeats();
    renderMapName();
    this.lobbyOverlay = overlay;
    (overlay as any)._renderSeats = renderSeats;
    (overlay as any)._renderMapName = renderMapName;
    if (isHost) {
      // Host:选择地图(仅内置图——过滤 custom- 前缀)。
      const mapBtn = el("button", { class: "btn", style: "display:block;margin:0 auto 4px;" }, ["选择地图"]) as HTMLButtonElement;
      mapBtn.addEventListener("click", () => {
        createMapSelectionScreen(this.boardWrap, this.builtinMapSource(), this.mapId ?? "sanguo", async (mapId, _name) => {
          try {
            // 先乐观重建本地渲染(Host 立即看到新图);再发请求持久化到服务器。
            await this.rebuildForMap(mapId);
            await this.http("/room/map", { roomId: this.roomId, seatToken: this.seatToken, mapId });
            // 服务端广播 lobby 会带回 mapId,触发非 Host 端重建。
            this.roomMeta = { ...this.roomMeta!, mapId };
            renderMapName();
          } catch (err) {
            this.flashHint((err as Error).message);
          }
        }, () => { /* 取消:无操作 */ });
      });
      box.appendChild(mapBtn);
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

  /** 仅内置图的 MapSource(过滤掉 custom- 自建图):联机模式只支持内置图。 */
  private builtinMapSource() {
    const src = getMapSource();
    return {
      listMaps: async () => (await src.listMaps()).filter((e) => !isCustomId(e.id)),
      loadMapData: (id: string) => src.loadMapData(id),
    };
  }

  /** 按 id 查内置图展示名(异步 fetch 清单);查不到回退 id 本身。 */
  private async builtinMapName(id: string): Promise<string> {
    try {
      const entries = await this.builtinMapSource().listMaps();
      const found = entries.find((e) => e.id === id);
      return found ? found.name : id;
    } catch {
      return id;
    }
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
      const prevMapId = this.roomMeta?.mapId ?? null;
      this.roomMeta = { host: msg.host, seats: msg.seats, seatCount: msg.seatCount, started: msg.started, mapId: msg.mapId };
      const rerender = (this.lobbyOverlay as any)?._renderSeats;
      if (rerender) rerender();
      const renderMapName = (this.lobbyOverlay as any)?._renderMapName;
      if (renderMapName) renderMapName();
      // 非 Host:mapId 变化时按 id fetch 内置图重建本地占位引擎渲染。
      // Host 自己选图时已乐观重建,此处不重复(否则会多一次 fetch + 闪烁)。
      const isHostSeat = this.seat === msg.host;
      if (!isHostSeat && msg.mapId && msg.mapId !== prevMapId && msg.mapId !== this.mapId) {
        void this.rebuildForMap(msg.mapId);
      }
      return;
    }
    if (msg.type === "snapshot") {
      this.roomMeta = { host: msg.host, seats: msg.seats, seatCount: msg.seats.length, started: true, mapId: this.roomMeta?.mapId ?? null };
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

  private send(cmd: GameCommand) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "cmd", cmd }));
  }

  /** 发命令 + 轻反馈。确认型(endDecision/buy/…)播对应音;结算类不在此处播。 */
  private act(cmd: GameCommand) {
    this.hideOverlay();
    this.busy = true;
    this.send(cmd);
    this.fullRender();
  }

  // ─────────────────────────── 胜利 ───────────────────────────
  private showVictory() {
    this.hideOverlay();
    const v = createVictory(this.engine, () => this.showConnectScreen());
    this.boardWrap.appendChild(v);
    this.overlay = v;
  }
}

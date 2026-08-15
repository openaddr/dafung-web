// 联机客户端(红线 4:state.ts 拆出的 network-client)。
// 与热座 App 并存:不跑引擎,只持一份「只读引擎」——收到服务器 snapshot 即
// restoreFromSnapshot 重 hydrate,复用全部渲染层(renderOthers/boardView/createScroll…)。
// 本地玩家的操作 → WS 发 GameCommand;bot/远程玩家的动作 → 由服务器逐步广播 snapshot 驱动渲染。
//
// 共享 scaffold/fullRender/bindEvents/openScroll/showHeroPickScroll/showTreasureOwnerScroll/
// showBankruptcyScroll/showHandDetail/showTileDetail/flashHint/destroy 在 ClientController 基类
// (ADR-0006)。本子类:连接屏(REST 建房/加入)+ WS 管理 + 换图重建 + 决策归属判定 + 命令发送。
// 大厅屏是独立的持状态模块 LobbyController(架构待办 ③);换图重建由 lobby 广播单路径驱动。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { createVictory } from "./ui";
import { el } from "./dom";
import { loadAssetManifest } from "./assets";
import { ClientController } from "./client-controller";
import { parseAction } from "./action-parser";
import { createBoardSvg } from "./board";
import { createAnimator } from "./animate";
import { getMapSource } from "./map-sources";
import { loadMapById } from "@core/map-source";
import { LobbyController, type LobbyState } from "./lobby";

type Snapshot = ReturnType<GameEngine["snapshot"]>;
type ServerMsg =
  | ({ type: "lobby" } & LobbyState)
  | ({ type: "snapshot"; roomId: string; seatCount: number; host: number; started: boolean; mapId: string | null; seats: LobbyState["seats"] } & Snapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

export class NetworkClient extends ClientController {
  engine: GameEngine; // 只读:每次 snapshot 用 restoreFromSnapshot 重 hydrate
  /** 当前渲染中的地图 id(构造时=初始占位图;lobby 广播 mapId 后同步)。 */
  private mapId: string | null;

  private serverUrl: string;
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  seat = -1;
  private seatToken: string | null = null;
  private lobby: LobbyController | null = null;
  private connectOverlay: HTMLElement | null = null;
  /** 诊断环形缓冲(可观测性基建):最近 20 条服务器消息摘要 + 关键本地转移。
   *  手机端无 devtools,经 window.__dafung.debug() 导出。 */
  private debugLog: string[] = [];

  /** 追加一条诊断记录(环形,上限 20 条)。 */
  private note(entry: string): void {
    const t = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    this.debugLog.push(`${t} ${entry}`);
    if (this.debugLog.length > 20) this.debugLog.shift();
  }

  /** 服务器消息 → 紧凑摘要(snapshot 全量太大,只记相位转移)。 */
  private summarize(msg: ServerMsg): string {
    if (msg.type === "snapshot") return `snapshot phase=${msg.phase} turn=${msg.turnPhase} active=${msg.activeIndex}`;
    if (msg.type === "lobby") return `lobby host=${msg.host} map=${msg.mapId} online=${msg.seats.filter((s) => s.online).length}/${msg.seats.length}`;
    return msg.type === "dismissed" ? "dismissed" : `error:${msg.error}`;
  }

  /** 诊断快照:排障时的客户端现场(手机上经 __dafung.debug() 导出)。 */
  debugDump(): Record<string, unknown> {
    return {
      seat: this.seat,
      busy: this.busy,
      phase: this.engine.phase,
      turnPhase: this.engine.turnPhase,
      activeIndex: this.engine.activeIndex,
      ws: this.ws?.readyState ?? "closed",
      log: [...this.debugLog],
    };
  }

  constructor(map: LoadedMap, serverUrl: string, mapId?: string | null) {
    super(map); // physicsSeed 不传:联机物理骰子不需要可复现(服务器才是权威)
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.mapId = mapId ?? null; // 初始占位图的 id(与 map 一致);房间选图后由广播驱动重建
    // 占位引擎:只为渲染就位(board/catalog 来自真实地图);首帧 snapshot 会覆盖全部可变状态。
    this.engine = this.makePlaceholderEngine(map);
    // 调试/测试钩子:读客户端引擎状态(从 snapshot 还原)+ 自己的 seat + 诊断现场
    window.__dafung = {
      engine: this.engine,
      snapshot: () => this.engine.snapshot(),
      seat: () => this.seat,
      busy: () => this.busy,
      debug: () => this.debugDump(),
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

  /** 换图重建:收到 lobby 广播的新 mapId 后(host/非 host 同一条路径),按 id fetch 内置图
   *  + 重建占位引擎,并替换基类的 boardView/animator(它们在构造时绑死了旧 map 的 board/svg)。 */
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

  /** 联机动作分发:parseAction 统一解析(ADR-0006:解析共用,执行差异化)→
   *  command 走 act→send(发 WS);UI 跳步(treasure-back / treasure-mode-*)只重弹卷轴。 */
  dispatchAction(action: string): void {
    const parsed = parseAction(action);
    if (!parsed) return;
    if (parsed.kind === "ui") {
      if (parsed.ui === "treasure-back") { this.showTreasureOwnerScroll(); return; }
      this.showTreasurePickerScroll(parsed.ui.mode);
      return;
    }
    this.act(parsed.command);
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
    this.lobby?.destroy();
    this.lobby = null;
    this.connectOverlay?.remove();
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
        this.openLobby(this.lobbyStateOf(r));
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
        this.openLobby(this.lobbyStateOf(r));
      } catch (err) {
        this.flashHint((err as Error).message);
      }
    });
    box.appendChild(el("div", { class: "field", style: "margin-top:10px;" }, [
      el("div", { style: "font-weight:600;margin-bottom:6px;" }, ["加入"]),
      codeIn, joinBtn,
    ]));
    overlay.appendChild(box);
    this.connectOverlay = overlay;
    this.boardWrap.appendChild(overlay);
  }

  /** 从 REST 响应(展开的 lobbyView 字段)取大厅态。 */
  private lobbyStateOf(r: { roomId: string; seatCount: number; host: number; started: boolean; mapId: string | null; seats: LobbyState["seats"] }): LobbyState {
    return { roomId: r.roomId, seatCount: r.seatCount, host: r.host, started: r.started, mapId: r.mapId, seats: r.seats };
  }

  /** 打开大厅屏(LobbyController 持状态模块,架构待办③):REST 回包给初始态,
   *  之后由 WS lobby 广播 update;host 控件显隐由模块按 state.host 自管。 */
  private openLobby(state: LobbyState) {
    this.connectOverlay?.remove();
    this.connectOverlay = null;
    this.lobby?.destroy();
    this.lobby = new LobbyController(this.boardWrap, this.seat, state, {
      // 确认选图:仅发请求;本地换图由 lobby 广播单路径驱动(host/非 host 同路)。
      onPickMap: async (mapId) => {
        await this.http("/room/map", { roomId: this.roomId, seatToken: this.seatToken, mapId });
      },
      onStart: async () => {
        await this.http("/room/start", { roomId: this.roomId, seatToken: this.seatToken });
      },
      onError: (message) => this.flashHint(message),
    });
  }

  private connect() {
    if (!this.roomId || this.seat < 0 || !this.seatToken) return;
    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/ws?room=${this.roomId}&seat=${this.seat}&token=${this.seatToken}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    this.ws.onclose = () => {
      this.note("ws-close");
      // 非被解散的断开:对局中提示重连;大厅/连接屏态不打扰(界面仍在)
      if (this.lobby == null && this.connectOverlay == null && this.engine.phase !== "GameOver") this.flashHint("连接断开,请刷新重连");
    };
    this.ws.onerror = () => this.note("ws-error");
  }

  private onMessage(msg: ServerMsg) {
    this.note(this.summarize(msg));
    if (msg.type === "lobby") {
      const { type: _msgType, ...state } = msg;
      this.lobby?.update(state);
      // 换图单一路径:任何端(host/非 host)都由 lobby 广播驱动重建,无乐观更新。
      // rebuildForMap 自带同图守卫;本地已渲染同图时不重复 fetch。
      if (state.mapId && state.mapId !== this.mapId) void this.rebuildForMap(state.mapId);
      return;
    }
    if (msg.type === "snapshot") {
      // 房间字段(seatCount/started/mapId)已随消息携带(协议补字段),无需从 seats 推断手抄。
      this.lobby?.destroy();
      this.lobby = null;
      this.engine.restoreFromSnapshot(msg as unknown as Snapshot);
      this.busy = false;
      this.animator.spawnFloaters(this.engine); // 浮动金额反馈(若引擎有)
      this.fullRender();
      this.refreshDecision();
      return;
    }
    if (msg.type === "dismissed") {
      this.lobby?.destroy();
      this.lobby = null;
      this.overlay?.remove();
      this.overlay = null;
      this.flashHint("房主已解散房间");
      setTimeout(() => this.showConnectScreen(), 800);
    }
  }

  // ─────────────────────────── 决策分发 ───────────────────────────
  private isMyDecision(): boolean {
    return this.engine.phase === "Playing" && this.engine.decisionOwner === this.seat && !(this.engine.players[this.seat]?.isBot ?? true);
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
    this.note(`send ${cmd.type}`);
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

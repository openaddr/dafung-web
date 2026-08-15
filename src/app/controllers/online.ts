// 联机控制器(替代旧 src/render/network-client.ts 的连接/协议部分,零 DOM):
// - 不跑引擎,只持「只读引擎」——收到服务器 snapshot 即 restoreFromSnapshot 重 hydrate。
// - 本地操作 → WS 发 {type:"cmd",cmd}(协议见 scripts/server.ts)。
// - REST 建房/加入/选图/开局(与旧 network-client 相同的 /room/* 接口);
//   大厅 UI 归 React 屏(LobbyScreen),本类只把 lobby 广播灌进 netStore。
// - 换图重建单路径:任何端(host/非 host)都由 lobby 广播的 mapId 驱动重建,无乐观更新
//   (对照旧 rebuildForMap;同图守卫避免重复 fetch)。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { loadMapById } from "@core/map-source";
import { FetchMapSource } from "@render/map-sources";
import { setEngine, useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import { animateMove, beginMarch, maybeShowTurnBanner } from "@app/fx/orchestrator";
import { setController } from "./registry";
import { GameController } from "./controller";

/** 服务器消息(协议见 scripts/server.ts:lobby / snapshot / dismissed / error)。
 *  lobby 与 snapshot 都带完整房间字段(clientView 两种形态对齐,见 room.ts)。 */
export type ServerMsg =
  | ({ type: "lobby" } & NetRoomFields)
  | ({ type: "snapshot" } & NetRoomFields & GameSnapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

export class OnlineController extends GameController {
  private _engine: GameEngine; // 只读:每次 snapshot 用 restoreFromSnapshot 重 hydrate
  private serverUrl: string;
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private seatToken: string | null = null;
  /** 当前占位引擎对应的地图 id(换图守卫:同图不重建)。 */
  private mapId: string | null;
  seat = -1;
  /** 发出命令后置 true,收 snapshot 回包清零(防连点重复发;旧 busy 的新等价物)。 */
  private pending = false;
  /** 托管能力:联机支持(服务器 bot 代打;单机不支持)。 */
  override readonly autopilotSupported = true;

  constructor(map: LoadedMap, serverUrl: string, mapId?: string | null) {
    super();
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.mapId = mapId ?? null;
    // 占位引擎:board/catalog 来自真实地图,仅为渲染就位;首帧 snapshot 覆盖全部可变状态。
    this._engine = this.makePlaceholderEngine(map);
    setEngine(this._engine);
    this.sync();
  }

  get engine(): GameEngine {
    return this._engine;
  }
  get viewSeat(): number {
    return this.seat;
  }
  /** 我的座位托管中(从 netStore 的 seats 广播回读,与旧 latestSeats 等价)。 */
  get autoPilotOn(): boolean {
    const s = useNetStore.getState();
    return s.seats[s.mySeat]?.autoPilot ?? false;
  }
  /** 轮到我决策(含珍宝交涉的 decisionOwner)且非 bot 座位、无 pending 命令、未托管。 */
  get interactive(): boolean {
    return (
      this._engine.phase === "Playing" &&
      this._engine.decisionOwner === this.seat &&
      !this._engine.players[this.seat]?.isBot &&
      !this.pending &&
      !this.autoPilotOn
    );
  }

  /** 用一张地图构建占位引擎(联机不掷本地骰,种子随意)。 */
  private makePlaceholderEngine(map: LoadedMap): GameEngine {
    return new GameEngine(map.board, map.catalog, createDice(), {
      seats: [
        { name: "诸侯 1", isBot: false },
        { name: "诸侯 2", isBot: true },
      ],
    });
  }

  // ─── 命令入口:发 WS,状态由服务器广播 snapshot 驱动 ───
  dispatchCommand(cmd: GameCommand): void {
    if (!this.interactive) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      useGameStore.getState().pushHint("连接未就绪");
      return;
    }
    this.pending = true;
    this.ws.send(JSON.stringify({ type: "cmd", cmd }));
    this.sync(); // 刷新 interactive(pending 期间锁操作)
  }

  roll(): void {
    this.dispatchCommand({ type: "rollAndMove" });
  }

  tileClick(index: number): void {
    // 联机对局中点击只读查看详情(决策不靠点击);详情弹层归 React 组件。
    void index;
  }

  /** 自助托管(spec: autopilot):发 WS 消息,生效状态从 seats 广播回读(无乐观更新)。 */
  override setAutoPilot(on: boolean, speed: "fast" | "slow"): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      useGameStore.getState().pushHint("连接未就绪");
      return;
    }
    this.ws.send(JSON.stringify({ type: "autoPilot", on, speed }));
  }

  // ─── REST(建房/加入/选图/开局;协议与旧 network-client 一致)──
  private http(path: string, body: unknown): Promise<Record<string, unknown>> {
    return fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (!r.ok || !j?.ok) throw new Error((j?.error as string) ?? `HTTP ${r.status}`);
      return j;
    });
  }

  /** 建房并连接。返回房间信息(供大厅屏渲染)。 */
  async createRoom(opts: { seats: number; bot?: number[]; seed?: number; target?: number }): Promise<Record<string, unknown>> {
    const r = await this.http("/room/new", opts);
    await this.adoptRoom(r);
    return r;
  }

  /** 按房间码加入并连接。 */
  async joinRoom(roomId: string): Promise<Record<string, unknown>> {
    const r = await this.http("/room/join", { roomId: roomId.toUpperCase() });
    await this.adoptRoom(r);
    return r;
  }

  /** host 选图:只发请求;本地换图由 lobby 广播单路径驱动(host/非 host 同路)。 */
  async pickMap(mapId: string): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.http("/room/map", { roomId: this.roomId, seatToken: this.seatToken, mapId });
  }

  /** host 开局:引擎在服务器侧构造,本端只等首帧 snapshot 广播。 */
  async startGame(): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.http("/room/start", { roomId: this.roomId, seatToken: this.seatToken });
  }

  /** 从 REST 回包取 roomId/seat/seatToken 并建立 WS;房间字段灌 netStore(大厅屏初渲染)。 */
  private async adoptRoom(r: Record<string, unknown>): Promise<void> {
    this.roomId = r.roomId as string;
    this.seat = r.seat as number;
    this.seatToken = r.seatToken as string;
    this.applyRoomFields(r);
    useNetStore.getState().setMySeat(this.seat);
    useGameStore.getState().setViewSeat(this.seat);
    this.connect();
  }

  /** REST 回包 / 广播里的房间字段 → netStore(lobby 与 snapshot 消息字段同构)。 */
  private applyRoomFields(r: Record<string, unknown>): void {
    useNetStore.getState().setRoom({
      roomId: r.roomId as string,
      host: r.host as number,
      started: r.started as boolean,
      mapId: (r.mapId as string | null) ?? null,
      seats: (r.seats as NetRoomFields["seats"]) ?? [],
    });
  }

  // ─── WS 连接管理 ───
  private connect(): void {
    if (!this.roomId || this.seat < 0 || !this.seatToken) return;
    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/ws?room=${this.roomId}&seat=${this.seat}&token=${this.seatToken}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => useNetStore.getState().setConnected(true);
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMsg);
    this.ws.onclose = () => {
      useNetStore.getState().setConnected(false);
      // 对局中断开才打扰(大厅态界面仍在,座位仅显示离线)。重连=刷新重进(与旧行为一致);
      // TODO(后续阶段):自动重连 + token 重入座。
      if (this._engine.phase === "Playing" && useGameStore.getState().screen === "game") {
        useGameStore.getState().pushHint("连接断开,请刷新重连");
      }
    };
    this.ws.onerror = () => useNetStore.getState().pushHint("连接异常");
  }

  // ─── 快照表现(阶段 6):diff 驱动的浮字 + 行军 ───
  /** 上一帧快照的玩家位置/现金(联机端无本地引擎推进事件,表现全靠相邻快照 diff)。 */
  private prevPos = new Map<string, { position: number; onStep: number | null }>();
  private prevCash = new Map<string, number>();
  /** 表现链串行化:快照可能连续到达,排队播放避免两次行军互踩。 */
  private fxQueue: Promise<void> = Promise.resolve();
  /** 是否已在对局屏(首帧 snapshot 才切屏;之后重连/恢复不重复切)。 */
  private enteredGame = false;

  private onMessage(msg: ServerMsg): void {
    if (msg.type === "lobby") {
      this.applyRoomFields(msg as unknown as Record<string, unknown>);
      // 换图单路径:lobby 广播的 mapId 驱动本地重建(占位引擎 + registry 的 MapData)。
      if (msg.mapId && msg.mapId !== this.mapId) void this.rebuildForMap(msg.mapId);
      return;
    }
    if (msg.type === "snapshot") {
      const { type: _t, ...snap } = msg;
      this.applyRoomFields(msg as unknown as Record<string, unknown>);
      if (msg.mapId && msg.mapId !== this.mapId) {
        // 快照带了新图(理论上开局前已由 lobby 广播换好;兜底再同步一次)
        this.mapId = msg.mapId;
      }
      this._engine.restoreFromSnapshot(snap as GameSnapshot);
      this.pending = false;
      this.playSnapshotEffects();
      this.sync();
      // 首帧 snapshot = 开局:从大厅切到对局屏(仅切屏;数据已 sync 进 gameStore)
      if (!this.enteredGame) {
        this.enteredGame = true;
        useGameStore.getState().setScreen("game");
      }
      return;
    }
    if (msg.type === "dismissed") {
      this.destroy();
      useNetStore.getState().setDismissed();
      useGameStore.getState().pushHint("房主已解散房间");
      // 回大厅屏展示解散面板(对照旧 dismissed → 800ms 后回连接屏)
      useGameStore.getState().setScreen("lobby");
      return;
    }
    // error:闪提示(如非法命令);pending 解锁等下一帧 snapshot 校正。
    useGameStore.getState().pushHint(msg.error);
  }

  /** 换图重建(lobby 广播驱动):fetch 内置图 → 重建占位引擎 + registry 的 MapData。
   *  BoardView/详情卷轴读的都是 registry 的 MapData,所以两处都要换。 */
  private async rebuildForMap(mapId: string): Promise<void> {
    let map: LoadedMap;
    let data: import("@core/types").MapData;
    try {
      const source = new FetchMapSource();
      data = await source.loadMapData(mapId);
      map = await loadMapById(source, mapId);
    } catch (err) {
      useNetStore.getState().pushHint(`加载地图失败:${(err as Error).message}`);
      return;
    }
    this.mapId = mapId;
    this._engine = this.makePlaceholderEngine(map);
    setEngine(this._engine);
    // setController 对同一实例不 destroy(见 registry 守卫),只更新 MapData
    setController(this, data);
    this.sync();
  }

  /** 快照级表现:diff 上一快照 → 现金变动浮字 + 位置变动行军 + 回合横幅。
   *  注意联机端 restoreFromSnapshot 会清空 engine.floaters/lastMove(瞬时态不序列化),
   *  所以浮字/路径全部由 diff 推导,不走单机那条 drainFloaters/lastMove 通道。
   *  TODO(联机骰子动画):本地无掷骰授权(点数在服务器),骰面仅由侧栏签面文字展示;
   *  多端一致的表现方案(服务器广播 die + ThreeDice.roll(face) 已留缝)见 TODO.md。 */
  private playSnapshotEffects(): void {
    const engine = this._engine;
    const board = engine.board;
    const tileCount = board.tiles.length;
    const fx = useFxStore.getState();

    // 1) 现金 diff → 浮字(锚到玩家当前格逻辑坐标)
    for (const p of engine.players) {
      const prev = this.prevCash.get(p.id);
      if (prev != null && p.cash !== prev) {
        const pos = board.positionOf(p.position);
        fx.spawnFloater(pos.x, pos.y, p.cash - prev, false);
      }
      this.prevCash.set(p.id, p.cash);
    }

    // 2) 位置 diff → 行军(首帧只记位置,不动画;辅路进出不做主路行军)
    const movers: { id: string; from: number; to: number }[] = [];
    for (const p of engine.players) {
      const prev = this.prevPos.get(p.id);
      this.prevPos.set(p.id, { position: p.position, onStep: p.onBranch?.step ?? null });
      if (!prev || prev.onStep != null || p.onBranch != null) continue;
      if (p.position === prev.position) continue;
      movers.push({ id: p.id, from: prev.position, to: p.position });
    }

    // 行军异步播放,但棋子渲染必须立刻让位(否则 React 先画终点再被拽回起点):
    // 先拼 lastMove 形状(主路前向逐格,与引擎 MovePath 同构)锚定旧位置,
    // sync 渲染后再沿弧线补走;表现完清掉拼装值,避免污染后续判断。
    if (movers.length > 0) {
      for (const m of movers) {
        const traversed: number[] = [];
        for (let i = 1; i <= tileCount; i++) {
          const t = (m.from + i) % tileCount;
          traversed.push(t);
          if (t === m.to) break;
        }
        engine.lastMove = {
          from: m.from,
          traversed,
          landIndex: m.to,
          passedCapital: false,
          capitalIndex: -1,
          waypoints: [],
          landBranchStep: null,
          branchWaypoints: [],
        };
        beginMarch(engine, m.id);
        const id = m.id;
        this.fxQueue = this.fxQueue.then(() => animateMove(engine, id));
      }
      this.fxQueue = this.fxQueue.then(() => {
        engine.lastMove = null;
      });
    }

    // 3) 回合横幅(活跃座位变化时;排在行军后,不打架)
    this.fxQueue = this.fxQueue.then(() => maybeShowTurnBanner(engine));
  }

  destroy(): void {
    this.ws?.close();
    this.ws = null;
    this.pending = false;
  }
}

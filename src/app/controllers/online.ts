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
import { FetchMapSource } from "@app/map-sources";
import { setEngine, useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { createEngineSink } from "@app/fx/sinks";
import { present, turnBannerEvent } from "@app/fx/orchestrator";
import type { PresentationEvent } from "@app/fx/presentation";
import { setController } from "./registry";
import { GameController } from "./controller";

/** 服务器消息(协议见 scripts/server.ts:lobby / snapshot / dismissed / error)。
 *  lobby 与 snapshot 都带完整房间字段(clientView 两种形态对齐,见 room.ts)。 */
export type ServerMsg =
  | ({ type: "lobby" } & NetRoomFields)
  | ({ type: "snapshot" } & NetRoomFields & GameSnapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

/** REST 入座回包(对照 scripts/server.ts:/room/new、/room/join 端点返回:
 *  {ok, seat, seatToken, ...lobbyView};lobbyView 房间字段与 WS 广播同构)。 */
interface RoomJoinReply extends NetRoomFields {
  ok: true;
  /** 分到的座位(建房=0 即 host)。 */
  seat: number;
  /** 座位归属凭证(WS 连接与后续 REST 鉴权用)。 */
  seatToken: string;
}

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
  /** 轮到我决策(含珍宝交涉的 decisionOwner)且非 bot 座位、无 pending 命令、未托管。
   *  共享骨架在基类 canAct(单机/联机判定收口),此处补联机特有:须轮到「我的座位」,
   *  差异锁 = pending(防连点重复发)与托管(服务器 bot 代打)。 */
  get interactive(): boolean {
    return this._engine.decisionOwner === this.seat && this.canAct(this.pending, this.autoPilotOn);
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
  async createRoom(opts: { seats: number; bot?: number[]; seed?: number; target?: number }): Promise<RoomJoinReply> {
    const reply = this.parseRoomReply(await this.http("/room/new", opts));
    await this.adoptRoom(reply);
    return reply;
  }

  /** 按房间码加入并连接。 */
  async joinRoom(roomId: string): Promise<RoomJoinReply> {
    const reply = this.parseRoomReply(await this.http("/room/join", { roomId: roomId.toUpperCase() }));
    await this.adoptRoom(reply);
    return reply;
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

  /** 从已收窄的入座回包取凭证并建立 WS;房间字段灌 netStore(大厅屏初渲染)。 */
  private async adoptRoom(reply: RoomJoinReply): Promise<void> {
    this.roomId = reply.roomId;
    this.seat = reply.seat;
    this.seatToken = reply.seatToken;
    this.applyRoomFields(reply);
    useNetStore.getState().setMySeat(this.seat);
    useGameStore.getState().setViewSeat(this.seat);
    this.connect();
  }

  /** REST 入座回包(/room/new、/room/join)的一次性收窄:
   *  原先用 6 个 as 硬取字段,现按 server.ts 端点返回(ok + 入座凭证 + lobbyView 房间字段,
   *  房间字段与 WS 广播同构)在此处集中做运行时校验/转换,后续代码全部走类型化字段。 */
  private parseRoomReply(r: Record<string, unknown>): RoomJoinReply {
    return {
      ok: true,
      roomId: String(r.roomId),
      seat: Number(r.seat),
      seatToken: String(r.seatToken),
      host: Number(r.host),
      started: r.started === true,
      mapId: typeof r.mapId === "string" ? r.mapId : null,
      // seats 数组结构由 server.ts seatMeta 产出,这里只做边界防御(非数组按空处理)
      seats: Array.isArray(r.seats) ? (r.seats as NetRoomFields["seats"]) : [],
    };
  }

  /** REST 回包 / 广播里的房间字段 → netStore(lobby 与 snapshot 消息字段同构)。 */
  private applyRoomFields(r: NetRoomFields): void {
    useNetStore.getState().setRoom({
      roomId: r.roomId,
      host: r.host,
      started: r.started,
      mapId: r.mapId ?? null,
      seats: r.seats ?? [],
    });
  }

  // ─── WS 连接管理 ───
  /** 重连循环状态:onclose → 指数退避重连(带抖动);destroy 置位后不再重试。 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private closedByUs = false;
  /** 退避参数:1s/2s/4s… 上限 30s,每次 ±30% 随机抖动(防多端同时断线同步风暴);
   *  超过 10 次放弃。重连沿用原 seatToken 重升级——ADR-0002:token 夺回座位,
   *  服务器侧已支持,重连成功后首帧 snapshot 照常 hydrate(与正常入座同路径)。 */
  private static readonly RECONNECT_BASE_MS = 1000;
  private static readonly RECONNECT_MAX_MS = 30000;
  private static readonly RECONNECT_MAX_ATTEMPTS = 10;

  private connect(): void {
    if (this.closedByUs || !this.roomId || this.seat < 0 || !this.seatToken) return;
    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/ws?room=${this.roomId}&seat=${this.seat}&token=${this.seatToken}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0; // 连上即清零,下次断线从 1s 重新起退避
      useNetStore.getState().setConnected(true);
    };
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as ServerMsg);
    this.ws.onclose = () => {
      if (this.closedByUs) return;
      useNetStore.getState().setConnected(false); // UI 已会显示断连态
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      // 重连尝试期间的 error 不打扰(onclose 马上接管);仅正常在线时闪提示
      if (useNetStore.getState().connected) useNetStore.getState().pushHint("连接异常");
    };
  }

  /** 指数退避重连调度。 */
  private scheduleReconnect(): void {
    if (this.closedByUs || this.reconnectTimer) return;
    if (this.reconnectAttempts >= OnlineController.RECONNECT_MAX_ATTEMPTS) {
      useGameStore.getState().pushHint("重连失败,请刷新页面");
      return;
    }
    const backoff = Math.min(
      OnlineController.RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      OnlineController.RECONNECT_MAX_MS,
    );
    const delayMs = backoff * (0.7 + Math.random() * 0.6); // ±30% 抖动
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  // ─── 快照表现(阶段 6 → Wave1 统一事件流):diff 提取事件 → present 播放 ───
  /** 上一帧快照的玩家位置/现金/破产位(联机端无本地引擎推进事件,表现全靠相邻快照 diff)。 */
  private prevPos = new Map<string, { position: number; onStep: number | null }>();
  private prevCash = new Map<string, number>();
  private prevBankrupt = new Set<string>();
  /** 表现链串行化:快照可能连续到达,排队播放避免两次行军互踩。 */
  private fxQueue: Promise<void> = Promise.resolve();
  /** 是否已在对局屏(首帧 snapshot 才切屏;之后重连/恢复不重复切)。 */
  private enteredGame = false;
  /** 表现出口(Wave1):引擎经 getter 绑定(rebuildForMap 会整体替换引擎实例)。 */
  private readonly fxSink = createEngineSink(() => this._engine);

  private onMessage(msg: ServerMsg): void {
    if (msg.type === "lobby") {
      // lobby/snapshot 两种消息都带完整 NetRoomFields(ServerMsg 已声明),直接透传
      this.applyRoomFields(msg);
      // 换图单路径:lobby 广播的 mapId 驱动本地重建(占位引擎 + registry 的 MapData)。
      if (msg.mapId && msg.mapId !== this.mapId) void this.rebuildForMap(msg.mapId);
      return;
    }
    if (msg.type === "snapshot") {
      const { type: _t, ...snap } = msg;
      // 掷骰检测(联机骰子动画):掷骰只在「本帧前引擎处于 Roll 阶段、本帧已离开」时发生
      // (rollAndMove 后 turnPhase 变为 决策/驻跸/下一回合)。快照里的 lastRoll 对象每帧
      // 重建,不能靠引用/字段 diff,用阶段迁移判定最稳。首帧(占位引擎)不算。
      const prevPhase = this._engine.turnPhase;
      this.applyRoomFields(msg);
      if (msg.mapId && msg.mapId !== this.mapId) {
        // 快照带了新图(理论上开局前已由 lobby 广播换好;兜底再同步一次)
        this.mapId = msg.mapId;
      }
      this._engine.restoreFromSnapshot(snap as GameSnapshot);
      this.pending = false;
      this.playSnapshotEffects(this.enteredGame && prevPhase === "Roll" && this._engine.turnPhase !== "Roll");
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

  /** 快照级表现(Wave1 改造为"提取 → 事件数组 → present"):diff 上一快照提取
   *  diceRolled/cashDelta/tokenMoved/sound(bankrupt)/turnBanner 事件,统一交给
   *  orchestrator.present 播放(与单机同一条播放路径,形状不再漂移)。
   *  浮字走 diff(floaters 不序列化);行军经 applyPresentationMove 注入 diff 推导的
   *  轨迹(快照虽含 lastMove,但那是"发令端视角",重放以本地 diff 为准,语义更稳)。
   *  骰子(newRoll=true):本地无掷骰授权(点数在服务器),diceRolled 事件驱动
   *  ThreeDice.roll(服务器权威 die)——各端轨迹/初始条件由本地随机流决定,
   *  各不相同没关系:**落面 = 服务器权威点数,多端一致**(TODO #2 的最终答案)。 */
  private playSnapshotEffects(newRoll: boolean): void {
    const engine = this._engine;
    const board = engine.board;
    const tileCount = board.tiles.length;
    const events: PresentationEvent[] = [];

    // 0) 新掷骰 → diceRolled 事件(排在行军前,时序对齐单机 Roll 步的 骰子→行军 链)。
    //    掷骰只在「本帧前引擎处于 Roll 阶段、本帧已离开」时发生(快照里的 lastRoll
    //    对象每帧重建,不能靠引用/字段 diff,用阶段迁移判定最稳。首帧不算)。
    if (newRoll) {
      const die = engine.lastRoll?.die;
      if (die) events.push({ kind: "diceRolled", die });
    }

    // 1) 现金 diff → cashDelta 事件(锚到玩家当前格逻辑坐标)
    for (const p of engine.players) {
      const prev = this.prevCash.get(p.id);
      if (prev != null && p.cash !== prev) {
        const pos = board.positionOf(p.position);
        events.push({ kind: "cashDelta", playerId: p.id, amount: p.cash - prev, x: pos.x, y: pos.y, atTile: p.position });
      }
      this.prevCash.set(p.id, p.cash);
    }

    // 2) 位置 diff → tokenMoved 事件(首帧只记位置,不动画;辅路进出不做主路行军)。
    //    棋子渲染必须立刻让位(否则 React 先画终点再被拽回):提取期同步经
    //    applyPresentationMove(引擎合法表现通道)注入 diff 推导的轨迹锚定旧位置,
    //    present 播放时再沿轨迹补走;表现完清掉注入,避免污染后续判断。
    let marched = false;
    for (const p of engine.players) {
      const prev = this.prevPos.get(p.id);
      this.prevPos.set(p.id, { position: p.position, onStep: p.onBranch?.step ?? null });
      if (!prev || prev.onStep != null || p.onBranch != null) continue;
      if (p.position === prev.position) continue;
      const traversed: number[] = [];
      for (let i = 1; i <= tileCount; i++) {
        const t = (prev.position + i) % tileCount;
        traversed.push(t);
        if (t === p.position) break;
      }
      const path = {
        from: prev.position,
        traversed,
        landIndex: p.position,
        passedCapital: false,
        capitalIndex: -1,
        waypoints: [],
        landBranchStep: null,
        branchWaypoints: [],
      };
      engine.applyPresentationMove(path);
      this.fxSink.marchBegin(p.id);
      events.push({ kind: "tokenMoved", playerId: p.id, path });
      marched = true;
    }

    // 2.5) 破产 diff → bankrupt 音效事件。**Wave1 唯一的有意行为变化**:对齐单机
    //      playStepEffects(AwaitingBankruptcySettle → prePlayer.isBankrupt → 破产音)
    //      ——此前联机完全缺失破产表现(架构报告候选 1+6 修复的漂移点)。
    for (const p of engine.players) {
      if (p.isBankrupt && !this.prevBankrupt.has(p.id)) {
        events.push({ kind: "sound", event: "bankrupt" });
      }
      if (p.isBankrupt) this.prevBankrupt.add(p.id);
    }

    // 3) 回合横幅事件(活跃座位变化时,orchestrator 内去重;排在行军后,不打架)
    const banner = turnBannerEvent(engine);
    if (banner) events.push(banner);

    this.fxQueue = this.fxQueue.then(() => present(events, this.fxSink));
    if (marched) {
      // 清掉 diff 推导的 presentation 轨迹:真实引擎态(服务器权威)不被本地表现污染
      this.fxQueue = this.fxQueue.then(() => {
        engine.applyPresentationMove(null);
      });
    }
  }

  destroy(): void {
    // 先置位再 close:onclose 回调看到 closedByUs 直接返回,不触发重连
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.pending = false;
  }
}

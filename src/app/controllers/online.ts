// 联机控制器——重构后只做「协议桥」(替代旧 src/render/network-client.ts 的连接/协议部分,零 DOM):
// - 不跑引擎,只持「只读引擎」——收到服务器 snapshot 即 restoreFromSnapshot 重 hydrate。
// - 连接/重连归 net/reconnecting-socket.ts,REST 大厅归 net/lobby-api.ts,
//   快照表现提取归 net/snapshot-effects.ts(原「一类五职责」拆分,ADR-0007 的客户端对偶)。
//   本类只剩:协议消息分发、快照 hydrate、表现提取器调用、registry/store 灌数、换图重建。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { loadMapById } from "@core/map-source";
import { FetchMapSource } from "@app/map-sources";
import { setEngine, useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { LobbyApi, type RoomJoinReply } from "@app/net/lobby-api";
import { ReconnectingSocket } from "@app/net/reconnecting-socket";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { setController } from "./registry";
import { GameController } from "./controller";

export type { RoomJoinReply };

/** 服务器消息(协议见 scripts/server.ts:lobby / snapshot / dismissed / error)。
 *  lobby 与 snapshot 都带完整房间字段(clientView 两种形态对齐,见 room.ts)。 */
export type ServerMsg =
  | ({ type: "lobby" } & NetRoomFields)
  | ({ type: "snapshot" } & NetRoomFields & GameSnapshot)
  | { type: "dismissed"; roomId: string }
  | { type: "error"; error: string };

export class OnlineController extends GameController {
  private _engine: GameEngine; // 只读:每次 snapshot 用 restoreFromSnapshot 重 hydrate
  private readonly api: LobbyApi;
  private sock: ReconnectingSocket | null = null;
  private roomId: string | null = null;
  private seatToken: string | null = null;
  /** 当前占位引擎对应的地图 id(换图守卫:同图不重建)。 */
  private mapId: string | null;
  seat = -1;
  /** 发出命令后置 true,收 snapshot 回包清零(防连点重复发;旧 busy 的新等价物)。 */
  private pending = false;
  /** 快照表现提取器(独立 module,diff 基准与播放队列封装在内)。 */
  private readonly fx = new SnapshotEffects(() => this._engine);
  /** 是否已在对局屏(首帧 snapshot 才切屏;之后重连/恢复不重复切)。 */
  private enteredGame = false;
  /** 托管能力:联机支持(服务器 bot 代打;单机不支持)。 */
  override readonly autopilotSupported = true;

  constructor(map: LoadedMap, serverUrl: string, mapId?: string | null) {
    super();
    this.api = new LobbyApi(serverUrl);
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
  /** pending 公开只读(UI F3:HandPanel 据此显示「行军中…」;写仍只发生在本类)。 */
  get isPending(): boolean {
    return this.pending;
  }
  /** 我的座位托管中(从 netStore 的 seats 广播回读,与旧 latestSeats 等价)。 */
  get autoPilotOn(): boolean {
    const s = useNetStore.getState();
    return s.seats[s.mySeat]?.autoPilot ?? false;
  }
  /** 轮到我决策(含珍宝交涉的 decisionOwner)且非 bot 座位、无 pending 命令、未托管。
   *  Wave3(候选2):基类 canAct 变参收口删除,公共骨架(Playing + 决策方是人类)在此内联,
   *  联机特有:须轮到「我的座位」,差异锁 = pending(防连点重复发)与托管(服务器 bot 代打)。 */
  get interactive(): boolean {
    const e = this._engine;
    return (
      e.decisionOwner === this.seat &&
      e.phase === "Playing" &&
      !e.players[e.decisionOwner]?.isBot &&
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
    if (!this.sock?.isOpen) {
      useGameStore.getState().pushHint("连接未就绪");
      return;
    }
    this.pending = true;
    // UI F3:pending 透传 netStore(HandPanel 读 netStore.pending 显示「行军中…」;
    // 不给基类加 seam,联机/单机经同一 store 字段取态,单机恒 false)。
    useNetStore.getState().setPending(true);
    this.sock.send(JSON.stringify({ type: "cmd", cmd }));
    this.sync(); // 刷新 interactive(pending 期间锁操作)
  }

  /** 自助托管(spec: autopilot):发 WS 消息,生效状态从 seats 广播回读(无乐观更新)。 */
  override setAutoPilot(on: boolean, speed: "fast" | "slow"): void {
    if (!this.sock?.isOpen) {
      useGameStore.getState().pushHint("连接未就绪");
      return;
    }
    this.sock.send(JSON.stringify({ type: "autoPilot", on, speed }));
  }

  // ─── REST(建房/加入/选图/开局;协议与旧 network-client 一致)──
  /** 建房并连接。返回房间信息(供大厅屏渲染)。 */
  async createRoom(opts: { seats: number; bot?: number[]; seed?: number; target?: number }): Promise<RoomJoinReply> {
    const reply = await this.api.createRoom(opts);
    await this.adoptRoom(reply);
    return reply;
  }

  /** 按房间码加入并连接。 */
  async joinRoom(roomId: string): Promise<RoomJoinReply> {
    const reply = await this.api.joinRoom(roomId);
    await this.adoptRoom(reply);
    return reply;
  }

  /** host 选图:只发请求;本地换图由 lobby 广播单路径驱动(host/非 host 同路)。 */
  async pickMap(mapId: string): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.api.pickMap({ roomId: this.roomId, seatToken: this.seatToken }, mapId);
  }

  /** host 开局:引擎在服务器侧构造,本端只等首帧 snapshot 广播。 */
  async startGame(): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.api.startGame({ roomId: this.roomId, seatToken: this.seatToken });
  }

  /** host 强令 bot 接管掉线座位(ADR-0002;当前 UI 未接,协议侧备齐)。 */
  async takeover(seat: number): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.api.takeover({ roomId: this.roomId, seatToken: this.seatToken }, seat);
  }

  /** host 解散房间(当前 UI 未接,协议侧备齐)。 */
  async dismissRoom(): Promise<void> {
    if (!this.roomId || !this.seatToken) throw new Error("未入座");
    await this.api.dismissRoom({ roomId: this.roomId, seatToken: this.seatToken });
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

  // ─── WS 连接(建连与退避重连细节封装在 ReconnectingSocket,这里只接状态与消息)──
  /** 建立带自动重连的 WS(重连沿用原 seatToken 重升级——ADR-0002:token 夺回座位,
   *  重连成功后首帧 snapshot 照常 hydrate,与正常入座同路径)。 */
  private connect(): void {
    if (!this.roomId || this.seat < 0 || !this.seatToken) return;
    const sock = new ReconnectingSocket({ url: this.api.wsUrl({ roomId: this.roomId, seatToken: this.seatToken }, this.seat) });
    this.sock = sock;
    sock.onStatus((s) => {
      // F2:全量状态入 netStore(断线横幅读 connection 三值),connected 由 setConnection
      // 派生写入。并行边界:本回调是 F2 线唯一被授权改动的 online.ts 位置,其余勿动。
      useNetStore.getState().setConnection(s);
    });
    sock.onError(() => {
      // 重连尝试期间的 error 不打扰(onclose 马上接管);仅正常在线时闪提示
      if (useNetStore.getState().connected) useNetStore.getState().pushHint("连接异常");
    });
    sock.onMessage((data) => this.onMessage(JSON.parse(data) as ServerMsg));
    sock.connect();
  }

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
      useNetStore.getState().setPending(false); // UI F3:快照到达即解锁「行军中…」
      this.fx.play(this.enteredGame && prevPhase === "Roll" && this._engine.turnPhase !== "Roll");
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

  destroy(): void {
    // socket.close 内部先置 closedByUs 再关:onclose 不触发重连,退避定时器一并清
    this.sock?.close();
    this.sock = null;
    this.pending = false;
    useNetStore.getState().setPending(false); // UI F3:销毁时清 pending,防残留
  }
}

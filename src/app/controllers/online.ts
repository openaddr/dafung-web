// 联机控制器——重构后只做「协议桥」(替代旧 src/render/network-client.ts 的连接/协议部分,零 DOM):
// - 不跑引擎,只持「只读引擎」——折叠切换⑥(#388)后状态通路 = 事件批消息(到达即
//   foldEventBatch 折进副本);snapshot 只剩整房摘要(首连/重连)与关键节点校准,到达
//   即 restoreFromSnapshot 重 hydrate(水合无条件覆盖折叠字段,快照=校准锚)。
// - 连接/重连归 net/reconnecting-socket.ts,REST 大厅归 net/lobby-api.ts,
//   事件批表现消费归 net/snapshot-effects.ts(原「一类五职责」拆分,ADR-0007 的客户端对偶;
//   #385 起演出因果 = 服务端事件批,快照 diff 提取已退役)。
//   本类只剩:协议消息分发、事件批折叠(#386)+快照 hydrate(水合=校准锚)、表现消费
//   调用、registry/store 灌数、换图重建、重连清批(#388:open 时事件面归零)。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/authority";
import type { GameCommand } from "@core/authority";
import { loadMapById } from "@core/map-source";
import { FetchMapSource } from "@app/map-sources";
import { setEngine, useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { LobbyApi, type RoomJoinReply } from "@app/net/lobby-api";
import { ReconnectingSocket } from "@app/net/reconnecting-socket";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { stashEventBatch, type EventBatchMsg } from "@app/net/event-feed";
import { foldEventBatch } from "@app/net/event-fold";
import { reactionQueriesSeat } from "./reaction";
import { setController } from "./registry";
import { GameController } from "./controller";

export type { RoomJoinReply };

/** 服务器消息(协议见 scripts/server.ts:lobby / snapshot / events / dismissed / error)。
 *  lobby 与 snapshot 都带完整房间字段(clientView 两种形态对齐,见 room.ts)。 */
export type ServerMsg =
  | ({ type: "lobby" } & NetRoomFields)
  | ({ type: "snapshot" } & NetRoomFields & GameSnapshot)
  | EventBatchMsg
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
  /** 当前地图(占位引擎重建用:快照座位数与占位引擎不一致时按数重建)。 */
  private map: LoadedMap;
  seat = -1;
  /** 发出命令后置 true,收 snapshot 回包清零(防连点重复发;旧 busy 的新等价物)。 */
  private pending = false;
  /** 换图重建流水号(#415):每次 rebuildForMap 起步自增,落地时对号——号不对 =
   *  期间有更新的换图指令,本次作废(取图 await 与下行快照/新换图指令竞速的过期落地防回归)。 */
  private rebuildSeq = 0;
  /** 事件批表现消费器(#385):netStore 暂存批(events 下行通道)→ 表现事件 → 播放,
   *  播放队列与到达序游标封装在内。onIdle:表现队列排空时补一次 sync——L42 期间被
   *  fx.playing 锁住的 interactive 在骰子/行军动画播完这一刻释放,决策卷轴/行军按钮
   *  随即就位(与单机 drive 锁同口径)。 */
  private readonly fx = new SnapshotEffects(
    () => this._engine,
    () => this.sync(),
  );
  /** 是否已在对局屏(首帧 snapshot 才切屏;之后重连/恢复不重复切)。 */
  private enteredGame = false;
  /** 上一帧是否处于「我的 Roll 等待态」(#188 起签表现的转入沿检测基准)。 */
  private prevMyRollWait = false;
  /** 上一帧各座位棋子位置(#385 行军锚定基准,#386 折叠前捕获口径)。#388 起表现
   *  直译改随事件帧走(锚点就地捕获传 play),快照帧的 play 由消费游标去重不再消费
   *  新批——本字段保留给快照帧的既有兜路(空批校准帧等),不再承载跨帧交接。 */
  private pendingMarchAnchors: (number | null)[] | null = null;
  /** 托管能力:联机支持(服务器 bot 代打;单机不支持)。 */
  override readonly autopilotSupported = true;

  constructor(map: LoadedMap, mapId?: string | null) {
    super();
    // LobbyApi 自取 server-base 单源(#279):地址在调用时读取,大厅改址即时生效
    this.api = new LobbyApi();
    this.mapId = mapId ?? null;
    this.map = map;
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
   *  联机特有:须轮到「我的座位」,差异锁 = pending(防连点重复发)与托管(服务器 bot 代打)。
   *  L42:再加表现锁 fx.playing——快照落地即可(数据即时),但骰子/行军动画播完前
   *  决策卷轴/行军按钮不呈现(单机 drive 会话锁的联机等价物;WaitingBar/横幅不受影响,
   *  它们不吃 interactive)。
   *  反应窗(#281,ADR-0017 多属主)例外:被询问座位可应答——决策方仍是出牌者,
   *  decisionOwner 不适用;不加 fx.playing 锁(倒计时不等演出,超时兜底在权威侧)。 */
  get interactive(): boolean {
    const e = this._engine;
    if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
      const pr = e.pendingReaction;
      if (pr == null) return false;
      // 被询问集公式单源 controllers/reaction.ts(#284);观战(seat=-1)恒不在集内。
      return !this.pending && this.seat >= 0 && reactionQueriesSeat(pr.view, this.seat);
    }
    return (
      e.decisionOwner === this.seat &&
      e.phase === "Playing" &&
      !e.players[e.decisionOwner]?.isBot &&
      !this.pending &&
      !this.autoPilotOn &&
      !this.fx.playing
    );
  }

  /** 用一张地图构建占位引擎(联机不掷本地骰,种子随意;座位数随房间,缺省 2 座)。 */
  private makePlaceholderEngine(map: LoadedMap, seatCount = 2): GameEngine {
    return new GameEngine(map.board, map.catalog, createDice(), {
      seats: Array.from({ length: seatCount }, (_, i) => ({
        name: `诸侯 ${i + 1}`,
        isBot: i > 0,
      })),
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

  /** Setup(PickCapital)落子(L41 联机):发 WS {type:"pickCapital"}——轮次/候选校验
   *  在服务器(room.pickCapital),生效靠广播快照(候选滚换/推进/进 Playing)。
   *  与 dispatchCommand 同用 pending 防连点;托管中不发(服务器 bot 代选)。 */
  override setupPickCapital(tileIndex: number): void {
    const e = this._engine;
    if (e.phase !== "Setup" || e.setupPhase !== "PickCapital") return;
    if (e.currentSetupPlayerIndex !== this.seat) return;
    if (this.pending || this.autoPilotOn) return;
    if (!this.sock?.isOpen) {
      useGameStore.getState().pushHint("连接未就绪");
      return;
    }
    this.pending = true;
    useNetStore.getState().setPending(true);
    this.sock.send(JSON.stringify({ type: "pickCapital", tileIndex }));
    this.sync(); // pending 期间锁重复提交
  }

  // ─── REST(建房/加入/选图/开局;协议与旧 network-client 一致)──
  /** 建房并连接。返回房间信息(供大厅屏渲染)。guohao=host 预设国号(R3-D1 #99,与 joinRoom 同语义)。 */
  async createRoom(opts: {
    seats: number;
    bot?: number[];
    seed?: number;
    target?: number;
    guohao?: string;
  }): Promise<RoomJoinReply> {
    const reply = await this.api.createRoom(opts);
    await this.adoptRoom(reply);
    return reply;
  }

  /** 按房间码加入并连接。guohao=预设国号(重名时开局由服务器加方位前缀)。 */
  async joinRoom(roomId: string, guohao?: string): Promise<RoomJoinReply> {
    const reply = await this.api.joinRoom(roomId, guohao);
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
    const sock = new ReconnectingSocket({
      url: this.api.wsUrl({ roomId: this.roomId, seatToken: this.seatToken }, this.seat),
    });
    this.sock = sock;
    sock.onStatus((s) => {
      // F2:全量状态入 netStore(断线横幅读 connection 三值),connected 由 setConnection
      // 派生写入。断线边界(s!=="open")废弃在途事件批(#385):断线前收到但未随快照
      // 消费的暂存批不在重连后补播;重连成功(#388 重连语义=整房摘要+清批)则把事件面
      // 整体归零(暂存批+到达计数+演出消费游标)——重连前的旧批不被当新批消费,状态
      // 唯一来源 = 紧随其后的整房摘要(ADR-0020 决策 4;服务器重启旧批重发的归口在
      // server.ts 恢复登记,见 seenBatches 恢复基线)。
      if (s === "open") this.fx.resetEventFace();
      else this.fx.dropStalledBatch();
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
      // 转移前各座位棋子位置(#385 行军锚定基准):hydrate 覆盖引擎态前捕获——
      // 反应窗余段行军按「视觉停点 → 落点」截短播用(与单机 runAnimatedStep 同口径)。
      // #386:同 tick 事件批已先行折叠推进 position,视觉停点改用折叠前捕获的锚点;
      // 本帧无事件批(空批 flush)时引擎位置未被折叠,水合前捕获口径不变。
      const prePositions = this.pendingMarchAnchors ?? this._engine.players.map((p) => p.position);
      this.pendingMarchAnchors = null;
      this.applyRoomFields(msg);
      if (msg.mapId && msg.mapId !== this.mapId) {
        // 快照带了新图(理论上开局前已由 lobby 广播换好;兜底再同步一次)
        this.mapId = msg.mapId;
      }
      if (snap.players.length !== this._engine.players.length) {
        // 座位数不一致 → 按快照座位数重建占位引擎(3+ 座联机局:restoreFromSnapshot
        // 按 e.players[i] 原地覆盖,占位引擎恒 2 座会越界写 undefined;占位座位本就
        // 是渲染壳,首帧快照整体覆盖,重建无信息丢失)。
        this._engine = this.makePlaceholderEngine(this.map, snap.players.length);
        setEngine(this._engine);
      }
      this._engine.restoreFromSnapshot(snap as GameSnapshot);
      this.pending = false;
      useNetStore.getState().setPending(false); // UI F3:快照到达即解锁「行军中…」
      // 演出(#385):netStore 暂存的事件批(events 消息先于同 tick 快照到达)经
      // SnapshotEffects 直译播放;本帧无批(空批 flush)时游标不推进,自然跳过。
      this.fx.play(prePositions);
      this.checkRollSeal();
      this.sync();
      // 首帧 snapshot = 开局:从大厅切到对局屏(仅切屏;数据已 sync 进 gameStore)
      if (!this.enteredGame) {
        this.enteredGame = true;
        useGameStore.getState().setScreen("game");
      }
      return;
    }
    if (msg.type === "events") {
      // 折叠最小闭环(#386,ADR-0020 决策 1):事件批投影进本地引擎副本(现金/位置
      // 两族,折叠器见 net/event-fold.ts),经既有 syncFromEngine 通路重渲(界面读口
      // 不变,不另起平行 store 切片;一次事件批一次重渲)。#388 切换后本通路是唯一
      // 对局状态下行,快照只在整房摘要/关键节点校准到达(水合无条件覆盖全部字段)。
      // 折叠前先捕获棋子位置当行军锚点(「转移前视觉停点」口径同快照帧)。
      const prePositions = this._engine.players.map((p) => p.position);
      foldEventBatch(this._engine, msg.events);
      // 表现消费(#385):批经 SnapshotEffects 直译播放。#388 起直译随事件帧走——
      // 正常对局快照不再随转移到达,表现锁(fx.playing,L42 决策卷轴的时序门)不能
      // 等快照帧;快照帧的 play 由消费游标去重,同批不会播两次。
      stashEventBatch(msg.events);
      this.fx.play(prePositions);
      // #388:命令在途锁在此解锁(旧世界靠快照回包清零;空批转移无 events 消息,由
      // 随后的决策窗校准快照解锁——见 server.ts 校准口径)。
      this.pending = false;
      useNetStore.getState().setPending(false);
      this.checkRollSeal();
      this.sync();
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
    // error:闪提示(如非法命令);pending 解锁等下一帧 events/校准快照校正。
    useGameStore.getState().pushHint(msg.error);
  }

  /** 起签转入沿检测(#188 第 1 步):本端人类座位进入「Roll 等待态」(服务器 ~1s 后自动
   *  起摇)→ 钤「签」印。快照帧与事件批帧共用(#388 切换后 Roll 等待态改由事件折叠
   *  到达,不再有逐步快照承载)。托管中座位由服务器 bot 代打(Roll 不经等待态),观战
   *  无座,都不播——与单机 autoRoll 的起签口径一致。 */
  private checkRollSeal(): void {
    const e = this._engine;
    const myRollWait =
      e.phase === "Playing" &&
      e.turnPhase === "Roll" &&
      e.decisionOwner === this.seat &&
      !e.players[this.seat]?.isBot &&
      !this.autoPilotOn;
    if (this.enteredGame && myRollWait && !this.prevMyRollWait) this.fx.qiqian(this.seat);
    this.prevMyRollWait = myRollWait;
  }

  /** 换图重建(lobby 广播驱动):fetch 内置图 → 重建占位引擎 + registry 的 MapData。
   *  BoardView/详情卷轴读的都是 registry 的 MapData,所以两处都要换。 */
  private async rebuildForMap(mapId: string): Promise<void> {
    const seq = ++this.rebuildSeq;
    let map: LoadedMap;
    let data: import("@core/board-loader").MapData;
    try {
      ({ map, data } = await this.loadMapBundle(mapId));
    } catch (err) {
      useNetStore.getState().pushHint(`加载地图失败:${(err as Error).message}`);
      return;
    }
    // 过期守卫(#415):取图 await 期间可能有更新的换图指令(rebuildSeq 已自增)——本次作废。
    if (seq !== this.rebuildSeq) return;
    if (this.enteredGame && this.mapId === mapId) {
      // #415:对局快照已先行水合(开局 flush 与本重建的取图竞速,取图可能后落)——
      // 此时换新占位引擎会把已水合的对局态打回 2 座空壳;房间静默等真人决策时再无
      // 后续下行纠偏,该端从此读不到真实局面(并发选都停摆的根因)。改「换板不换局」:
      // 当前引擎态整卷快照,在新图占位壳上复原,对局态与棋盘一次到位。
      const snap = this._engine.snapshot();
      this.map = map;
      this._engine = this.makePlaceholderEngine(map, snap.players.length);
      this._engine.restoreFromSnapshot(snap);
      setEngine(this._engine);
      // setController 对同一实例不 destroy(见 registry 守卫),只更新 MapData
      setController(this, data);
      this.sync();
      return;
    }
    this.mapId = mapId;
    this.map = map;
    this._engine = this.makePlaceholderEngine(map);
    setEngine(this._engine);
    // setController 对同一实例不 destroy(见 registry 守卫),只更新 MapData
    setController(this, data);
    this.sync();
  }

  /** 换图取材(清单回查 + 地图加载):rebuildForMap 的取图步,单独成方法 = 测试注入缝
   *  (bun 单测覆写本方法即可驱动 rebuildForMap,不触网)。 */
  private async loadMapBundle(
    mapId: string,
  ): Promise<{ map: LoadedMap; data: import("@core/board-loader").MapData }> {
    const source = new FetchMapSource();
    const data = await source.loadMapData(mapId);
    const map = await loadMapById(source, mapId);
    return { map, data };
  }

  destroy(): void {
    // socket.close 内部先置 closedByUs 再关:onclose 不触发重连,退避定时器一并清
    this.sock?.close();
    this.sock = null;
    this.pending = false;
    useNetStore.getState().setPending(false); // UI F3:销毁时清 pending,防残留
  }
}

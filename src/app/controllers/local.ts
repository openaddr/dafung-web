// 单机控制器(#398 单机统一 B):「服务器住在本进程」——进程内起房间编排
// (scripts/room.ts RoomRegistry,与联机 server.ts 同一份编排),经 MemorySocket
// (src/app/net/transport.ts 内存双工)驱动:
//   命令上行 = wire 协议三族消息(编码/解析/分发单源 scripts/wire.ts #429,与联机 WS
//              同一本体,不再「同契约」双写);
//   推进     = 房间编排引擎/bot 链(driveBots)/看门狗(#188 自动起摇、#281 反应窗),
//              事件批经 transportBroadcast 合并成单拍下行(events 先行、整房摘要随后);
//   演出消费 = 与联机同一通路(SnapshotEffects → extractBatchEvents → present);
//   状态读取 = 内存直连(权威引擎就住同进程,ADR-0020 快照水合/校准/重连语义的单机
//              对应物 = 天然同步,无网络级重连,故不 hydrate 副本)。
// 旧锁步编排已随本票退役:本地 bot 循环(runBots/apLoop)、驱动仲裁器(drive.ts,已删)、
// 自动起摇/反应窗定时器全部删除——单机与联机从此只差「传输在不在网上」。
import type { LoadedMap } from "@core/board-loader";
import type { GameEngine } from "@core/authority";
import type { AiDifficulty, GameCommand, SeatConfig } from "@core/authority";
import type { EncounterConfig } from "@core/encounters";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { archiveEngineLog } from "@app/gameLogArchive";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { stashEventBatch } from "@app/net/event-feed";
import { e2eReactionWindowMs } from "@app/fx/timings";
import { createMemorySocketPair, type SeatTransport } from "@app/net/transport";
import { createWorkerClock, type WorkerClock } from "@app/net/worker-clock";
// 房间编排双运行时同构(scripts/room.ts 零 node 依赖,见该文件「运行时同构原语」节):
// 浏览器进程内直接起注册表。持久化/会话类型为纯类型导入(构建期擦除)。
import { RoomRegistry } from "../../../scripts/room";
import type { RoomSession } from "../../../scripts/room";
import type { RoomPersistence, RoomRecord } from "../../../scripts/room-persistence";
// wire 协议编解码单源(#429):上行编码(cmdMsg 等)+ 解析分发(dispatchInbound)、
// 下行消息类型(ServerMsg)全部从这里 import,与联机 server.ts/online.ts 同一份。
import {
  autoPilotMsg,
  cmdMsg,
  dispatchInbound,
  pickCapitalMsg,
  type ServerMsg,
} from "../../../scripts/wire";
import { reactionQueriesSeat } from "./reaction";
import { GameController } from "./controller";

/** 单机开局配置(房间通路):与联机 createRoom/hostConfig 同构。座位表只取
 *  isBot 布点与首座(=host 真人)的预设国号——名字/起手银两不进房间通路
 *  (引擎座位名恒「座 N」;经济 v2 起手恒 10000=引擎缺省,单源 core)。 */
export interface SoloRoomConfig {
  seats: SeatConfig[];
  targetNetWorth?: number;
  difficulty?: AiDifficulty;
  /** 骰子种子(?seed= 复现;缺省引擎自由掷)。 */
  seed?: number;
  /** 地图 id(ADR-0014 局头要素;编辑器试玩不经图库,如实空串)。 */
  mapId?: string;
  /** 机遇配置(#125):设置屏四值原值透传;缺省 = 机遇关(引擎缺省语义,与联机同)。 */
  encounter?: EncounterConfig;
}

/** 进程内房间持久化(单机):RoomPersistence 的内存实现。单机无跨进程恢复语义
 *  (销毁即解散房间),save/load 仅为满足 registry 的记录投影通道。 */
class MemoryRoomPersistence implements RoomPersistence {
  private readonly m = new Map<string, RoomRecord>();
  save(rec: RoomRecord): void {
    this.m.set(rec.roomId, rec);
  }
  load(roomId: string): RoomRecord | null {
    return this.m.get(roomId) ?? null;
  }
  remove(roomId: string): void {
    this.m.delete(roomId);
  }
  exists(roomId: string): boolean {
    return this.m.has(roomId);
  }
  listIds(): string[] {
    return [...this.m.keys()];
  }
}

export class LocalController extends GameController {
  /** 房间编排注册表(进程内单实例,随控制器生灭;联机同构的引擎侧宿主)。 */
  private readonly registry: RoomRegistry;
  /** 本局房间会话(进程内直读元数据:托管态等房间级字段不走传输)。 */
  private readonly room: RoomSession;
  /** Worker 时钟(#399):看门狗/慢速托管节拍挂 Worker,失焦照跑(后台节流免疫)。 */
  private readonly clock: WorkerClock;
  private readonly roomId: string;
  private readonly seatToken: string;
  /** 内存双工客户端端点(命令上行/消息下行的唯一通路;与联机 WS 传输同接口)。 */
  private readonly sock: SeatTransport;
  /** 房间权威引擎(内存直连读;构造同步段由 startGame 产出)。 */
  private readonly _engine: GameEngine;
  /** 单机恒 seat 0(host 真人;createRoom 强约束 seat0=human)。 */
  readonly seat = 0;
  /** 命令已发出、下行拍未回(防连点;联机 pending 的单机对应物)。 */
  private pending = false;
  /** 事件批表现消费器:与联机同一实例、同一播放队列(netStore 暂存批 → 直译 → present)。 */
  private readonly fx: SnapshotEffects;
  /** 已收首帧整房摘要(起签转入沿检测在此之前不启用,与联机 enteredGame 同语义)。 */
  private enteredGame = false;
  /** 上一拍是否处于「我的 Roll 等待态」(起签印的转入沿检测基准)。 */
  private prevMyRollWait = false;
  /** 上一拍各座位棋子位置(行军锚定基准):内存直连下引擎已在转移后,「转移前视觉
   *  停点」取上一拍同步时的位置(联机「折叠前捕获」的单机对应拍,语义等价)。 */
  private prePositions: ReadonlyArray<number | null>;
  override readonly autopilotSupported = true;

  constructor(map: LoadedMap, config: SoloRoomConfig) {
    super();
    const guohao = config.seats[0]?.guohao;
    const botIdx = new Set(config.seats.flatMap((s, i) => (s.isBot ? [i] : [])));
    // ADR-0014 单机对局日志:registry 每次 persist(每手快照)后增量归档 IndexedDB——
    // 挂在编排 persist 通道上,与旧锁步 sync() 的归档节奏同源(每手一次)。
    // Worker 时钟(#399):编排节拍(看门狗/托管步进)不随页面可见性漂移。
    this.clock = createWorkerClock();
    // #284 反应窗时长覆盖(单机形态):联机经 server env E2E_REACTION_MS → registry,
    // 单机经 e2e 注入的 localStorage 键(E2E_REACTION_MS_KEY)→ 同一 registry 选项。
    // 0/未注入 = 走 core REACTION_WINDOW_MS 常量表(配置缺席不是兜底,server.ts 同模式)。
    const reactionWindowMs = e2eReactionWindowMs();
    this.registry = new RoomRegistry(
      new MemoryRoomPersistence(),
      undefined,
      (room) => {
        if (room.engine) archiveEngineLog(room.engine);
      },
      {
        encounter: config.encounter,
        clock: this.clock,
        ...(reactionWindowMs > 0 ? { reactionWindowMs } : {}),
      },
    );
    const created = this.registry.createRoom({
      seatCount: config.seats.length,
      botIdx,
      hostConfig: {
        seed: config.seed,
        target: config.targetNetWorth,
        difficulty: config.difficulty,
      },
      guohao,
    });
    this.roomId = created.room.roomId;
    this.seatToken = created.token;
    this.room = created.room;
    // 选图+开局:单机地图已在手,合法集就是它自己;mapId 缺省(编辑器试玩)如实空串。
    this.registry.setMap(
      this.roomId,
      config.mapId ?? "",
      created.token,
      new Set([config.mapId ?? ""]),
    );
    // 内存双工:客户端端点收下行;宿主端点挂进编排(上行消息进房间公共入口,
    // 编排每次可见变化经 onUpdate → transportBroadcast 合并下行)。
    const pair = createMemorySocketPair(created.seat);
    this.sock = pair.client;
    pair.client.onMessage((data) => this.onMessage(JSON.parse(data) as ServerMsg));
    pair.host.onClientMessage((data) => this.hostDispatch(data));
    this.registry.connectSeat(this.roomId, created.seat, created.token, pair.host);
    // 开局:startGame 同步段建引擎(doDraftRoll)+ driveBots 把 bot 选都驱动到轮到
    // 人类;构造返回时引擎必已就位(同步段直抛 = 起兵失败,App catch 显式报错)。
    void this.registry.startGame(
      this.roomId,
      created.token,
      () => this.registry.transportBroadcast(this.roomId),
      () => map,
    );
    const engine = this.room.engine;
    if (!engine) throw new Error("单机开局异常:startGame 同步段未产出引擎");
    this._engine = engine;
    setEngine(engine);
    this.prePositions = engine.players.map((p) => p.position);
    this.fx = new SnapshotEffects(
      () => this._engine,
      () => this.sync(),
    );
    this.sync();
  }

  get engine(): GameEngine {
    return this._engine;
  }

  // 热座视角跟随决策方(珍宝交涉相位=城主,其余=activeIndex);与旧锁步同口径,
  // 内存直连读权威引擎,公式单源引擎 getter。
  get viewSeat(): number {
    return this._engine.decisionOwner;
  }

  /** 此刻本地玩家能否操作:与联机 OnlineController 同构(差异锁 = pending),
   *  反应窗例外:被询问座位可应答(决策方仍是出牌者,decisionOwner 不适用)。 */
  get interactive(): boolean {
    const e = this._engine;
    if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
      const pr = e.pendingReaction;
      if (pr == null) return false;
      return !this.pending && reactionQueriesSeat(pr.view, this.seat);
    }
    return (
      e.phase === "Playing" &&
      !e.players[e.decisionOwner]?.isBot &&
      !this.pending &&
      !this.autoPilotOn &&
      !this.fx.playing
    );
  }

  /** 我的座位托管中(进程内直读房间会话;房间级元数据不走传输,联机=广播回读)。 */
  override get autoPilotOn(): boolean {
    return this.room.autoPilot.has(this.seat);
  }

  // ─── 命令入口(上行经内存双工,与联机 WS 同一条 wire 编码)───
  dispatchCommand(cmd: GameCommand): void {
    if (!this.interactive) return; // 非本地决策时忽略(引擎自身也有相位守卫,双保险)
    this.pending = true;
    this.sock.send(cmdMsg(cmd));
    this.sync(); // 刷新 interactive(pending 期间锁操作)
  }

  /** Setup(PickCapital)落子:发 WS 同款 {type:"pickCapital"},轮次/候选校验在房间
   *  编排(room.pickCapital),生效靠下行拍(候选滚换/推进/进 Playing)。 */
  override setupPickCapital(tileIndex: number): void {
    const e = this._engine;
    if (e.phase !== "Setup" || e.setupPhase !== "PickCapital") return;
    if (e.currentSetupPlayerIndex !== this.seat) return;
    if (this.pending || this.autoPilotOn) return;
    this.pending = true;
    this.sock.send(pickCapitalMsg(tileIndex));
    this.sync();
  }

  /** 自助托管:发 {type:"autoPilot"},生效态从房间会话回读(无乐观更新,联机同构)。 */
  override setAutoPilot(on: boolean, speed: "fast" | "slow"): void {
    this.sock.send(autoPilotMsg(on, speed));
  }

  /** 销毁 = 进程内房间解散(看门狗/传输面残表随 dismissRoom 一并清)+ 端点关闭
   *  + Worker 时钟停转 + 事件面归零(防上一局暂存批泄入下一局,联机 resetEventFace
   *  同语义)。 */
  override destroy(): void {
    this.sock.close();
    this.registry.dismissRoom(this.roomId, this.seatToken);
    this.clock.dispose();
    useNetStore.getState().resetEventFace();
  }

  // ─── 下行消费(events 先行、整房摘要随后;与联机 OnlineController 同一形状)───
  private onMessage(msg: ServerMsg): void {
    if (msg.type === "events") {
      // 演出直译(#385/#388):批入 netStore 暂存 → SnapshotEffects 直译播放,与联机
      // 同一消费面;锚点=上一拍捕获的位置(转移前视觉停点)。
      stashEventBatch(msg.events);
      this.fx.play(this.prePositions);
      this.pending = false;
      this.checkRollSeal();
      this.sync();
      return;
    }
    if (msg.type === "snapshot") {
      // 整房摘要(首连/校准):内存直连天然同步,不 hydrate 副本(引擎=权威),
      // 只借拍刷新派生量与起签转入沿。
      this.pending = false;
      if (!this.enteredGame) this.enteredGame = true;
      this.checkRollSeal();
      this.sync();
      return;
    }
    if (msg.type === "lobby") return; // 大厅元数据(开局前首连摘要):单机无大厅读口
    if (msg.type === "dismissed") return; // 单机解散由 destroy 主动发起,无远端解散
    useGameStore.getState().pushHint(msg.error);
  }

  /** 起签转入沿(#188):本座位进入 Roll 等待态(房间 ~1s 看门狗自动起摇)→ 钤「签」印。
   *  与联机 checkRollSeal 同款,托管中由服务器代打不播。 */
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

  protected override sync(): void {
    super.sync();
    // 拍后落锚:本拍位置成为下一拍的「转移前视觉停点」(行军余段截短基准)。
    this.prePositions = this._engine.players.map((p) => p.position);
  }

  // ─── 宿主侧消息分发(= server.ts ws message 处理器的进程内对应物,同一 codec 本体)───
  /** 上行解析+分发收口 wire.dispatchInbound(#429):三族消息一个本体,双写退役。
   *  错误按类送通道(两传输面只管送达的 seam):rejected(编排校验失败,如非法命令
   *  竞态)→ pushHint + 解锁 pending(联机 error 下行的单机直达);badJson/unknownShape
   *  在内存面结构上不可能(上行只经 wire 构造函数发出),真出现 = 自身 bug,照炸
   *  (零兜底,不静默吞成提示)。 */
  private hostDispatch(raw: string): void {
    void dispatchInbound(raw, {
      cmd: (cmd) =>
        this.registry.applyCommand(this.roomId, cmd, () =>
          this.registry.transportBroadcast(this.roomId),
        ),
      pickCapital: (tileIndex) =>
        this.registry.pickCapital(this.roomId, this.seat, tileIndex, () =>
          this.registry.transportBroadcast(this.roomId),
        ),
      setAutoPilot: (on, speed) =>
        this.registry.setAutoPilot(this.roomId, this.seat, on, speed, () =>
          this.registry.transportBroadcast(this.roomId),
        ),
    }).then((result) => {
      if (result.ok) return;
      if (result.reason === "rejected") {
        useGameStore.getState().pushHint(result.message);
        this.pending = false; // 命令未生效:解锁等下一拍
        return;
      }
      throw new Error(`hostDispatch:上行消息结构性失败(${result.reason}):${result.message}`);
    });
  }
}

// 房间游戏编排(ADR-0007):房间会话模型 + 生命周期 + 座位 + host 移交 + 落盘。
// 服务器和单机客户端注入持久化、地图加载及日志落盘适配器。
// 传输层持 WS 句柄、知道 online 状态;视图/transferHost 都接 `onlineSeats: Set<number>` 作入参。
// **双运行时同构**(#398 单机统一 B):联机与单机共用命令路由和事件产出。
// 随机数与座位 token 编码见「运行时同构原语」;引擎构造与快照水合见 room-record.ts。
// 三块已拆出(模块治理 10/11 #327):客户端投影 seat-projection.ts(纯搬)、bot 驱动
// bot-driver.ts(纯搬)、看门狗 watchdogs.ts(三组收敛为通用工厂);registry 经 ops
// 对象注入宿主操作面,投影消费方直引 seat-projection.ts(不留再导出转接层)。
// 设计见 docs/adr/0007-room-module-extraction.md;语义不变量见 ADR-0001/0002/0004/0005。
import type { GameCommand, GameEngine, SeatConfig, TurnPhase } from "../engine/authority";
import { isSingleCjk, MAX_SEAT_COUNT, MIN_SEAT_COUNT } from "../engine/constants";
import { isLogWarning } from "../engine/model";
// 国号重名前缀算法(E7/#19)下沉 core:大厅客户端用同一纯函数做重名预告,开局定稿同源
import { resolveGuohaoClash } from "../engine/guohao";
import type { LoadedMap } from "../engine/board-loader";
import type { RoomPersistence } from "./room-persistence";
import { createEngine, engineFromRecord } from "./room-record";
import type { HostConfig, PersistedSeat, RoomRecord } from "./room-record";
import { EventBatchChannel } from "./event-batch";
import {
  assembleDownlinkShot,
  CALIBRATION_BACKED_KINDS,
  CALIBRATION_EVENT_KINDS,
  CALIBRATION_WINDOWS,
  INITIAL_GAME_LOG_CURSOR,
  isPrivateJinnangStepBatch,
  lobbyView,
  projectGameLog,
  publicLogWarningReason,
  seatControlled,
  type GameLogCursor,
} from "./seat-projection";
// wire 协议编解码单源(#429):单机传输面下行装配已收口 seat-projection 的
// assembleDownlinkShot 单口(#431,内用 wire 构造函数);元数据指纹仅复用 wire 序列化。
// 本模块只管排空、校准判定与节流后的发送。
import {
  encodeDownlink,
  requiresPlayerSubmission,
  type PlayerSubmission,
  type PlayerSubmissionResult,
  type ReportCommandProcessing,
} from "../protocol/wire";
import {
  stageEngineChange,
  stagePlayerSubmission,
  submissionPayload,
  type RoomSubmissions,
  type StagedEngineChange,
} from "./player-submissions";
import {
  decisionSeatOf,
  driveBots as driveBotsSession,
  reactionQueriedSeats,
  type DriveBotsHost,
} from "./bot-driver";
import {
  deriveReactionDeadline,
  installReactionDeadline,
  reactionDeadlineFromRecord,
  reactionTimingOf,
  type ReactionDeadline,
} from "./reaction-deadline";
import { createWatchdogs, type WatchdogHost, type Watchdogs } from "./watchdogs";

// ──────────────────────────── 运行时同构原语(#398 单机统一 B)────────────────────────────
// 被替换物与语义对照(行为零变化,只换运行时来源):
//   randomBytes/randomInt ← node:crypto → Web Crypto getRandomValues(bun 与浏览器皆有
//   全局 crypto);token 编码 ← Buffer#toString("base64url") → 本地 base64url 编码器
//   (同字母表,18 字节恒 24 字符无 padding)。引擎构造与快照水合原是另两项本地等价
//   (← engine-helpers.createEngine / room-persistence.engineFromRecord),#427 起收口
//   共享纯模块 room-record.ts,本地复刻删除——「两份逐字同语义」人肉纪律就此退役。
/** CSPRNG 字节串(getRandomValues;调用方:token/房间码)。 */
const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
};
/** 均匀 [0, upperExclusive) 随机整数:拒绝采样无模偏(语义同 node:crypto randomInt)。 */
const randomInt = (upperExclusive: number): number => {
  const limit = Math.floor(0x1_0000_0000 / upperExclusive) * upperExclusive;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % upperExclusive;
  }
};
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** base64url 编码(字母表与 Buffer#toString("base64url") 一致;尾部无 padding)。 */
const toBase64Url = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 == null) break;
    out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 == null) break;
    out += B64URL[b2 & 63];
  }
  return out;
};

// ──────────────────────────── 数据形状 ────────────────────────────
/** 座位状态:无 WebSocket 句柄(WS 归传输层;ADR-0007 关键不变量 1)。 */
export interface SeatState {
  kind: "human" | "bot"; // bot 座位:服务器驱动,人类不可领
  token: string | null; // human 座位:未领=null,领后=不可猜 token(ADR-0005)
  guohao: string | null; // 加入者预设国号(单汉字);null=未指定,开局由引擎分配
}

// ──────────────────────────── 观测事件(可观测性基建)────────────────────────────
// room.ts 不落盘(ADR-0007):关键转移以回调注入观察者,由传输层(server.ts)写 JSONL 流水。
// 目标:联机卡死类问题(如"带 bot 开局卡住")可从流水直接定位停点与原因。
export type RoomBotStopReason =
  | "human-turn" // 轮到人类(在线或冻结)→ 正常等待
  | "not-input-phase" // 引擎内部过渡相位,无需驱动
  | "no-progress" // fingerprint 未变 → 防死循环熔断(异常信号)
  | "game-over"
  | "guard"; // 步数上限熔断(异常信号)

export type RoomEvent =
  | { ev: "start"; mapId: string }
  | { ev: "map"; mapId: string }
  /** 托管开关拨动(ADR-0028 单一开关):by 分辨触发源——self=玩家自助(含收回),
   *  watchdog=看门狗代开(#118 停摆/#380 保留窗,只开不关)。对局日志行同形状。 */
  | { ev: "autopilot"; seat: number; on: boolean; by: "self" | "watchdog" }
  | { ev: "offline"; seat: number; online: number[] }
  | { ev: "auto-roll"; seat: number } // #188:人类座位 Roll 相位超时未摇,服务器代发起摇
  | { ev: "reaction-decline"; seat: number } // #281:被询问座位反应窗超时,服务器代发「不用」
  | { ev: "bot-step"; seat: number; turnPhase: string; active: number }
  | { ev: "bot-stop"; reason: RoomBotStopReason; phase: string; turnPhase: string; active: number };

/** 房间事件观察者(注入;测试与 server.ts 各持一份实现)。 */
export type RoomObserver = (roomId: string, event: RoomEvent) => void;

/** 对局日志增量落盘钩子(ADR-0014,注入):房间保存后或解散时调用,
 *  传输层(server.ts)把 engine.log 新增行追加进 data/logs/<gameId>.jsonl。room.ts 自身零 fs。 */
export type RoomLogSink = (room: RoomSession) => void;

/** 单局房间会话:开局前后都用它(Lobby 态 engine=null)。 */
export interface RoomSession {
  roomId: string;
  seatCount: number;
  seats: SeatState[];
  hostSeat: number; // 当前 host 座位(开局=0;host 掉线则移交,ADR-0002)
  /** 托管座位集(ADR-0028 单一开关):人类座位交 bot 代打的唯一状态域。触发源两道
   *  ——玩家自助(setAutoPilot,可开可关)与看门狗代开(#118 停摆/#380 保留窗到期,
   *  只开不关);重连不清,只有本人收回。出处只进观测行/对局日志(by 字段),行为无分叉。 */
  autoPilot: Set<number>;
  hostConfig: HostConfig;
  /** 本房间所选地图 id(建房时 null;host setMap 后填;startGame 前 must 非 null)。 */
  mapId: string | null;
  engine: GameEngine | null; // null = Lobby
  submissions: RoomSubmissions;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 去掉易混 I/L/O
const CODE_LEN = 4;

// ──────────────────────────── 传输面(#397 单机统一 A)────────────────────────────
// 房间编排经传输抽象收发:对端点的最小要求是「座位归属 + 下行 send + 在线否」三样
// (ADR-0007 不变量保持:WS 句柄与内存双工端点在此同一视图,本模块仍零 WS 依赖)。
// 联机由服务器持有 WS、广播和排空。单机经 connectSeat 挂上 MemorySocket 的
// 宿主端点，编排每次可见变化经 onUpdate →
// transportBroadcast 合并成一拍下行——事件批消息先行(因果在前)、校准摘要随后
// (形状/封装收口 wire.ts #429,单源;消费端为折叠/直译的既有接收面)。
export interface SeatEndpoint {
  /** 座位归属(入座即绑定;token 鉴权在 connectSeat 入口)。 */
  readonly seat: number;
  /** 下行一条消息(原始 JSON 字符串,与 WS wire format 同契约)。 */
  send(data: string): void;
  /** 连接是否完好(断开后不再下发)。 */
  readonly open: boolean;
}

// ──────────────────────────── RoomRegistry:深模块 ────────────────────────────
export interface CreateRoomConfig {
  seatCount: number;
  botIdx: Set<number>;
  hostConfig: HostConfig;
  guohao?: string; // host 预设国号(R3-D1 #99):写入 seat0,语义与 joinSeat 一致(校验/trim/可空)
}

/** Registry 注入项(server.ts 构造时传;ADR-0007:fs 读取归传输层,room.ts 只消费结果)。
 *  decisionTimeoutMs(#118):决策停摆看门狗——引擎停在未被托管的真人座位的决策点超过
 *  该毫秒,看门狗代开该座位托管(ADR-0028;重连不清,本人点「收回」拿回)。0 = 关闭
 *  (缺省关,测试友好);server.ts 默认 120s(env DECISION_TIMEOUT_MS 可调)。
 *  stallAbortMs(#642):驱动链停摆作废看门狗——no-progress 断链且决策座位属服务器驱动
 *  (bot/托管)超过该毫秒,看门狗 abortGame 响亮终局(零无声软锁)。缺省 = 随
 *  decisionTimeoutMs 同窗(联机不传即 120s;这是设计内派生,非兜底);单机显式传
 *  STALL_ABORT_MS(core/timings 单源 30s),不经 decisionTimeoutMs——后者在单机保持
 *  缺省关,#118 human-turn 既有 stall 行为零变化。0 = 显式关闭。
 *  reactionWindowMs(#284):反应窗时长覆盖(env E2E_REACTION_MS,模式照 DECISION_TIMEOUT_MS);
 *  0 = 不覆盖,走 core REACTION_WINDOW_MS 常量表(缺省查表,数值以常量表为准)。
 *  retentionWindowMs(#380):掉线座位保留窗口——对局中断线座位保留该毫秒,窗口内持
 *  token 重连无缝归座,到期看门狗代开托管(ADR-0028;重连不清托管)。0 = 关闭
 *  (缺省关,单机/测试;server.ts 默认 600000=10 分钟,env RETENTION_WINDOW_MS 可调)。
 *  botStepMs(#730,ADR-0061):bot 座位步进配速(ms)——产出端配速,bot 连锁逐拍
 *  下行,与客户端演出队列同量级,普通对局不再积压进追帧/吸附档。0 = 无配速(缺席同,
 *  测试缺省);生产装配层(local.ts/server.ts)显式传 core BOT_STEP_MS,e2e 经各自
 *  通道显式注入(含 0=关)。
 *  clock(#399 Worker 时钟):编排定时原语(看门狗/托管步进)。缺省 = 宿主全局
 *  setTimeout(服务器语义);浏览器进程内单机通路注入 Worker 时钟(后台节流免疫,
 *  见 apps/client/src/net/worker-clock.ts)——「失焦照跑」,单机与联机同构的最后一环。 */
export interface RoomRegistryOptions {
  decisionTimeoutMs?: number;
  stallAbortMs?: number;
  reactionWindowMs?: number;
  retentionWindowMs?: number;
  botStepMs?: number;
  clock?: RoomClock;
}

/** 定时原语(与全局 setTimeout/clearTimeout 同构;句柄类型不透明)。
 *  #399:注入点——编排内一切「等待」都经它,运行时差异(服务器全局定时器 /
 *  浏览器 Worker 时钟)归注入方。 */
export interface RoomClock {
  /** 权威绝对时间（毫秒）。恢复同一份存档时沿用同一时基，缺省用 Date.now。 */
  now?(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 缺省时钟 = 宿主全局定时器(bun/服务器;浏览器主线程——被注入 Worker 时钟的
 *  单机通路不经过它)。 */
const globalClock: RoomClock = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomSession>();
  private readonly diagnosticLogCursors = new WeakMap<RoomSession, GameLogCursor>();
  private readonly persistence: RoomPersistence;
  private readonly observer: RoomObserver | null;
  private readonly logSink: RoomLogSink | null;
  private readonly decisionTimeoutMs: number;
  /** #642 驱动链停摆作废窗口(ms;缺省随 decisionTimeoutMs 同窗,见选项注)。 */
  private readonly stallAbortMs: number;
  /** #380 掉线座位保留窗口(ms;0=关,见 RoomRegistryOptions.retentionWindowMs)。 */
  private readonly retentionWindowMs: number;
  /** #284 反应窗时长覆盖(0=不覆盖,走 core 常量表):E2E_REACTION_MS 注入通道。 */
  private readonly reactionWindowMsOverride: number;
  /** #730 bot 座位步进配速(ms;0=无配速,测试缺省):E2E_BOT_STEP_MS/生产常量注入通道。 */
  private readonly botStepMs: number;
  /** #399 编排定时原语(看门狗/托管步进;缺省全局,浏览器注入 Worker 时钟)。 */
  private readonly clock: RoomClock;
  private readonly now: () => number;
  /** 四组看门狗(#118 停摆/#188 自动起摇/#281 反应窗/#380 掉线保留窗):通用工厂实例,
   *  见 ./watchdogs。driveBots 每次进出重评估(链首 clear,链尾按停点重武装)。 */
  private readonly watchdogs: Watchdogs;
  /** 驱动/看门狗共用的宿主操作面:闭包桥接 registry 私有方法(observe/persist/
   *  applyCommand/…),拆分后 bot-driver/watchdogs 不反向 import 本模块。 */
  private readonly ops: DriveBotsHost;

  // ── 传输面状态(#397):roomId → 座位 → 端点,及下行合并的批通道 ──
  private readonly seatEndpoints = new Map<string, Map<number, SeatEndpoint>>();
  private readonly seatDecisions = new WeakMap<SeatEndpoint, string | null>();
  /** 事件批累积/去重/排空/合并拍归共享通道(#411,event-batch.ts)——
   *  与 server.ts 联机通路同一份批语义,双端行为零变化。 */
  private readonly batches = new EventBatchChannel();
  /** 上次下行的结算相位,用于检测共享校准窗退出沿。 */
  private readonly settledTurnPhase = new Map<string, TurnPhase | null>();
  /** 非校准拍按房间字段差异发送 lobby 元数据,与服务器同口径。 */
  private readonly lastRoomMeta = new Map<string, string>();

  constructor(
    persistence: RoomPersistence,
    observer?: RoomObserver,
    logSink?: RoomLogSink,
    options?: RoomRegistryOptions,
  ) {
    this.persistence = persistence;
    this.observer = observer ?? null;
    this.logSink = logSink ?? null;
    this.decisionTimeoutMs = options?.decisionTimeoutMs ?? 0;
    this.stallAbortMs = options?.stallAbortMs ?? options?.decisionTimeoutMs ?? 0;
    this.retentionWindowMs = options?.retentionWindowMs ?? 0;
    this.reactionWindowMsOverride = options?.reactionWindowMs ?? 0;
    this.botStepMs = options?.botStepMs ?? 0;
    this.clock = options?.clock ?? globalClock;
    this.now = this.clock.now?.bind(this.clock) ?? (() => Date.now());
    this.watchdogs = createWatchdogs(this.watchdogHost());
    this.ops = {
      observe: (r, ev) => this.observe(r, ev),
      persist: (r) => this.persist(r, true),
      applyCommand: (roomId, cmd, onUpdate) => this.applyCommand(roomId, cmd, onUpdate),
      abortGame: (r, reason, onUpdate) => this.abortGame(r.roomId, reason, onUpdate),
      decisionTimeoutMs: this.decisionTimeoutMs,
      stallAbortMs: this.stallAbortMs,
      botStepMs: this.botStepMs,
      watchdogs: this.watchdogs,
      clock: this.clock,
    };
  }

  /** WatchdogHost 视角(构造期一次性;driveBots 闭包指向本.driveBots 接线方法)。 */
  private watchdogHost(): WatchdogHost {
    return {
      isCurrentRoom: (r) => this.rooms.get(r.roomId) === r,
      observe: (r, ev) => this.observe(r, ev),
      logRoom: (r, brief, detail) => this.logRoom(r, brief, detail),
      persist: (r) => this.persist(r),
      applyCommand: (roomId, cmd, onUpdate) => this.applyCommand(roomId, cmd, onUpdate),
      driveBots: (r, onUpdate) => this.driveBots(r, onUpdate),
      abortGame: (r, reason, onUpdate) => this.abortGame(r.roomId, reason, onUpdate),
      decisionTimeoutMs: this.decisionTimeoutMs,
      stallAbortMs: this.stallAbortMs,
      retentionWindowMs: this.retentionWindowMs,
      clock: this.clock,
    };
  }

  /** 发一条观测事件(无观察者时为空操作)。 */
  private observe(r: RoomSession, event: RoomEvent): void {
    this.observer?.(r.roomId, event);
  }

  /** 房间生命周期行随房间保存和归档。开局前无对局日志。 */
  private logRoom(r: RoomSession, brief: string, detail: string): void {
    if (!r.engine) return;
    r.engine.logRoomEvent(brief, detail);
  }

  /** 对局日志归档单独报告故障，已保存的裁决仍须下行并继续驱动。 */
  private writeGameLog(r: RoomSession): void {
    try {
      this.logSink?.(r);
    } catch (error) {
      console.error(`[room] 房间 ${r.roomId} 的对局日志归档失败`, error);
    }
  }

  /** 房间码冲突检测:查内存 + persistence.exists(后者由适配器实现,默认查 fs)。 */
  private existsRoom(id: string): boolean {
    return this.rooms.has(id) || this.persistence.exists(id);
  }

  // ──────────────────────────── 启动恢复 ────────────────────────────
  /** 从 persistence 把所有房间载入内存(启动时调一次)。
   *  mapProvider:按 mapId 恢复对应地图的引擎(服务器注入;room.ts 不读 fs)。
   *  onRestored:每恢复一房先登记对局日志和已交付事件的基线，再恢复反应窗。
   *  onUpdate:恢复的看门狗或托管代打推进时通知传输层。 */
  restoreAll(
    mapProvider?: (mapId: string) => LoadedMap,
    onRestored?: (room: RoomSession) => void,
    onUpdate?: (room: RoomSession) => void,
  ): number {
    let count = 0;
    for (const id of this.persistence.listIds()) {
      const rec = this.persistence.load(id);
      if (!rec) continue;
      // 旧版本快照(字段集已过时)不可恢复 → 跳过该房间,与持久化层「损坏文件跳过」同口径:
      // 启动 resilience 归这里,不靠快照 write 兜底(零兜底红线)
      let room: RoomSession;
      try {
        room = this.hydrate(rec, mapProvider);
      } catch (err) {
        console.warn(`[room] 跳过不可恢复的房间 ${id}:`, err instanceof Error ? err.message : err);
        this.persistence.remove(id);
        continue;
      }
      this.rooms.set(rec.roomId, room);
      onRestored?.(room);
      if (room.engine?.phase === "Playing" && room.engine.turnPhase === "Roll") {
        // 已提交的出牌阶段可以在自动起摇前保存，恢复时重挂同一房间节拍。
        this.clock.setTimeout(() => {
          if (this.rooms.get(id) === room && room.engine?.turnPhase === "Roll")
            void this.driveBots(room, onUpdate);
        }, 0);
      } else {
        this.resumeReaction(room, onUpdate);
      }
      count++;
    }
    return count;
  }

  /** 内部:RoomRecord → RoomSession(零 WS 句柄;引擎重建走共享纯模块 engineFromRecord,#427 单源)。 */
  private hydrate(rec: RoomRecord, mapProvider?: (mapId: string) => LoadedMap): RoomSession {
    const deadline = reactionDeadlineFromRecord(rec);
    if (
      !Number.isSafeInteger(rec.submissions.decisionRevision) ||
      !Array.isArray(rec.submissions.entries)
    )
      throw new Error(`房间 ${rec.roomId} 的玩家提交记录损坏`);
    const room: RoomSession = {
      roomId: rec.roomId,
      seatCount: rec.seatCount,
      seats: rec.seats.map((s) => ({ kind: s.kind, token: s.token, guohao: s.guohao ?? null })),
      hostSeat: rec.hostSeat,
      autoPilot: new Set(rec.autoPilot),
      hostConfig: rec.hostConfig,
      mapId: rec.mapId ?? null,
      engine: engineFromRecord(rec, mapProvider, this.reactionWindowMsOverride),
      submissions: rec.submissions,
    };
    this.adoptReactionDeadline(room, deadline);
    return room;
  }

  private resumeReaction(room: RoomSession, onUpdate?: (room: RoomSession) => void): void {
    const e = room.engine;
    if (e?.turnPhase !== "AwaitingReaction") return;
    const pending = e.pendingReaction!;
    this.watchdogs.syncReaction(room, onUpdate);
    if (
      reactionTimingOf(room).remainingMs > 0 &&
      reactionQueriedSeats(pending.view).some(
        (seat) => seatControlled(room, seat) && !pending.answers.some((a) => a.seat === seat),
      )
    ) {
      // 托管切换可能已保存、尚未代答。恢复后沿用原策略，驱动链再次核对期限。
      this.clock.setTimeout(() => {
        if (
          this.rooms.get(room.roomId) === room &&
          e.turnPhase === "AwaitingReaction" &&
          e.pendingReaction?.seq === pending.seq
        )
          void this.driveBots(room, onUpdate);
      }, 0);
    }
  }

  get(roomId: string): RoomSession | undefined {
    return this.rooms.get(roomId);
  }

  size(): number {
    return this.rooms.size;
  }

  // ──────────────────────────── 房间码 / token ────────────────────────────
  private newToken(): string {
    return toBase64Url(randomBytes(18));
  }

  private newRoomId(): string {
    for (let i = 0; i < 100; i++) {
      let s = "";
      for (let j = 0; j < CODE_LEN; j++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.existsRoom(s)) return s;
    }
    throw new RoomError(500, "房间码生成失败(冲突过多)");
  }

  // ──────────────────────────── 房间生命周期 ────────────────────────────
  /** 建房:Seat0=host(human,已领 token);其它座位按 botIdx 标记。返回 {room,seat,token}。
   *  R3-D1(#99):guohao=host 预设国号,写入 seat0;校验/trim 与 joinSeat 逐字同语义,
   *  重名前缀不在此时处理——开局 startGame 统一走 resolveGuohaoClash 演算。 */
  createRoom(config: CreateRoomConfig): { room: RoomSession; seat: number; token: string } {
    const { seatCount, botIdx, hostConfig, guohao } = config;
    if (!Number.isInteger(seatCount) || seatCount < MIN_SEAT_COUNT || seatCount > MAX_SEAT_COUNT)
      throw new RoomError(400, `seats 必须为 ${MIN_SEAT_COUNT}–${MAX_SEAT_COUNT} 的整数`);
    if (botIdx.has(0)) throw new RoomError(400, "host(Seat 0)必须是真人");
    if (guohao != null && !isSingleCjk(guohao.trim())) throw new RoomError(400, "国号需为单个汉字");
    const roomId = this.newRoomId();
    const seats: SeatState[] = Array.from({ length: seatCount }, (_, i) => ({
      kind: botIdx.has(i) ? "bot" : "human",
      token: null,
      guohao: null,
    }));
    const token = this.newToken();
    seats[0].token = token;
    seats[0].guohao = guohao != null ? guohao.trim() : null;
    const room: RoomSession = {
      roomId,
      seatCount,
      seats,
      hostSeat: 0,
      autoPilot: new Set(),
      hostConfig,
      mapId: null,
      engine: null,
      submissions: { decisionRevision: 0, entries: [] },
    };
    this.rooms.set(roomId, room);
    this.persist(room);
    return { room, seat: 0, token };
  }

  /** 凭 roomId 加入第一个空 human 座位(FCFS)。guohao=加入者预设国号(单汉字,可空)。
   *  重名不在加入时处理:开局(startGame)统一做前缀分配,快照里的国号即最终国号。 */
  joinSeat(roomId: string, guohao?: string): { room: RoomSession; seat: number; token: string } {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始,不可加入");
    if (guohao != null && !isSingleCjk(guohao.trim())) throw new RoomError(400, "国号需为单个汉字");
    const idx = room.seats.findIndex((s) => s.kind === "human" && s.token == null);
    if (idx < 0) throw new RoomError(409, "房间已满(无空座位)");
    const token = this.newToken();
    room.seats[idx].token = token;
    room.seats[idx].guohao = guohao != null ? guohao.trim() : null;
    this.persist(room);
    return { room, seat: idx, token };
  }

  /** host 选图:校验 caller 是 host、对局未开始、mapId 在清单内。
   *  validMapIds:服务器从清单读出的合法 id 集合(注入,room.ts 不读 fs;ADR-0007)。
   *  开局后调用 → 409(地图已锁定)。 */
  setMap(
    roomId: string,
    mapId: string,
    callerSeatToken: string,
    validMapIds: Set<string>,
  ): RoomSession {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始,不可改图");
    if (callerSeatToken !== room.seats[room.hostSeat].token)
      throw new RoomError(403, "仅 host 可选图");
    if (typeof mapId !== "string" || !validMapIds.has(mapId)) throw new RoomError(400, "未知地图");
    room.mapId = mapId;
    this.observe(room, { ev: "map", mapId });
    this.persist(room);
    return room;
  }

  /** host 开局:构造引擎，补齐国号并排定选都顺序后进入 Setup·PickCapital。真人经 WS
   *  真人通过玩家提交落子，bot/托管座位由 driveBots 代选。首帧 onUpdate 含首位的候选。
   *  onUpdate:开局首帧 + 每个 bot 步后调(逐步直播,保留原 server.ts 行为)。
   *  mapProvider:按 mapId 返回 LoadedMap(服务器加载内置地图后注入;ADR-0007:
   *  room.ts 不读 fs)。startGame 前必须 setMap,否则 400"请先选择地图"。
   *  异步:driveBots 可能含托管步进。 */
  async startGame(
    roomId: string,
    hostToken: string,
    onUpdate?: (room: RoomSession) => void,
    mapProvider?: (mapId: string) => LoadedMap,
  ): Promise<RoomSession> {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可开局");
    if (room.mapId == null) throw new RoomError(400, "请先选择地图");
    if (!mapProvider) throw new RoomError(500, "服务器未提供地图加载器");
    const map = mapProvider(room.mapId);
    // 国号:预设者先到先得保留原名,重名者依次取方位前缀(宁→东宁/…);未预设/bot 由引擎分配
    const finalGuohao = resolveGuohaoClash(room.seats.map((s) => s.guohao));
    const seatsCfg: SeatConfig[] = room.seats.map((s, i) => ({
      name: `座 ${i + 1}`,
      isBot: s.kind === "bot" || s.token == null, // 未领的人类座位自动 bot 填充
      guohao: finalGuohao[i] ?? undefined,
    }));
    const engine = createEngine(
      {
        seats: seatsCfg,
        seed: room.hostConfig.seed,
        // 房主未定制 target 时按地图顶层解析(与 room-record 恢复路径同语义);
        // 起手现金产品面无旋钮,恒随地图顶层(ADR-0041 引擎无缺省)
        targetNetWorth: room.hostConfig.target ?? map.targetNetWorth,
        startingCash: map.startingCash,
        // 起手珍宝(件/人)同上,恒随地图顶层(#1100)。
        startingTreasures: map.startingTreasures,
        mapId: room.mapId!,
        // 反应窗时长接线(#284):registry env 覆盖注入引擎,开窗写入 view.windowMs
        // 随快照下发——客户端横幅投影与权威侧定时器同读一份,两端同长自动成立。
        reactionWindowMs:
          this.reactionWindowMsOverride > 0 ? this.reactionWindowMsOverride : undefined,
      },
      true,
      map,
    );
    room.engine = engine;
    this.observe(room, { ev: "start", mapId: room.mapId! });
    // 开局房间行(ADR-0014):座位构成随开局写入对局日志(大厅期的加入以此汇总呈现)
    this.logRoom(
      room,
      `房间开局:${room.seatCount} 座(${room.seats.filter((s) => s.kind === "bot").length} bot),地图 ${room.mapId}`,
      JSON.stringify({
        type: "start",
        mapId: room.mapId,
        seats: room.seats.map((s, i) => ({ seat: i, kind: s.kind, guohao: s.guohao })),
      }),
    );
    this.persist(room);
    onUpdate?.(room); // 开局首帧(Setup 态:offeredCapitals=首位选都者的候选)
    await this.driveBots(room, onUpdate); // bot/托管座位先驱动(全 bot 驱动房自动进 Playing)
    return room;
  }

  /** 玩家自助托管(spec: autopilot,ADR-0028 单一开关):把自己的座位交给 bot 代打
   *  (on)或收回(off)。代打行为=bot 同款(#580 行为单源,无速度分档)。
   *  重连(attachSeat)不清除——托管持久到本人经此方法收回(一键收回,ADR-0028)。
   *  收回后在途连锁做完到下一个决策点自然停(driveBots 每步重查 seatControlled,
   *  步间让出宏任务 → 切回即停)。
   *  对局中才可托管(未开局 409);切换后 onUpdate 广播,若轮到该座位立即驱动。
   *  fire-and-forget(#529 死锁教训):只调度驱动链第一拍即返回,不 await 整条链——
   *  托管链 2s/步自续,await 它 = 本命令挂满整条链(生产)/ 与 ManualClock 泵法互等
   *  死锁(测试);后续步经注入时钟自续,重入守卫保证不双开。 */
  async setAutoPilot(
    roomId: string,
    seat: number,
    on: boolean,
    onUpdate?: (room: RoomSession) => void,
    report?: ReportCommandProcessing,
  ): Promise<RoomSession> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) throw new RoomError(409, "对局未开始,不可托管");
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length)
      throw new RoomError(400, "seat 非法");
    if (room.seats[seat].kind === "bot") throw new RoomError(400, "bot 座位无需托管");
    if (on) room.autoPilot.add(seat);
    else room.autoPilot.delete(seat);
    this.observe(room, { ev: "autopilot", seat, on, by: "self" });
    // 托管开关房间行(ADR-0014):机读 detail 供重放调整 bot 驱动座位集(by 分辨触发源)
    const seatGuohao = room.engine.players[seat].guohao;
    const logOffset = room.engine.log.length;
    this.logRoom(
      room,
      on ? `${seatGuohao} 开启托管,交由电脑代打` : `${seatGuohao} 关闭托管,收回操作`,
      JSON.stringify({ type: "autopilot", seat, on, by: "self" }),
    );
    this.persist(room);
    onUpdate?.(room); // 先广播托管状态
    report?.({ outcome: "accepted", logOffset: this.publicLogOffset(room, logOffset) });
    void this.driveBots(room, onUpdate); // 只调度第一拍,链经注入时钟自续(#529,见方法注)
    return room;
  }

  /** host 解散房间:从内存和 persistence 删除。返回被删的 roomId。
   *  WS 句柄关闭由传输层负责(broadcast dismissed 后断开连接)。 */
  dismissRoom(roomId: string, hostToken: string): string {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可解散");
    const id = room.roomId;
    this.persistence.remove(id);
    // 房间删除后直接归档最后一行，并清理运行态。
    if (room.engine) {
      this.logRoom(room, `房主解散房间(${room.roomId})`, JSON.stringify({ type: "dismiss" }));
      this.writeGameLog(room);
    }
    // #118/#188/#281/#380:撤四组看门狗计时器(到点动作自身有房间存在重校验,此为即时清理)
    this.watchdogs.stall.clear(id);
    this.watchdogs.autoRoll.clear(id);
    this.watchdogs.reactionWait.clear(id);
    this.watchdogs.retention.clear(id);
    // 传输面残表一并清(#397):端点/在途累积批/已排定的 flush 定时器随房同撤
    // (#411:批三表与定时器清理归共享通道 dispose)
    this.batches.dispose(id);
    this.settledTurnPhase.delete(id);
    this.lastRoomMeta.delete(id);
    this.seatEndpoints.delete(id);
    this.rooms.delete(id);
    return id;
  }

  // ──────────────────────────── 命令 + 掉线 ────────────────────────────
  /** 应用一条人类命令并驱动 bot/托管座位的连锁。
   *  onUpdate:每次可见状态变化后调(初始命令结果后 + 每个 botAct 步后),传输层在回调里 broadcast。
   *  这保留了原 server.ts 的逐步直播 UX(network-client 的渐进 snapshot 反馈)。
   *  异步:连锁可能含托管步进(在途时本调用被重入守卫跳过,由既有链接管)。
   *  本方法供 bot 和看门狗在房间内部代发。玩家输入由座位连接交给房间校验。 */
  async applyCommand(
    roomId: string,
    cmd: GameCommand,
    onUpdate?: (room: RoomSession) => void,
    report?: ReportCommandProcessing,
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) {
      report?.({ outcome: "unprocessed", reason: room ? "对局未开始" : "房间不存在" });
      return;
    }
    const { engine } = room;
    const logOffset = engine.log.length;
    // 应答可关闭原窗并打开下一窗，必须在保存成功后才替换原局面与截止时刻。
    const change =
      cmd.type === "respondReaction"
        ? stageEngineChange(engine, (draft) => draft.submitCommand(cmd))
        : undefined;
    const rejection = change === undefined ? engine.submitCommand(cmd) : change.result;
    const log = change === undefined ? engine.log : change.snapshot.log;
    // 只定位本次同步权威处理写出的警告。日志原文可能含牌面。
    const warning = log.slice(logOffset).findIndex(isLogWarning);
    this.persist(room, rejection === undefined && warning === -1, change);
    if (rejection !== undefined) throw new RoomError(400, rejection);
    this.watchdogs.syncReaction(room, onUpdate);
    onUpdate?.(room); // 人类命令结果先推
    if (report) {
      if (warning === -1) {
        report({
          outcome: "accepted",
          ...this.publicLogAnchor(room, log, logOffset),
        });
      } else {
        const warningOffset = logOffset + warning;
        report({
          outcome: "warning",
          logOffset: this.publicLogOffset(room, warningOffset),
          reason: publicLogWarningReason(log[warningOffset]),
        });
      }
    }
    await this.driveBots(room, onUpdate); // bot/托管座位的连锁,逐步 persist+onUpdate
  }

  /** 座位提交：查原结果先于决策点时效。校验、裁决和原子保存之间不让出执行权。 */
  async submitFromSeat(
    roomId: string,
    seat: number,
    submission: PlayerSubmission,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<PlayerSubmissionResult> {
    const room = this.rooms.get(roomId);
    if (
      !room ||
      roomId !== submission.roomId ||
      seat !== submission.seat ||
      !room.seats[seat]?.token
    )
      return { outcome: "rejected", reasonCode: "wrongSeat", reason: "提交与入座房间或座位不符" };
    const payload = submissionPayload(submission);
    const old = room.submissions.entries.find(
      (entry) => entry.seat === seat && entry.submissionId === submission.submissionId,
    );
    if (old)
      return old.payload === payload
        ? { ...old.result }
        : {
            outcome: "rejected",
            reasonCode: "submissionIdConflict",
            reason: "这个提交编号已用于其他内容",
          };

    const staged = stagePlayerSubmission(room, submission);
    const { change } = staged;
    const result =
      change === undefined
        ? staged.result
        : {
            ...staged.result,
            ...this.publicLogAnchor(room, change.snapshot.log, room.engine!.log.length),
          };
    const submissions = {
      decisionRevision: room.submissions.decisionRevision + (result.outcome === "accepted" ? 1 : 0),
      entries: [
        ...room.submissions.entries,
        { seat, submissionId: submission.submissionId, payload, result },
      ],
    };
    this.commit(room, submissions, change);
    if (change !== undefined) {
      this.writeGameLog(room);
      this.watchdogs.syncReaction(room, onUpdate);
      onUpdate?.(room);
      void this.driveBots(room, onUpdate);
    }
    return { ...result };
  }

  /** 尚未迁移的玩家命令只放行决策归属座位。已迁移的操作须走 submitFromSeat。 */
  async applyCommandFromSeat(
    roomId: string,
    seat: number,
    cmd: GameCommand,
    onUpdate?: (room: RoomSession) => void,
    report?: ReportCommandProcessing,
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) {
      report?.({ outcome: "unprocessed", reason: room ? "对局未开始" : "房间不存在" });
      return;
    }
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length)
      throw new RoomError(400, "seat 非法"); // 旁观/越界座位不可提交任何游戏命令
    if (cmd.type === "rollAndMove") throw new RoomError(403, "行军由房间自动起摇");
    const e = room.engine;
    if (requiresPlayerSubmission(cmd, e.pendingJinnang?.cardId ?? null))
      throw new RoomError(403, "请携带原决策点和提交编号提交此操作");
    const owner = decisionSeatOf(e);
    if (seat !== owner) throw new RoomError(403, `未轮到该座位决策(归属:座位 ${owner})`);
    await this.applyCommand(roomId, cmd, onUpdate, report);
  }

  // ──────────────────────────── 响亮终局(#642)────────────────────────────
  /** 房间编排侧作废入口(三出口共用):引擎 abortGame(幂等,域本体 game-events.abortGame)
   *  + persist(终局行随 logSink 落盘 ADR-0014)+ 常规下行广播(事件批 gameOver
   *  reason="aborted" 与整房摘要照走 per-seat 投影)。调用方=驱动链 catch(出口①)/
   *  stallAbort 看门狗(出口②)/ 单机 LocalController 时钟 fatal(出口③)。
   *  房间/引擎不存在 = 调用方 bug,显式抛错(零兜底)。 */
  abortGame(roomId: string, reason: string, onUpdate?: (room: RoomSession) => void): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) throw new RoomError(409, "房间不存在或对局未开始,不可作废");
    const change =
      room.engine.turnPhase === "AwaitingReaction"
        ? stageEngineChange(room.engine, (draft) => draft.abortGame(reason))
        : undefined;
    if (change === undefined) room.engine.abortGame(reason);
    this.persist(room, false, change);
    onUpdate?.(room);
  }

  /** WS close 时调用:host 掉线 → transferHost;之后 driveBots(托管座位的连锁)。
   *  seat:刚断开的座位(传输层应已从 stillOnlineSeats 中移除,此处仅作文档/防御)。
   *  stillOnlineSeats:传输层算好后传入(只有传输层知道谁还连着 WS)。
   *  onUpdate:每次可见状态变化后调。异步(连锁可能含托管步进)。
   *  #380:对局中断线 → 座位保留窗武装(retentionWindowMs>0 时):窗口内持 token 重连
   *  无缝归座(attachSeat 撤表),到期看门狗代开托管(ADR-0028);大厅/已终局/已服务
   *  器驱动的座位由看门狗 window 判定不武装。 */
  async markSeatOffline(
    roomId: string,
    seat: number,
    stillOnlineSeats: Set<number>,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.observe(room, { ev: "offline", seat, online: [...stillOnlineSeats] });
    // 离线房间行(ADR-0014)
    if (room.engine) {
      this.logRoom(
        room,
        `座位 ${seat}(${room.engine.players[seat].guohao}) 离线`,
        JSON.stringify({ type: "offline", seat }),
      );
    }
    this.transferHostIfNeeded(room, stillOnlineSeats);
    this.persist(room);
    // #380:座位保留窗武装(窗口判定与豁免归 watchdogs.retention 的 window)
    if (room.engine) this.watchdogs.retention.arm(room, seat, onUpdate);
    onUpdate?.(room); // 先推"该座离线 + 可能的 host 移交"
    await this.driveBots(room, onUpdate); // 托管中的座位若轮到,继续;冻结的人类座位不驱动(等重连/托管代开)
  }

  // ──────────────────────────── 鉴权 ────────────────────────────
  /** 校验 seat+token 是否匹配某房间(WS upgrade 用)。返回 true/false。 */
  validateSeat(roomId: string, seat: number, token: string | null): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) return false;
    if (!token || token !== room.seats[seat].token) return false;
    return true;
  }

  /** WS 连接建立时调用(ADR-0002/0005):token 是 Seat 归属唯一凭证 → 连上即归座。
   *  传输层随后发整房摘要给该 WS。托管开关不动(ADR-0028:重连不清托管,回来的人
   *  点「收回」拿回控制)。
   *  #380:重连即撤本座位保留窗(到期不误托管已归来的在线座位)。 */
  attachSeat(
    roomId: string,
    seat: number,
    onUpdate?: (room: RoomSession) => void,
  ): RoomSession | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    this.watchdogs.retention.disarm(roomId, seat);
    this.watchdogs.syncReaction(room, onUpdate);
    return room;
  }

  // ──────────────────────────── 传输面端点(#397 单机统一 A)────────────────────────────
  /** 内存端点入座(单机通路):鉴权同 WS upgrade(validateSeat)→ attachSeat 语义
   *  (持 token 重连归座;托管开关不动,ADR-0028)→ 立即经装配单口下发首连整房摘要
   *  (与 server.ts open 处理器共用逐座位装配)。
   *  此后编排每次可见变化都会经 transportBroadcast 合并下行到本端点。 */
  connectSeat(roomId: string, seat: number, token: string, ep: SeatEndpoint): RoomSession {
    if (!this.validateSeat(roomId, seat, token)) throw new RoomError(401, "座位鉴权失败");
    const room = this.attachSeat(roomId, seat, () => this.transportBroadcast(roomId));
    if (!room) throw new RoomError(404, "房间不存在");
    // 重连只接当前摘要。待交付的旧拍先给原连接，无端点时累积的拍由摘要覆盖。
    if (this.batches.cancelScheduled(roomId)) this.flushTransport(roomId);
    else this.batches.drain(roomId);
    if (room.engine) this.batches.seedSeen(roomId, room.engine.gameEvents);
    let eps = this.seatEndpoints.get(roomId);
    if (!eps) {
      eps = new Map();
      this.seatEndpoints.set(roomId, eps);
    }
    eps.set(seat, ep);
    const shot = assembleDownlinkShot(room, this.transportOnlineSeats(roomId), seat, [], true);
    this.seatDecisions.set(ep, shot.decisionPoint);
    ep.send(shot.snapshot);
    this.settledTurnPhase.set(roomId, room.engine?.turnPhase ?? null);
    this.lastRoomMeta.set(
      roomId,
      encodeDownlink(lobbyView(room, this.transportOnlineSeats(roomId))),
    );
    return room;
  }

  /** 内存端点离座(单机销毁路径):仅摘端点,房间状态不动(解散走 dismissRoom,
   *  它会一并清传输面残表)。 */
  disconnectSeat(roomId: string, seat: number): void {
    const eps = this.seatEndpoints.get(roomId);
    if (!eps) return;
    eps.delete(seat);
    if (eps.size === 0) this.seatEndpoints.delete(roomId);
  }

  /** 端点在线座位集(ADR-0007 不变量 2 的内存端点版:在线状态归传输面)。 */
  private transportOnlineSeats(roomId: string): Set<number> {
    return new Set(this.seatEndpoints.get(roomId)?.keys() ?? []);
  }

  /** 传输面广播(单机通路;由宿主以 onUpdate 回调喂入):引擎当前批以「数组引用换新」
   *  为界累积(#411 起批语义归共享通道 event-batch.ts,与 server.ts 同一份代码:
   *  引用不变 = 同一转移的重复通知,不重收),本 tick 内合并,setTimeout(0) 统一 flush。
   *  无端点的房间(联机自持通路)只累积不排定时器,行为即无操作。 */
  transportBroadcast(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.batches.accumulate(roomId, room.engine?.gameEvents);
    if (this.seatEndpoints.get(roomId) == null) return;
    this.batches.schedule(roomId, () => this.flushTransport(roomId));
  }

  /** 自动下行复用 server.ts 的校准窗/节点/闭沿口径;事件先发、校准摘要随后。
   *  共享触发登记由 seat-projection 的 CALIBRATION_* 提供。
   *  异常终局通过 forceSnapshot 立即发完整状态。 */
  private flushTransport(roomId: string, forceSnapshot = false): void {
    const room = this.rooms.get(roomId);
    const eps = this.seatEndpoints.get(roomId);
    if (!room || !eps || eps.size === 0) {
      this.batches.drain(roomId);
      return;
    }
    const events = this.batches.drain(roomId);
    const e = room.engine;
    const settled = e?.turnPhase ?? null;
    const prev = this.settledTurnPhase.get(roomId) ?? null;
    this.settledTurnPhase.set(roomId, settled);
    const batch = events ?? [];
    const closeEdgeBatch =
      batch.length === 0 || batch.some((event) => CALIBRATION_BACKED_KINDS.has(event.kind));
    const calibrate =
      e != null &&
      (e.phase === "Setup" ||
        batch.some((event) => CALIBRATION_EVENT_KINDS.has(event.kind)) ||
        (settled != null &&
          CALIBRATION_WINDOWS.has(settled) &&
          !isPrivateJinnangStepBatch(prev, settled, batch)) ||
        (prev != null && CALIBRATION_WINDOWS.has(prev) && closeEdgeBatch));
    const withSnapshot = forceSnapshot || calibrate;
    const online = this.transportOnlineSeats(roomId);
    const metaJson = encodeDownlink(lobbyView(room, online));
    const metaChanged = this.lastRoomMeta.get(roomId) !== metaJson;
    for (const [seat, ep] of eps) {
      if (!ep.open) continue;
      const shot = withSnapshot
        ? assembleDownlinkShot(room, online, seat, batch, true)
        : assembleDownlinkShot(room, online, seat, batch, false, this.seatDecisions.get(ep));
      if (shot.events !== null || shot.snapshot !== null)
        this.seatDecisions.set(ep, shot.decisionPoint);
      if (shot.events !== null) ep.send(shot.events);
      if (shot.snapshot !== null) ep.send(shot.snapshot);
      else if (metaChanged) ep.send(metaJson);
    }
    this.lastRoomMeta.set(roomId, metaJson);
  }

  /** 时钟挂死的异常终局立即下行,不等待已失效的驱动节拍。 */
  flushTransportNow(roomId: string): void {
    this.batches.cancelScheduled(roomId);
    this.batches.accumulate(roomId, this.rooms.get(roomId)?.engine?.gameEvents);
    this.flushTransport(roomId, true);
  }

  // ──────────────────────────── host 移交(ADR-0002)────────────────────────────
  /** host 离线 → 身份移交在场最久(最低索引)的在线真人;无在线真人则保持(等重连)。
   *  online 状态由传输层传入(ADR-0007 关键不变量 2)。 */
  private transferHostIfNeeded(r: RoomSession, onlineSeats: Set<number>): void {
    if (onlineSeats.has(r.hostSeat)) {
      const cur = r.seats[r.hostSeat];
      if (cur && cur.kind === "human") return; // host 仍在线且是人类 → 不动
    }
    for (let i = 0; i < r.seats.length; i++) {
      if (r.seats[i].kind === "human" && onlineSeats.has(i)) {
        r.hostSeat = i;
        return;
      }
    }
  }

  // ──────────────────── bot 驱动 + 看门狗(拆 bot-driver.ts / watchdogs.ts)────────────────────
  /** 驱动实现已拆 bot-driver.ts(模块治理 10/11 #327,纯搬):本方法只做宿主接线,
   *  registry 内各生命周期入口照旧 this.driveBots 调用;看门狗的 arm/clear 由驱动实现
   *  经 ops.watchdogs 调度,房间解散清理由 dismissRoom 直调。 */
  private driveBots(r: RoomSession, onUpdate?: (room: RoomSession) => void): Promise<void> {
    return driveBotsSession(this.ops, r, onUpdate);
  }

  /** 回执引用公开日志行号。按尚未计数的新增行推进。 */
  private publicLogOffset(r: RoomSession, rawOffset: number): number {
    const prev = this.diagnosticLogCursors.get(r) ?? INITIAL_GAME_LOG_CURSOR;
    const publicOffset =
      prev.publicOffset + projectGameLog(r.engine!.log, prev.rawOffset, rawOffset).length;
    this.diagnosticLogCursors.set(r, { rawOffset, publicOffset });
    return publicOffset;
  }

  private publicLogAnchor(r: RoomSession, log: GameEngine["log"], rawOffset: number) {
    return projectGameLog(log, rawOffset).length === 0
      ? {}
      : { logOffset: this.publicLogOffset(r, rawOffset) };
  }

  // ──────────────────────────── 持久化投影 ────────────────────────────
  private adoptReactionDeadline(room: RoomSession, deadline: ReactionDeadline | null): void {
    if (installReactionDeadline(room, deadline, this.now))
      this.watchdogs.reactionWait.clear(room.roomId);
  }

  private commit(r: RoomSession, submissions: RoomSubmissions, change?: StagedEngineChange): void {
    const snapshot = change === undefined ? (r.engine?.snapshot() ?? null) : change.snapshot;
    const reactionDeadline = deriveReactionDeadline(r, snapshot, this.now);
    const rec: RoomRecord = {
      roomId: r.roomId,
      seatCount: r.seatCount,
      seats: r.seats.map((s): PersistedSeat => ({
        kind: s.kind,
        token: s.token,
        guohao: s.guohao,
      })),
      hostSeat: r.hostSeat,
      autoPilot: [...r.autoPilot],
      hostConfig: r.hostConfig,
      mapId: r.mapId,
      submissions,
      snapshot,
      ...(reactionDeadline === null ? {} : { reactionDeadline }),
    };
    this.persistence.save(rec);
    if (change !== undefined) {
      r.engine!.restoreFromSnapshot(change.snapshot);
      change.commitDicePins?.();
    }
    r.submissions = submissions;
    this.adoptReactionDeadline(r, reactionDeadline);
  }

  private persist(r: RoomSession, decisionAdvanced = false, change?: StagedEngineChange): void {
    const submissions = decisionAdvanced
      ? { ...r.submissions, decisionRevision: r.submissions.decisionRevision + 1 }
      : r.submissions;
    this.commit(r, submissions, change);
    // ADR-0014 对局日志:每手快照后把引擎新增日志行经钩子交传输层落盘(data/logs/<gameId>.jsonl)
    if (r.engine) this.writeGameLog(r);
  }
}

// ──────────────────────────── 错误类型(供传输层映射 HTTP 状态码)────────────────────────────
export class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

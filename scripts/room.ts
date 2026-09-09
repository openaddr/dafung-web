// 房间游戏编排(ADR-0007):房间生命周期 + 座位 + bot 驱动 + host 移交 + 纯视图。
// 标准 ports & adapters 的核心:深模块,**零 WS/HTTP/fs 依赖**(不 import ws / node:http / node:fs)。
// 传输层持 WS 句柄、知道 online 状态;视图/transferHost 都接 `onlineSeats: Set<number>` 作入参。
// 持久化做成注入的 RoomPersistence 适配器。
//
// clientView/lobbyView 自 2026-08-14(架构待办③)起:snapshot 消息补齐 seatCount/started/mapId,
// 与 lobby 消息的房间字段对齐——客户端从任一消息都能直接得到完整房间态,无需手抄推断。
// (个人项目,不考虑旧协议兼容;客户端 network-client.ts 同步改。)
// 设计见 docs/adr/0007-room-module-extraction.md;语义不变量见 ADR-0001/0002/0004/0005。
import { randomBytes, randomInt } from "node:crypto";
import { GameEngine } from "../src/core/game";
import type { GameSnapshot } from "../src/core/snapshot";
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty, GameCommand } from "../src/core/types";
import { isSingleCjk } from "../src/core/constants";
import type { EncounterConfig } from "../src/core/encounters";
// 国号重名前缀算法(E7/#19)下沉 core:大厅客户端用同一纯函数做重名预告,开局定稿同源
import { resolveGuohaoClash } from "../src/core/guohao";
import type { LoadedMap } from "../src/core/board-loader";
import { botAct } from "../src/core/bot";
import { createEngine, statusOf } from "./engine-helpers";
import {
  type HostConfig,
  type PersistedSeat,
  type RoomPersistence,
  type RoomRecord,
  recordToSessionData,
} from "./room-persistence";

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
  | { ev: "takeover"; seat: number; auto?: true } // auto=true(#118):决策停摆看门狗代接管,非房主手动
  | { ev: "autopilot"; seat: number; on: boolean; speed: AutoPilotSpeed }
  | { ev: "offline"; seat: number; online: number[] }
  | { ev: "bot-step"; seat: number; turnPhase: string; active: number }
  | { ev: "bot-stop"; reason: RoomBotStopReason; phase: string; turnPhase: string; active: number };

/** 房间事件观察者(注入;测试与 server.ts 各持一份实现)。 */
export type RoomObserver = (roomId: string, event: RoomEvent) => void;

/** 对局日志增量落盘钩子(ADR-0014,注入):persist 后/房间行写入后调用,
 *  传输层(server.ts)把 engine.log 新增行追加进 logs/<gameId>.jsonl。room.ts 自身零 fs。 */
export type RoomLogSink = (room: RoomSession) => void;

/** 单局房间会话:开局前后都用它(Lobby 态 engine=null)。 */
export interface RoomSession {
  roomId: string;
  seatCount: number;
  seats: SeatState[];
  hostSeat: number; // 当前 host 座位(开局=0;host 掉线则移交,ADR-0002)
  takeover: Set<number>; // 房主强令 bot 接管的人类座位(重连时移除=夺回)
  /** 自助托管(座位 → 速度):玩家把自己的座位交给 bot 代打。
   *  与 takeover 分离——重连不清除,只有玩家自己收回(autos 02/spec: autopilot)。 */
  autoPilot: Map<number, AutoPilotSpeed>;
  hostConfig: HostConfig;
  /** 本房间所选地图 id(建房时 null;host setMap 后填;startGame 前 must 非 null)。 */
  mapId: string | null;
  /** 本局机遇配置(#135):开局时由 registry 注入项定(服务器读 jiyu.json);
   *  null=机遇关。随房间持久化——服务器重启重建引擎时复刻,否则联机局机遇静默丢失。 */
  encounter: EncounterConfig | null;
  engine: GameEngine | null; // null = Lobby
}

export type AutoPilotSpeed = "fast" | "slow";
/** 慢速托管:每步决策间隔(ms)——玩家看得清 bot 在做什么。 */
export const AUTOPILOT_SLOW_MS = 2000;

// botAct 能驱动的相位(其它相位是引擎内部过渡,无需外部驱动)
const INPUT_PHASES = new Set([
  "Roll",
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingEncounter", // 抉择机遇(#124):bot 贪心策略,见 bot.ts
  "AwaitingJinnang", // 锦囊(#122/T2):bot 恒「今不用」保守推进(策略表在 T6)
"AwaitingExhaustion", // 体力耗竭(#130):bot 随机弃城
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
]);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 去掉易混 I/L/O
const CODE_LEN = 4;

// ──────────────────────────── 国号重名前缀(autos 28)────────────────────────────
// 算法本体在 src/core/guohao.ts(客户端大厅预告与开局定稿共用);此处再导出维持原引用面。
export { resolveGuohaoClash } from "../src/core/guohao";

// ──────────────────────────── 纯视图(传输层与持久化都不参与)────────────────────────────
/** 座位元数据:lobbyView/clientView 都从这里取(字段与原 server.ts 一致,客户端依赖)。
 *  guohao(E7/#19):预设国号原样透出(null=未预设/bot,开局由引擎分配)——
 *  大厅据此渲染单字方章;重名预告由客户端用 core/guohao 的同一算法计算。 */
export function seatMeta(r: RoomSession, onlineSeats: Set<number>) {
  return r.seats.map((s, i) => ({
    seat: i,
    kind: s.kind,
    taken: s.token != null,
    online: onlineSeats.has(i),
    // 该座位当前是否由服务器驱动:开局前 bot 座位;开局后 bot 座位或被房主接管的座位
    controlled: r.engine ? r.engine.players[i].isBot || r.takeover.has(i) : s.kind === "bot",
    // 自助托管中(bot 代打,但身份仍是真人;UI 据此显示「托管」标记)
    autoPilot: r.autoPilot.has(i),
    guohao: s.guohao,
  }));
}

export interface LobbyView {
  type: "lobby";
  roomId: string;
  seatCount: number;
  host: number;
  started: boolean;
  mapId: string | null;
  seats: ReturnType<typeof seatMeta>;
}

export function lobbyView(r: RoomSession, onlineSeats: Set<number>): LobbyView {
  return {
    type: "lobby" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: r.engine != null,
    mapId: r.mapId,
    seats: seatMeta(r, onlineSeats),
  };
}

/** 锦囊暗牌投影(ADR-0016):god-view 快照按「接收座位」裁剪。白名单三档——
 *  public 原样 / count-only 只给数量 / private 只发本人:
 *  - 他人锦囊手牌 → count-only(清空内容 + jinnangHandCount 数量);
 *  - 锦囊牌库牌序 → count-only(牌序决定未来抽牌,泄了等于开了天眼;只留剩余数);
 *  - 含锦囊内容的对局日志行 → 不外发(引擎侧已源头不落内容,此处按机读键过滤抽牌行,防御性双保险);
 *  - 其余(银两/城池/珍宝/弃牌堆…)全部 public 原样——明置信息不裁。
 *  纯函数:不改输入;单测直测(redact 缝,ADR-0016 的落点)。 */
export function redactSnapshotForSeat(s: GameSnapshot, seat: number): GameSnapshot {
  // 军情密探(#122/T4):本座位进行中的窥探目标,内容对 viewer 放行
  const peeked = new Set((s.jinnangPeeks ?? []).filter((pk) => pk.viewer === seat).map((pk) => pk.target));
  const players = s.players.map((p, i) => {
    // 数量走引擎态 jinnangHandCount(公开信息),此处只裁内容
    if (i === seat || peeked.has(i)) return p;
    return { ...p, jinnangHand: [] };
  });
  return {
    ...s,
    players,
    jinnangDeck: [], // 牌序只裁不给;剩余数走引擎态 jinnangDeckCount
    // 日志不裁(ADR-0016 决策3):引擎源头只写「抽了一张锦囊」无内容,抽牌行本身
    // 是公开信息(手牌数),随快照照发
  };
}

/** clientView:snapshot 态把 engine.snapshot() 展开;Lobby 态退化为 lobbyView。
 *  snapshot 分支携带与 lobby 相同的房间字段(roomId/seatCount/host/started/mapId/seats)
 *  + 引擎快照展开(快照无同名键,不冲突)。
 *  seat(ADR-0016):接收方座位——传入即返回该座位的投影(锦囊暗牌/牌序/抽牌日志已裁);
 *  缺省 = god-view 全量(重放/调试/单测语义,生产 ws 路径一律传 seat)。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>, seat?: number) {
  if (!r.engine) return lobbyView(r, onlineSeats);
  const base = {
    type: "snapshot" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: true,
    mapId: r.mapId,
    seats: seatMeta(r, onlineSeats),
  };
  const snap = r.engine.snapshot();
  return { ...base, ...(seat == null ? snap : redactSnapshotForSeat(snap, seat)) };
}

// ──────────────────────────── bot/接管/托管驱动(ADR-0002 接管;spec: autopilot)────────────────────────────
/** 该座位当前是否由服务器驱动(原始 bot、被房主接管、或自助托管中)。 */
function seatControlled(r: RoomSession, seat: number): boolean {
  return r.engine != null && (r.engine.players[seat]?.isBot || r.takeover.has(seat) || r.autoPilot.has(seat));
}

/** 该座位当前步进延迟:托管慢速 2s,其余(bot 座位/takeover/托管快速)为 0。 */
function stepDelayMs(r: RoomSession, seat: number): number {
  return r.autoPilot.get(seat) === "slow" ? AUTOPILOT_SLOW_MS : 0;
}

/** 当前决策点归属座位:Setup·PickCapital=当前选都位,Playing=decisionOwner(珍宝
 *  交涉=城主)。-1 = 无归属(Setup 收尾瞬态),不可驱动。 */
function decisionSeatOf(e: GameEngine): number {
  return e.phase === "Setup" ? e.currentSetupPlayerIndex : e.decisionOwner;
}

/** 廉价状态指纹:任何真实进展都会改变它(防 botAct 空转死循环)。
 *  必须覆盖所有"无资源变化的进展":位置移动、跳过轮空消耗、回合推进——
 *  曾经漏了这三者,导致"掷骰落空格 + 对手跳过"被误判 no-progress,全 bot/托管局卡死(症状1根因)。 */
function fingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.setupPhase,
    e.turnPhase,
    e.turnNumber,
    e.activeIndex,
    e.currentDraftIndex,
    e.players.map((p) => `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}:${p.position}:${p.skipTurns}:${p.warrants}`).join(","),
  ].join("|");
}

// ──────────────────────────── RoomRegistry:深模块 ────────────────────────────
export interface CreateRoomConfig {
  seatCount: number;
  botIdx: Set<number>;
  hostConfig: HostConfig;
  guohao?: string; // host 预设国号(R3-D1 #99):写入 seat0,语义与 joinSeat 一致(校验/trim/可空)
}

/** Registry 注入项(server.ts 构造时传;ADR-0007:fs 读取归传输层,room.ts 只消费结果)。
 *  encounter(#135):联机机遇配置——服务器读 public/config/jiyu.json 后注入,
 *  startGame 透传进引擎 EngineConfig.encounter。缺省 = 机遇关(引擎缺省语义,历史行为)。
 *  decisionTimeoutMs(#118):决策停摆看门狗——引擎停在未接管人类座位的决策点超过该毫秒,
 *  bot 自动接管该座位(重连/刷新夺回,同 ADR-0002 接管语义)。0 = 关闭(缺省关,测试友好);
 *  server.ts 默认 120s(env DECISION_TIMEOUT_MS 可调)。 */
export interface RoomRegistryOptions {
  encounter?: EncounterConfig;
  decisionTimeoutMs?: number;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomSession>();
  private readonly persistence: RoomPersistence;
  private readonly observer: RoomObserver | null;
  private readonly logSink: RoomLogSink | null;
  private readonly encounter?: EncounterConfig;
  private readonly decisionTimeoutMs: number;
  /** #118 看门狗:roomId → 待超时座位 + timer。driveBots 每次进出重评估(见各自注释)。 */
  private readonly stall = new Map<string, { seat: number; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    persistence: RoomPersistence,
    observer?: RoomObserver,
    logSink?: RoomLogSink,
    options?: RoomRegistryOptions,
  ) {
    this.persistence = persistence;
    this.observer = observer ?? null;
    this.logSink = logSink ?? null;
    this.encounter = options?.encounter;
    this.decisionTimeoutMs = options?.decisionTimeoutMs ?? 0;
  }

  /** 发一条观测事件(无观察者时为空操作)。 */
  private observe(r: RoomSession, event: RoomEvent): void {
    this.observer?.(r.roomId, event);
  }

  /** 房间生命周期行写进对局日志(ADR-0014 category "room";开局前无引擎则跳过),
   *  写完立即触发日志落盘钩子(解散等场景不再有后续 persist)。 */
  private logRoom(r: RoomSession, brief: string, detail: string): void {
    if (!r.engine) return;
    r.engine.logRoomEvent(brief, detail);
    this.logSink?.(r);
  }

  /** 房间码冲突检测:查内存 + persistence.exists(后者由适配器实现,默认查 fs)。 */
  private existsRoom(id: string): boolean {
    return this.rooms.has(id) || this.persistence.exists(id);
  }

  // ──────────────────────────── 启动恢复 ────────────────────────────
  /** 从 persistence 把所有房间载入内存(启动时调一次)。
   *  mapProvider:按 mapId 恢复对应地图的引擎(服务器注入;room.ts 不读 fs)。
   *  onRestored:每恢复一房回调一次(server.ts 据此给对局日志落盘记基线,ADR-0014)。 */
  restoreAll(mapProvider?: (mapId: string) => LoadedMap, onRestored?: (room: RoomSession) => void): number {
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
      count++;
    }
    return count;
  }

  /** 内部:RoomRecord → RoomSession(零 WS 句柄;engine 重建走 persistence 层)。 */
  private hydrate(rec: RoomRecord, mapProvider?: (mapId: string) => LoadedMap): RoomSession {
    const data = recordToSessionData(rec, mapProvider);
    return {
      roomId: data.roomId,
      seatCount: data.seatCount,
      seats: data.seats.map((s) => ({ kind: s.kind, token: s.token, guohao: s.guohao })),
      hostSeat: data.hostSeat,
      takeover: data.takeover,
      autoPilot: data.autoPilot,
      hostConfig: data.hostConfig,
      mapId: data.mapId,
      encounter: data.encounter,
      engine: data.engine,
    };
  }

  get(roomId: string): RoomSession | undefined {
    return this.rooms.get(roomId);
  }

  size(): number {
    return this.rooms.size;
  }

  // ──────────────────────────── 房间码 / token ────────────────────────────
  private newToken(): string {
    return randomBytes(18).toString("base64url");
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
    if (!(seatCount >= 2 && seatCount <= 8)) throw new RoomError(400, "seats 必须 2-8");
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
    const room: RoomSession = { roomId, seatCount, seats, hostSeat: 0, takeover: new Set(), autoPilot: new Map(), hostConfig, mapId: null, encounter: null, engine: null };
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
  setMap(roomId: string, mapId: string, callerSeatToken: string, validMapIds: Set<string>): RoomSession {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始,不可改图");
    if (callerSeatToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可选图");
    if (typeof mapId !== "string" || !validMapIds.has(mapId)) throw new RoomError(400, "未知地图");
    room.mapId = mapId;
    this.observe(room, { ev: "map", mapId });
    this.persist(room);
    return room;
  }

  /** host 开局:构造引擎(doDraftRoll 自动国号)后停在 Setup·PickCapital(L41:真人
   *  各自在自己屏幕三选一,经 WS pickCapital 落子;bot/接管/托管座位由 driveBots 代选,
   *  全 bot 驱动房自动跑完进 Playing)。首帧 onUpdate 即 Setup 态(含首位选都者三候选)。
   *  onUpdate:开局首帧 + 每个 bot 步后调(逐步直播,保留原 server.ts 行为)。
   *  mapProvider:按 mapId 返回 LoadedMap(服务器从 public/maps 加载后注入;ADR-0007:
   *  room.ts 不读 fs)。startGame 前必须 setMap,否则 400"请先选择地图"。
   *  异步:driveBots 可能含慢速托管步进。 */
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
        targetNetWorth: room.hostConfig.target,
        difficulty: room.hostConfig.difficulty,
        mapId: room.mapId!,
        // 机遇接线(#135):registry 注入项(服务器读 jiyu.json)开局定稿,存房间记录——
        // 引擎侧归一/回退单源 resolveEncounterConfig;undefined = 机遇关(缺省注入)。
        encounter: this.encounter,
      },
      true,
      map,
    );
    room.encounter = this.encounter ?? null;
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
    onUpdate?.(room); // 开局首帧(Setup 态:offeredCapitals=首位选都者三候选)
    await this.driveBots(room, onUpdate); // bot/接管/托管座位先驱动(全 bot 驱动房自动进 Playing)
    return room;
  }

  /** 真人选都落子(L41):校验「轮到该座位 + tileIndex ∈ 三候选」后引擎落子;
   *  选完由引擎滚换下一位候选,余下 bot/接管/托管座位 driveBots 接力。
   *  轮次/候选校验与 engine.pickCapital 同源(消息透传),这里补 HTTP 语义状态码。 */
  async pickCapital(
    roomId: string,
    seat: number,
    tileIndex: number,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<RoomSession> {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (!room.engine) throw new RoomError(409, "对局未开始");
    const e = room.engine;
    if (e.phase !== "Setup" || e.setupPhase !== "PickCapital") throw new RoomError(409, "非选都阶段");
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) throw new RoomError(400, "seat 非法");
    if (e.currentSetupPlayerIndex !== seat) throw new RoomError(403, "未轮到该座位选都");
    if (!e.offeredCapitals.includes(tileIndex)) throw new RoomError(400, "非本轮候选城");
    const r = e.pickCapital(seat, tileIndex);
    if (!r.ok) throw new RoomError(400, r.reason ?? "选都失败");
    this.persist(room);
    onUpdate?.(room); // 落子结果先推(候选滚换/推进)
    await this.driveBots(room, onUpdate); // 余下服务器驱动座位接棒(全 bot 驱动房直接跑完进 Playing)
    return room;
  }

  /** 玩家自助托管(spec: autopilot):把自己的座位交给 bot 代打(on)或收回(off)。
   *  与 takeover 分离:重连(attachSeat)不清除,只有本人经此方法收回。
   *  收回后在途连锁做完到下一个决策点自然停(driveBots 每步重查 seatControlled)。
   *  对局中才可托管(未开局 409);切换后 onUpdate 广播,若轮到该座位立即驱动。 */
  async setAutoPilot(
    roomId: string,
    seat: number,
    on: boolean,
    speed: AutoPilotSpeed,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<RoomSession> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) throw new RoomError(409, "对局未开始,不可托管");
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) throw new RoomError(400, "seat 非法");
    if (room.seats[seat].kind === "bot") throw new RoomError(400, "bot 座位无需托管");
    if (speed !== "fast" && speed !== "slow") throw new RoomError(400, "speed 只能是 fast | slow");
    if (on) room.autoPilot.set(seat, speed);
    else room.autoPilot.delete(seat);
    this.observe(room, { ev: "autopilot", seat, on, speed });
    // 托管开关房间行(ADR-0014):机读 detail 供重放调整 bot 驱动座位集
    const seatGuohao = room.engine.players[seat].guohao;
    this.logRoom(
      room,
      on
        ? `${seatGuohao} 开启托管(${speed === "slow" ? "慢速" : "快速"}),交由电脑代打`
        : `${seatGuohao} 关闭托管,收回操作`,
      JSON.stringify({ type: "autopilot", seat, on, speed }),
    );
    this.persist(room);
    onUpdate?.(room); // 先广播托管状态
    await this.driveBots(room, onUpdate); // 若轮到该座位,立即开始代打
    return room;
  }

  /** host 强令 bot 接管某 human 座位(ADR-0002)。若该 seat 正轮到,driveBots 解冻。
   *  onUpdate:每个 botAct 步后调。异步(driveBots 可能含慢速托管步进)。 */
  async takeoverSeat(
    roomId: string,
    hostToken: string,
    seat: number,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<RoomSession> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) throw new RoomError(404, "对局不存在");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可接管");
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) throw new RoomError(400, "seat 非法");
    if (room.seats[seat].kind === "bot") throw new RoomError(400, "该座位本就是 bot");
    room.takeover.add(seat);
    this.observe(room, { ev: "takeover", seat });
    // 接管房间行(ADR-0014):重放据此把该座位并入 bot 驱动集
    this.logRoom(
      room,
      `房主令 bot 接管座位 ${seat}(${room.engine.players[seat].guohao})`,
      JSON.stringify({ type: "takeover", seat }),
    );
    await this.driveBots(room, onUpdate); // 若该 seat 正轮到,立即 bot 驱动解冻(逐步 persist+onUpdate)
    this.persist(room);
    onUpdate?.(room); // 终态
    return room;
  }

  /** host 解散房间:从内存和 persistence 删除。返回被删的 roomId。
   *  WS 句柄关闭由传输层负责(broadcast dismissed 后断开连接)。 */
  dismissRoom(roomId: string, hostToken: string): string {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可解散");
    // 解散房间行(ADR-0014):房间删除前先落盘(logRoom 内触发 logSink)
    this.logRoom(room, `房主解散房间(${room.roomId})`, JSON.stringify({ type: "dismiss" }));
    const id = room.roomId;
    this.clearStall(id); // #118:撤看门狗计时器(stallFire 自身有房间存在重校验,此为即时清理)
    this.rooms.delete(id);
    this.persistence.remove(id);
    return id;
  }

  // ──────────────────────────── 命令 + 掉线 ────────────────────────────
  /** 应用一条人类命令并驱动 bot/接管/托管座位的连锁。
   *  onUpdate:每次可见状态变化后调(初始命令结果后 + 每个 botAct 步后),传输层在回调里 broadcast。
   *  这保留了原 server.ts 的逐步直播 UX(network-client 的渐进 snapshot 反馈)。
   *  异步:连锁可能含慢速托管步进(在途时本调用被重入守卫跳过,由既有链接管)。 */
  async applyCommand(roomId: string, cmd: GameCommand, onUpdate?: (room: RoomSession) => void): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) return;
    room.engine.submitCommand(cmd);
    this.persist(room);
    onUpdate?.(room); // 人类命令结果先推
    await this.driveBots(room, onUpdate); // bot/接管/托管座位的连锁,逐步 persist+onUpdate
  }

  /** WS close 时调用:host 掉线 → transferHost;之后 driveBots(接管/托管座位的连锁)。
   *  seat:刚断开的座位(传输层应已从 stillOnlineSeats 中移除,此处仅作文档/防御)。
   *  stillOnlineSeats:传输层算好后传入(只有传输层知道谁还连着 WS)。
   *  onUpdate:每次可见状态变化后调。异步(连锁可能含慢速托管步进)。 */
  async markSeatOffline(
    roomId: string,
    seat: number,
    stillOnlineSeats: Set<number>,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<void> {
    void seat; // 保留参数以匹配 ADR-0007 接口语义;transport 保证 seat ∉ stillOnlineSeats。
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.observe(room, { ev: "offline", seat, online: [...stillOnlineSeats] });
    // 离线房间行(ADR-0014)
    if (room.engine) {
      this.logRoom(room, `座位 ${seat}(${room.engine.players[seat].guohao}) 离线`, JSON.stringify({ type: "offline", seat }));
    }
    this.transferHostIfNeeded(room, stillOnlineSeats);
    this.persist(room);
    onUpdate?.(room); // 先推"该座离线 + 可能的 host 移交"
    await this.driveBots(room, onUpdate); // 接管/托管中的座位若轮到,继续;冻结的人类座位不驱动(等重连/接管)
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

  /** WS 连接建立时调用(ADR-0002/0005):token 是 Seat 归属唯一凭证 →
   *  连上即从接管集合移除(原玩家持 token 重连夺回)。传输层随后发 clientView 给该 WS。 */
  attachSeat(roomId: string, seat: number): RoomSession | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    // 重连房间行(ADR-0014):重放据此把座位移出接管驱动的 bot 集(托管不因重连失效)
    if (room.takeover.has(seat) && room.engine) {
      this.logRoom(room, `座位 ${seat}(${room.engine.players[seat].guohao}) 重连,退出接管`, JSON.stringify({ type: "attach", seat }));
    }
    room.takeover.delete(seat);
    return room;
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

  // ──────────────────────────── bot 驱动(逐步 onUpdate;慢速托管异步步进)────────────────────────────
  /** 进行中的驱动链(重入守卫:慢速托管 await 期间,新命令/新触发不再开第二条链,
   *  由挂起中的循环继续接管——它每步重查状态,天然覆盖后续进展)。 */
  private readonly driving = new WeakSet<RoomSession>();

  /** 连续驱动服务器控制的决策点,直到轮到人类(在线或冻结)/ 游戏结束 / 无进展。
   *  Setup·PickCapital 期决策点=当前选都座位(currentSetupPlayerIndex,真人等 WS
   *  pickCapital);Playing 期=decisionOwner。关键:冻结的人类座位不被驱动
   *  (seatControlled=false)→ 游戏等其重连或房主接管。
   *  慢速托管座位每步间延迟 2s(异步);每步 persist + onUpdate:客户端能逐步看到动作。
   *  返回 Promise:fast 模式下任务同步完成(零延迟),语义与旧同步版一致。 */
  private async driveBots(r: RoomSession, onUpdate?: (room: RoomSession) => void): Promise<void> {
    const e = r.engine;
    if (!e) return;
    this.clearStall(r.roomId); // 新链开跑即撤看门狗:服务器在驱动,无停摆可言(出口重评估)
    if (this.driving.has(r)) return; // 已有链在跑:它会把新进展接走
    this.driving.add(r);
    try {
      let guard = 0;
      let reason: RoomBotStopReason = "guard";
      while (e.phase !== "GameOver" && guard++ < 500) {
        // Setup 期(bot/接管/托管代选 aiSetupStepFor)与 Playing 期(botAct)统一到
        // 同一步进骨架:决策点归属与可驱动相位不同,observe/persist/直播/进展检查共用。
        const setup = e.phase === "Setup";
        const owner = decisionSeatOf(e);
        const phaseOk = setup
          ? e.setupPhase === "PickCapital" && owner >= 0
          : INPUT_PHASES.has(e.turnPhase);
        if (!phaseOk) { reason = "not-input-phase"; break; }
        if (!seatControlled(r, owner)) { reason = "human-turn"; break; }
        const delay = stepDelayMs(r, owner);
        const before = fingerprint(e);
        if (setup) e.aiSetupStepFor(owner);
        else botAct(e, { conservative: r.takeover.has(owner) && !r.autoPilot.has(owner) }); // #118×#148:接管=保守(看门狗/房主接管不替玩家花锦囊),自助托管=按策略
        this.observe(r, { ev: "bot-step", seat: owner, turnPhase: e.turnPhase, active: e.activeIndex });
        this.persist(r);
        onUpdate?.(r); // 每步直播
        if (e.isOver) { reason = "game-over"; break; }
        if (fingerprint(e) === before) { reason = "no-progress"; break; }
        if (delay > 0) await new Promise((res) => setTimeout(res, delay));
      }
      if (e.phase === "GameOver") reason = "game-over";
      this.observe(r, { ev: "bot-stop", reason, phase: e.phase, turnPhase: e.turnPhase, active: e.activeIndex });
      // 步数上限(guard)只防单链失控,不是游戏终界:全 bot/全员托管的长对局会自然超过 500 步。
      // 若未终局且仍轮到服务器驱动的座位 → 休整后自动续链(否则对局会永久卡死——
      // 有人类交互时每次命令都会重开新链,全托管场景没有任何重触发者)。
      const guardOwner = decisionSeatOf(e);
      if (reason === "guard" && e.phase !== "GameOver" && guardOwner >= 0 && seatControlled(r, guardOwner)) {
        setTimeout(() => {
          void this.driveBots(r, onUpdate);
        }, stepDelayMs(r, guardOwner));
      }
      // #118 看门狗出口评估:链停在未接管的真人座位(human-turn)= 该端拖节奏,武装超时。
      // 其余停因(not-input-phase/game-over/guard 续链)服务器仍在掌控,不武装。
      if (reason === "human-turn" && guardOwner >= 0 && this.decisionTimeoutMs > 0) {
        this.armStall(r, guardOwner, onUpdate);
      }
    } finally {
      this.driving.delete(r);
    }
  }

  // ──────────────────────────── 决策停摆看门狗(#118)────────────────────────────
  /** 撤看门狗(链重开/房间解散时);无挂起计时器时空操作。 */
  private clearStall(roomId: string): void {
    const w = this.stall.get(roomId);
    if (w) {
      clearTimeout(w.timer);
      this.stall.delete(roomId);
    }
  }

  /** 武装:decisionTimeoutMs 后若仍停在同一未接管人类座位 → bot 接管(ADR-0002 语义)。
   *  同房间旧计时器先撤(决策点换了,重算)。unref:不因挂起计时器拖延进程退出。 */
  private armStall(r: RoomSession, seat: number, onUpdate?: (room: RoomSession) => void): void {
    this.clearStall(r.roomId);
    const timer = setTimeout(() => {
      void this.stallFire(r, seat, onUpdate);
    }, this.decisionTimeoutMs);
    timer.unref?.();
    this.stall.set(r.roomId, { seat, timer });
  }

  /** 超时触发:重校验(房间还在/对局未终/仍停在该座位/该座位仍非服务器驱动)后
   *  bot 接管并续推连锁。接管走既有 takeover 集合:重连 attachSeat 自动夺回,
   *  对局日志记 takeover 行(重放把它并入 bot 驱动集,终态逐字段一致)。 */
  private async stallFire(
    r: RoomSession,
    seat: number,
    onUpdate?: (room: RoomSession) => void,
  ): Promise<void> {
    this.stall.delete(r.roomId);
    const e = r.engine;
    if (this.rooms.get(r.roomId) !== r || !e || e.isOver) return;
    const owner = decisionSeatOf(e);
    if (owner !== seat || seatControlled(r, seat)) return;
    r.takeover.add(seat);
    this.observe(r, { ev: "takeover", seat, auto: true });
    this.logRoom(
      r,
      `座位 ${seat}(${e.players[seat].guohao}) 决策停摆超 ${Math.round(this.decisionTimeoutMs / 1000)} 秒,bot 自动接管(重连/刷新夺回)`,
      JSON.stringify({ type: "takeover", seat, auto: true }),
    );
    this.persist(r);
    onUpdate?.(r); // 先广播接管(客户端座位controlled 置位,等待条换「智将运筹中…」)
    await this.driveBots(r, onUpdate); // 解冻续推;再停下一个真人决策点时出口重新武装
  }

  // ──────────────────────────── 持久化投影 ────────────────────────────
  private persist(r: RoomSession): void {
    const rec: RoomRecord = {
      roomId: r.roomId,
      seatCount: r.seatCount,
      seats: r.seats.map((s): PersistedSeat => ({ kind: s.kind, token: s.token, guohao: s.guohao })),
      hostSeat: r.hostSeat,
      takeover: [...r.takeover],
      autoPilot: [...r.autoPilot].map(([seat, speed]) => ({ seat, speed })),
      hostConfig: r.hostConfig,
      mapId: r.mapId,
      encounter: r.encounter, // #135:机遇配置随房间落盘,重启重建引擎复刻(否则联机局机遇静默丢)
      snapshot: r.engine ? r.engine.snapshot() : null,
    };
    this.persistence.save(rec);
    // ADR-0014 对局日志:每手快照后把引擎新增日志行经钩子交传输层落盘(logs/<gameId>.jsonl)
    if (r.engine) this.logSink?.(r);
  }
}

// ──────────────────────────── 错误类型(供传输层映射 HTTP 状态码)────────────────────────────
export class RoomError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "RoomError";
  }
}

// ──────────────────────────── 类型再导出(供 server.ts 用)────────────────────────────
export type { AiDifficulty };
// statusOf 同样从 engine-helpers 再导出,避免 server.ts 多加一行 import
export { statusOf };

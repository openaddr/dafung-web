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
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty, GameCommand } from "../src/core/types";
import { isSingleCjk } from "../src/core/constants";
import type { LoadedMap } from "../src/core/board-loader";
import { botAct } from "../src/core/bot";
import { autoSetup, createEngine, statusOf } from "./engine-helpers";
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
  | { ev: "takeover"; seat: number }
  | { ev: "autopilot"; seat: number; on: boolean; speed: AutoPilotSpeed }
  | { ev: "offline"; seat: number; online: number[] }
  | { ev: "bot-step"; seat: number; turnPhase: string; active: number }
  | { ev: "bot-stop"; reason: RoomBotStopReason; phase: string; turnPhase: string; active: number };

/** 房间事件观察者(注入;测试与 server.ts 各持一份实现)。 */
export type RoomObserver = (roomId: string, event: RoomEvent) => void;

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
  engine: GameEngine | null; // null = Lobby
}

export type AutoPilotSpeed = "fast" | "slow";
/** 慢速托管:每步决策间隔(ms)——玩家看得清 bot 在做什么。 */
export const AUTOPILOT_SLOW_MS = 2000;

// botAct 能驱动的相位(其它相位是引擎内部过渡,无需外部驱动)
const INPUT_PHASES = new Set([
  "Roll",
  "AwaitingCapitalHalt",
  "AwaitingBranch",
  "AwaitingDecision",
  "AwaitingHeroPick",
  "AwaitingTreasureOwner",
  "AwaitingBankruptcySettle",
]);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // 去掉易混 I/L/O
const CODE_LEN = 4;

// ──────────────────────────── 国号重名前缀(autos 28)────────────────────────────
/** 联机重名国号的方位前缀(定案 8 个:东西南北前后大小;座位 ≤8,一名+七前缀恰好够用)。 */
export const GUOHAO_PREFIXES = ["东", "西", "南", "北", "前", "后", "大", "小"] as const;

/** 重名国号分配:先到先得保留原名,后到者依次取未被占用的前缀国号(宁→东宁/西宁/…)。
 *  null(未预设)与不重复的国号原样返回;顺序即座位顺序。 */
export function resolveGuohaoClash(desired: ReadonlyArray<string | null>): Array<string | null> {
  const used = new Set<string>();
  return desired.map((g) => {
    if (g == null) return null;
    if (!used.has(g)) {
      used.add(g);
      return g;
    }
    const prefix = GUOHAO_PREFIXES.find((px) => !used.has(px + g));
    if (prefix == null) throw new RoomError(500, "国号前缀耗尽(座位数超出 8)");
    const final = prefix + g;
    used.add(final);
    return final;
  });
}

// ──────────────────────────── 纯视图(传输层与持久化都不参与)────────────────────────────
/** 座位元数据:lobbyView/clientView 都从这里取(字段与原 server.ts 一致,客户端依赖)。 */
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

/** clientView:snapshot 态把 engine.snapshot() 展开;Lobby 态退化为 lobbyView。
 *  snapshot 分支携带与 lobby 相同的房间字段(roomId/seatCount/host/started/mapId/seats)
 *  + 引擎快照展开(快照无同名键,不冲突)。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>) {
  return r.engine
    ? {
        type: "snapshot" as const,
        roomId: r.roomId,
        seatCount: r.seatCount,
        host: r.hostSeat,
        started: true,
        mapId: r.mapId,
        seats: seatMeta(r, onlineSeats),
        ...r.engine.snapshot(),
      }
    : lobbyView(r, onlineSeats);
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
}

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomSession>();
  private readonly persistence: RoomPersistence;
  private readonly observer: RoomObserver | null;

  constructor(persistence: RoomPersistence, observer?: RoomObserver) {
    this.persistence = persistence;
    this.observer = observer ?? null;
  }

  /** 发一条观测事件(无观察者时为空操作)。 */
  private observe(r: RoomSession, event: RoomEvent): void {
    this.observer?.(r.roomId, event);
  }

  /** 房间码冲突检测:查内存 + persistence.exists(后者由适配器实现,默认查 fs)。 */
  private existsRoom(id: string): boolean {
    return this.rooms.has(id) || this.persistence.exists(id);
  }

  // ──────────────────────────── 启动恢复 ────────────────────────────
  /** 从 persistence 把所有房间载入内存(启动时调一次)。
   *  mapProvider:按 mapId 恢复对应地图的引擎(服务器注入;room.ts 不读 fs)。 */
  restoreAll(mapProvider?: (mapId: string) => LoadedMap): number {
    let count = 0;
    for (const id of this.persistence.listIds()) {
      const rec = this.persistence.load(id);
      if (!rec) continue;
      this.rooms.set(rec.roomId, this.hydrate(rec, mapProvider));
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
  /** 建房:Seat0=host(human,已领 token);其它座位按 botIdx 标记。返回 {room,seat,token}。 */
  createRoom(config: CreateRoomConfig): { room: RoomSession; seat: number; token: string } {
    const { seatCount, botIdx, hostConfig } = config;
    if (!(seatCount >= 2 && seatCount <= 8)) throw new RoomError(400, "seats 必须 2-8");
    if (botIdx.has(0)) throw new RoomError(400, "host(Seat 0)必须是真人");
    const roomId = this.newRoomId();
    const seats: SeatState[] = Array.from({ length: seatCount }, (_, i) => ({
      kind: botIdx.has(i) ? "bot" : "human",
      token: null,
      guohao: null,
    }));
    const token = this.newToken();
    seats[0].token = token;
    const room: RoomSession = { roomId, seatCount, seats, hostSeat: 0, takeover: new Set(), autoPilot: new Map(), hostConfig, mapId: null, engine: null };
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

  /** host 开局:构造引擎(doDraftRoll 自动国号)+ autoSetup + driveBots。
   *  onUpdate:开局首帧 + 每个 botAct 步后调(逐步直播,保留原 server.ts 行为)。
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
      },
      true,
      map,
    );
    autoSetup(engine);
    room.engine = engine;
    this.observe(room, { ev: "start", mapId: room.mapId! });
    this.persist(room);
    onUpdate?.(room); // 开局首帧
    await this.driveBots(room, onUpdate); // bot 座位先驱动到人类/待输入(逐步广播)
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
    const id = room.roomId;
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
   *  关键:冻结的人类座位不被驱动(seatControlled=false)→ 游戏等其重连或房主接管。
   *  慢速托管座位每步间延迟 2s(异步);每步 persist + onUpdate:客户端能逐步看到动作。
   *  返回 Promise:fast 模式下任务同步完成(零延迟),语义与旧同步版一致。 */
  private async driveBots(r: RoomSession, onUpdate?: (room: RoomSession) => void): Promise<void> {
    const e = r.engine;
    if (!e) return;
    if (this.driving.has(r)) return; // 已有链在跑:它会把新进展接走
    this.driving.add(r);
    try {
      let guard = 0;
      let reason: RoomBotStopReason = "guard";
      while (e.phase !== "GameOver" && guard++ < 500) {
        if (!INPUT_PHASES.has(e.turnPhase)) { reason = "not-input-phase"; break; }
        const owner = e.decisionOwner;
        if (!seatControlled(r, owner)) { reason = "human-turn"; break; }
        const delay = stepDelayMs(r, owner);
        const before = fingerprint(e);
        botAct(e);
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
      if (reason === "guard" && e.phase !== "GameOver" && seatControlled(r, e.decisionOwner)) {
        setTimeout(() => {
          void this.driveBots(r, onUpdate);
        }, stepDelayMs(r, e.decisionOwner));
      }
    } finally {
      this.driving.delete(r);
    }
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
      snapshot: r.engine ? r.engine.snapshot() : null,
    };
    this.persistence.save(rec);
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

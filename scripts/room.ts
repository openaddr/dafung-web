// 房间游戏编排(ADR-0007):房间生命周期 + 座位 + bot 驱动 + host 移交 + 纯视图。
// 标准 ports & adapters 的核心:深模块,**零 WS/HTTP/fs 依赖**(不 import ws / node:http / node:fs)。
// 传输层持 WS 句柄、知道 online 状态;视图/transferHost 都接 `onlineSeats: Set<number>` 作入参。
// 持久化做成注入的 RoomPersistence 适配器。
//
// 行为与原 server.ts(2026-08-04 重构前)逐字节一致:客户端看到的 clientView/lobbyView 不变。
// 设计见 docs/adr/0007-room-module-extraction.md;语义不变量见 ADR-0001/0002/0004/0005。
import { randomBytes, randomInt } from "node:crypto";
import { GameEngine } from "../src/core/game";
import type { SeatConfig } from "../src/core/game";
import type { AiDifficulty, GameCommand } from "../src/core/types";
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
}

/** 单局房间会话:开局前后都用它(Lobby 态 engine=null)。 */
export interface RoomSession {
  roomId: string;
  seatCount: number;
  seats: SeatState[];
  hostSeat: number; // 当前 host 座位(开局=0;host 掉线则移交,ADR-0002)
  takeover: Set<number>; // 房主强令 bot 接管的人类座位(重连时移除=夺回)
  hostConfig: HostConfig;
  engine: GameEngine | null; // null = Lobby
}

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
  }));
}

export interface LobbyView {
  type: "lobby";
  roomId: string;
  seatCount: number;
  host: number;
  started: boolean;
  seats: ReturnType<typeof seatMeta>;
}

export function lobbyView(r: RoomSession, onlineSeats: Set<number>): LobbyView {
  return {
    type: "lobby" as const,
    roomId: r.roomId,
    seatCount: r.seatCount,
    host: r.hostSeat,
    started: r.engine != null,
    seats: seatMeta(r, onlineSeats),
  };
}

/** clientView:snapshot 态把 engine.snapshot() 展开;Lobby 态退化为 lobbyView。
 *  字段必须与原 server.ts 逐字节一致(网络客户端 network-client.ts 依赖)。 */
export function clientView(r: RoomSession, onlineSeats: Set<number>) {
  return r.engine
    ? {
        type: "snapshot" as const,
        roomId: r.roomId,
        host: r.hostSeat,
        seats: seatMeta(r, onlineSeats),
        ...r.engine.snapshot(),
      }
    : lobbyView(r, onlineSeats);
}

// ──────────────────────────── bot/接管驱动(ADR-0002 接管)────────────────────────────
/** 当前决策归属哪个座位:大部分相位=active;AwaitingTreasureOwner=城主(可能≠访客)。 */
function decisionOwnerSeat(e: GameEngine): number {
  return e.turnPhase === "AwaitingTreasureOwner" ? e.treasureVisitor?.ownerIdx ?? e.activeIndex : e.activeIndex;
}

/** 该座位当前是否由服务器驱动(原始 bot,或被房主接管的人类座位)。 */
function seatControlled(r: RoomSession, seat: number): boolean {
  return r.engine != null && (r.engine.players[seat]?.isBot || r.takeover.has(seat));
}

/** 廉价状态指纹:任何真实进展都会改变它(防 botAct 空转死循环)。 */
function fingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.setupPhase,
    e.turnPhase,
    e.activeIndex,
    e.currentDraftIndex,
    e.players.map((p) => `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}`).join(","),
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

  constructor(persistence: RoomPersistence) {
    this.persistence = persistence;
  }

  /** 房间码冲突检测:查内存 + persistence.exists(后者由适配器实现,默认查 fs)。 */
  private existsRoom(id: string): boolean {
    return this.rooms.has(id) || this.persistence.exists(id);
  }

  // ──────────────────────────── 启动恢复 ────────────────────────────
  /** 从 persistence 把所有房间载入内存(启动时调一次)。 */
  restoreAll(): number {
    let count = 0;
    for (const id of this.persistence.listIds()) {
      const rec = this.persistence.load(id);
      if (!rec) continue;
      this.rooms.set(rec.roomId, this.hydrate(rec));
      count++;
    }
    return count;
  }

  /** 内部:RoomRecord → RoomSession(零 WS 句柄;engine 重建走 persistence 层)。 */
  private hydrate(rec: RoomRecord): RoomSession {
    const data = recordToSessionData(rec);
    return {
      roomId: data.roomId,
      seatCount: data.seatCount,
      seats: data.seats.map((s) => ({ kind: s.kind, token: s.token })),
      hostSeat: data.hostSeat,
      takeover: data.takeover,
      hostConfig: data.hostConfig,
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
    if (!(seatCount >= 2 && seatCount <= 4)) throw new RoomError(400, "seats 必须 2-4");
    if (botIdx.has(0)) throw new RoomError(400, "host(Seat 0)必须是真人");
    const roomId = this.newRoomId();
    const seats: SeatState[] = Array.from({ length: seatCount }, (_, i) => ({
      kind: botIdx.has(i) ? "bot" : "human",
      token: null,
    }));
    const token = this.newToken();
    seats[0].token = token;
    const room: RoomSession = { roomId, seatCount, seats, hostSeat: 0, takeover: new Set(), hostConfig, engine: null };
    this.rooms.set(roomId, room);
    this.persist(room);
    return { room, seat: 0, token };
  }

  /** 凭 roomId 加入第一个空 human 座位(FCFS)。返回 {room,seat,token}。 */
  joinSeat(roomId: string): { room: RoomSession; seat: number; token: string } {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始,不可加入");
    const idx = room.seats.findIndex((s) => s.kind === "human" && s.token == null);
    if (idx < 0) throw new RoomError(409, "房间已满(无空座位)");
    const token = this.newToken();
    room.seats[idx].token = token;
    this.persist(room);
    return { room, seat: idx, token };
  }

  /** host 开局:构造引擎(doDraftRoll 自动国号)+ autoSetup + driveBots。
   *  onUpdate:开局首帧 + 每个 botAct 步后调(逐步直播,保留原 server.ts 行为)。 */
  startGame(roomId: string, hostToken: string, onUpdate?: (room: RoomSession) => void): RoomSession {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError(404, "房间不存在");
    if (room.engine) throw new RoomError(409, "对局已开始");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可开局");
    const seatsCfg: SeatConfig[] = room.seats.map((s, i) => ({
      name: `座 ${i + 1}`,
      isBot: s.kind === "bot" || s.token == null, // 未领的人类座位自动 bot 填充
    }));
    const engine = createEngine(
      {
        seats: seatsCfg,
        seed: room.hostConfig.seed,
        targetNetWorth: room.hostConfig.target,
        difficulty: room.hostConfig.difficulty,
      },
      true,
    );
    autoSetup(engine);
    room.engine = engine;
    this.persist(room);
    onUpdate?.(room); // 开局首帧
    this.driveBots(room, onUpdate); // bot 座位先驱动到人类/待输入(逐步广播)
    return room;
  }

  /** host 强令 bot 接管某 human 座位(ADR-0002)。若该 seat 正轮到,driveBots 解冻。
   *  onUpdate:每个 botAct 步后调。 */
  takeoverSeat(
    roomId: string,
    hostToken: string,
    seat: number,
    onUpdate?: (room: RoomSession) => void,
  ): RoomSession {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) throw new RoomError(404, "对局不存在");
    if (hostToken !== room.seats[room.hostSeat].token) throw new RoomError(403, "仅 host 可接管");
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.seats.length) throw new RoomError(400, "seat 非法");
    if (room.seats[seat].kind === "bot") throw new RoomError(400, "该座位本就是 bot");
    room.takeover.add(seat);
    this.driveBots(room, onUpdate); // 若该 seat 正轮到,立即 bot 驱动解冻(逐步 persist+onUpdate)
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
  /** 应用一条人类命令并驱动 bot/接管座位的连锁。
   *  onUpdate:每次可见状态变化后调(初始命令结果后 + 每个 botAct 步后),传输层在回调里 broadcast。
   *  这保留了原 server.ts 的逐步直播 UX(network-client 的渐进 snapshot 反馈)。 */
  applyCommand(roomId: string, cmd: GameCommand, onUpdate?: (room: RoomSession) => void): void {
    const room = this.rooms.get(roomId);
    if (!room || !room.engine) return;
    room.engine.submitCommand(cmd);
    this.persist(room);
    onUpdate?.(room); // 人类命令结果先推
    this.driveBots(room, onUpdate); // bot/接管座位的连锁,逐步 persist+onUpdate
  }

  /** WS close 时调用:host 掉线 → transferHost;之后 driveBots(接管座位的连锁)。
   *  seat:刚断开的座位(传输层应已从 stillOnlineSeats 中移除,此处仅作文档/防御)。
   *  stillOnlineSeats:传输层算好后传入(只有传输层知道谁还连着 WS)。
   *  onUpdate:每次可见状态变化后调。 */
  markSeatOffline(
    roomId: string,
    seat: number,
    stillOnlineSeats: Set<number>,
    onUpdate?: (room: RoomSession) => void,
  ): void {
    void seat; // 保留参数以匹配 ADR-0007 接口语义;transport 保证 seat ∉ stillOnlineSeats。
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.transferHostIfNeeded(room, stillOnlineSeats);
    this.persist(room);
    onUpdate?.(room); // 先推"该座离线 + 可能的 host 移交"
    this.driveBots(room, onUpdate); // 接管中的座位若轮到,继续;冻结的人类座位不驱动(等重连/接管)
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

  // ──────────────────────────── bot 驱动(逐步 onUpdate)────────────────────────────
  /** 连续驱动服务器控制的决策点,直到轮到人类(在线或冻结)/ 游戏结束 / 无进展。
   *  关键:冻结的人类座位不被驱动(seatControlled=false)→ 游戏等其重连或房主接管。
   *  每步 persist + onUpdate:客户端(联机模式)能逐步看到 bot/接管座位的动作,而非一次性跳到终态。 */
  private driveBots(r: RoomSession, onUpdate?: (room: RoomSession) => void): void {
    const e = r.engine;
    if (!e) return;
    let guard = 0;
    while (e.phase !== "GameOver" && guard++ < 500) {
      if (!INPUT_PHASES.has(e.turnPhase)) break;
      if (!seatControlled(r, decisionOwnerSeat(e))) break; // 人类拥有决策(在线或冻结)→ 停
      const before = fingerprint(e);
      botAct(e);
      this.persist(r);
      onUpdate?.(r); // 每步直播
      if (e.isOver) break;
      if (fingerprint(e) === before) break; // 无进展 → 停(防死循环)
    }
  }

  // ──────────────────────────── 持久化投影 ────────────────────────────
  private persist(r: RoomSession): void {
    const rec: RoomRecord = {
      roomId: r.roomId,
      seatCount: r.seatCount,
      seats: r.seats.map((s): PersistedSeat => ({ kind: s.kind, token: s.token })),
      hostSeat: r.hostSeat,
      takeover: [...r.takeover],
      hostConfig: r.hostConfig,
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

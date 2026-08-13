// Room 模块单测(ADR-0007):房间逻辑首次可不开 socket / 不碰磁盘单测。
// 覆盖 ADR-0002 掉线/接管/解散语义 —— 这些 e2e 不覆盖(e2e 只走建房/加入/开局/掷骰)。
// 用 InMemory 持久化注入 RoomRegistry,零 fs / 零 WS。
import { describe, it, expect } from "vitest";
import { RoomRegistry, RoomError, lobbyView } from "../scripts/room";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import { MAP } from "../scripts/engine-helpers";
import type { LoadedMap } from "../src/core/board-loader";

class InMemoryPersistence implements RoomPersistence {
  private readonly m = new Map<string, RoomRecord>();
  save(rec: RoomRecord): void {
    this.m.set(rec.roomId, rec); // persist 已建独立 rec(新数组/snapshot),无需再 clone
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

/** 断言 fn 抛 RoomError 且 status 匹配。 */
function expectRoomError(fn: () => unknown, status: number): void {
  let caught: unknown = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RoomError);
  expect((caught as RoomError).status).toBe(status);
}

/** 测试用最小地图清单:sanguo(真实内置图)。setMap 校验用。 */
const VALID_MAP_IDS = new Set(["sanguo", "zhongyuan"]);
/** 测试用 mapProvider:所有 id 都返回同一张 sanguo 图(避免读 fs)。 */
const testMapProvider = (_id: string): LoadedMap => MAP;

/** 建一个已开局的房间:seat0=host(human),其余非 bot 座位都 join(人类),bot 座位 bot。
 *  默认 host 先 setMap("sanguo") 再 startGame(startGame 要求已选图)。 */
function setupStartedRoom(opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {}) {
  const seats = opts.seats ?? 3;
  const botIdx = new Set(opts.bot ?? [2]);
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({ seatCount: seats, botIdx, hostConfig: { seed: opts.seed ?? 42 } });
  const roomId = created.room.roomId;
  const hostToken = created.token;
  const guestTokens: string[] = [];
  for (let i = 1; i < seats; i++) {
    if (!botIdx.has(i)) guestTokens.push(reg.joinSeat(roomId).token);
  }
  reg.setMap(roomId, opts.mapId ?? "sanguo", hostToken, VALID_MAP_IDS);
  reg.startGame(roomId, hostToken, undefined, testMapProvider);
  return { reg, roomId, hostToken, guestTokens };
}

describe("RoomRegistry · 房间生命周期", () => {
  it("createRoom:seat0=host 领 token,bot 座位标记正确", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, seat, token } = reg.createRoom({
      seatCount: 3,
      botIdx: new Set([2]),
      hostConfig: { seed: 1 },
    });
    expect(seat).toBe(0);
    expect(token).toBeTruthy();
    expect(room.hostSeat).toBe(0);
    expect(room.seats[0].token).toBe(token);
    expect(room.seats[1].kind).toBe("human");
    expect(room.seats[1].token).toBeNull();
    expect(room.seats[2].kind).toBe("bot");
    expect(room.engine).toBeNull();
  });

  it("createRoom 拒绝 host=bot / 越界座位数", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    expectRoomError(() => reg.createRoom({ seatCount: 3, botIdx: new Set([0]), hostConfig: {} }), 400);
    expectRoomError(() => reg.createRoom({ seatCount: 5, botIdx: new Set(), hostConfig: {} }), 400);
    expectRoomError(() => reg.createRoom({ seatCount: 1, botIdx: new Set(), hostConfig: {} }), 400);
  });

  it("joinSeat:FCFS 占第一个空 human 座位;满后 409", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    const j = reg.joinSeat(room.roomId);
    expect(j.seat).toBe(1);
    expect(j.token).toBeTruthy();
    expectRoomError(() => reg.joinSeat(room.roomId), 409); // seat1 已占,无空 human 座
  });

  it("startGame:构造引擎 + autoSetup → phase Playing", () => {
    const { reg, roomId } = setupStartedRoom();
    const room = reg.get(roomId)!;
    expect(room.engine).not.toBeNull();
    expect(room.engine!.phase).toBe("Playing");
  });

  it("startGame:未开局态下,非 host 开局 → 403", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    // room 未开局(engine=null),先过 404/409 守卫,再到 token 校验 → 403
    expectRoomError(() => reg.startGame(room.roomId, "wrong-token"), 403);
  });

  it("startGame:重复开局 → 409", () => {
    const { reg, roomId, hostToken } = setupStartedRoom();
    expectRoomError(() => reg.startGame(roomId, hostToken), 409);
  });
});

describe("RoomRegistry · ADR-0002 掉线 / host 移交", () => {
  it("host 掉线 → 身份移交在场最久(最低索引)真人", () => {
    const { reg, roomId, guestTokens } = setupStartedRoom({ seats: 3, bot: [2] });
    // seat0=host human, seat1=human(已 join), seat2=bot。seat0 掉线,seat1 仍在线
    reg.markSeatOffline(roomId, 0, new Set([1]));
    expect(reg.get(roomId)!.hostSeat).toBe(1);
    void guestTokens;
  });

  it("唯一在线真人掉线(无人可移交)→ host 保持", () => {
    // 2 座:seat0=host human, seat1=bot。seat0 掉线,stillOnline=空
    const { reg, roomId } = setupStartedRoom({ seats: 2, bot: [1] });
    reg.markSeatOffline(roomId, 0, new Set());
    expect(reg.get(roomId)!.hostSeat).toBe(0); // 无人可移交,保持
  });

  it("markSeatOffline 不抛错(内部 driveBots 对冻结人类座位不驱动)", () => {
    const { reg, roomId } = setupStartedRoom({ seats: 3, bot: [2] });
    expect(() => reg.markSeatOffline(roomId, 1, new Set([0]))).not.toThrow();
  });
});

describe("RoomRegistry · ADR-0002 接管(takeoverSeat)", () => {
  it("host 强令 bot 接管 human 座位 → takeover 集合包含该 seat", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 3, bot: [2] });
    reg.takeoverSeat(roomId, hostToken, 1);
    expect(reg.get(roomId)!.takeover.has(1)).toBe(true);
  });

  it("非 host 接管 → 403", () => {
    const { reg, roomId } = setupStartedRoom({ seats: 3, bot: [2] });
    expectRoomError(() => reg.takeoverSeat(roomId, "not-host", 1), 403);
  });

  it("接管 bot 座位 → 400", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 3, bot: [2] });
    expectRoomError(() => reg.takeoverSeat(roomId, hostToken, 2), 400); // seat2 本就是 bot
  });
});

describe("RoomRegistry · 解散(dismissRoom)", () => {
  it("host 解散 → 内存与持久化都移除", () => {
    const persistence = new InMemoryPersistence();
    const reg = new RoomRegistry(persistence);
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    reg.dismissRoom(room.roomId, token);
    expect(reg.get(room.roomId)).toBeUndefined();
    expect(persistence.exists(room.roomId)).toBe(false);
  });

  it("非 host 解散 → 403;不存在房间 → 404", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 2, bot: [1] });
    expectRoomError(() => reg.dismissRoom(roomId, "not-host"), 403);
    expectRoomError(() => reg.dismissRoom("NOPE", hostToken), 404);
  });
});

describe("RoomRegistry · 重连夺回(attachSeat)", () => {
  it("接管后 attachSeat → takeover 移除该 seat(持 token 重连夺回)", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 3, bot: [2] });
    reg.takeoverSeat(roomId, hostToken, 1);
    expect(reg.get(roomId)!.takeover.has(1)).toBe(true);
    reg.attachSeat(roomId, 1); // 原玩家持 token 重连
    expect(reg.get(roomId)!.takeover.has(1)).toBe(false);
  });
});

describe("RoomRegistry · 选图(mapId / setMap)", () => {
  it("createRoom:mapId 初始为 null", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expect(room.mapId).toBeNull();
  });

  it("host setMap 后 mapId 更新 + lobbyView 含 mapId", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    reg.setMap(room.roomId, "sanguo", token, VALID_MAP_IDS);
    expect(reg.get(room.roomId)!.mapId).toBe("sanguo");
    // lobbyView 应返回 mapId 字段
    const view = lobbyView(reg.get(room.roomId)!, new Set([0]));
    expect(view.mapId).toBe("sanguo");
  });

  it("非 host setMap → 403", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expectRoomError(() => reg.setMap(room.roomId, "sanguo", "not-host", VALID_MAP_IDS), 403);
    // mapId 不变
    expect(reg.get(room.roomId)!.mapId).toBeNull();
  });

  it("setMap 传不存在的 mapId → 400 且 mapId 不变", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expectRoomError(() => reg.setMap(room.roomId, "ghost", token, VALID_MAP_IDS), 400);
    expect(reg.get(room.roomId)!.mapId).toBeNull();
  });

  it("setMap 房间不存在 → 404", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    expectRoomError(() => reg.setMap("NOPE", "sanguo", "tok", VALID_MAP_IDS), 404);
  });

  it("未选图(startGame 前 mapId=null)→ 报错'请先选择地图'", () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    // 注意:不 setMap,直接 startGame
    let caught: unknown = null;
    try {
      reg.startGame(room.roomId, token, undefined, testMapProvider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoomError);
    expect((caught as RoomError).status).toBe(400);
    expect((caught as RoomError).message).toContain("请先选择地图");
  });

  it("对局已开始后再 setMap → 409", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 2, bot: [1] });
    expectRoomError(() => reg.setMap(roomId, "zhongyuan", hostToken, VALID_MAP_IDS), 409);
  });
});

describe("RoomRegistry · 鉴权(validateSeat)", () => {
  it("正确 token → true;错误/空/越界/不存在 → false", () => {
    const { reg, roomId, hostToken } = setupStartedRoom({ seats: 3, bot: [2] });
    expect(reg.validateSeat(roomId, 0, hostToken)).toBe(true);
    expect(reg.validateSeat(roomId, 0, "wrong")).toBe(false);
    expect(reg.validateSeat(roomId, 0, null)).toBe(false);
    expect(reg.validateSeat(roomId, 0, "")).toBe(false);
    expect(reg.validateSeat(roomId, 99, hostToken)).toBe(false); // 越界
    expect(reg.validateSeat("NOPE", 0, hostToken)).toBe(false); // 房间不存在
  });
});

describe("RoomRegistry · 命令 + onUpdate 直播", () => {
  it("applyCommand 的 onUpdate 至少回调一次(保留逐步直播语义)", () => {
    const { reg, roomId } = setupStartedRoom({ seats: 3, bot: [2] });
    let calls = 0;
    reg.applyCommand(roomId, { type: "rollAndMove" }, () => {
      calls++;
    });
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe("RoomRegistry · 持久化恢复(restoreAll)", () => {
  it("新 registry 共享同一 persistence → restoreAll 恢复房间(引擎/hostSeat/相位/mapId)", () => {
    const persistence = new InMemoryPersistence();
    const reg1 = new RoomRegistry(persistence);
    const created = reg1.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: { seed: 7 } });
    reg1.joinSeat(created.room.roomId);
    reg1.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    reg1.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    const before = reg1.get(created.room.roomId)!;
    const beforeTurn = before.engine!.turnNumber;
    const beforePhase = before.engine!.phase;

    // 模拟"进程重启":新 registry 同一 persistence;restoreAll 带 mapProvider 恢复对应地图引擎
    const reg2 = new RoomRegistry(persistence);
    const n = reg2.restoreAll(testMapProvider);
    expect(n).toBe(1);
    const restored = reg2.get(created.room.roomId)!;
    expect(restored).toBeDefined();
    expect(restored.engine).not.toBeNull();
    expect(restored.engine!.phase).toBe(beforePhase);
    expect(restored.engine!.turnNumber).toBe(beforeTurn);
    expect(restored.hostSeat).toBe(before.hostSeat);
    expect(restored.seats.length).toBe(3);
    expect(restored.mapId).toBe("sanguo");
  });
});

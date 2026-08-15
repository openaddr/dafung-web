// Room 模块单测(ADR-0007):房间逻辑首次可不开 socket / 不碰磁盘单测。
// 覆盖 ADR-0002 掉线/接管/解散语义 —— 这些 e2e 不覆盖(e2e 只走建房/加入/开局/掷骰)。
// 用 InMemory 持久化注入 RoomRegistry,零 fs / 零 WS。
import { describe, it, expect } from "vitest";
import { RoomRegistry, RoomError, lobbyView, clientView } from "../scripts/room";
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

/** 断言 fn 抛 RoomError 且 status 匹配(fn 可为同步或异步方法)。 */
async function expectRoomError(fn: () => unknown | Promise<unknown>, status: number): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
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
async function setupStartedRoom(opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {}) {
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
  await reg.startGame(roomId, hostToken, undefined, testMapProvider);
  return { reg, roomId, hostToken, guestTokens };
}

describe("RoomRegistry · 房间生命周期", () => {
  it("createRoom:seat0=host 领 token,bot 座位标记正确", async () => {
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

  it("createRoom 拒绝 host=bot / 越界座位数", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    await expectRoomError(() => reg.createRoom({ seatCount: 3, botIdx: new Set([0]), hostConfig: {} }), 400);
    await expectRoomError(() => reg.createRoom({ seatCount: 5, botIdx: new Set(), hostConfig: {} }), 400);
    await expectRoomError(() => reg.createRoom({ seatCount: 1, botIdx: new Set(), hostConfig: {} }), 400);
  });

  it("joinSeat:FCFS 占第一个空 human 座位;满后 409", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    const j = reg.joinSeat(room.roomId);
    expect(j.seat).toBe(1);
    expect(j.token).toBeTruthy();
    await expectRoomError(() => reg.joinSeat(room.roomId), 409); // seat1 已占,无空 human 座
  });

  it("startGame:构造引擎 + autoSetup → phase Playing", async () => {
    const { reg, roomId } = await setupStartedRoom();
    const room = reg.get(roomId)!;
    expect(room.engine).not.toBeNull();
    expect(room.engine!.phase).toBe("Playing");
  });

  it("startGame:未开局态下,非 host 开局 → 403", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    // room 未开局(engine=null),先过 404/409 守卫,再到 token 校验 → 403
    await expectRoomError(() => reg.startGame(room.roomId, "wrong-token"), 403);
  });

  it("startGame:重复开局 → 409", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom();
    await expectRoomError(() => reg.startGame(roomId, hostToken), 409);
  });
});

describe("RoomRegistry · ADR-0002 掉线 / host 移交", () => {
  it("host 掉线 → 身份移交在场最久(最低索引)真人", async () => {
    const { reg, roomId, guestTokens } = await setupStartedRoom({ seats: 3, bot: [2] });
    // seat0=host human, seat1=human(已 join), seat2=bot。seat0 掉线,seat1 仍在线
    await reg.markSeatOffline(roomId, 0, new Set([1]));
    expect(reg.get(roomId)!.hostSeat).toBe(1);
    void guestTokens;
  });

  it("唯一在线真人掉线(无人可移交)→ host 保持", async () => {
    // 2 座:seat0=host human, seat1=bot。seat0 掉线,stillOnline=空
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [1] });
    await reg.markSeatOffline(roomId, 0, new Set());
    expect(reg.get(roomId)!.hostSeat).toBe(0); // 无人可移交,保持
  });

  it("markSeatOffline 不抛错(内部 driveBots 对冻结人类座位不驱动)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2] });
    await reg.markSeatOffline(roomId, 1, new Set([0])); // 不抛错即通过
  });
});

describe("RoomRegistry · ADR-0002 接管(takeoverSeat)", () => {
  it("host 强令 bot 接管 human 座位 → takeover 集合包含该 seat", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    await reg.takeoverSeat(roomId, hostToken, 1);
    expect(reg.get(roomId)!.takeover.has(1)).toBe(true);
  });

  it("非 host 接管 → 403", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2] });
    await expectRoomError(() => reg.takeoverSeat(roomId, "not-host", 1), 403);
  });

  it("接管 bot 座位 → 400", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    await expectRoomError(() => reg.takeoverSeat(roomId, hostToken, 2), 400); // seat2 本就是 bot
  });
});

describe("RoomRegistry · 解散(dismissRoom)", () => {
  it("host 解散 → 内存与持久化都移除", async () => {
    const persistence = new InMemoryPersistence();
    const reg = new RoomRegistry(persistence);
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    reg.dismissRoom(room.roomId, token);
    expect(reg.get(room.roomId)).toBeUndefined();
    expect(persistence.exists(room.roomId)).toBe(false);
  });

  it("非 host 解散 → 403;不存在房间 → 404", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 2, bot: [1] });
    await expectRoomError(() => reg.dismissRoom(roomId, "not-host"), 403);
    await expectRoomError(() => reg.dismissRoom("NOPE", hostToken), 404);
  });
});

describe("RoomRegistry · 重连夺回(attachSeat)", () => {
  it("接管后 attachSeat → takeover 移除该 seat(持 token 重连夺回)", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    await reg.takeoverSeat(roomId, hostToken, 1);
    expect(reg.get(roomId)!.takeover.has(1)).toBe(true);
    reg.attachSeat(roomId, 1); // 原玩家持 token 重连
    expect(reg.get(roomId)!.takeover.has(1)).toBe(false);
  });
});

describe("RoomRegistry · 选图(mapId / setMap)", () => {
  it("createRoom:mapId 初始为 null", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expect(room.mapId).toBeNull();
  });

  it("host setMap 后 mapId 更新 + lobbyView 含 mapId", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    reg.setMap(room.roomId, "sanguo", token, VALID_MAP_IDS);
    expect(reg.get(room.roomId)!.mapId).toBe("sanguo");
    // lobbyView 应返回 mapId 字段
    const view = lobbyView(reg.get(room.roomId)!, new Set([0]));
    expect(view.mapId).toBe("sanguo");
  });

  it("非 host setMap → 403", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(() => reg.setMap(room.roomId, "sanguo", "not-host", VALID_MAP_IDS), 403);
    // mapId 不变
    expect(reg.get(room.roomId)!.mapId).toBeNull();
  });

  it("setMap 传不存在的 mapId → 400 且 mapId 不变", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(() => reg.setMap(room.roomId, "ghost", token, VALID_MAP_IDS), 400);
    expect(reg.get(room.roomId)!.mapId).toBeNull();
  });

  it("setMap 房间不存在 → 404", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    await expectRoomError(() => reg.setMap("NOPE", "sanguo", "tok", VALID_MAP_IDS), 404);
  });

  it("未选图(startGame 前 mapId=null)→ 报错'请先选择地图'", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    // 注意:不 setMap,直接 startGame
    let caught: unknown = null;
    try {
      await reg.startGame(room.roomId, token, undefined, testMapProvider);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoomError);
    expect((caught as RoomError).status).toBe(400);
    expect((caught as RoomError).message).toContain("请先选择地图");
  });

  it("对局已开始后再 setMap → 409", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 2, bot: [1] });
    await expectRoomError(() => reg.setMap(roomId, "zhongyuan", hostToken, VALID_MAP_IDS), 409);
  });
});

describe("clientView · snapshot 消息房间字段(架构待办③:协议自描述)", () => {
  it("开局后 snapshot 分支携带 seatCount/started/mapId——客户端无需从 seats 推断手抄", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2], mapId: "zhongyuan" });
    const view = clientView(reg.get(roomId)!, new Set([0]));
    expect(view.type).toBe("snapshot");
    if (view.type !== "snapshot") throw new Error("expected snapshot");
    expect(view.seatCount).toBe(3);
    expect(view.started).toBe(true);
    expect(view.mapId).toBe("zhongyuan");
    expect(view.host).toBe(0);
    expect(view.seats).toHaveLength(3);
  });

  it("未开局退化为 lobbyView:started=false、mapId=null、seatCount 齐全", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 4, botIdx: new Set([3]), hostConfig: {} });
    const view = clientView(reg.get(room.roomId)!, new Set());
    expect(view.type).toBe("lobby");
    expect(view.started).toBe(false);
    expect(view.mapId).toBeNull();
    expect(view.seatCount).toBe(4);
  });
});

describe("RoomRegistry · 观测事件(RoomObserver,可观测性基建)", () => {
  /** 收集型观察者:记录 (roomId, event) 对。 */
  function observed() {
    const events: { roomId: string; event: Record<string, unknown> }[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (roomId, event) =>
      events.push({ roomId, event: event as Record<string, unknown> }));
    return { reg, events };
  }

  it("开局 + host 接管 seat0 → start/bot-step 序列 + 终局 bot-stop(game-over)", async () => {
    const { reg, events } = observed();
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 1 } });
    reg.setMap(room.roomId, "sanguo", token, VALID_MAP_IDS);
    await reg.startGame(room.roomId, token, undefined, testMapProvider); // seat0=host 人类 → 停在 human-turn
    expect(events.find((e) => e.event.ev === "start")).toBeTruthy();
    const stops = events.filter((e) => e.event.ev === "bot-stop");
    expect(stops[0].event.reason).toBe("human-turn");
    // host 强令 bot 接管 seat0 → 全 bot 自行终局
    await reg.takeoverSeat(room.roomId, token, 0, undefined);
    expect(events.find((e) => e.event.ev === "takeover")?.event.seat).toBe(0);
    expect(events.filter((e) => e.event.ev === "bot-step").length).toBeGreaterThan(0);
    expect(events.at(-1)?.event.ev).toBe("bot-stop");
    expect(events.at(-1)?.event.reason).toBe("game-over");
    // 所有事件都带正确的 roomId
    expect(events.every((e) => e.roomId === room.roomId)).toBe(true);
  });

  it("人类座位在线 → bot-stop reason=human-turn(正常等待)", async () => {
    const { reg, events } = observed();
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 42 } });
    reg.setMap(room.roomId, "sanguo", token, VALID_MAP_IDS);
    await reg.startGame(room.roomId, token, undefined, testMapProvider); // seat0 人类(host 已领 token)
    const stops = events.filter((e) => e.event.ev === "bot-stop");
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].event.reason).toBe("human-turn");
  });

  it("掉线 → offline 事件带 stillOnline 名单", async () => {
    const { reg, events } = observed();
    const { room, token } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    reg.joinSeat(room.roomId);
    reg.setMap(room.roomId, "sanguo", token, VALID_MAP_IDS);
    await reg.startGame(room.roomId, token, undefined, testMapProvider);
    await reg.markSeatOffline(room.roomId, 1, new Set([0]));
    const off = events.find((e) => e.event.ev === "offline");
    expect(off?.event.seat).toBe(1);
    expect(off?.event.online).toEqual([0]);
  });

  it("无观察者 → 一切行为不变(空操作)", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 2, bot: [1] });
    await reg.applyCommand(roomId, { type: "rollAndMove" }); // 不抛错即通过
    expect(reg.get(roomId)!.engine!.phase).toBe("Playing");
    void hostToken;
  });
});

describe("RoomRegistry · 自助托管 setAutoPilot(spec: autopilot)", () => {
  it("开快速托管(全 bot 局)→ 自行推进到终局(guard 续链)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [1] });
    await reg.setAutoPilot(roomId, 0, true, "fast");
    expect(reg.get(roomId)!.autoPilot.has(0)).toBe(true);
    // seat0 托管 → 全场服务器驱动;超过 500 步的链经 setTimeout 续链,轮询等终局
    const room = reg.get(roomId)!;
    for (let i = 0; i < 600 && room.engine!.phase !== "GameOver"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(room.engine!.phase).toBe("GameOver");
  }, 30000);

  it("部分托管:seat0 托管,推进到 seat1(真人)决策点停", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [] }); // 三真人
    await reg.setAutoPilot(roomId, 0, true, "fast");
    const room = reg.get(roomId)!;
    expect(room.engine!.phase).toBe("Playing");
    // 决策归属落在非 seat0 的真人手上
    expect(room.engine!.players[room.engine!.decisionOwner].isBot).toBe(false);
    expect(room.engine!.decisionOwner).not.toBe(0);
  });

  it("收回托管 → autoPilot 移除,后续停在 human-turn", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [1] });
    await reg.setAutoPilot(roomId, 0, true, "fast");
    await reg.setAutoPilot(roomId, 0, false, "fast");
    expect(reg.get(roomId)!.autoPilot.has(0)).toBe(false);
  });

  it("重连(attachSeat)清 takeover 但不清 autoPilot", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [] });
    reg.takeoverSeat(roomId, hostToken, 1, undefined);
    await reg.setAutoPilot(roomId, 1, true, "fast"); // seat1 已被接管,再自助托管
    reg.attachSeat(roomId, 1); // 重连夺回 → takeover 清,autoPilot 保留
    const room = reg.get(roomId)!;
    expect(room.takeover.has(1)).toBe(false);
    expect(room.autoPilot.has(1)).toBe(true);
  });

  it("bot 座位托管 → 400;未开局 → 409;非法 speed → 400", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    await expectRoomError(() => reg.setAutoPilot(roomId, 2, true, "fast"), 400); // bot 座位
    await expectRoomError(() => reg.setAutoPilot(roomId, 99, true, "fast"), 400); // 越界
    await expectRoomError(() => reg.setAutoPilot(roomId, 1, true, "turbo" as "fast"), 400); // 非法 speed
    const reg2 = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg2.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(() => reg2.setAutoPilot(room.roomId, 0, true, "fast"), 409); // 未开局
    void hostToken;
  });

  it("慢速托管:3 秒窗口内该座位步数 ≤2(2s/步节奏)", async () => {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
      events.push(event as Record<string, unknown>));
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 3 } });
    reg.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    // 慢速托管 seat0,不 await:链在后台走(整链到终局会花数分钟,测试只观察窗口)
    void reg.setAutoPilot(created.room.roomId, 0, true, "slow");
    await new Promise((r) => setTimeout(r, 3000));
    const mine = events.filter((e) => e.ev === "bot-step" && e.seat === 0).length;
    expect(mine).toBeGreaterThanOrEqual(1); // 至少迈出第一步(0 延迟首步)
    expect(mine).toBeLessThanOrEqual(2); // 2s/步 → 3s 窗口内至多 2 步(快速模式下整局都会跑完)
    // 收尾:收回托管,后台链将在下一个检查点停
    await reg.setAutoPilot(created.room.roomId, 0, false, "fast");
  }, 15000);

  it("托管事件进观测流水(autopilot 事件带座位/开关/速度)", async () => {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
      events.push(event as Record<string, unknown>));
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 5 } });
    reg.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await reg.setAutoPilot(created.room.roomId, 0, true, "fast");
    const ev = events.find((e) => e.ev === "autopilot");
    expect(ev).toMatchObject({ seat: 0, on: true, speed: "fast" });
  }, 30000);

  it("持久化含 autoPilot:重启恢复保留托管", async () => {
    const persistence = new InMemoryPersistence();
    const reg1 = new RoomRegistry(persistence);
    const created = reg1.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 9 } });
    reg1.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg1.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await reg1.setAutoPilot(created.room.roomId, 0, true, "fast");
    const reg2 = new RoomRegistry(persistence);
    reg2.restoreAll(testMapProvider);
    expect(reg2.get(created.room.roomId)!.autoPilot.get(0)).toBe("fast");
  });
});

describe("RoomRegistry · 鉴权(validateSeat)", () => {
  it("正确 token → true;错误/空/越界/不存在 → false", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    expect(reg.validateSeat(roomId, 0, hostToken)).toBe(true);
    expect(reg.validateSeat(roomId, 0, "wrong")).toBe(false);
    expect(reg.validateSeat(roomId, 0, null)).toBe(false);
    expect(reg.validateSeat(roomId, 0, "")).toBe(false);
    expect(reg.validateSeat(roomId, 99, hostToken)).toBe(false); // 越界
    expect(reg.validateSeat("NOPE", 0, hostToken)).toBe(false); // 房间不存在
  });
});

describe("RoomRegistry · 命令 + onUpdate 直播", () => {
  it("applyCommand 的 onUpdate 至少回调一次(保留逐步直播语义)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2] });
    let calls = 0;
    await reg.applyCommand(roomId, { type: "rollAndMove" }, () => {
      calls++;
    });
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe("RoomRegistry · 持久化恢复(restoreAll)", () => {
  it("新 registry 共享同一 persistence → restoreAll 恢复房间(引擎/hostSeat/相位/mapId)", async () => {
    const persistence = new InMemoryPersistence();
    const reg1 = new RoomRegistry(persistence);
    const created = reg1.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: { seed: 7 } });
    reg1.joinSeat(created.room.roomId);
    reg1.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg1.startGame(created.room.roomId, created.token, undefined, testMapProvider);
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

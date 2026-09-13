// Room 模块单测(ADR-0007):房间逻辑首次可不开 socket / 不碰磁盘单测。
// 覆盖 ADR-0002 掉线/接管/解散语义 —— 这些 e2e 不覆盖(e2e 只走建房/加入/开局/掷骰)。
// 用 InMemory 持久化注入 RoomRegistry,零 fs / 零 WS。
import { describe, it, expect } from "bun:test";
import { RoomRegistry, RoomError, lobbyView, clientView, resolveGuohaoClash, redactSnapshotForSeat } from "../scripts/room";
import { JINNANG_CARDS } from "../src/core/jinnang";
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

/** 建一个已开局的房间(不代选都):seat0=host(human),其余非 bot 座位都 join(人类),bot 座位 bot。
 *  默认 host 先 setMap("sanguo") 再 startGame(startGame 要求已选图)。
 *  L41 起 startGame 停在 Setup·PickCapital(真人各自三选一),本助手到「开局」为止。 */
async function startRoom(opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {}) {
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

/** 真人逐个 pickCapital(offered[0])直到进 Playing;余下 bot 座位由 pickCapital 内部
 *  driveBots 自动接棒。 */
async function pickAllHumanCapitals(reg: RoomRegistry, roomId: string): Promise<void> {
  const e = reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e.phase === "Setup"; i++) {
    const cur = e.currentSetupPlayerIndex;
    if (cur < 0) break;
    await reg.pickCapital(roomId, cur, e.offeredCapitals[0]);
  }
}

/** 开局 + 全员选都完成(= 旧行为「开局即 Playing」的等价终态)。 */
async function setupStartedRoom(opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {}) {
  const r = await startRoom(opts);
  await pickAllHumanCapitals(r.reg, r.roomId);
  return r;
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
    await expectRoomError(() => reg.createRoom({ seatCount: 9, botIdx: new Set(), hostConfig: {} }), 400);
    await expectRoomError(() => reg.createRoom({ seatCount: 1, botIdx: new Set(), hostConfig: {} }), 400);
  });

  it("createRoom:座位上限 8(#29)", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 8, botIdx: new Set(), hostConfig: {} });
    expect(room.seats).toHaveLength(8);
    // Seat0=host 已领 token,其余座位空置;国号预设槽起始全 null
    expect(room.seats.slice(1).every((s) => s.token == null)).toBe(true);
    expect(room.seats.every((s) => s.guohao == null)).toBe(true);
  });

  it("joinSeat:FCFS 占第一个空 human 座位;满后 409", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    const j = reg.joinSeat(room.roomId);
    expect(j.seat).toBe(1);
    expect(j.token).toBeTruthy();
    await expectRoomError(() => reg.joinSeat(room.roomId), 409); // seat1 已占,无空 human 座
  });

  it("startGame:开局停在 Setup·PickCapital(L41:真人三选一,不再 autoSetup)", async () => {
    const { reg, roomId } = await startRoom();
    const e = reg.get(roomId)!.engine!;
    expect(e).not.toBeNull();
    expect(e.phase).toBe("Setup");
    expect(e.setupPhase).toBe("PickCapital");
    expect(e.offeredCapitals).toHaveLength(3);
    // driveBots 自 draft 首位驱动 bot 座位自动代选,停在第一个真人手上
    let k = 0;
    while (k < e.draftOrder.length && e.players[e.draftOrder[k]].isBot) {
      expect(e.players[e.draftOrder[k]].capitalIndex).toBeGreaterThanOrEqual(0);
      k++;
    }
    expect(k).toBeLessThan(e.draftOrder.length); // 房内至少 host 一个真人
    expect(e.currentSetupPlayerIndex).toBe(e.draftOrder[k]);
    expect(e.players[e.currentSetupPlayerIndex].isBot).toBe(false);
  });

  it("真人逐个 pickCapital:全员选完 → phase Playing", async () => {
    const { reg, roomId } = await startRoom();
    const e = reg.get(roomId)!.engine!;
    await pickAllHumanCapitals(reg, roomId);
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
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

describe("RoomRegistry · 真人选都 pickCapital(L41)", () => {
  it("非本轮候选城 → 400 且状态不变", async () => {
    const { reg, roomId } = await startRoom();
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    // 选一座「可作都城但不在三候选里」的城(快照契约:候选外一律拒)
    const unoffered = e.board.tiles.find(
      (t) => t.isCapitalEligible && !e.offeredCapitals.includes(t.index) && !e.takenCapitalIndices.has(t.index),
    )!;
    expect(unoffered).toBeTruthy();
    const before = e.currentDraftIndex;
    await expectRoomError(() => reg.pickCapital(roomId, cur, unoffered.index), 400);
    expect(e.currentDraftIndex).toBe(before);
    expect(e.players[cur].capitalIndex).toBe(-1);
  });

  it("未轮到该座位 → 403 且状态不变", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [2] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    // 另一个真人座位(非当前选都位)提交
    const other = e.players.findIndex((p, i) => i !== cur && !p.isBot);
    expect(other).toBeGreaterThanOrEqual(0);
    await expectRoomError(() => reg.pickCapital(roomId, other, e.offeredCapitals[0]), 403);
    expect(e.players[other].capitalIndex).toBe(-1);
  });

  it("对局未开始 → 409;房间不存在 → 404;非选都阶段 → 409", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(() => reg.pickCapital(room.roomId, 0, 0), 409); // 未开局
    await expectRoomError(() => reg.pickCapital("NOPE", 0, 0), 404);
    const { reg: reg2, roomId } = await startRoom({ seats: 2, bot: [1] });
    await pickAllHumanCapitals(reg2, roomId);
    await expectRoomError(() => reg2.pickCapital(roomId, 0, 0), 409); // 已进 Playing
  });

  it("候选内落子:扣建城费/定都/推进下一位(候选滚换)", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [2] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const tileIdx = e.offeredCapitals[0];
    const buildCost = e.catalog.get(e.board.at(tileIdx).propertyId)!.buildCost;
    const cashBefore = e.players[cur].cash;
    let calls = 0;
    await reg.pickCapital(roomId, cur, tileIdx, () => {
      calls++;
    });
    expect(calls).toBeGreaterThanOrEqual(1); // onUpdate 直播保留
    expect(e.players[cur].capitalIndex).toBe(tileIdx);
    expect(e.players[cur].cash).toBe(cashBefore - buildCost);
    expect(e.currentDraftIndex).toBeGreaterThan(0);
  });

  it("bot 座位轮到自动选都:真人选完后服务器接棒,无需人工", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [1, 2] });
    const e = reg.get(roomId)!.engine!;
    // host(唯一真人)选都后,余下 bot 座位由 pickCapital 内部 driveBots 自动跑完
    const cur = e.currentSetupPlayerIndex;
    await reg.pickCapital(roomId, cur, e.offeredCapitals[0]);
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  });

  it("托管代选:开局后自助托管当前选都真人 → 服务器 bot 代选推进", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const before = e.currentDraftIndex;
    await reg.setAutoPilot(roomId, cur, true, "fast");
    expect(e.currentDraftIndex).toBe(before + 1); // 托管链已代选一步
    expect(e.players[cur].capitalIndex).not.toBe(-1);
  });

  it("接管代选:host 接管选都中的真人 → 服务器 bot 代选推进", async () => {
    const { reg, roomId, hostToken } = await startRoom({ seats: 3, bot: [] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const before = e.currentDraftIndex;
    await reg.takeoverSeat(roomId, hostToken, cur, undefined);
    expect(e.currentDraftIndex).toBe(before + 1);
    expect(e.players[cur].capitalIndex).not.toBe(-1);
    expect(reg.get(roomId)!.takeover.has(cur)).toBe(true);
  });

  it("全 bot 驱动房自动开局不回归:开局后无人选都,托管即自动跑完 Setup", async () => {
    const { reg, roomId } = await startRoom({ seats: 2, bot: [1] });
    const e = reg.get(roomId)!.engine!;
    expect(e.phase).toBe("Setup"); // 开局停在真人 host
    await reg.setAutoPilot(roomId, 0, true, "fast"); // host 托管 → 全座位服务器驱动
    expect(e.phase === "Playing" || e.phase === "GameOver").toBe(true); // 选都自动跑完,不留 Setup
    expect(e.setupPhase).toBe("Done"); // 完成信号看 setupPhase(破产会转走都城,capitalIndex 不可作判据)
  });
});


describe('RoomRegistry · 联机国号预设与重名前缀(autos 28)', () => {
  it('joinSeat 带国号:合法单字写入座位;非法 → 400', async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 4, botIdx: new Set(), hostConfig: {} });
    reg.joinSeat(room.roomId, '宁');
    expect(room.seats[1].guohao).toBe('宁');
    await expectRoomError(() => reg.joinSeat(room.roomId, 'AB'), 400);
    await expectRoomError(() => reg.joinSeat(room.roomId, ''), 400);
  });

  it('开局:重名国号依次加方位前缀(宁→宁/东宁/西宁…),快照即最终国号', async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 5, botIdx: new Set([4]), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    // host 未预设;三名加入者都用「宁」
    reg.joinSeat(roomId, '宁');
    reg.joinSeat(roomId, '宁');
    reg.joinSeat(roomId, '宁');
    reg.setMap(roomId, 'sanguo', created.token, VALID_MAP_IDS);
    const room = await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const guohao = room.engine!.players.map((p) => p.guohao);
    // seat0 未预设(引擎分配,不与已用冲突);seat1-3 依次 宁/东宁/西宁
    expect(guohao[1]).toBe('宁');
    expect(guohao[2]).toBe('东宁');
    expect(guohao[3]).toBe('西宁');
    expect(new Set(guohao).size).toBe(5); // 全局无重复(host 未预设由引擎分配)
    // 最终国号体现在快照里(UI 直接显示)
    expect(room.engine!.snapshot().players.map((p) => p.guohao)).toEqual(guohao);
  });

  it('开局:无重名则用原名;未预设座位由引擎从字池分配', async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId, '燕');
    reg.setMap(roomId, 'sanguo', created.token, VALID_MAP_IDS);
    const room = await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const guohao = room.engine!.players.map((p) => p.guohao);
    expect(guohao[1]).toBe('燕');
    expect(new Set(guohao).size).toBe(3);
  });

  it('seatMeta/lobbyView 透出预设国号(E7 #19):大厅预告与开局定稿同源', async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 3, botIdx: new Set(), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    // host(Seat0)不预设国号(入口无此字段);两名加入者撞名「魏」
    reg.joinSeat(roomId, '魏');
    reg.joinSeat(roomId, '魏');
    // lobby/seats 元数据带 guohao 原样值(未预设=null,大厅不放假章)
    const view = lobbyView(reg.get(roomId)!, new Set([0]));
    expect(view.seats.map((s) => s.guohao)).toEqual([null, '魏', '魏']);
    expect(clientView(reg.get(roomId)!, new Set([0])).seats.map((s) => s.guohao)).toEqual([null, '魏', '魏']);
    // 客户端预告 = 同一纯函数(core/guohao)按座位序演算;开局定稿必须与预告一致
    const preview = resolveGuohaoClash(view.seats.map((s) => s.guohao));
    expect(preview).toEqual([null, '魏', '东魏']);
    reg.setMap(roomId, 'sanguo', created.token, VALID_MAP_IDS);
    const room = await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const finalGuohao = room.engine!.players.map((p) => p.guohao);
    preview.forEach((pv, i) => {
      if (pv != null) expect(finalGuohao[i]).toBe(pv);
    });
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

describe("RoomRegistry · 行军自动化(#188)", () => {
  it("人类座位 Roll 相位 ~1s 后服务器代发 rollAndMove(观测流水 + cmd 行)", async () => {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
      events.push(event as Record<string, unknown>));
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 42 } });
    reg.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await pickAllHumanCapitals(reg, created.room.roomId);
    const e = reg.get(created.room.roomId)!.engine!;
    // 本房间的 rollAndMove cmd 行只可能来自自动起摇(选都行是 pickCapital 的;
    // botAct 直调不经 submitCommand)。开局锦囊相位保持人工(#188 红线):测试侧以
    // 玩家身份「今不用」放行,落 Roll 后计时器武装,≤1s 自动起摇。
    const rolled = () => e.log.some((l) => l.category === "cmd" && l.detail.includes('"rollAndMove"'));
    for (let i = 0; i < 400 && !rolled(); i++) {
      if (e.phase === "Playing" && e.turnPhase === "AwaitingJinnang" && !e.players[e.decisionOwner].isBot) {
        await reg.applyCommand(created.room.roomId, { type: "useJinnang", cardId: null });
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(rolled()).toBe(true);
    expect(events.some((x) => x.ev === "auto-roll")).toBe(true);
  }, 15000);
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
    // 经济 v2(目标 30000)全 bot 对局超过单链 500 步:经 setTimeout 续链,轮询等终局
    for (let i = 0; i < 900 && events.at(-1)?.event.reason !== "game-over"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
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

  it("ADR-0014 房间生命周期行进对局日志 + logSink 增量钩子(开局/托管/接管/解散)", async () => {
    const flushed: Array<{ gameId: string; len: number }> = [];
    const reg = new RoomRegistry(
      new InMemoryPersistence(),
      undefined,
      (room) => flushed.push({ gameId: room.engine!.gameId, len: room.engine!.log.length }),
    );
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 11 } });
    reg.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    const engine = reg.get(created.room.roomId)!.engine!;
    const roomRows = () => engine.log.filter((l) => l.category === "room");
    // 开局行:座位构成 + 机读 type=start
    expect(roomRows().some((l) => l.detail.includes('"type":"start"') && l.brief.includes("房间开局"))).toBe(true);
    // 托管开关行(开 → 关,机读 type=autopilot 供重放调整驱动座位集)
    await reg.setAutoPilot(created.room.roomId, 0, true, "fast");
    expect(roomRows().some((l) => l.detail.includes('"type":"autopilot"') && l.detail.includes('"on":true'))).toBe(true);
    await reg.setAutoPilot(created.room.roomId, 0, false, "fast");
    expect(roomRows().some((l) => l.detail.includes('"type":"autopilot"') && l.detail.includes('"on":false'))).toBe(true);
    // 接管行
    await reg.takeoverSeat(created.room.roomId, created.token, 0, undefined);
    expect(roomRows().some((l) => l.detail.includes('"type":"takeover"'))).toBe(true);
    // logSink:persist 与房间行写入后都会被调(对局日志 jsonl 增量追加的驱动源)
    expect(flushed.length).toBeGreaterThan(3);
    expect(flushed.every((f) => f.gameId === engine.gameId)).toBe(true);
    expect(flushed[flushed.length - 1].len).toBe(engine.log.length);
    // 解散行(房间删除前落日志)
    reg.dismissRoom(created.room.roomId, created.token);
    expect(roomRows().some((l) => l.detail.includes('"type":"dismiss"'))).toBe(true);
  }, 60000);

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

describe("RoomRegistry · 联机机遇接线(#135)", () => {
  /** 读引擎运行时机遇配置(engine.encounter 为 private,测试侧经类型断言读取)。 */
  function encounterOf(reg: RoomRegistry, roomId: string): { triggerRate: number; shares: { good: number; neutral: number; bad: number } } {
    return (reg.get(roomId)!.engine as unknown as { encounter: { triggerRate: number; shares: { good: number; neutral: number; bad: number } } }).encounter;
  }

  it("注入 encounter → startGame 透传引擎(触发率/归一档位)", async () => {
    const persistence = new InMemoryPersistence();
    const reg = new RoomRegistry(persistence, undefined, undefined, {
      encounter: { triggerRate: 100, baseRates: { good: 0, neutral: 100, bad: 0 } },
    });
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 42 } });
    reg.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    // 引擎侧已归一(baseRates → shares);中性 100% 原样
    expect(encounterOf(reg, created.room.roomId)).toEqual({
      triggerRate: 100,
      shares: { good: 0, neutral: 100, bad: 0 },
    });
  });

  it("未注入(缺省)→ 机遇关(引擎缺省 triggerRate 0,历史行为)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [1] });
    expect(encounterOf(reg, roomId).triggerRate).toBe(0);
  });

  it("机遇配置随房间持久化:重启 restoreAll 后引擎复刻同一配置", async () => {
    const persistence = new InMemoryPersistence();
    const reg1 = new RoomRegistry(persistence, undefined, undefined, {
      encounter: { triggerRate: 40, baseRates: { good: 30, neutral: 45, bad: 25 } },
    });
    const created = reg1.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 9 } });
    reg1.setMap(created.room.roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg1.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    const reg2 = new RoomRegistry(persistence);
    reg2.restoreAll(testMapProvider);
    expect(encounterOf(reg2, created.room.roomId)).toEqual({
      triggerRate: 40,
      shares: { good: 30, neutral: 45, bad: 25 },
    });
  });
});

describe("RoomRegistry · 决策停摆看门狗(#118)", () => {
  /** 收集型观察者(同「观测事件」describe)。 */
  function observedWith(opts?: { decisionTimeoutMs?: number }) {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) => events.push(event as Record<string, unknown>), undefined, opts);
    return { reg, events };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("人类座位停摆超时 → bot 自动接管(auto 事件+对局继续),重连 attachSeat 夺回", async () => {
    const { reg, events } = observedWith({ decisionTimeoutMs: 25 });
    const created = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: { seed: 42 } });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId); // seat1 人类(guest)
    reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider); // 停在 seat0(Roll)
    const e = reg.get(roomId)!.engine!;
    expect(e.phase).toBe("Setup"); // 选都阶段即停 seat0(human)
    // 25ms 超时 → seat0 被自动接管;连锁推进到 seat1(人类)又停 → 再超时接管 → 对局持续走
    await sleep(300);
    const takeovers = events.filter((ev) => ev.ev === "takeover");
    expect(takeovers.length).toBeGreaterThanOrEqual(1);
    expect(takeovers.every((ev) => ev.auto === true)).toBe(true); // 全部为看门狗代接管,非房主手动
    // 对局确有进展(接管后 driveBots 续推:选都走完进 Playing,不再永久挂)
    expect(["Playing", "GameOver"]).toContain(e.phase);
    // 重连夺回(attachSeat 既有语义,ADR-0002):被看门狗接管的座位,重连即收回
    // (首位选都者按骰序不定,故取实际被接管者断言,不写死座位号)
    const stalledSeat = takeovers[0].seat as number;
    reg.attachSeat(roomId, stalledSeat);
    expect(reg.get(roomId)!.takeover.has(stalledSeat)).toBe(false);
  });

  it("decisionTimeoutMs=0(缺省)→ 永不自动接管(人类座位正常等待,历史行为)", async () => {
    const { reg, events } = observedWith();
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 42 } });
    const roomId = created.room.roomId;
    reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider);
    await sleep(120);
    expect(events.some((ev) => ev.ev === "takeover")).toBe(false);
    expect(reg.get(roomId)!.takeover.size).toBe(0);
  });

  it("解散房间撤看门狗:超时窗口内 dismiss → 无迟到接管、无未处理拒绝", async () => {
    const { reg, events } = observedWith({ decisionTimeoutMs: 400 });
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 42 } });
    const roomId = created.room.roomId;
    reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider); // 武装(400ms 窗口)
    reg.dismissRoom(roomId, created.token); // 窗口内解散 → clearStall
    await sleep(500);
    expect(reg.get(roomId)).toBeUndefined();
    expect(events.some((ev) => ev.ev === "takeover")).toBe(false);
  });
});

describe("锦囊暗牌投影(ADR-0016 · redactSnapshotForSeat)", () => {
  /** 开一局已发手牌的房:发牌在选都完成时(finishSetup),故须走到 Playing。 */
  async function roomWithHands() {
    const r = await setupStartedRoom({ seats: 3, bot: [2] });
    const e = r.reg.get(r.roomId)!.engine!;
    // 保证 seat0/seat1 都有牌可断言(起手 1 张 + 各补 2 张)
    e.drawJinnang(0, 2);
    e.drawJinnang(1, 2);
    return r;
  }

  it("本人手牌原样;他人 → 内容清空 + jinnangHandCount 数量", async () => {
    const { reg, roomId } = await roomWithHands();
    const snap = reg.get(roomId)!.engine!.snapshot();
    const view0 = redactSnapshotForSeat(snap, 0);
    expect(view0.players[0].jinnangHand).toEqual(snap.players[0].jinnangHand);
    expect(view0.players[1].jinnangHand).toEqual([]);
    expect(view0.players[1].jinnangHandCount).toBe(snap.players[1].jinnangHand.length);
    expect(view0.players[2].jinnangHandCount).toBe(snap.players[2].jinnangHand.length);
    expect(view0.players.every((p, i) => (i === 0 ? true : p.jinnangHand.length === 0))).toBe(true);
  });

  it("牌库牌序只给数量;弃牌堆(明置)原样", async () => {
    const { reg, roomId } = await roomWithHands();
    const snap = reg.get(roomId)!.engine!.snapshot();
    const view = redactSnapshotForSeat(snap, 1);
    expect(view.jinnangDeck).toEqual([]);
    expect(view.jinnangDeckCount).toBe(snap.jinnangDeck.length);
    expect(view.jinnangDiscard).toEqual(snap.jinnangDiscard);
  });

  it("抽牌日志行照发(公开信息,ADR-0016 决策3:源头无内容则日志不裁);纯函数不改输入", async () => {
    const { reg, roomId } = await roomWithHands();
    const e = reg.get(roomId)!.engine!;
    e.drawJinnang(0, 1); // 再抽 → 产生 jinnangDraw 日志行
    const snap = e.snapshot();
    const drawRows = snap.log.filter((l) => l.detail.includes("jinnangDraw"));
    expect(drawRows.length).toBeGreaterThan(0);
    // 行内只有手牌数,无牌名(引擎源头保证,另测);投影原样携带
    expect(drawRows.every((l) => !JINNANG_CARDS.some((c) => l.brief.includes(c.id)))).toBe(true);
    const before = JSON.stringify(snap);
    const view = redactSnapshotForSeat(snap, 0);
    expect(view.log.length).toBe(snap.log.length);
    expect(JSON.stringify(snap)).toBe(before); // 未改输入
  });

  it("clientView 带座位 → 投影视图;缺省 → god-view;lobby 态不受影响", async () => {
    const { reg, roomId, hostToken } = await roomWithHands();
    const room = reg.get(roomId)!;
    const online = new Set([0]);
    const view0 = clientView(room, online, 0) as Record<string, unknown>;
    const god = clientView(room, online) as Record<string, unknown>;
    const p1view = (view0.players as { jinnangHand: string[]; jinnangHandCount?: number }[])[1];
    const p1god = (god.players as { jinnangHand: string[] }[])[1];
    expect(p1view.jinnangHand).toEqual([]);
    expect(p1view.jinnangHandCount).toBe(p1god.jinnangHand.length);
    expect((view0.jinnangDeck as string[]).length).toBe(0);
    expect((god.jinnangDeck as string[]).length).toBeGreaterThan(0);
    // lobby 态:未开局房间照旧
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expect(clientView(created.room, new Set([0]), 0).type).toBe("lobby");
    void hostToken;
  });
});

describe("窥探投影(ADR-0016 · #122/T4)", () => {
  it("viewer 视角:窥探目标手牌内容放行,第三者仍裁空;到期后裁回", async () => {
    const { reg, roomId } = await (async () => {
      const r = await setupStartedRoom({ seats: 3, bot: [2] });
      r.reg.get(r.roomId)!.engine!.drawJinnang(0, 2);
      return r;
    })();
    const e = reg.get(roomId)!.engine!;
    e.resolveJinnang(null);
    e.activePlayer.jinnangHand = ["军情密探"];
    e.activePlayer.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    expect(e.jinnangPeeks).toEqual([{ viewer: 0, target: 1 }]);
    const snap = e.snapshot();
    const view0 = redactSnapshotForSeat(snap, 0);
    const view2 = redactSnapshotForSeat(snap, 2);
    expect(view0.players[1].jinnangHand).toEqual(snap.players[1].jinnangHand); // viewer 见内容
    expect(view0.players[2].jinnangHand).toEqual([]); // 非目标仍裁
    expect(view2.players[0].jinnangHand).toEqual(snap.players[0].jinnangHand); // 自己恒全量
    expect(view2.players[1].jinnangHand).toEqual([]); // 第三者不见窥探内容
  });
});

describe("锦囊×房间上下文(#148):接管保守 vs 托管策略", () => {
  it("房主接管座位 bot 恒今不用;自助托管座位按策略用牌", async () => {
    const persistence = new InMemoryPersistence();
    // 2 人类座位:seat0(host)/seat1;无原生 bot
    const reg = new RoomRegistry(persistence);
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set(), hostConfig: { seed: 42 } });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId);
    reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider);
    // 全员选都 → Playing;给 seat0 一张已启用锦囊(免战金牌)
    const e = reg.get(roomId)!.engine!;
    let g = 0;
    while (e.phase === "Setup" && g++ < 20) await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]);
    e.players[0].jinnangHand = ["免战金牌"];
    e.players[0].jinnangHandCount = 1;
    // 房主接管 seat0(等效看门狗路径)→ driveBots 保守:锦囊不消耗
    await reg.takeoverSeat(roomId, created.token, 0);
    expect(e.players[0].jinnangHand).toEqual(["免战金牌"]);
    // 改自助托管 + 现金压到全场中位以下 → 免战策略满足 → bot 用牌
    e.players[0].cash = 100;
    e.players[1].cash = 5000;
    e.jinnangUsedTags = [];
    e.players[0].jinnangHand = ["免战金牌"];
    e.players[0].jinnangHandCount = 1;
    await reg.setAutoPilot(roomId, 0, true, "fast");
    await reg.setAutoPilot(roomId, 1, true, "fast"); // 对座也托管:对局才会循环回 seat0 回合
    for (let i = 0; i < 300 && e.players[0].jinnangHand.length > 0 && !e.isOver; i++) {
      await new Promise((r) => setTimeout(r, 20)); // driveBots 自驱,轮询等策略用牌
    }
    expect(e.players[0].jinnangHand.length).toBeLessThan(1); // 托管策略把牌用了
  });
});

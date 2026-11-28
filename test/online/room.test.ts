// Room 模块单测(ADR-0007):房间逻辑首次可不开 socket / 不碰磁盘单测。
// 覆盖 ADR-0002 掉线/解散与 ADR-0028 托管(接管即自动托管)语义 —— 这些 e2e 不覆盖
// (e2e 只走建房/加入/开局/掷骰)。用 InMemory 持久化注入 RoomRegistry,零 fs / 零 WS。
// 慢例池(测试管线提速批):五条整局托管骑局例按「单例实测 ≥3s」判据入慢例池
// (口径见 docs/how-to/开发与测试.md「把测试跑起来」),DAFUNG_SLOW=1 才跑
// (bun run test:slow),默认池 skip(skip 行可见)——托管全程骑局到终局 7.5s /
// 观测事件开局托管 7.4s / 托管可撤销 7.3s / 托管单节拍不瞬通 7.2s / 托管单节拍节奏
// 3.0s(实测 2026-10-30);其余 68 例轻,常驻默认池。
import { submitCapitalForSetup } from "./room-capitals";
import { describe, it, expect } from "bun:test";
import { RoomRegistry, RoomError } from "@dafung/core/room/room";
import { seatDecisionPointOf } from "@dafung/core/room/player-submissions";
import type { RoomClock, SeatEndpoint } from "@dafung/core/room/room";
import {
  lobbyView,
  clientView,
  redactSnapshotForSeat,
  redactEvents,
  CALIBRATION_WINDOWS,
  CALIBRATION_EVENT_KINDS,
} from "@dafung/core/room/seat-projection";
import { resolveGuohaoClash } from "@dafung/core/engine/guohao";
import { JINNANG_CARDS } from "@dafung/core/engine/jinnang";
import { GameEngine } from "@dafung/core/engine/authority";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  setDefense,
  setStamina,
} from "@dafung/core/engine/planter";
import { heroSlotOf, skillMarksOf } from "@dafung/core/engine/roster";
import { createDice } from "@dafung/core/engine/dice";
import { foldEventBatch } from "@dafung/core/protocol/event-fold";
import { hydrateSeatReplica } from "@dafung/core/protocol/seat-replica";
import type { RoomPersistence } from "@dafung/core/room/room-persistence";
import type { RoomRecord } from "@dafung/core/room/room-record";
import type { ServerMsg } from "@dafung/core/protocol/wire";
import { MAP } from "../../scripts/engine-helpers";
import { loadMap, type LoadedMap } from "@dafung/core/engine/board-loader";
import zhongyuanData from "../../packages/core/maps/zhongyuan.json";

// 慢例池开关:DAFUNG_SLOW=1(bun run test:slow)才跑,默认池 skip(skip 行可见);判据与实测耗时见文件头注。
const itSlow = it.skipIf(!process.env.DAFUNG_SLOW);

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

/** 手动时钟(测试注入,托管步进语义用例):定时全挂表,fireAll 手动泵,零真实等待。 */
class ManualClock implements RoomClock {
  private readonly pending = new Map<unknown, () => void>();
  setTimeout(cb: () => void, _ms: number): unknown {
    const id = {} as unknown;
    this.pending.set(id, cb);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle);
  }
  fireAll(): void {
    const cbs = [...this.pending.values()];
    this.pending.clear();
    for (const cb of cbs) cb();
  }
  get size(): number {
    return this.pending.size;
  }
}

/** 宏任务让位:等待真实 setTimeout(0),保证链的全部 microtask 延续(含嵌套 await)
 *  先于下一次泵送落地(纯 Promise.resolve 只让一位,嵌套延续会与 fireAll 交错)。 */
const macroTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 断言 fn 抛 RoomError 且 status 匹配(fn 可为同步或异步方法)。 */
async function expectRoomError(
  fn: () => unknown | Promise<unknown>,
  status: number,
): Promise<void> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RoomError);
  expect((caught as RoomError).status).toBe(status);
}

/** 测试用最小地图清单:guanzhong(真实内置图)。setMap 校验用。 */
const VALID_MAP_IDS = new Set(["guanzhong", "zhongyuan"]);
/** 测试用 mapProvider:所有 id 都返回同一张 guanzhong 图(避免读 fs)。 */
const testMapProvider = (_id: string): LoadedMap => MAP;

/** 建一个已开局的房间(不代选都):seat0=host(human),其余非 bot 座位都 join(人类),bot 座位 bot。
 *  默认 host 先 setMap("guanzhong") 再 startGame(startGame 要求已选图)。
 *  L41 起 startGame 停在 Setup·PickCapital(真人各自三选一),本助手到「开局」为止。 */
async function startRoom(
  opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {},
) {
  const seats = opts.seats ?? 3;
  const botIdx = new Set(opts.bot ?? [2]);
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({
    seatCount: seats,
    botIdx,
    hostConfig: { seed: opts.seed ?? 42 },
  });
  const roomId = created.room.roomId;
  const hostToken = created.token;
  const guestTokens: string[] = [];
  for (let i = 1; i < seats; i++) {
    if (!botIdx.has(i)) guestTokens.push(reg.joinSeat(roomId).token);
  }
  reg.setMap(roomId, opts.mapId ?? "guanzhong", hostToken, VALID_MAP_IDS);
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
    await submitCapitalForSetup(reg, roomId, cur, e.offeredCapitals[0]);
  }
}

/** 开局 + 全员选都完成(= 旧行为「开局即 Playing」的等价终态)。 */
async function setupStartedRoom(
  opts: { seats?: number; bot?: number[]; seed?: number; mapId?: string } = {},
) {
  const r = await startRoom(opts);
  await pickAllHumanCapitals(r.reg, r.roomId);
  return r;
}

/** 双人真人房选都进 Playing(ManualClock 注入:托管步进语义用例——托管链步进全走
 *  手动泵,零真实等待,节拍/可撤销语义可精确断言)。 */
async function playingRoomWithClock(clock: RoomClock) {
  const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, { clock });
  return { reg, ...(await playingRoom(reg)) };
}

/** 在既有 registry 上建房开局到 Playing(选都泵送;代打用例族共用,返回双座 token)。 */
async function playingRoom(
  reg: RoomRegistry,
): Promise<{ roomId: string; token: string; guestToken: string }> {
  // target 16,000(ADR-0034 后生产图达标局中位 ~290 轮):压低达标线让「跑到终局」族
  // 回到旧局长量级,60s 预算内收敛;收敛/一致性断言与目标绝对值无关
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 42, target: 16000 },
  });
  const roomId = created.room.roomId;
  const guestToken = reg.joinSeat(roomId).token;
  reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = () => reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e().phase === "Setup"; i++)
    await submitCapitalForSetup(reg, roomId, e().currentSetupPlayerIndex, e().offeredCapitals[0]!);
  expect(e().phase).toBe("Playing");
  return { roomId, token: created.token, guestToken };
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

  it("createRoom 拒绝 host=bot 或不在 2–8 范围内的整数座位数", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    await expectRoomError(
      () => reg.createRoom({ seatCount: 3, botIdx: new Set([0]), hostConfig: {} }),
      400,
    );
    for (const seatCount of [1, 2.5, 9]) {
      await expectRoomError(
        () => reg.createRoom({ seatCount, botIdx: new Set(), hostConfig: {} }),
        400,
      );
    }
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

  it("REST 占座契约(e2e 下沉 #306):建房 lobby 形状 → join 次座 → 满员 409", async () => {
    // 原 e2e 走 HTTP 断言 /room/new·join 响应体;两响应 = { ok, seat, seatToken,
    // ...lobbyView } —— lobbyView 即响应体本体,零 WS 等价平移,逐字段对照不弱化。
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, seat, token } = reg.createRoom({
      seatCount: 3,
      botIdx: new Set([2]),
      hostConfig: { seed: 7 },
    });
    expect(seat).toBe(0);
    expect(token).toBeTruthy();
    expect(room.roomId).toMatch(/^[A-Z]{4}$/);
    const lobby = lobbyView(room, new Set([0]));
    expect(lobby.seats).toHaveLength(3);
    expect(lobby.seats[0].taken).toBe(true); // host 已占
    expect(lobby.seats[2].kind).toBe("bot");

    // /room/join:凭码占第一个空 human 座,响应体同形
    const joined = reg.joinSeat(room.roomId);
    expect(joined.seat).toBe(1);
    expect(joined.token).toBeTruthy();
    expect(lobbyView(joined.room, new Set([0, 1])).seats[1].taken).toBe(true);

    // 满员再加入 → 409
    await expectRoomError(() => reg.joinSeat(room.roomId), 409);
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

describe("RoomRegistry · 真人选都提交", () => {
  it("候选内落子:扣建城费/定都/推进下一位(候选滚换)", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [2] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const tileIdx = e.offeredCapitals[0];
    const buildCost = e.catalog.get(e.board.at(tileIdx).propertyId)!.buildCost;
    const cashBefore = e.players[cur].cash;
    let calls = 0;
    await submitCapitalForSetup(reg, roomId, cur, tileIdx, () => {
      calls++;
    });
    expect(calls).toBeGreaterThanOrEqual(1); // onUpdate 直播保留
    expect(e.players[cur].capitalIndex).toBe(tileIdx);
    expect(e.players[cur].cash).toBe(cashBefore - buildCost);
    expect(e.currentDraftIndex).toBeGreaterThan(0);
  });

  for (const [seatCount, seed] of [
    [6, 7],
    [8, 1],
  ] as const) {
    it(`中原争霸 ${seatCount} 席联机开局，电脑补空席并代选都城`, async () => {
      const reg = new RoomRegistry(new InMemoryPersistence());
      const { room, token } = reg.createRoom({
        seatCount,
        botIdx: new Set(),
        hostConfig: { seed },
      });
      const { roomId } = room;
      reg.setMap(roomId, "zhongyuan", token, VALID_MAP_IDS);
      await reg.startGame(roomId, token, undefined, () => loadMap(zhongyuanData));
      const e = room.engine!;
      expect(e.phase).toBe("Setup");
      expect(e.currentSetupPlayerIndex).toBe(0); // 固定种子让房主先选、先行动
      await submitCapitalForSetup(reg, roomId, 0, e.offeredCapitals[0]);
      expect(e.phase).toBe("Playing");
      expect(e.activeIndex).toBe(0);
      expect(e.players.filter((p) => p.isBot)).toHaveLength(seatCount - 1);
      expect(new Set(e.players.map((p) => p.capitalIndex)).size).toBe(seatCount);
      expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
    });
  }

  it("托管代选:开局后自助托管当前选都真人 → 服务器 bot 代选推进", async () => {
    const { reg, roomId } = await startRoom({ seats: 3, bot: [] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const before = e.currentDraftIndex;
    await reg.setAutoPilot(roomId, cur, true);
    expect(e.currentDraftIndex).toBe(before + 1); // 托管链已代选一步
    expect(e.players[cur].capitalIndex).not.toBe(-1);
  });

  it("全 bot 驱动房自动开局不回归:开局后无人选都,托管即自动跑完 Setup", async () => {
    const { reg, roomId } = await startRoom({ seats: 2, bot: [1] });
    const e = reg.get(roomId)!.engine!;
    expect(e.phase).toBe("Setup"); // 开局停在真人 host
    await reg.setAutoPilot(roomId, 0, true); // host 托管 → 全座位服务器驱动
    // #580:fire-and-forget 单拍只代选一步,余下选都经时钟自续(2s/步)——轮询等 Setup 跑完
    for (let i = 0; i < 3000 && e.phase === "Setup"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(e.phase === "Playing" || e.phase === "GameOver").toBe(true); // 选都自动跑完,不留 Setup
    expect(e.setupPhase).toBe("Done"); // 完成信号看 setupPhase(破产会转走都城,capitalIndex 不可作判据)
  }, 30_000);
});

describe("RoomRegistry · 联机国号预设与重名前缀(autos 28)", () => {
  it("joinSeat 带国号:合法单字写入座位;非法 → 400", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 4, botIdx: new Set(), hostConfig: {} });
    reg.joinSeat(room.roomId, "宁");
    expect(room.seats[1].guohao).toBe("宁");
    await expectRoomError(() => reg.joinSeat(room.roomId, "AB"), 400);
    await expectRoomError(() => reg.joinSeat(room.roomId, ""), 400);
  });

  it("开局:重名国号依次加方位前缀(宁→宁/东宁/西宁…),快照即最终国号", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 5, botIdx: new Set([4]), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    // host 未预设;三名加入者都用「宁」
    reg.joinSeat(roomId, "宁");
    reg.joinSeat(roomId, "宁");
    reg.joinSeat(roomId, "宁");
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    const room = await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const guohao = room.engine!.players.map((p) => p.guohao);
    // seat0 未预设(引擎分配,不与已用冲突);seat1-3 依次 宁/东宁/西宁
    expect(guohao[1]).toBe("宁");
    expect(guohao[2]).toBe("东宁");
    expect(guohao[3]).toBe("西宁");
    expect(new Set(guohao).size).toBe(5); // 全局无重复(host 未预设由引擎分配)
    // 最终国号体现在快照里(UI 直接显示)
    expect(room.engine!.snapshot().players.map((p) => p.guohao)).toEqual(guohao);
  });

  it("开局:无重名则用原名;未预设座位由引擎从字池分配", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId, "燕");
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    const room = await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const guohao = room.engine!.players.map((p) => p.guohao);
    expect(guohao[1]).toBe("燕");
    expect(new Set(guohao).size).toBe(3);
  });

  it("seatMeta/lobbyView 透出预设国号(E7 #19):大厅预告与开局定稿同源", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const created = reg.createRoom({ seatCount: 3, botIdx: new Set(), hostConfig: { seed: 7 } });
    const roomId = created.room.roomId;
    // host(Seat0)不预设国号(入口无此字段);两名加入者撞名「魏」
    reg.joinSeat(roomId, "魏");
    reg.joinSeat(roomId, "魏");
    // lobby/seats 元数据带 guohao 原样值(未预设=null,大厅不放假章)
    const view = lobbyView(reg.get(roomId)!, new Set([0]));
    expect(view.seats.map((s) => s.guohao)).toEqual([null, "魏", "魏"]);
    expect(clientView(reg.get(roomId)!, new Set([0]), 0).seats.map((s) => s.guohao)).toEqual([
      null,
      "魏",
      "魏",
    ]);
    // 客户端预告 = 同一纯函数(core/guohao)按座位序演算;开局定稿必须与预告一致
    const preview = resolveGuohaoClash(view.seats.map((s) => s.guohao));
    expect(preview).toEqual([null, "魏", "东魏"]);
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
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

describe("RoomRegistry · 重连(attachSeat,ADR-0028)", () => {
  it("重连不清托管:attachSeat 后 autoPilot 仍在,拿回控制靠本人「收回」", async () => {
    // 回归锚:守「重连即夺回」旧口径不复活(ADR-0028 单一开关,重连不动开关)。用时 <1s。
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2] });
    await reg.setAutoPilot(roomId, 0, true);
    reg.attachSeat(roomId, 0); // 原玩家持 token 重连
    expect(reg.get(roomId)!.autoPilot.has(0)).toBe(true);
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

describe("RoomRegistry · 选图(mapId / setMap)", () => {
  it("createRoom:mapId 初始为 null", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    expect(room.mapId).toBeNull();
  });

  it("host setMap 后 mapId 更新 + lobbyView 含 mapId", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room, token } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    reg.setMap(room.roomId, "guanzhong", token, VALID_MAP_IDS);
    expect(reg.get(room.roomId)!.mapId).toBe("guanzhong");
    // lobbyView 应返回 mapId 字段
    const view = lobbyView(reg.get(room.roomId)!, new Set([0]));
    expect(view.mapId).toBe("guanzhong");
  });

  it("非 host setMap → 403", async () => {
    const reg = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(
      () => reg.setMap(room.roomId, "guanzhong", "not-host", VALID_MAP_IDS),
      403,
    );
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
    await expectRoomError(() => reg.setMap("NOPE", "guanzhong", "tok", VALID_MAP_IDS), 404);
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
    const view = clientView(reg.get(roomId)!, new Set([0]), 0);
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
    const view = clientView(reg.get(room.roomId)!, new Set(), 0);
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
      events.push(event as Record<string, unknown>),
    );
    const created = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 42 },
    });
    reg.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await pickAllHumanCapitals(reg, created.room.roomId);
    const e = reg.get(created.room.roomId)!.engine!;
    // 本房间的 rollAndMove cmd 行只可能来自自动起摇(选都行是 pickCapital 的;
    // botAct 直调不经 submitCommand)。开局锦囊相位保持人工(#188 红线):测试侧以
    // 玩家身份「今不用」放行,落 Roll 后计时器武装,≤1s 自动起摇。
    const rolled = () =>
      e.log.some((l) => l.category === "cmd" && l.detail.includes('"rollAndMove"'));
    for (let i = 0; i < 400 && !rolled(); i++) {
      if (
        e.phase === "Playing" &&
        e.turnPhase === "AwaitingJinnang" &&
        !e.players[e.decisionOwner].isBot
      ) {
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
      events.push({ roomId, event: event as Record<string, unknown> }),
    );
    return { reg, events };
  }

  itSlow(
    "开局 + host 托管 seat0 → start/autopilot/bot-step 序列 + 终局 bot-stop(game-over)",
    async () => {
      const events: { roomId: string; event: Record<string, unknown> }[] = [];
      const clock = new ManualClock();
      const reg = new RoomRegistry(
        new InMemoryPersistence(),
        (roomId, event) => events.push({ roomId, event: event as Record<string, unknown> }),
        undefined,
        { clock },
      );
      const { room, token } = reg.createRoom({
        seatCount: 2,
        botIdx: new Set([1]),
        hostConfig: { seed: 1 },
      });
      reg.setMap(room.roomId, "guanzhong", token, VALID_MAP_IDS);
      await reg.startGame(room.roomId, token, undefined, testMapProvider); // seat0=host 人类 → 停在 human-turn
      expect(events.find((e) => e.event.ev === "start")).toBeTruthy();
      const stops = events.filter((e) => e.event.ev === "bot-stop");
      expect(stops[0].event.reason).toBe("human-turn");
      // host 开启托管 seat0 → 全座位服务器驱动,自行终局(#580:fire-and-forget,链经时钟自续)
      await reg.setAutoPilot(room.roomId, 0, true);
      expect(events.find((e) => e.event.ev === "autopilot")?.event).toMatchObject({
        seat: 0,
        on: true,
        by: "self",
      });
      // 泵送:托管链 2s/步经注入时钟,fireAll 逐拍放行直到终局(bot 座位 0 延迟随链同走)
      for (let i = 0; i < 20_000 && events.at(-1)?.event.reason !== "game-over"; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(events.at(-1)?.event.ev).toBe("bot-stop");
      expect(events.at(-1)?.event.reason).toBe("game-over");
      expect(events.filter((e) => e.event.ev === "bot-step").length).toBeGreaterThan(0);
      // 所有事件都带正确的 roomId
      expect(events.every((e) => e.roomId === room.roomId)).toBe(true);
    },
    60_000,
  );

  it("人类座位在线 → bot-stop reason=human-turn(正常等待)", async () => {
    const { reg, events } = observed();
    const { room, token } = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 42 },
    });
    reg.setMap(room.roomId, "guanzhong", token, VALID_MAP_IDS);
    await reg.startGame(room.roomId, token, undefined, testMapProvider); // seat0 人类(host 已领 token)
    const stops = events.filter((e) => e.event.ev === "bot-stop");
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0].event.reason).toBe("human-turn");
  });

  it("掉线 → offline 事件带 stillOnline 名单", async () => {
    const { reg, events } = observed();
    const { room, token } = reg.createRoom({ seatCount: 3, botIdx: new Set([2]), hostConfig: {} });
    reg.joinSeat(room.roomId);
    reg.setMap(room.roomId, "guanzhong", token, VALID_MAP_IDS);
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
  itSlow(
    "托管单节拍不瞬通(#580):fire-and-forget 单拍只进一步,泵送才续链,guard 续链跑到终局",
    async () => {
      const clock = new ManualClock();
      const { reg, roomId } = await playingRoomWithClock(clock);
      const e = reg.get(roomId)!.engine!;
      await reg.setAutoPilot(roomId, 0, true);
      await reg.setAutoPilot(roomId, 1, true);
      // 零泵送:fire-and-forget 链至多同步走第一拍即挂时钟等下一拍(零延迟实现在此
      // 已整局瞬通直落终局)——步进延迟 = 对局不可能在单个宏任务里打完
      expect(e.isOver).toBe(false);
      // 泵送:链经注入时钟逐步自续(guard 续链同走时钟)直到终局
      for (let i = 0; i < 20_000 && !e.isOver; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(e.phase).toBe("GameOver");
    },
    60_000,
  );

  itSlow(
    "托管可撤销(#580):收回后泵到时钟排空即停在真人决策点,重开续跑终局",
    async () => {
      const clock = new ManualClock();
      const { reg, roomId } = await playingRoomWithClock(clock);
      const e = reg.get(roomId)!.engine!;
      await reg.setAutoPilot(roomId, 0, true);
      await reg.setAutoPilot(roomId, 1, true);
      for (let i = 0; i < 5; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(e.phase).toBe("Playing"); // 推进几拍仍在对局中(步进保证)
      // 收回 seat0(误触切回)→ 泵到时钟排空:链在 seat0 的决策点停(human-turn 出口,
      // decisionTimeoutMs=0 无看门狗定时),对局不直落终局
      await reg.setAutoPilot(roomId, 0, false);
      for (let i = 0; i < 20_000 && clock.size > 0; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(clock.size).toBe(0); // 时钟排空 = 链与看门狗全部停摆,无后台续跑
      expect(e.isOver).toBe(false);
      expect(e.decisionOwner).toBe(0); // 停在收回座位的真人决策门
      // 重开托管 → 续跑到终局(可恢复)
      await reg.setAutoPilot(roomId, 0, true);
      for (let i = 0; i < 20_000 && !e.isOver; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(e.phase).toBe("GameOver");
    },
    60_000,
  );

  it("部分托管:seat0 托管,推进到 seat1(真人)决策点停", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [] }); // 三真人
    await reg.setAutoPilot(roomId, 0, true);
    const room = reg.get(roomId)!;
    expect(room.engine!.phase).toBe("Playing");
    // #580:托管链 2s/步经真实时钟异步自续,setAutoPilot 已不 await 整链——
    // 轮询等链推进到非 seat0 的真人决策点停(human-turn 出口;一个座位的回合数步,
    // 超时按步数×2s 富余给)
    for (let i = 0; i < 3000 && room.engine!.decisionOwner === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // 决策归属落在非 seat0 的真人手上
    expect(room.engine!.players[room.engine!.decisionOwner].isBot).toBe(false);
    expect(room.engine!.decisionOwner).not.toBe(0);
  }, 45_000);

  it("收回托管 → autoPilot 移除,后续停在 human-turn", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [1] });
    await reg.setAutoPilot(roomId, 0, true);
    await reg.setAutoPilot(roomId, 0, false);
    expect(reg.get(roomId)!.autoPilot.has(0)).toBe(false);
  });

  it("bot 座位托管 → 400;未开局 → 409", async () => {
    const { reg, roomId, hostToken } = await setupStartedRoom({ seats: 3, bot: [2] });
    await expectRoomError(() => reg.setAutoPilot(roomId, 2, true), 400); // bot 座位
    await expectRoomError(() => reg.setAutoPilot(roomId, 99, true), 400); // 越界
    const reg2 = new RoomRegistry(new InMemoryPersistence());
    const { room } = reg2.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await expectRoomError(() => reg2.setAutoPilot(room.roomId, 0, true), 409); // 未开局
    void hostToken;
  });

  itSlow(
    "托管单节拍节奏:3 秒窗口内该座位步数 ≤2(2s/步)",
    async () => {
      const events: Record<string, unknown>[] = [];
      const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
        events.push(event as Record<string, unknown>),
      );
      const created = reg.createRoom({
        seatCount: 2,
        botIdx: new Set([1]),
        hostConfig: { seed: 3 },
      });
      reg.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
      await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
      // 托管 seat0,不 await:链在后台走(整链到终局会花数分钟,测试只观察窗口)
      void reg.setAutoPilot(created.room.roomId, 0, true);
      await new Promise((r) => setTimeout(r, 3000));
      const mine = events.filter((e) => e.ev === "bot-step" && e.seat === 0).length;
      expect(mine).toBeGreaterThanOrEqual(1); // 至少迈出第一步(0 延迟首步)
      expect(mine).toBeLessThanOrEqual(2); // 2s/步 → 3s 窗口内至多 2 步
      // 收尾:收回托管,后台链将在下一个检查点停
      await reg.setAutoPilot(created.room.roomId, 0, false);
    },
    15000,
  );

  it("托管事件进观测流水(autopilot 事件带座位/开关)", async () => {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
      events.push(event as Record<string, unknown>),
    );
    const created = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: { seed: 5 } });
    reg.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await reg.setAutoPilot(created.room.roomId, 0, true);
    const ev = events.find((e) => e.ev === "autopilot");
    expect(ev).toMatchObject({ seat: 0, on: true });
  }, 30000);

  it("ADR-0014 房间生命周期行进对局日志 + logSink 增量钩子(开局/托管/解散)", async () => {
    const flushed: Array<{ gameId: string; len: number }> = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), undefined, (room) =>
      flushed.push({ gameId: room.engine!.gameId, len: room.engine!.log.length }),
    );
    const created = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 11 },
    });
    reg.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    const engine = reg.get(created.room.roomId)!.engine!;
    const roomRows = () => engine.log.filter((l) => l.category === "room");
    // 开局行:座位构成 + 机读 type=start
    expect(
      roomRows().some((l) => l.detail.includes('"type":"start"') && l.brief.includes("房间开局")),
    ).toBe(true);
    // 托管开关行(开 → 关,机读 type=autopilot 供重放调整驱动座位集)
    await reg.setAutoPilot(created.room.roomId, 0, true);
    expect(
      roomRows().some(
        (l) => l.detail.includes('"type":"autopilot"') && l.detail.includes('"on":true'),
      ),
    ).toBe(true);
    await reg.setAutoPilot(created.room.roomId, 0, false);
    expect(
      roomRows().some(
        (l) => l.detail.includes('"type":"autopilot"') && l.detail.includes('"on":false'),
      ),
    ).toBe(true);
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
    const created = reg1.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 9 },
    });
    reg1.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg1.startGame(created.room.roomId, created.token, undefined, testMapProvider);
    await reg1.setAutoPilot(created.room.roomId, 0, true);
    const reg2 = new RoomRegistry(persistence);
    reg2.restoreAll(testMapProvider);
    expect(reg2.get(created.room.roomId)!.autoPilot.has(0)).toBe(true);
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

describe("RoomRegistry · cmd 提交者座位校验(#454)", () => {
  /** 火烧连营以另一席的都城为中心，由房间命令打开识破窗并登记时限。 */
  async function openCounterWindow(reg: RoomRegistry, roomId: string) {
    const e = reg.get(roomId)!.engine!;
    if (e.players.length !== 2) throw new Error("测试预期 2 座房间");
    const userSeat = e.activeIndex;
    const victimSeat = 1 - userSeat;
    giveJinnang(e, userSeat, ["火烧连营"]);
    giveJinnang(e, victimSeat, ["识破诡计"]);
    armPhase(e, { turnPhase: "AwaitingJinnang" });
    const center = e.players[victimSeat].capitalIndex;
    const capital = e.board.at(center).propertyId;
    if (capital === null) throw new Error("测试预期受影响座位已定都");
    grantProperty(e, victimSeat, capital, 3);
    setDefense(e, victimSeat, capital, 20);
    await reg.applyCommand(roomId, { type: "useJinnang", cardId: "火烧连营" });
    await reg.applyCommand(roomId, {
      type: "useJinnang",
      cardId: "火烧连营",
      targets: [center],
    });
    expect(e.turnPhase as string).toBe("AwaitingReaction");
    return { e, userSeat, victimSeat };
  }

  it("非决策归属座位发命令 → 403,引擎不动", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    const e = reg.get(roomId)!.engine!;
    const owner = e.decisionOwner;
    const other = owner === 0 ? 1 : 0;
    await expectRoomError(
      () => reg.applyCommandFromSeat(roomId, other, { type: "rollAndMove" }),
      403,
    );
    expect(e.decisionOwner).toBe(owner); // 引擎状态未动
  });

  it("决策归属座位放行:rollAndMove 正常起摇", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    const e = reg.get(roomId)!.engine!;
    await reg.applyCommandFromSeat(roomId, e.decisionOwner, { type: "rollAndMove" });
    // 命令已达引擎:cmd 流记行(每回合开头都是锦囊相位,turnPhase 值会循环回原值,不作断言)
    expect(e.log.some((l) => l.category === "cmd" && l.detail.includes('"rollAndMove"'))).toBe(
      true,
    );
  });

  it("Setup 期非当前选都位发命令 → 403", async () => {
    const { reg, roomId } = await startRoom({ seats: 2, bot: [] });
    const e = reg.get(roomId)!.engine!;
    const cur = e.currentSetupPlayerIndex;
    const other = cur === 0 ? 1 : 0;
    await expectRoomError(
      () => reg.applyCommandFromSeat(roomId, other, { type: "rollAndMove" }),
      403,
    );
  });

  it("无身份座位(-1/越界)发命令 → 400", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    await expectRoomError(() => reg.applyCommandFromSeat(roomId, -1, { type: "rollAndMove" }), 400);
    await expectRoomError(() => reg.applyCommandFromSeat(roomId, 9, { type: "rollAndMove" }), 400);
  });

  it("反应窗:非被询问座位替他人应答 → 403,窗不动(#445 Bug3 实锤面)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    const { e, victimSeat } = await openCounterWindow(reg, roomId);
    const outsider = 1 - victimSeat;
    // 圈外座位伪造受害者应答(替打识破):拒,窗与牌都不动
    await expectRoomError(
      () =>
        reg.applyCommandFromSeat(roomId, outsider, {
          type: "respondReaction",
          seat: victimSeat,
          use: true,
          cardId: "识破诡计",
          target: { kind: "city", id: e.players[victimSeat].capitalIndex },
        }),
      403,
    );
    expect(e.pendingReaction).not.toBeNull(); // 窗未被伪造应答收走
    expect(e.players[victimSeat].jinnangHand).toEqual(["识破诡计"]); // 牌未被冒用
    // 圈外座位以自己名义应答(非被询问者):同样拒
    await expectRoomError(
      () =>
        reg.applyCommandFromSeat(roomId, outsider, {
          type: "respondReaction",
          seat: outsider,
          use: false,
        }),
      403,
    );
    expect(e.pendingReaction).not.toBeNull();
  });

  it("反应窗:被询问座位本人应答放行(不用 → 照常结算)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    const { e, victimSeat } = await openCounterWindow(reg, roomId);
    const decisionPoint = seatDecisionPointOf(reg.get(roomId)!, victimSeat)!;
    const result = await reg.submitFromSeat(roomId, victimSeat, {
      roomId,
      seat: victimSeat,
      submissionId: "本人弃用",
      decisionPoint,
      cmd: { type: "respondReaction", seat: victimSeat, use: false },
    });
    expect(result.outcome).toBe("accepted");
    expect(e.pendingReaction).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // 结算收卷(同 reaction-window.test 口径)
  });

  it("无反应窗时 respondReaction → 403(无人被询问=无归属)", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 2, bot: [] });
    await pickAllHumanCapitals(reg, roomId);
    const e = reg.get(roomId)!.engine!;
    expect(e.pendingReaction).toBeNull();
    await expectRoomError(
      () => reg.applyCommandFromSeat(roomId, 0, { type: "respondReaction", seat: 0, use: false }),
      403,
    );
  });
});

describe("RoomRegistry · 持久化恢复(restoreAll)", () => {
  it("新 registry 共享同一 persistence → restoreAll 恢复房间(引擎/hostSeat/相位/mapId)", async () => {
    const persistence = new InMemoryPersistence();
    const reg1 = new RoomRegistry(persistence);
    const created = reg1.createRoom({
      seatCount: 3,
      botIdx: new Set([2]),
      hostConfig: { seed: 7 },
    });
    reg1.joinSeat(created.room.roomId);
    reg1.setMap(created.room.roomId, "guanzhong", created.token, VALID_MAP_IDS);
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
    expect(restored.mapId).toBe("guanzhong");
  });
});

describe("RoomRegistry · 决策停摆看门狗(#118)", () => {
  /** 收集型观察者(同「观测事件」describe)。 */
  function observedWith(opts?: { decisionTimeoutMs?: number }) {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(
      new InMemoryPersistence(),
      (_roomId, event) => events.push(event as Record<string, unknown>),
      undefined,
      opts,
    );
    return { reg, events };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("人类座位停摆超时 → 看门狗代开托管(by:watchdog 观测行+对局日志行+对局继续)", async () => {
    // 手泵时钟:代开托管后链 2s/步全经注入时钟(接管时代 0ms 直推的旧泵法不再适用)
    const clock = new ManualClock();
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(
      new InMemoryPersistence(),
      (_roomId, event) => events.push(event as Record<string, unknown>),
      undefined,
      { decisionTimeoutMs: 25, clock },
    );
    const created = reg.createRoom({
      seatCount: 3,
      botIdx: new Set([2]),
      hostConfig: { seed: 42 },
    });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId); // seat1 人类(guest)
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider); // 停在 seat0(Roll)
    const e = reg.get(roomId)!.engine!;
    expect(e.phase).toBe("Setup"); // 选都阶段即停 seat0(human)
    // 泵送:25ms 停摆窗到点 → 代开托管 → 链推进到下一真人又停 → 再代开 → 直至出 Setup
    for (let i = 0; i < 4000 && e.phase === "Setup"; i++) {
      clock.fireAll();
      await macroTick();
    }
    const aps = events.filter((ev) => ev.ev === "autopilot");
    expect(aps.length).toBeGreaterThanOrEqual(1);
    expect(aps.every((ev) => ev.by === "watchdog" && ev.on === true)).toBe(true); // 只开不关,出处=看门狗
    // 开关确实拨了(单一状态域:不再有第二套接管集合)
    const stalledSeat = aps[0].seat as number;
    expect(reg.get(roomId)!.autoPilot.has(stalledSeat)).toBe(true);
    // 对局日志行(ADR-0014):机读 autopilot(by:watchdog)+ brief 记停摆代开
    expect(
      e.log.some(
        (l) =>
          l.category === "room" &&
          l.detail.includes('"type":"autopilot"') &&
          l.detail.includes('"by":"watchdog"') &&
          l.brief.includes("决策停摆"),
      ),
    ).toBe(true);
    // 对局确有进展(托管后 driveBots 续推:选都走完进 Playing,不再永久挂)
    expect(["Playing", "GameOver"]).toContain(e.phase);
  });

  it("「你可」选择闸窗停摆(#1378 真修):超时代发「暂不发」(标记保留),不代开托管", async () => {
    // 回归例(不修必挂:旧行为=停摆代开托管→驱动链按 bot 策略代答=发动,本例断言
    // 零 autopilot 事件 + 发动未发生,双锚都红)。布景同 caopi-skill-choice-online
    // (armHero 直授+setStamina 过阈开窗),停摆武装经 applyCommand 触发的
    // 驱动链出口(链停真人座位→#118 stall 上表),超时到点泵送。
    const clock = new ManualClock();
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(
      new InMemoryPersistence(),
      (_roomId, event) => events.push(event as Record<string, unknown>),
      undefined,
      { decisionTimeoutMs: 25, clock },
    );
    const created = reg.createRoom({
      seatCount: 3,
      botIdx: new Set([2]),
      hostConfig: { seed: 42 },
    });
    const roomId = created.room.roomId;
    reg.joinSeat(roomId); // seat1 人类(guest)
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider);
    const e = reg.get(roomId)!.engine!;
    for (let i = 0; i < 20 && e.phase === "Setup"; i++)
      await submitCapitalForSetup(reg, roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]!);
    expect(e.phase).toBe("Playing");
    // 注:decisionTimeoutMs>0 时链尾常驻武装 #118,不做事后时钟排干(排干即代开托管,
    // 旧行为的既有例);残留挂表由下一次链首 clear(bot-driver 链首撤 stall/autoRoll)
    // 收口,链跑一轮后按 size 精确断言。
    // 布景(被测环前拍):seat0 直授放逐 → 损失 70 过阈停窗
    e.activeIndex = 0;
    armHero(e, 0, "caopi", ["fangzhu"]);
    setStamina(e, 0, 30);
    expect<string>(e.turnPhase).toBe("AwaitingSkillChoice");
    // 链跑一轮触发 #118 武装(命令本体被相位守卫警告拒绝:座位 1 非决策者,窗不动)
    await reg.applyCommand(roomId, { type: "respondSkillChoice", seat: 1, use: false });
    expect<string>(e.turnPhase).toBe("AwaitingSkillChoice");
    expect(clock.size).toBe(1); // 恰 stall(seat0)一表项
    // 泵送:停摆窗到点 → 代发「暂不发」(与手点同一条 respondSkillChoice 命令路径)
    for (let i = 0; i < 4000 && e.pendingSkillChoices.length > 0; i++) {
      clock.fireAll();
      await macroTick();
    }
    // 不代开托管:全程零 autopilot 事件(旧行为的发动路径由此红)
    expect(events.some((ev) => ev.ev === "autopilot")).toBe(false);
    // 暂不发落账:放弃=标记保留(spec 语义),战报留痕,窗收续推
    expect(e.pendingSkillChoices).toHaveLength(0);
    expect(skillMarksOf(heroSlotOf(e.players[0], "caopi"), "fangzhu")).toBe(70);
    expect(e.log.some((l) => l.detail.includes("skillChoiceDecline"))).toBe(true);
    expect(e.players[1].skipTurns).toBe(0); // 发动未发生
    expect(e.turnPhase).not.toBe("AwaitingSkillChoice");
  });

  it("decisionTimeoutMs=0(缺省)→ 永不代开托管(真人座位正常等待,历史行为)", async () => {
    const { reg, events } = observedWith();
    const created = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 42 },
    });
    const roomId = created.room.roomId;
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider);
    await sleep(120);
    expect(events.some((ev) => ev.ev === "autopilot")).toBe(false);
    expect(reg.get(roomId)!.autoPilot.size).toBe(0);
  });

  it("解散房间撤看门狗:超时窗口内 dismiss → 无迟到托管、无未处理拒绝", async () => {
    const { reg, events } = observedWith({ decisionTimeoutMs: 400 });
    const created = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 42 },
    });
    const roomId = created.room.roomId;
    reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
    await reg.startGame(roomId, created.token, undefined, testMapProvider); // 武装(400ms 窗口)
    reg.dismissRoom(roomId, created.token); // 窗口内解散 → clearStall
    await sleep(500);
    expect(reg.get(roomId)).toBeUndefined();
    expect(events.some((ev) => ev.ev === "autopilot")).toBe(false);
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

  it("clientView 将权威快照投影给接收席位，开局前返回大厅", async () => {
    const { reg, roomId, hostToken } = await roomWithHands();
    const room = reg.get(roomId)!;
    const online = new Set([0]);
    const view0 = clientView(room, online, 0) as Record<string, unknown>;
    const god = room.engine!.snapshot();
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

describe("窥探投影(ADR-0016 · #575 即时窥探)", () => {
  it("阅览权随 peekApplied 事件走:viewer 座位保留手牌内容,他人裁空;快照恒无窥探放行", async () => {
    const { reg, roomId } = await setupStartedRoom({ seats: 3, bot: [2] });
    const e = reg.get(roomId)!.engine!;
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    giveJinnang(e, 0, ["军情密探"]);
    giveJinnang(e, 1, ["连环计"]);
    giveJinnang(e, 2, []);
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    // 事件=窥探的唯一载体:viewer 手牌内容随行,redact 逐座位裁(ADR-0016)
    const batch = e.gameEvents;
    const ev = batch.find((x) => x.kind === "peekApplied");
    expect(ev).toMatchObject({
      kind: "peekApplied",
      viewerSeat: 0,
      targetSeat: 1,
      cardId: "军情密探",
    });
    const hand = ev!.kind === "peekApplied" ? ev!.hand : [];
    expect(hand).toEqual(["连环计"]);
    const forViewer = redactEvents(batch, 0).find((x) => x.kind === "peekApplied");
    const forThird = redactEvents(batch, 2).find((x) => x.kind === "peekApplied");
    expect(forViewer).toMatchObject({ hand }); // 窥方保留内容
    expect(forThird).toMatchObject({ hand: [] }); // 第三者裁空
    // 快照恒无窥探放行(#575 持续窗口退役):viewer 视角他人手牌照旧 count-only
    const snap = e.snapshot();
    const view0 = redactSnapshotForSeat(snap, 0);
    const view2 = redactSnapshotForSeat(snap, 2);
    expect(view0.players[1].jinnangHand).toEqual([]); // 被窥者内容不再随快照放行
    expect(view0.players[2].jinnangHand).toEqual([]);
    expect(view2.players[0].jinnangHand).toEqual([]); // 阅览事件未开放第三方手牌
    expect(view2.players[1].jinnangHand).toEqual([]);
  });
});

describe("代打行为单源(#580):托管(含看门狗代开)同款 bot 策略", () => {
  it("托管接手出牌阶段时按策略打出横征暴敛", async () => {
    const { reg, roomId } = await playingRoomWithClock(new ManualClock());
    const e = reg.get(roomId)!.engine!;
    armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    giveJinnang(e, 0, ["横征暴敛"]);
    giveJinnang(e, 1, []);
    await reg.setAutoPilot(roomId, 0, true);
    expect(e.gameEvents).toContainEqual(
      expect.objectContaining({ kind: "jinnangAnnounced", seat: 0, cardId: "横征暴敛" }),
    );
    expect(e.players[0].jinnangHand).toEqual([]);
  });

  it("代驾座位按策略应答反应窗:识破自保划算才拆,策略答案透传 respondReaction(cmd 行锚)", async () => {
    const clock = new ManualClock();
    const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, { clock });
    const { roomId } = await playingRoom(reg);
    const e = reg.get(roomId)!.engine!;
    // seat0 持横征暴敛(可用即用,公告开识破窗),seat1 持识破诡计(被询座位,托管代驾)
    e.players[0].jinnangHand = ["横征暴敛"];
    e.players[0].jinnangHandCount = 1;
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    await reg.setAutoPilot(roomId, 0, true);
    await reg.setAutoPilot(roomId, 1, true);
    // 泵送:横征暴敛公告 → 反应窗 → 驱动链代发 seat1 的策略答案(估损 200 > 底价 100 → 拆)
    for (let i = 0; i < 4000 && e.players[1].jinnangHand.length > 0 && !e.isOver; i++) {
      clock.fireAll();
      await macroTick();
    }
    expect(e.players[1].jinnangHand.length).toBe(0); // 代驾把识破打了

    const cmdRow = e.log.find(
      (l) => l.category === "cmd" && l.detail.includes('"type":"respondReaction"'),
    );
    expect(cmdRow?.detail).toContain('"use":true');
    expect(cmdRow?.detail).toContain('"cardId":"识破诡计"');
    expect(JSON.parse(cmdRow!.detail).target).toEqual({ kind: "seat", id: 1 });
  });

  // 手泵两座托管到终局，核对事件批收敛和重连摘要的终局结果（#580、ADR-0020）。

  itSlow(
    "托管全程骑局到终局:事件批自足收敛,双端 gameOver、胜者一致(#580 托管 cutover e2e 终局覆盖下沉)",
    async () => {
      // 整局实骑 ~50s 量级:#789 数值平衡后该种子局时长贴近 bun 默认 60s 预算,冷跑偶发超时——
      // 预算放宽到 120s(非慢化,只给满载首跑留余量)。
      const clock = new ManualClock();
      const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, { clock });
      const { roomId, token, guestToken } = await playingRoom(reg);

      // 首连下发摘要，之后在校准节点随事件批下发快照。
      const feeds = [
        { seat: 0, token, msgs: [] as ServerMsg[] },
        { seat: 1, token: guestToken, msgs: [] as ServerMsg[] },
      ];
      for (const f of feeds) {
        const ep: SeatEndpoint = {
          seat: f.seat,
          open: true,
          send: (data) => f.msgs.push(JSON.parse(data) as ServerMsg),
        };
        reg.connectSeat(roomId, f.seat, f.token, ep);
      }
      // 首连整房摘要恰一份(每端点 connectSeat 同步首发,未开局广播不掺行)
      expect(
        feeds.every((f) => f.msgs.length === 1 && f.msgs[0]!.type === "snapshot"),
        "首连整房摘要恰一份",
      ).toBe(true);

      // 双端托管(onUpdate 接传输面广播:下行拍由此驱动)
      const broadcast = () => reg.transportBroadcast(roomId);
      await reg.setAutoPilot(roomId, 0, true, broadcast);
      await reg.setAutoPilot(roomId, 1, true, broadcast);

      // 手泵骑到终局(零墙钟;预算与既有泵送终局用例同款),随后排空在途 flush 残拍
      // (flush 定时器是真 setTimeout(0),循环出口处末批可能尚未下行)
      const e = reg.get(roomId)!.engine!;
      for (let i = 0; i < 20_000 && !e.isOver; i++) {
        clock.fireAll();
        await macroTick();
      }
      expect(e.phase).toBe("GameOver");
      for (let i = 0; i < 5; i++) await macroTick();

      const winner = e.winner;
      if (winner == null) throw new Error("托管终局缺少胜者");
      for (const f of feeds) {
        const snaps = f.msgs.filter((m) => m.type === "snapshot");
        const batches = f.msgs.filter((m) => m.type === "events");
        expect(
          f.msgs.every((m) => m.type === "snapshot" || m.type === "events" || m.type === "lobby"),
        ).toBe(true);
        for (const [index, msg] of f.msgs.entries()) {
          if (
            msg.type === "events" &&
            msg.events.some((ev) => CALIBRATION_EVENT_KINDS.has(ev.kind))
          )
            expect(f.msgs[index + 1]?.type, "校准节点的事件批随发快照").toBe("snapshot");
        }
        expect(
          f.msgs.some(
            (msg, index) => msg.type === "events" && f.msgs[index + 1]?.type === "events",
          ),
          "局中存在无需快照的事件批",
        ).toBe(true);
        expect(
          snaps.some((msg) => CALIBRATION_WINDOWS.has(msg.turnPhase)),
          "决策窗校准相位快照在场",
        ).toBe(true);
        const terminal = batches.flatMap((batch) =>
          batch.events.filter((ev) => ev.kind === "gameOver"),
        );
        expect(terminal, "两端各收到一次终局事件").toHaveLength(1);

        const first = f.msgs[0];
        if (first?.type !== "snapshot") throw new Error("端点缺少首连快照");
        const replica = new GameEngine(MAP.board, MAP.catalog, createDice(42), {
          seats: [
            { name: "座 1", isBot: false },
            { name: "座 2", isBot: false },
          ],
          targetNetWorth: MAP.targetNetWorth,
          startingCash: MAP.startingCash,
          startingTreasures: 0,
        });
        hydrateSeatReplica(replica, first);
        for (const batch of batches) foldEventBatch(replica, batch.events);
        expect(replica.isOver).toBe(true);
        expect(replica.phase).toBe("GameOver");
        expect(replica.winner?.id, "事件批副本与权威胜者一致").toBe(winner.id);

        const reconnect: ServerMsg[] = [];
        reg.disconnectSeat(roomId, f.seat);
        reg.connectSeat(roomId, f.seat, f.token, {
          seat: f.seat,
          open: true,
          send: (data) => reconnect.push(JSON.parse(data) as ServerMsg),
        });
        const summary = reconnect[0];
        if (summary?.type !== "snapshot") throw new Error("端点缺少重连快照");
        expect(summary.phase).toBe("GameOver");
        expect(summary.winner).toBe(winner.id);
      }
    },
    120_000,
  );
});

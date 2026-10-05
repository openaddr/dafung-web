// 掉线座位保留窗口单测(#380,ADR-0002/0005):对局中断线 → 保留窗武装(注入时钟,
// ManualClock 零真实等待);窗口内重连无缝夺回(attachSeat 撤表);到期 bot 自动接管
// (等价房主 takeover:takeover(auto) 观测行 + 对局日志行 + 解冻续推);token 是座位
// 归属唯一凭证——保留窗到期不使 token 失效,自动接管后原 token 仍可鉴权+夺回。
// 窗口期冻结停摆语义不变(ADR-0002 默认冻结)。InMemory 持久化,零 fs / 零 WS。
import { describe, it, expect } from "bun:test";
import { RoomRegistry } from "../scripts/room";
import type { RoomClock } from "../scripts/room";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import { MAP } from "../scripts/engine-helpers";
import type { LoadedMap } from "../src/core/board-loader";

/** 手动时钟(测试注入):定时全部挂表,fireAll 手动推进——接线断言零真实等待。 */
class ManualClock implements RoomClock {
  private readonly pending = new Map<unknown, () => void>();
  private seq = 0;
  setTimeout(cb: () => void, _ms: number): unknown {
    const id = ++this.seq;
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

class InMemoryPersistence implements RoomPersistence {
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const testMapProvider = (_id: string): LoadedMap => MAP;
const VALID_MAP_IDS = new Set(["sanguo"]);

/** 收集型观察者 + 注入手册时钟的 registry:保留窗到点全靠 fireAll 手动推进。 */
function observedWith(opts: { retentionWindowMs: number }) {
  const events: Record<string, unknown>[] = [];
  const clock = new ManualClock();
  const reg = new RoomRegistry(
    new InMemoryPersistence(),
    (_roomId, event) => events.push(event as Record<string, unknown>),
    undefined,
    { ...opts, clock },
  );
  return { reg, events, clock };
}

/** 开一局停在选都阶段的房(seats 座、botIdx 标 bot),返回首个待选都真人座位。 */
async function startedRoom(reg: RoomRegistry, seats: number, botIdx: number[]) {
  const created = reg.createRoom({
    seatCount: seats,
    botIdx: new Set(botIdx),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  for (let i = 1; i < seats; i++) if (!botIdx.includes(i)) reg.joinSeat(roomId);
  reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = reg.get(roomId)!.engine!;
  return {
    roomId,
    token: created.token,
    engine: e,
    tokenOf: (seat: number) => reg.get(roomId)!.seats[seat].token!,
  };
}

describe("RoomRegistry · 掉线座位保留窗(#380)", () => {
  it("对局中断线 → 保留窗武装(挂注入时钟);大厅断线不武装", async () => {
    const { reg, clock } = observedWith({ retentionWindowMs: 60_000 });
    // 大厅(未开局)断线:不武装
    const lobby = reg.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
    await reg.markSeatOffline(lobby.room.roomId, 0, new Set());
    expect(clock.size).toBe(0);
    // 对局中断线:武装
    const { roomId } = await startedRoom(reg, 3, [2]);
    await reg.markSeatOffline(roomId, 1, new Set([0]));
    expect(clock.size).toBe(1);
  });

  it("retentionWindowMs=0(缺省)→ 不武装、到期无接管(历史纯冻结行为)", async () => {
    const events: Record<string, unknown>[] = [];
    const reg = new RoomRegistry(new InMemoryPersistence(), (_roomId, event) =>
      events.push(event as Record<string, unknown>),
    );
    const { roomId } = await startedRoom(reg, 3, [2]);
    await reg.markSeatOffline(roomId, 1, new Set([0]));
    await sleep(30);
    expect(events.some((ev) => ev.ev === "takeover")).toBe(false);
    expect(reg.get(roomId)!.takeover.size).toBe(0);
  });

  it("窗口期内回合到来维持冻结停摆(不驱动、状态不动)", async () => {
    const { reg, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, engine } = await startedRoom(reg, 3, [2]);
    const stalled = engine.currentSetupPlayerIndex; // 首个待选都真人 = 冻结点
    await reg.markSeatOffline(roomId, stalled, new Set([0, 1].filter((s) => s !== stalled)));
    expect(engine.phase).toBe("Setup");
    expect(clock.size).toBe(1); // 保留窗已挂,但不 fire
    await sleep(30);
    expect(engine.phase).toBe("Setup"); // 冻结停摆:无人代打
    expect(engine.currentSetupPlayerIndex).toBe(stalled);
    expect(reg.get(roomId)!.takeover.size).toBe(0);
  });

  it("窗口到期 → bot 自动接管(auto 观测行 + 对局日志行 + 解冻续推)", async () => {
    const { reg, events, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, engine } = await startedRoom(reg, 3, [2]);
    const stalled = engine.currentSetupPlayerIndex;
    await reg.markSeatOffline(roomId, stalled, new Set([0, 1].filter((s) => s !== stalled)));
    clock.fireAll(); // 保留窗到点
    await sleep(30); // fire 是异步链(接管 + driveBots)
    expect(reg.get(roomId)!.takeover.has(stalled)).toBe(true);
    const tk = events.find((ev) => ev.ev === "takeover");
    expect(tk).toMatchObject({ seat: stalled, auto: true });
    // 对局日志行(ADR-0014):接管行入引擎日志,brief 记保留窗到期
    const roomRows = engine.log.filter((l) => l.category === "room");
    expect(
      roomRows.some((l) => l.detail.includes('"type":"takeover"') && l.brief.includes("保留窗口")),
    ).toBe(true);
    // 解冻续推:冻结点的选都由服务器代打完成(草稿推进/相位离开该座位)
    expect(
      engine.players[stalled].capitalIndex >= 0 || engine.currentSetupPlayerIndex !== stalled,
    ).toBe(true);
  });

  it("窗口内重连 → 撤本座表项,到期不接管;他座计时不受影响", async () => {
    const { reg, events, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, engine } = await startedRoom(reg, 3, []); // 三真人
    const cur = engine.currentSetupPlayerIndex;
    const others = [0, 1, 2].filter((s) => s !== cur);
    await reg.markSeatOffline(roomId, others[0], new Set([cur]));
    await reg.markSeatOffline(roomId, others[1], new Set([cur]));
    expect(clock.size).toBe(2); // 各自计时
    reg.attachSeat(roomId, others[0]); // 座位 0 重连:只撤自己的窗
    expect(clock.size).toBe(1);
    clock.fireAll();
    await sleep(30);
    expect(reg.get(roomId)!.takeover.has(others[0])).toBe(false); // 重连者不接管
    expect(reg.get(roomId)!.takeover.has(others[1])).toBe(true); // 未归者接管
    expect(events.some((ev) => ev.ev === "takeover" && ev.seat === others[0])).toBe(false);
  });

  it("token 口径:窗口到期自动接管后,原 token 仍可鉴权并重连夺回(ADR-0005)", async () => {
    const { reg, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, engine, tokenOf } = await startedRoom(reg, 3, [2]);
    const stalled = engine.currentSetupPlayerIndex;
    const token = tokenOf(stalled);
    await reg.markSeatOffline(roomId, stalled, new Set());
    clock.fireAll();
    await sleep(30);
    expect(reg.get(roomId)!.takeover.has(stalled)).toBe(true); // 已被自动接管
    expect(reg.validateSeat(roomId, stalled, token)).toBe(true); // token 未失效
    reg.attachSeat(roomId, stalled); // 持原 token 重连
    expect(reg.get(roomId)!.takeover.has(stalled)).toBe(false); // 夺回
  });

  it("解散撤保留窗:窗口内 dismiss → 到点动作重校验退场,无迟到接管", async () => {
    const { reg, events, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, token } = await startedRoom(reg, 3, [2]);
    await reg.markSeatOffline(roomId, 1, new Set([0]));
    expect(clock.size).toBe(1);
    reg.dismissRoom(roomId, token);
    expect(clock.size).toBe(0); // 随房撤表
    clock.fireAll(); // 迟到的火(若有)应被房间存在重校验挡下
    await sleep(30);
    expect(reg.get(roomId)).toBeUndefined();
    expect(events.some((ev) => ev.ev === "takeover")).toBe(false);
  });

  it("已服务器驱动的座位断线不武装:window 判定豁免(接管/托管不重复计时)", async () => {
    const { reg, clock } = observedWith({ retentionWindowMs: 60_000 });
    const { roomId, engine } = await startedRoom(reg, 3, [2]);
    // 冻结的真人座位断线:武装(基线)
    const stalled = engine.currentSetupPlayerIndex;
    await reg.markSeatOffline(roomId, stalled, new Set());
    expect(clock.size).toBe(1);
    // 已由服务器驱动的座位断线:window 判定豁免,不新增计时
    const controlled = reg
      .get(roomId)!
      .engine!.players.findIndex((p, i) => i !== stalled && !p.isBot);
    await reg.setAutoPilot(roomId, controlled, true, "fast"); // 托管 → 服务器驱动
    const before = clock.size;
    await reg.markSeatOffline(roomId, controlled, new Set([0]));
    expect(clock.size).toBe(before);
  });
});

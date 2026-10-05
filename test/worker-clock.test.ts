// Worker 时钟 + 节拍单源单测(#399 单机统一 C):
//   ① createWorkerClock 真实 Worker(bun 原生支持 blob worker):到点回发执行回调、
//      clear 撤回调、dispose 可停;
//   ② RoomRegistry clock 注入端到端:手动时钟驱动 #188 自动起摇看门狗——
//      「失焦推进可测」的接缝即注入面(真实后台行为归 e2e/手动验证,单测钉接线)。
// 节拍常量单源(core/timings)由 watchdogs/bot-driver 改引承担,此处不再重复数值断言。
import { describe, it, expect } from "bun:test";
import { createWorkerClock } from "../src/app/net/worker-clock";
import type { RoomClock } from "../scripts/room";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import { RoomRegistry } from "../scripts/room";
import { MAP } from "../scripts/engine-helpers";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("createWorkerClock(真实 Worker)", () => {
  it("到点回发并执行回调(Worker 节拍不受主线程定时器通道约束)", async () => {
    const clock = createWorkerClock();
    try {
      let fired = 0;
      clock.setTimeout(() => {
        fired++;
      }, 25);
      const deadline = Date.now() + 8000;
      while (fired === 0 && Date.now() < deadline) await sleep(20);
      expect(fired).toBe(1);
    } finally {
      clock.dispose();
    }
  }, 15_000);

  it("clear 撤回调:set 后同拍撤,到点不执行", async () => {
    const clock = createWorkerClock();
    try {
      let fired = 0;
      const h = clock.setTimeout(() => {
        fired++;
      }, 400);
      clock.clearTimeout(h); // set/clear 消息有序,worker 先撤表:回调必不到点
      await sleep(900);
      expect(fired).toBe(0);
    } finally {
      clock.dispose();
    }
  }, 15_000);
});

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

describe("RoomRegistry clock 注入(#399:编排节拍经注入时钟)", () => {
  it("#188 自动起摇看门狗走注入时钟:手动 fireAll 即代发 rollAndMove,对局推进", async () => {
    const clock = new ManualClock();
    const reg = new RoomRegistry(new InMemoryPersistence(), undefined, undefined, { clock });
    const created = reg.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 7 }, // 人类先手(react-helpers 离线核算同源)
    });
    reg.setMap(created.room.roomId, "sanguo", created.token, new Set(["sanguo"]));
    await reg.startGame(created.room.roomId, created.token, undefined, () => MAP);
    const e = created.room.engine!;
    // 人类选都(三选一首项)→ 房间驱动余下 bot + 过渡进 Playing,停在人类 Roll 等待态:
    // 自动起摇看门狗已挂注入时钟(全局定时器零占用)
    await reg.pickCapital(created.room.roomId, 0, e.offeredCapitals[0]!);
    expect(e.phase).toBe("Playing");
    expect(e.turnPhase).toBe("Roll");
    const turn0 = e.turnNumber;
    expect(clock.size).toBeGreaterThanOrEqual(1);
    clock.fireAll(); // 手动推进节拍:看门狗到点 → applyCommand rollAndMove → 链式推进
    await sleep(20); // fire 是异步链(applyCommand+driveBots),让出事件循环
    // auto-roll 代发生效:回合量前进(快速链可能已绕回下一个 Roll 等待态,以轮次为准)
    expect(e.turnNumber).toBeGreaterThan(turn0);
    reg.dismissRoom(created.room.roomId, created.token);
  }, 20_000);
});

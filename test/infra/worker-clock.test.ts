// Worker 时钟 + 节拍单源单测(#399 单机统一 C):
//   ① RoomRegistry clock 注入端到端:手动时钟驱动 #188 自动起摇看门狗——
//      「失焦推进可测」的接缝即注入面(真实后台行为归 e2e/手动验证,单测钉接线)。
//   ② latestWorkerClock(#421 寻址)登记/dispose 语义。
// #987 清退:createWorkerClock 真实 Worker 计时三例(到点回发/clear 撤回调/暂停闸)
// 整体退役——负载敏感可致挂(master 全量三连挂/单文件连绿,2026-11-01 定性),计时
// 即主题、无一两行确定性改造可根除;暂停闸语义由全线 e2e freezeClock 用例承担。
// 节拍常量单源(core/timings)由 watchdogs/bot-driver 改引承担,此处不再重复数值断言。
import { describe, it, expect } from "bun:test";
import { createWorkerClock, latestWorkerClock } from "../../src/app/net/worker-clock";
import type { RoomClock } from "../../scripts/room";
import type { RoomPersistence } from "../../scripts/room-persistence";
import type { RoomRecord } from "../../scripts/room-record";
import { RoomRegistry } from "../../scripts/room";
import { MAP } from "../../scripts/engine-helpers";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("createWorkerClock(真实 Worker)", () => {
  it("latestWorkerClock(#421 寻址):创建即登记,dispose 让位", () => {
    const before = latestWorkerClock();
    const clock = createWorkerClock();
    expect(latestWorkerClock()).toBe(clock);
    clock.dispose();
    expect(latestWorkerClock()).toBe(before); // 回落到上一个未销毁时钟(无则 null)
  });
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
    reg.setMap(created.room.roomId, "guanzhong", created.token, new Set(["guanzhong"]));
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
    // auto-roll 代发生效:回合量前进(快速链可能已绕回下一个 Roll 等待态,以轮次为准)。
    // #473 后首摇可能落在带抉择的格(无主城/宝物城等)停住人类决策:清决策点再补拍
    // fire,让链走完一个回合(代发本身已由离开 Roll 证明)。
    for (let i = 0; i < 4 && e.turnNumber === turn0; i++) {
      if (e.turnPhase === "AwaitingDecision") e.endDecision();
      else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(0);
      else if (e.turnPhase === "AwaitingTreasureOwner") e.resolveTreasureOwner({ type: "skip" });
      clock.fireAll();
      await sleep(20);
    }
    expect(e.turnNumber).toBeGreaterThan(turn0);
    reg.dismissRoom(created.room.roomId, created.token);
  }, 20_000);
});

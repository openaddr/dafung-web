// 服务器崩溃恢复实测收口(#380,ADR-0007 持久化通路):落盘 → 新 registry 恢复 →
// 对局继续推进,覆盖三形态——进行中对局(双路续跑终态一致)/ 已终局(原样保留)/
// 损坏文件跳过(坏 JSON 走 persistence 层「跳过+console.warn」通道,结构损坏走
// room 层 hydrate 抛错→跳过并移除)。另有 #388 恢复播种(seenBatches/settledTurnPhase)
// 与恢复路径的咬合测试。全程 FileRoomPersistence 真落盘(worktree tmp/ 下,用后即清),
// 定时一律注入 ManualClock,零真实等待。
import { describe, it, expect, spyOn } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoomRegistry } from "../scripts/room";
import type { RoomClock, RoomSession } from "../scripts/room";
import { FileRoomPersistence } from "../scripts/room-persistence";
import type { RoomPersistence } from "../scripts/room-persistence";
import type { RoomRecord } from "../scripts/room-record";
import type { GameEvent } from "../src/core/game-events";
import type { GameSnapshot } from "../src/core/snapshot";
import { MAP } from "../scripts/engine-helpers";
import type { LoadedMap } from "../src/core/board-loader";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const testMapProvider = (_id: string): LoadedMap => MAP;
const VALID_MAP_IDS = new Set(["sanguo"]);

/** 手动时钟(测试注入):定时全部挂表,fireAll 手动推进。 */
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

let dirSeq = 0;
function tmpDir(label: string): string {
  return join(import.meta.dir, "..", "tmp", `recovery-${label}-${Date.now()}-${dirSeq++}`);
}

/** 开一局双人房(全真人),选都完毕进 Playing。 */
async function playingRoom(reg: RoomRegistry): Promise<string> {
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  reg.joinSeat(roomId);
  reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = () => reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e().phase === "Setup"; i++) {
    await reg.pickCapital(roomId, e().currentSetupPlayerIndex, e().offeredCapitals[0]!);
  }
  expect(e().phase).toBe("Playing");
  return roomId;
}

/** 托管全场后经注入时钟泵到终局:fireAll 推进 guard 续链/看门狗,直到 GameOver。 */
async function pumpToGameOver(
  reg: RoomRegistry,
  roomId: string,
  clock: ManualClock,
): Promise<void> {
  const e = () => reg.get(roomId)!.engine!;
  for (let i = 0; i < 4000 && e().phase !== "GameOver"; i++) {
    clock.fireAll();
    await sleep(2);
  }
  expect(e().phase).toBe("GameOver");
}

/** 终态对照投影:gameId(每次构造随机)与日志时间戳(墙钟)是两次运行必然不同的
 *  字段,归零后比较——其余逐字段必须一致。 */
function comparable(snap: GameSnapshot): string {
  return JSON.stringify({
    ...snap,
    gameId: "",
    log: snap.log.map((l) => ({ ...l, ts: 0 })),
  });
}

describe("RoomRegistry · 崩溃恢复(#380 三形态 + #388 播种咬合)", () => {
  it("进行中对局:落盘 → 新 registry 恢复保真 → 双路续跑到终局,终态一致", async () => {
    const dir1 = tmpDir("mid");
    let dir2: string | null = null;
    try {
      const clock1 = new ManualClock();
      const reg1 = new RoomRegistry(new FileRoomPersistence(dir1), undefined, undefined, {
        clock: clock1,
      });
      const roomId = await playingRoom(reg1);
      const e1 = () => reg1.get(roomId)!.engine!;
      // 推进半局:托管当前决策归属座位,链在另一真人的决策点停——真实「进行中」存档点
      const firstOwner = e1().decisionOwner;
      await reg1.setAutoPilot(roomId, firstOwner, true, "fast");
      const other = 1 - firstOwner;
      expect(e1().phase).toBe("Playing");
      expect(e1().isOver).toBe(false);

      // 「进程崩溃」:此刻落盘记录拷入新目录,新 registry 恢复
      const rec = new FileRoomPersistence(dir1).load(roomId)!;
      dir2 = tmpDir("restored");
      const persistence2 = new FileRoomPersistence(dir2);
      persistence2.save(rec);
      const clock2 = new ManualClock();
      const reg2 = new RoomRegistry(persistence2, undefined, undefined, {
        clock: clock2,
      });
      expect(reg2.restoreAll(testMapProvider)).toBe(1);
      const restored = reg2.get(roomId)!;
      expect(restored.engine).not.toBeNull();
      // 恢复保真:恢复引擎快照 === 崩溃时落盘快照(逐字段,含 rngState/日志)
      expect(JSON.stringify(restored.engine!.snapshot())).toBe(JSON.stringify(e1().snapshot()));

      // 双路续跑:A=原进程继续,B=恢复进程继续——同一存档点出发,终态一致
      await reg1.setAutoPilot(roomId, other, true, "fast");
      await reg2.setAutoPilot(roomId, other, true, "fast");
      await pumpToGameOver(reg1, roomId, clock1);
      await pumpToGameOver(reg2, roomId, clock2);
      expect(comparable(restored.engine!.snapshot())).toBe(comparable(e1().snapshot()));
      // 终局行(ADR-0014)两侧都在
      expect(e1().log.some((l) => l.category === "final")).toBe(true);
      expect(restored.engine!.log.some((l) => l.category === "final")).toBe(true);
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      if (dir2) rmSync(dir2, { recursive: true, force: true });
    }
  }, 120_000);

  it("已终局:恢复后相位/快照原样保留", async () => {
    const dir = tmpDir("final");
    try {
      const clock = new ManualClock();
      const reg1 = new RoomRegistry(new FileRoomPersistence(dir), undefined, undefined, { clock });
      const roomId = await playingRoom(reg1);
      await reg1.setAutoPilot(roomId, 0, true, "fast");
      await reg1.setAutoPilot(roomId, 1, true, "fast");
      await pumpToGameOver(reg1, roomId, clock);
      const finalSnap = reg1.get(roomId)!.engine!.snapshot();

      const reg2 = new RoomRegistry(new FileRoomPersistence(dir));
      expect(reg2.restoreAll(testMapProvider)).toBe(1);
      const restored = reg2.get(roomId)!;
      expect(restored.engine!.phase).toBe("GameOver");
      expect(restored.engine!.isOver).toBe(true);
      expect(JSON.stringify(restored.engine!.snapshot())).toBe(JSON.stringify(finalSnap));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("损坏文件跳过:坏 JSON 走 persistence 跳过通道;结构损坏跳过并移除;好房间照常恢复", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const dir = tmpDir("corrupt");
    try {
      const persistence = new FileRoomPersistence(dir);
      const reg1 = new RoomRegistry(persistence);
      const created = reg1.createRoom({ seatCount: 2, botIdx: new Set([1]), hostConfig: {} });
      const goodId = created.room.roomId;
      // 形态①:整文件坏 JSON(persistence 层 load/listIds 跳过 + 告警,文件保留)
      writeFileSync(join(dir, "ZZZZ.json"), "{ not json", "utf-8");
      expect(persistence.load("ZZZZ")).toBeNull();
      // 形态②:JSON 合法但快照存在而缺 mapId(room 层 hydrate 抛 → 跳过并移除)
      persistence.save({
        roomId: "BROK",
        seatCount: 2,
        seats: [
          { kind: "human", token: "t", guohao: null },
          { kind: "bot", token: null, guohao: null },
        ],
        hostSeat: 0,
        takeover: [],
        autoPilot: [],
        hostConfig: {},
        mapId: null,
        snapshot: {},
      } as unknown as RoomRecord);
      expect(persistence.listIds().sort()).toEqual(["BROK", goodId].sort()); // ZZZZ 不入列

      const reg2 = new RoomRegistry(persistence);
      expect(reg2.restoreAll(testMapProvider)).toBe(1); // 只恢复好房间
      expect(reg2.get(goodId)).toBeDefined();
      expect(reg2.get("BROK")).toBeUndefined(); // 结构损坏:跳过
      expect(persistence.exists("BROK")).toBe(false); // 且移除记录文件
      expect(persistence.exists("ZZZZ")).toBe(true); // 坏文件原样保留(不静默吞)
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2); // 两条损坏通道都告警过
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("#388 恢复播种咬合:恢复批基线按引用去重,重启后旧批不重发;新转移只追加新批", async () => {
    const persistence = new InMemoryPersistence(); // 播种语义与介质无关,内存表聚焦引用契约
    const clock1 = new ManualClock();
    const reg1 = new RoomRegistry(persistence, undefined, undefined, { clock: clock1 });
    const created = reg1.createRoom({
      seatCount: 2,
      botIdx: new Set([1]),
      hostConfig: { seed: 42 },
    });
    const roomId = created.room.roomId;
    reg1.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
    await reg1.startGame(roomId, created.token, undefined, testMapProvider);
    const e1 = () => reg1.get(roomId)!.engine!;
    // host 选都 → 服务器驱动余下 bot 座位接棒,直到停下(必有非空事件批)
    for (let i = 0; i < 20 && e1().phase === "Setup"; i++) {
      await reg1.pickCapital(roomId, e1().currentSetupPlayerIndex, e1().offeredCapitals[0]!);
    }
    const batchAtCrash = e1().gameEvents;
    expect(batchAtCrash.length).toBeGreaterThan(0);
    const firstEventAtCrash = batchAtCrash[0];

    // 模拟 server.ts restoreAll 回调的 #388 播种(seenBatches/settledTurnPhase;
    // server.ts 模块顶层 Bun.serve 不可 import,此处按同一回调契约钉住咬合)
    const seenBatches = new Map<string, GameEvent[]>();
    const settledTurnPhase = new Map<string, string | null>();
    const reg2 = new RoomRegistry(persistence);
    reg2.restoreAll(testMapProvider, (room) => {
      const e = room.engine;
      if (e) {
        seenBatches.set(room.roomId, e.gameEvents);
        settledTurnPhase.set(room.roomId, e.turnPhase);
      }
    });
    const e2 = reg2.get(roomId)!.engine!;
    const turnPhaseAtRestore = e2.turnPhase;
    const seededBatch = seenBatches.get(roomId)!;
    // 咬合 1:恢复引擎的当前批引用 === 播种引用(server 端按引用去重的凭据)
    expect(e2.gameEvents).toBe(seededBatch);
    // 咬合 2:按 server 的 accumulate 口径(同引用不重收)——恢复批不重发
    const accumulate = (room: RoomSession): GameEvent[] => {
      const batch = room.engine?.gameEvents;
      if (!batch) return [];
      if (seenBatches.get(room.roomId) === batch) return [];
      seenBatches.set(room.roomId, batch);
      return batch.length > 0 ? [...batch] : [];
    };
    expect(accumulate(reg2.get(roomId)!)).toEqual([]);
    // 咬合 3:恢复后新转移 → 批引用换新,只追加新批事件,旧批不混入。
    // 按停点相位发真人命令(锦囊「今不用」/起摇),驱动一次真实转移。
    let appended: GameEvent[] = [];
    for (let i = 0; i < 50; i++) {
      const room2 = reg2.get(roomId)!;
      const e = room2.engine!;
      if (e.phase !== "Playing") break;
      const acc = accumulate(room2);
      if (acc.length > 0) {
        appended = acc;
        break;
      }
      if (e.turnPhase === "AwaitingJinnang")
        await reg2.applyCommand(roomId, { type: "useJinnang", cardId: null });
      else if (e.turnPhase === "Roll") await reg2.applyCommand(roomId, { type: "rollAndMove" });
      else break;
    }
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]).not.toBe(firstEventAtCrash);
    // 咬合 4:结算相位基线 = 恢复引擎当时 turnPhase(决策窗退出检测的起点)
    expect(settledTurnPhase.get(roomId)).toBe(turnPhaseAtRestore);
  });
});

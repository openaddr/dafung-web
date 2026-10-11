// room-record 单测(#427 单源):水合纯逻辑唯一实现 scripts/room-record.ts 的行为钉子。
// ①记录损坏(快照在而缺 mapId/加载器)当场抛——零兜底口径,恢复期由 restoreAll 跳过并移除;
// ②Lobby 记录(无快照)→ null;③真实落盘记录恢复保真 + reactionWindowMs 覆盖透传(#284);
// ④模块源零 node 导入(浏览器可 import 的架构属性,本模块存在的理由)。
// registry 级恢复语义(restoreAll 三形态/#388 播种)归 room-recovery.test.ts,此处不复制。
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engineFromRecord } from "../scripts/room-record";
import type { RoomRecord } from "../scripts/room-record";
import { RoomRegistry } from "../scripts/room";
import type { RoomPersistence } from "../scripts/room-persistence";
import { MAP } from "../scripts/engine-helpers";
import type { LoadedMap } from "../src/core/board-loader";

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

const mapProvider = (_id: string): LoadedMap => MAP;
const VALID_MAP_IDS = new Set(["sanguo"]);

/** 造一条带快照的真实落盘记录(双人房,host 选都完毕进 Playing 后取持久化投影)。
 *  进程内缓存:三个用例共用同一条记录,开局只走一次。 */
let cached: Promise<RoomRecord> | null = null;
function recordAsync(): Promise<RoomRecord> {
  cached ??= recordWithSnapshot();
  return cached;
}

async function recordWithSnapshot(): Promise<RoomRecord> {
  const persistence = new InMemoryPersistence();
  const reg = new RoomRegistry(persistence);
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set([1]),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, mapProvider);
  const e = () => reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e().phase === "Setup"; i++) {
    await reg.pickCapital(roomId, e().currentSetupPlayerIndex, e().offeredCapitals[0]!);
  }
  expect(e().phase).toBe("Playing");
  return persistence.load(roomId)!;
}

describe("room-record · engineFromRecord(#427 唯一实现)", () => {
  it("Lobby 记录(无快照)→ null,不建引擎", async () => {
    const rec = await recordAsync();
    expect(engineFromRecord({ ...rec, snapshot: null }, mapProvider)).toBeNull();
  });

  it("记录损坏当场抛:快照在而缺 mapId 或缺加载器(零兜底,不退默认图)", async () => {
    const rec = await recordAsync();
    expect(() => engineFromRecord({ ...rec, mapId: null }, mapProvider)).toThrow(
      /快照存在但缺地图 id 或加载器/,
    );
    expect(() => engineFromRecord(rec, undefined)).toThrow(/快照存在但缺地图 id 或加载器/);
  });

  it("恢复保真:重建引擎快照 === 落盘快照;reactionWindowMs 覆盖透传(#284),缺省走 core 常量表", async () => {
    const rec = await recordAsync();
    const engine = engineFromRecord(rec, mapProvider, 1234);
    expect(engine).not.toBeNull();
    expect(JSON.stringify(engine!.snapshot())).toBe(JSON.stringify(rec.snapshot));
    expect(engine!.reactionWindowMsOverride).toBe(1234);
    expect(engineFromRecord(rec, mapProvider)!.reactionWindowMsOverride).toBe(0);
  });
});

describe("room-record · 模块纯度(浏览器可 import)", () => {
  it("源文件零 node 导入(零 fs,浏览器进程内单机通路可直引)", () => {
    const src = readFileSync(join(import.meta.dir, "..", "scripts", "room-record.ts"), "utf-8");
    expect(src).not.toContain('"node:');
  });
});

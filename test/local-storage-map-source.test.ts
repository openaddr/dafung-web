// LocalStorageMapSource 单测:自建图库(localStorage 数组)的增删查。
// vitest 环境是 node(无 localStorage),通过构造函数注入内存 mock storage。
import { describe, it, expect, beforeEach } from "bun:test";
import { LocalStorageMapSource, type StorageLike } from "@app/map-sources";
import { isCustomId } from "@core/map-source";
import type { MapData } from "@core/types";
import sanguoData from "../public/maps/sanguo.json";

/** 内存 StorageLike mock(实现 getItem/setItem/removeItem)。 */
function makeMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

/** 两城最小 MapData(够 LocalStorageMapSource 存取:listMaps 读 tiles.length)。 */
function makeMap(tileCount = 2, targetNetWorth = 5000): MapData {
  const tiles = [];
  for (let i = 0; i < tileCount; i++) {
    tiles.push({ id: `t${i}`, name: `城${i}`, pos: [i * 100, 0] });
  }
  return {
    version: 1,
    targetNetWorth,
    startingCash: 2500,
    maxLevel: 5,
    resupplyPerLevel: 150,
    tiles,
  } as unknown as MapData;
}

describe("LocalStorageMapSource(listMaps/loadMapData)", () => {
  let storage: StorageLike;
  let src: LocalStorageMapSource;

  beforeEach(() => {
    storage = makeMemoryStorage();
    src = new LocalStorageMapSource(storage);
  });

  it("空图库 listMaps 返回空数组", async () => {
    expect(await src.listMaps()).toEqual([]);
  });

  it("loadMapData 找不到 id 抛错", async () => {
    await expect(src.loadMapData("custom-999")).rejects.toThrow(/无此 id/);
  });

  it("存入图后 listMaps 返回 MapEntry(custom=true,desc=自建地图)", async () => {
    const id = src.saveCustomMap("我的图", makeMap(3, 7000));
    const entries = await src.listMaps();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      name: "我的图",
      desc: "自建地图",
      tileCount: 3,
      targetNetWorth: 7000,
      custom: true,
    });
  });

  it("loadMapData 返回存入的 data(深拷贝,改返回值不污染图库)", async () => {
    const data = makeMap(4);
    const id = src.saveCustomMap("测试", data);
    const loaded = await src.loadMapData(id);
    expect(loaded.tiles).toHaveLength(4);
    // 改返回值不影响图库(再 load 一次仍原值)
    loaded.tiles.push({ id: "x", name: "x", pos: [9, 9] } as never);
    const loaded2 = await src.loadMapData(id);
    expect(loaded2.tiles).toHaveLength(4);
  });
});

describe("LocalStorageMapSource.saveCustomMap(id 生成与重名)", () => {
  let storage: StorageLike;
  let src: LocalStorageMapSource;

  beforeEach(() => {
    storage = makeMemoryStorage();
    src = new LocalStorageMapSource(storage);
  });

  it("生成的 id 为 custom- 前缀(isCustomId 为 true)", () => {
    const id = src.saveCustomMap("x", makeMap());
    expect(isCustomId(id)).toBe(true);
    expect(id.startsWith("custom-")).toBe(true);
  });

  it("多次保存生成不同 id(时间戳唯一)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add(src.saveCustomMap(`图${i}`, makeMap()));
    expect(ids.size).toBe(5);
  });

  it("允许重名(两张同名图各自独立 id)", async () => {
    const a = src.saveCustomMap("同名", makeMap(2, 1000));
    const b = src.saveCustomMap("同名", makeMap(3, 2000));
    expect(a).not.toBe(b);
    const entries = await src.listMaps();
    expect(entries.filter((e) => e.name === "同名")).toHaveLength(2);
  });

  it("saveCustomMap 返回的 id 能被 loadMapData 加载", async () => {
    const id = src.saveCustomMap("可加载", makeMap(5, 9000));
    const data = await src.loadMapData(id);
    expect(data.tiles).toHaveLength(5);
    expect(data.targetNetWorth).toBe(9000);
  });

  it("listCustomMaps 返回原始记录(含 createdAt)", () => {
    const before = Date.now();
    const id = src.saveCustomMap("带时间", makeMap());
    const records = src.listCustomMaps();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(id);
    expect(records[0].createdAt).toBeGreaterThanOrEqual(before);
  });
});

describe("LocalStorageMapSource.deleteCustomMap", () => {
  let storage: StorageLike;
  let src: LocalStorageMapSource;

  beforeEach(() => {
    storage = makeMemoryStorage();
    src = new LocalStorageMapSource(storage);
  });

  it("删除存在的图后 listMaps 不再包含它", async () => {
    const id1 = src.saveCustomMap("图1", makeMap());
    const id2 = src.saveCustomMap("图2", makeMap());
    expect(await src.listMaps()).toHaveLength(2);
    src.deleteCustomMap(id1);
    const entries = await src.listMaps();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id2);
  });

  it("删除不存在的 id 无副作用(不抛错,其余图完好)", async () => {
    const id = src.saveCustomMap("唯一", makeMap());
    src.deleteCustomMap("custom-nonexistent");
    const entries = await src.listMaps();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
  });

  it("删完后再 loadMapData 抛错", async () => {
    const id = src.saveCustomMap("待删", makeMap());
    src.deleteCustomMap(id);
    await expect(src.loadMapData(id)).rejects.toThrow(/无此 id/);
  });
});

describe("LocalStorageMapSource(持久化与容错)", () => {
  it("同一 storage 的新实例能看到已存图(持久化语义)", async () => {
    const storage = makeMemoryStorage();
    const src1 = new LocalStorageMapSource(storage);
    const id = src1.saveCustomMap("持久", makeMap(2));
    // 新实例共用同一 storage → 能读到
    const src2 = new LocalStorageMapSource(storage);
    const entries = await src2.listMaps();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
  });

  it("localStorage 存了坏 JSON → listMaps 静默返回空数组(容错)", async () => {
    const storage = makeMemoryStorage();
    storage.setItem("dafung-custom-maps", "{这不是合法json");
    const src = new LocalStorageMapSource(storage);
    expect(await src.listMaps()).toEqual([]);
  });

  it("localStorage 存了非数组 → listMaps 静默返回空数组", async () => {
    const storage = makeMemoryStorage();
    storage.setItem("dafung-custom-maps", JSON.stringify({ not: "array" }));
    const src = new LocalStorageMapSource(storage);
    expect(await src.listMaps()).toEqual([]);
  });

  it("存入完整 sanguo 数据能无损往返", async () => {
    const storage = makeMemoryStorage();
    const src = new LocalStorageMapSource(storage);
    const id = src.saveCustomMap("完整三国", sanguoData as MapData);
    const loaded = await src.loadMapData(id);
    expect(loaded.tiles.length).toBe((sanguoData as MapData).tiles.length);
    expect(loaded.targetNetWorth).toBe((sanguoData as MapData).targetNetWorth);
  });
});

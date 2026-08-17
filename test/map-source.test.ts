import { describe, it, expect } from "bun:test";
import {
  loadMapById,
  parseCatalog,
  entryFromFile,
  isCustomId,
  CUSTOM_ID_PREFIX,
  type MapSource,
  type MapEntry,
  type CatalogFileEntry,
} from "@core/map-source";
import type { MapData } from "@core/types";
import sanguoData from "../public/maps/sanguo.json";
import zhongyuanData from "../public/maps/zhongyuan.json";

/** 内存 MapSource(单测用):不依赖 fetch/localStorage。 */
function makeMemorySource(entries: MapEntry[], data: Record<string, MapData>): MapSource {
  return {
    listMaps: async () => entries,
    loadMapData: async (id) => {
      if (!(id in data)) throw new Error(`内存源找不到地图:${id}`);
      return data[id];
    },
  };
}

describe("loadMapById(统一加载入口)", () => {
  it("按 id 从源加载并构建 LoadedMap", async () => {
    const src = makeMemorySource(
      [{ id: "sanguo", name: "群雄逐鹿", desc: "", tileCount: 30, targetNetWorth: 8000 }],
      { sanguo: sanguoData as MapData },
    );
    const m = await loadMapById(src, "sanguo");
    expect(m.tiles.length).toBeGreaterThanOrEqual(30);
    expect(m.targetNetWorth).toBe(8000);
  });

  it("不同 id 加载到不同地图", async () => {
    const src = makeMemorySource(
      [
        { id: "sanguo", name: "群雄逐鹿", desc: "", tileCount: 30, targetNetWorth: 8000 },
        { id: "zhongyuan", name: "中原争霸", desc: "", tileCount: 8, targetNetWorth: 5000 },
      ],
      {
        sanguo: sanguoData as MapData,
        zhongyuan: zhongyuanData as MapData,
      },
    );
    const [a, b] = await Promise.all([loadMapById(src, "sanguo"), loadMapById(src, "zhongyuan")]);
    expect(a.tiles.length).not.toBe(b.tiles.length);
    expect(a.targetNetWorth).not.toBe(b.targetNetWorth);
  });

  it("自建图 id(custom- 前缀)与内置 id 走同一加载路径", async () => {
    const customData = JSON.parse(JSON.stringify(zhongyuanData)) as MapData;
    customData.targetNetWorth = 3000; // 改个值区分
    const src = makeMemorySource(
      [{ id: "custom-1", name: "我的图", desc: "", tileCount: 8, targetNetWorth: 3000, custom: true }],
      { "custom-1": customData },
    );
    const m = await loadMapById(src, "custom-1");
    expect(m.targetNetWorth).toBe(3000);
  });

  it("源里找不到 id 时抛错", async () => {
    const src = makeMemorySource([], {});
    await expect(loadMapById(src, "nonexistent")).rejects.toThrow();
  });

  it("坏地图数据经 loadMap 校验失败时抛错", async () => {
    const bad = { version: 99 } as unknown as MapData; // 版本不符
    const src = makeMemorySource(
      [{ id: "bad", name: "坏图", desc: "", tileCount: 1, targetNetWorth: 1 }],
      { bad },
    );
    await expect(loadMapById(src, "bad")).rejects.toThrow(/版本/);
  });
});

describe("parseCatalog(清单解析)", () => {
  it("合法清单解析成功", () => {
    const catalog: CatalogFileEntry[] = [
      { id: "sanguo", name: "群雄逐鹿", file: "sanguo.json", desc: "...", tileCount: 30, targetNetWorth: 8000 },
      { id: "zhongyuan", name: "中原争霸", file: "zhongyuan.json", desc: "...", tileCount: 8, targetNetWorth: 5000 },
    ];
    expect(parseCatalog(catalog)).toHaveLength(2);
  });

  it("空数组报错", () => {
    expect(() => parseCatalog([])).toThrow(/空或非数组/);
  });

  it("非数组报错", () => {
    expect(() => parseCatalog({})).toThrow(/空或非数组/);
  });

  it("缺 id 报错", () => {
    expect(() => parseCatalog([{ name: "x", file: "x.json", desc: "", tileCount: 1, targetNetWorth: 1 }])).toThrow(/缺 id/);
  });

  it("缺 file 报错", () => {
    expect(() => parseCatalog([{ id: "x", name: "x", desc: "", tileCount: 1, targetNetWorth: 1 }])).toThrow(/缺 file/);
  });

  it("tileCount 非法报错", () => {
    expect(() =>
      parseCatalog([{ id: "x", name: "x", file: "x.json", desc: "", tileCount: 0, targetNetWorth: 1 }]),
    ).toThrow(/tileCount 非法/);
  });

  it("targetNetWorth 非法报错", () => {
    expect(() =>
      parseCatalog([{ id: "x", name: "x", file: "x.json", desc: "", tileCount: 1, targetNetWorth: -1 }]),
    ).toThrow(/targetNetWorth 非法/);
  });
});

describe("entryFromFile / isCustomId", () => {
  it("entryFromFile 去掉 file 字段", () => {
    const e: CatalogFileEntry = {
      id: "sanguo",
      name: "群雄逐鹿",
      file: "sanguo.json",
      desc: "...",
      tileCount: 30,
      targetNetWorth: 8000,
    };
    const m = entryFromFile(e);
    expect(m.id).toBe("sanguo");
    expect(m.name).toBe("群雄逐鹿");
    expect((m as unknown as Record<string, unknown>).file).toBeUndefined();
    expect(m.custom).toBeUndefined(); // 内置图无 custom 标记
  });

  it("isCustomId 识别 custom- 前缀", () => {
    expect(isCustomId("custom-123")).toBe(true);
    expect(isCustomId("sanguo")).toBe(false);
    expect(isCustomId(CUSTOM_ID_PREFIX)).toBe(true); // 仅前缀也算(边界)
  });
});

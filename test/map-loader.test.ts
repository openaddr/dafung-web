import { describe, it, expect } from "bun:test";
import { loadMap } from "@core/board-loader";
import { sideArc } from "@core/board";
import huanyouData from "../public/maps/huanyou.json";

describe("地图加载器(合法)", () => {
  it("内置三国地图加载成功", () => {
    const m = loadMap(huanyouData);
    expect(m.tiles.length).toBeGreaterThanOrEqual(30);
    expect(m.board.count).toBe(m.tiles.length);
    expect(m.targetNetWorth).toBe(30000);
    expect(m.startingCash).toBe(10000);
    expect(m.catalog.get("prop-changan")?.purchasePrice).toBe(7200); // #827 再平衡:长安=名城 72 档
  });

  it("主路按 tiles 数组顺序闭合", () => {
    const m = loadMap(huanyouData);
    let cur = 0;
    for (let i = 0; i < m.board.count; i++) cur = m.board.next(cur);
    expect(cur).toBe(0);
  });
});

describe("地图校验(非法应抛可读错误)", () => {
  const base = () => JSON.parse(JSON.stringify(huanyouData));

  it("版本不符", () => {
    const d = base();
    d.version = 99;
    expect(() => loadMap(d)).toThrow(/版本/);
  });
  it("tiles 为空", () => {
    const d = base();
    d.tiles = [];
    expect(() => loadMap(d)).toThrow(/tiles 为空/);
  });
  it("坐标完全重叠", () => {
    const d = base();
    d.tiles[1].pos = [...d.tiles[0].pos];
    expect(() => loadMap(d)).toThrow(/重叠/);
  });
  it("lenient 跳过间距校验(编辑器实时预览用)", () => {
    const d = base();
    d.tiles[1].pos = [d.tiles[0].pos[0] + 10, d.tiles[0].pos[1]]; // 距离 10 < 80
    expect(() => loadMap(d)).toThrow(/重叠/);
    expect(() => loadMap(d, { lenient: true })).not.toThrow();
  });
  it("价格为负", () => {
    const d = base();
    d.tiles[0].price = -1;
    expect(() => loadMap(d)).toThrow(/为负/);
  });
  it("城缺 tradeAdd(坐地起价逐城必配,零兜底)", () => {
    const d = base();
    delete d.tiles[0].tradeAdd;
    expect(() => loadMap(d)).toThrow(/tradeAdd/);
  });
  it("城 tradeMult 长度与等级数不符(越界等级会静默换公式,当场拒绝)", () => {
    const d = base();
    d.tiles[0].tradeMult = [2, 4];
    expect(() => loadMap(d)).toThrow(/tradeMult/);
  });
  it("缺 maxLevel(等级上限逐图必配,不再默认 3)", () => {
    const d = base();
    delete d.maxLevel;
    expect(() => loadMap(d)).toThrow(/maxLevel/);
  });
  it("缺顶层 resupply(地图级都城补给必配,固定值)", () => {
    const d = base();
    delete d.resupply;
    expect(() => loadMap(d)).toThrow(/resupply/);
  });
  it("城缺 price(免费城须显式写 0,不再默认 0)", () => {
    const d = base();
    delete d.tiles[0].price;
    expect(() => loadMap(d)).toThrow(/price/);
  });
  it("城缺 buildCost(建城费必配,不再默认 0)", () => {
    const d = base();
    delete d.tiles[0].buildCost;
    expect(() => loadMap(d)).toThrow(/buildCost/);
  });
  it("城缺 group(区域分组必配,不再默认 z)", () => {
    const d = base();
    delete d.tiles[0].group;
    expect(() => loadMap(d)).toThrow(/group/);
  });
});

describe("避城算法 sideArc", () => {
  it("中间有城时弧线绕开(y 偏移)", () => {
    const wps = sideArc({ x: 0, y: 0 }, { x: 1000, y: 0 }, [{ x: 500, y: 0 }]);
    expect(wps.length).toBeGreaterThan(0);
    expect(wps.some((w) => w.y !== 0)).toBe(true);
  });
  it("无其他城时返回两点途经", () => {
    const wps = sideArc({ x: 0, y: 0 }, { x: 1000, y: 0 }, []);
    expect(wps.length).toBe(2);
  });
});

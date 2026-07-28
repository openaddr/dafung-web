import { describe, it, expect } from "vitest";
import { loadMap } from "@core/board-loader";
import { sideArc } from "@core/board";
import sanguoData from "../public/maps/sanguo.json";

describe("地图加载器(合法)", () => {
  it("内置三国地图加载成功", () => {
    const m = loadMap(sanguoData);
    expect(m.tiles.length).toBeGreaterThanOrEqual(30);
    expect(m.shortcuts.length).toBe(5);
    expect(m.board.count).toBe(m.tiles.length);
    expect(m.targetNetWorth).toBe(8000);
    expect(m.startingCash).toBe(2500);
    expect(m.catalog.get("prop-changan")?.purchasePrice).toBe(400);
  });

  it("主路按 tiles 数组顺序闭合", () => {
    const m = loadMap(sanguoData);
    let cur = 0;
    for (let i = 0; i < m.board.count; i++) cur = m.board.next(cur, null);
    expect(cur).toBe(0);
  });

  it("捷径 from/to(tile id)解析为 index", () => {
    const m = loadMap(sanguoData);
    const sc = m.shortcuts.find((s) => s.id === "huarong-bypass")!;
    const findIdx = (pid: string) => m.tiles.findIndex((t) => t.propertyId === pid);
    expect(sc.branchNode).toBe(findIdx("prop-huarong")); // 华容道
    expect(sc.rejoinNode).toBe(findIdx("prop-jiaozhou")); // 交州
  });

  it("捷径默认用避城算法生成 sideWaypoints", () => {
    const m = loadMap(sanguoData);
    for (const s of m.shortcuts) expect(s.sideWaypoints.length).toBeGreaterThan(0);
  });
});

describe("地图校验(非法应抛可读错误)", () => {
  const base = () => JSON.parse(JSON.stringify(sanguoData));

  it("版本不符", () => {
    const d = base(); d.version = 99;
    expect(() => loadMap(d)).toThrow(/版本/);
  });
  it("tiles 为空", () => {
    const d = base(); d.tiles = [];
    expect(() => loadMap(d)).toThrow(/tiles 为空/);
  });
  it("坐标完全重叠", () => {
    const d = base(); d.tiles[1].pos = [...d.tiles[0].pos];
    expect(() => loadMap(d)).toThrow(/重叠/);
  });
  it("lenient 跳过间距校验(编辑器实时预览用)", () => {
    const d = base();
    d.tiles[1].pos = [d.tiles[0].pos[0] + 10, d.tiles[0].pos[1]]; // 距离 10 < 80
    expect(() => loadMap(d)).toThrow(/重叠/);
    expect(() => loadMap(d, { lenient: true })).not.toThrow();
  });
  it("CoinFlip win/lose 符号非法抛错", () => {
    const d = base();
    d.shortcuts[1].consequence = { kind: "CoinFlip", win: { cashDelta: -5 }, lose: { cashDelta: 5 } };
    expect(() => loadMap(d)).toThrow(/不能为负|不能为正/);
  });
  it("捷径 from 引用无效", () => {
    const d = base(); d.shortcuts[0].from = "no-such-tile";
    expect(() => loadMap(d)).toThrow(/from 引用无效/);
  });
  it("捷径 from === to", () => {
    const d = base(); d.shortcuts[0].to = d.shortcuts[0].from;
    expect(() => loadMap(d)).toThrow(/相同/);
  });
  it("价格为负", () => {
    const d = base(); d.tiles[0].price = -1;
    expect(() => loadMap(d)).toThrow(/为负/);
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

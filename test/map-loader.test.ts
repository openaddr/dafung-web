import { describe, it, expect } from "bun:test";
import { loadMap } from "@core/board-loader";
import { sideArc } from "@core/board";
import sanguoData from "../public/maps/sanguo.json";

describe("地图加载器(合法)", () => {
  it("内置三国地图加载成功", () => {
    const m = loadMap(sanguoData);
    expect(m.tiles.length).toBeGreaterThanOrEqual(30);
    expect(m.board.count).toBe(m.tiles.length);
    expect(m.targetNetWorth).toBe(8000);
    expect(m.startingCash).toBe(2500);
    expect(m.catalog.get("prop-changan")?.purchasePrice).toBe(400);
  });

  it("主路按 tiles 数组顺序闭合", () => {
    const m = loadMap(sanguoData);
    let cur = 0;
    for (let i = 0; i < m.board.count; i++) cur = m.board.next(cur);
    expect(cur).toBe(0);
  });

  it("辅路 start/end(tile id)解析为 index,cells 携带坐标", () => {
    const m = loadMap(sanguoData);
    expect(m.branch).not.toBeNull();
    const findIdx = (pid: string) => m.tiles.findIndex((t) => t.propertyId === pid);
    expect(m.branch!.startNode).toBe(findIdx("prop-xuchang"));
    expect(m.branch!.endNode).toBe(findIdx("prop-xiangyang"));
    expect(m.branch!.cells.length).toBe(5);
    for (const c of m.branch!.cells) {
      expect(typeof c.position.x).toBe("number");
      expect(typeof c.position.y).toBe("number");
    }
  });

  it("辅路格 kind 序列:3 珍宝 + 1 锦囊 + 1 中伏", () => {
    const m = loadMap(sanguoData);
    const kinds = m.branch!.cells.map((c) => c.kind);
    expect(kinds.filter((k) => k === "treasure").length).toBe(3);
    expect(kinds.filter((k) => k === "event").length).toBe(1);
    expect(kinds.filter((k) => k === "penalty").length).toBe(1);
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
  it("价格为负", () => {
    const d = base(); d.tiles[0].price = -1;
    expect(() => loadMap(d)).toThrow(/为负/);
  });
  it("辅路 start 引用无效", () => {
    const d = base(); d.branch.start = "no-such-tile";
    expect(() => loadMap(d)).toThrow(/start 引用无效/);
  });
  it("辅路 start === end", () => {
    const d = base(); d.branch.end = d.branch.start;
    expect(() => loadMap(d)).toThrow(/相同/);
  });
  it("辅路 cells 为空", () => {
    const d = base(); d.branch.cells = [];
    expect(() => loadMap(d)).toThrow(/cells 为空/);
  });
  it("辅路格 kind 非法", () => {
    const d = base(); d.branch.cells[0].kind = "wow";
    expect(() => loadMap(d)).toThrow(/kind 非法/);
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

import { describe, it, expect } from "vitest";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const board = loadMap(sanguoData).board;
// 用名字查 index,避免 boards.json 增删格后 index 位移导致单测脆弱
const idx = (name: string) => board.tiles.find((t) => t.name === name)!.index;

describe("棋盘路径", () => {
  it("主环闭合:走 N 步回起点", () => {
    let cur = 0;
    for (let i = 0; i < board.count; i++) cur = board.next(cur, null);
    expect(cur).toBe(0);
  });

  it("computePath 简单移动", () => {
    const from = idx("长安");
    const p = board.computePath(from, 3, -1);
    expect(p.traversed).toEqual([from + 1, from + 2, from + 3]);
    expect(p.landIndex).toBe(from + 3);
    expect(p.from).toBe(from);
  });

  it("computePath 环绕过尾", () => {
    const last = board.count - 1;
    const p = board.computePath(last, 3, -1); // 末→0→1→2
    expect(p.traversed).toEqual([0, 1, 2]);
    expect(p.landIndex).toBe(2);
  });

  it("经过都城触发 passedCapital,落点为都城则不触发驻跸", () => {
    const from = idx("长安");
    const cap = from + 3;
    const p1 = board.computePath(from, 5, cap);
    expect(p1.passedCapital).toBe(true);
    const p2 = board.computePath(from, 3, cap);
    expect(p2.passedCapital).toBe(true);
    expect(p2.landIndex).toBe(p2.capitalIndex);
  });

  it("支路:函谷关小路一步直达许昌,含独立途经点", () => {
    const hangu = idx("函谷关");
    const xuchang = idx("许昌");
    const choice = { fromNode: hangu, kind: "Shortcut" as const };
    const p = board.computePath(hangu, 1, -1, choice);
    expect(p.traversed).toEqual([xuchang]);
    expect(p.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it("支路:首步走小路,后续回主环", () => {
    const hangu = idx("函谷关");
    const xuchang = idx("许昌");
    const choice = { fromNode: hangu, kind: "Shortcut" as const };
    const p = board.computePath(hangu, 3, -1, choice);
    expect(p.traversed).toEqual([xuchang, xuchang + 1, xuchang + 2]);
  });

  it("支路途经点不计入 traversed(不触发都城检测)", () => {
    const hangu = idx("函谷关");
    const choice = { fromNode: hangu, kind: "Shortcut" as const };
    const p = board.computePath(hangu, 1, hangu + 1, choice); // 都城=下一格,但小路跳过
    expect(p.passedCapital).toBe(false);
  });

  it("长边生成蜿蜒途经点,短边直线", () => {
    const last = board.count - 1;
    const wps = board.edgeWaypoints(last, 0); // 末→首 环边(长)
    expect(wps.length).toBe(2);
    const wpsShort = board.edgeWaypoints(0, 1); // 相邻短边
    expect(wpsShort.length).toBe(0);
  });

  it("分歧点可查到 ShortcutDef", () => {
    for (const name of ["函谷关", "赤壁", "华容道", "剑阁", "子午谷"]) {
      expect(board.getShortcut(idx(name))).not.toBeNull();
    }
    expect(board.getShortcut(idx("长安"))).toBeNull();
  });
});

import { describe, it, expect } from "bun:test";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { createBoard, type TileDef } from "@core/board";

const loaded = loadMap(huanyouData);
const board = loaded.board;
// 用名字查 index,避免 boards.json 增删格后 index 位移导致单测脆弱
const idx = (name: string) => board.tiles.find((t) => t.name === name)!.index;

describe("棋盘路径(单环)", () => {
  it("主环闭合:走 N 步回起点", () => {
    let cur = 0;
    for (let i = 0; i < board.count; i++) cur = board.next(cur);
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

  it("避城弧线阈值:短边直线、长边蜿蜒;闭环对角边照常走弧(ADR-0027)", () => {
    // 新环游图全边 ≥ 行距 320,天然全弧,阈值语义改用合成双城板钉死
    const tile = (i: number, x: number): TileDef => ({
      index: i,
      type: "Property",
      name: i === 0 ? "甲" : "乙",
      position: { x, y: 0 },
      propertyId: `p${i}`,
      isCapitalEligible: false,
      region: null,
    });
    expect(createBoard([tile(0, 0), tile(1, 200)]).edgeWaypoints(0, 1)).toHaveLength(0);
    expect(createBoard([tile(0, 0), tile(1, 400)]).edgeWaypoints(0, 1)).toHaveLength(2);
    // 闭环边 会稽⇗长安(对角 ≈497)是全图唯一非正交边,与其他边同走避城弧
    expect(board.edgeWaypoints(idx("会稽"), idx("长安"))).toHaveLength(2);
  });
});

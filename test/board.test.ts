import { describe, it, expect } from "bun:test";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { createBoard, tileIndexOfProperty, type TileDef } from "@core/board";

const loaded = loadMap(guanzhongData);
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

  it("驿道恒直线(#928/ADR-0044):行走序列只含城心,短长边一视同仁", () => {
    // 双城合成板:任意边长的行走序列都只装落位中心,无避城弧线途经点
    const tile = (i: number, x: number): TileDef => ({
      index: i,
      type: "Property",
      name: i === 0 ? "甲" : "乙",
      position: { x, y: 0 },
      propertyId: `p${i}`,
      isCapitalEligible: false,
    });
    const short = createBoard([tile(0, 0), tile(1, 200)]);
    const long = createBoard([tile(0, 0), tile(1, 400)]);
    for (const b of [short, long]) {
      const p = b.computePath(0, 1, -1);
      expect(p.waypoints).toEqual([b.positionOf(1)]);
    }
    // 在役环游图同样恒直线:整条路径只含 tile 中心(环游图全边 ≥320,旧弧线时代全弯);
    // 期望锚取 tiles 数组序后继(独立于引擎 next/normalize 推进,防半同义反复)
    const huiji = idx("会稽");
    const p = board.computePath(huiji, 1, -1);
    expect(p.waypoints).toEqual([board.tiles[huiji + 1].position]);
  });
});

describe("tileIndexOfProperty(propertyId 反查单源)", () => {
  it("命中返回格 index(关中图任一城往返)", () => {
    const from = idx("长安");
    const pid = board.tiles[from].propertyId!;
    expect(tileIndexOfProperty(board, pid)).toBe(from);
  });

  it("缺城响亮炸(零兜底回归锁:五消费面统一契约,「静默回退 id 冒充城名」旧病不复活)", () => {
    expect(() => tileIndexOfProperty(board, "不存在的城")).toThrow(/不在棋盘/);
  });
});

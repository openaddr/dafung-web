import { describe, it, expect } from "bun:test";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const loaded = loadMap(sanguoData);
const board = loaded.board;
// 用名字查 index,避免 boards.json 增删格后 index 位移导致单测脆弱
const idx = (name: string) => board.tiles.find((t) => t.name === name)!.index;

describe("棋盘路径(主环 + 分岔辅路)", () => {
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
    expect(p.landBranchStep).toBeNull();
    expect(p.branchWaypoints).toEqual([]);
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

  it("长边生成蜿蜒途经点,短边直线", () => {
    const last = board.count - 1;
    const wps = board.edgeWaypoints(last, 0); // 末→首 环边(长)
    expect(wps.length).toBe(2);
    const wpsShort = board.edgeWaypoints(0, 1); // 相邻短边
    expect(wpsShort.length).toBe(0);
  });

  it("辅路起点可被 getBranchStart 识别", () => {
    expect(board.branch).not.toBeNull();
    const startName = board.tiles[board.branch!.startNode].name;
    const endName = board.tiles[board.branch!.endNode].name;
    expect(startName).toBe("许昌");
    expect(endName).toBe("襄阳");
    expect(board.getBranchStart(idx("许昌"))).toBe(true);
    expect(board.getBranchStart(idx("长安"))).toBe(false);
    expect(board.branch!.cells.length).toBe(5);
  });

  it("辅路逐格:onBranch 从 step0 走 2 步 → 落 step2(event 格),含 branchWaypoints", () => {
    const start = board.branch!.startNode;
    const p = board.computePath(start, 2, -1, { step: 0 });
    expect(p.landBranchStep).toBe(2);
    expect(p.landIndex).toBe(start); // 占位:辅路落格主路位置仍是起点
    expect(p.branchWaypoints.length).toBe(2); // 经第 1、2 格
    expect(p.traversed).toEqual([]);
    expect(board.branch!.cells[2].kind).toBe("event");
  });

  it("辅路汇入:从 step0 走超过总格数 → 汇入 endNode 主路并清空 landBranchStep", () => {
    const N = board.branch!.cells.length;
    const end = board.branch!.endNode;
    // 从 step0 走 N+2 步:用 N 步到 endNode,剩 2 步走主路
    const p = board.computePath(board.branch!.startNode, N + 2, -1, { step: 0 });
    expect(p.landBranchStep).toBeNull(); // 已汇入主路
    expect(p.landIndex).toBe((end + 2) % board.count);
    expect(p.branchWaypoints.length).toBeGreaterThan(0); // 含辅路格 + endNode
    expect(p.traversed.length).toBe(2); // endNode 后再走 2 步主路
  });

  it("辅路恰巧到终点:从 step0 走 N 步 → 落 endNode", () => {
    const N = board.branch!.cells.length;
    const end = board.branch!.endNode;
    const p = board.computePath(board.branch!.startNode, N, -1, { step: 0 });
    expect(p.landBranchStep).toBeNull();
    expect(p.landIndex).toBe(end);
    expect(p.traversed).toEqual([]);
  });
});

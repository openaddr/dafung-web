// 选都三选一(capital offer)单测:候选生成算法 / pickCapital 校验 / bot 限定候选 /
// 快照恢复 / 8 人局不耗尽 / zhongyuan 小地图退化。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import zhongyuanData from "../public/maps/zhongyuan.json";
import { loadMap } from "@core/board-loader";

const SANGUO = loadMap(sanguoData);
const ZHONGYUAN = loadMap(zhongyuanData);

function makeEngine(seed: number, seats: SeatConfig[], map = SANGUO): GameEngine {
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(map.board, map.catalog, createDice(seed), cfg);
}

function humans(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isBot: false }));
}

/** 推进到第 stepIndex 位玩家选都轮(全人类座位,不动 rng 之外的状态)。 */
function stepToDraft(e: GameEngine, stepIndex: number): number {
  e.doDraftRoll();
  for (let i = 0; i < stepIndex; i++) {
    const idx = e.currentSetupPlayerIndex;
    const cap = e.firstAvailableCapitalIndex();
    if (idx < 0 || cap < 0) throw new Error("setup stalled");
    e.pickCapital(idx, cap);
  }
  return e.currentSetupPlayerIndex;
}

describe("选都三选一:候选生成", () => {
  it("候选恰 3 座、互不重复、不含已选都", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const e = makeEngine(seed, humans(3));
      e.doDraftRoll();
      expect(e.offeredCapitals).toHaveLength(3);
      expect(new Set(e.offeredCapitals).size).toBe(3);
      for (const i of e.offeredCapitals) expect(e.takenCapitalIndices.has(i)).toBe(false);
    }
  });

  it("价格三档各一(剩余充足时:候选按建价排序分别落在低/中/高三分位)", () => {
    for (const seed of [1, 3, 5, 9, 11, 13]) {
      const e = makeEngine(seed, humans(2));
      e.doDraftRoll();
      // 首轮候选:三座建价应分别来自低/中/高三档(档边界:剩余城按建价三分)
      const costs = e.offeredCapitals
        .map((i) => e.catalog.get(e.board.at(i).propertyId)!.buildCost)
        .sort((a, b) => a - b);
      const allCosts = e.board.tiles
        .filter((t) => t.isCapitalEligible)
        .map((t) => e.catalog.get(t.propertyId)!.buildCost)
        .sort((a, b) => a - b);
      const cut1 = allCosts[Math.floor(allCosts.length / 3)];
      const cut2 = allCosts[Math.floor((allCosts.length * 2) / 3)];
      expect(costs[0]).toBeLessThanOrEqual(cut1); // 低档
      expect(costs[1]).toBeGreaterThanOrEqual(cut1); // 中档
      expect(costs[1]).toBeLessThanOrEqual(cut2);
      expect(costs[2]).toBeGreaterThanOrEqual(cut2); // 高档
    }
  });

  it("地理分散:三候选不全在同一区域(固定 seed 概率断言)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const e = makeEngine(seed, humans(2));
      e.doDraftRoll();
      const regions = e.offeredCapitals.map((i) => e.board.at(i).region);
      expect(new Set(regions).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("不同玩家的候选集互不重复(不与已选都、不与历史候选重叠)", () => {
    const e = makeEngine(42, humans(4));
    e.doDraftRoll();
    const seen = new Set<number>();
    for (let i = 0; i < 3; i++) {
      for (const c of e.offeredCapitals) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
      const idx = e.currentSetupPlayerIndex;
      e.pickCapital(idx, e.offeredCapitals[0]);
    }
    expect(seen.size).toBe(9); // 3 轮 × 3 候选,零复用
  });
});

describe("选都三选一:pickCapital 校验与 bot", () => {
  it("非候选城被拒(新 reason),已选/非都城仍被拒", () => {
    const e = makeEngine(1, humans(3));
    e.doDraftRoll();
    const idx = e.currentSetupPlayerIndex;
    const outsider = e.board.tiles.find(
      (t) => t.isCapitalEligible && !e.takenCapitalIndices.has(t.index) && !e.offeredCapitals.includes(t.index),
    )!;
    expect(e.pickCapital(idx, outsider.index)).toEqual({ ok: false, reason: "非本轮候选城" });
    const nonCity = e.board.tiles.find((t) => !t.isCapitalEligible)!;
    expect(e.pickCapital(idx, nonCity.index)).toEqual({ ok: false, reason: "该城不可作都城" });
    // 选定候选成功,候选滚换给下一位
    expect(e.pickCapital(idx, e.offeredCapitals[1]).ok).toBe(true);
    expect(e.offeredCapitals).toHaveLength(3);
  });

  it("bot 从自己的三候选中选", () => {
    const e = makeEngine(7, [
      { name: "A", isBot: true },
      { name: "B", isBot: true },
      { name: "C", isBot: true },
    ]);
    e.doDraftRoll();
    while (e.setupPhase === "PickCapital") {
      const idx = e.currentSetupPlayerIndex;
      const offered = [...e.offeredCapitals];
      expect(e.aiSetupStep()).toBe(true);
      expect(offered).toContain(e.players[idx].capitalIndex);
    }
    expect(e.phase).toBe("Playing");
  });
});

describe("选都三选一:快照与极端地图", () => {
  it("快照恢复后 offeredCapitals/历史候选一致(选都中段)", () => {
    const a = makeEngine(21, humans(4));
    stepToDraft(a, 2);
    const snap = a.snapshot();
    const b = makeEngine(999, humans(4)); // 种子不同:恢复覆盖 rngState 与候选
    b.restoreFromSnapshot(snap);
    expect(b.offeredCapitals).toEqual(a.offeredCapitals);
    expect([...b.offeredCapitalHistory].sort()).toEqual([...a.offeredCapitalHistory].sort());
    expect(b.snapshot()).toEqual(snap);
  });

  it("8 人局(sanguo 31 城)候选不耗尽,全员有都城", () => {
    const e = makeEngine(11, Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, isBot: true })));
    e.doDraftRoll();
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 100) e.aiSetupStep();
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
    expect(new Set(e.players.map((p) => p.capitalIndex)).size).toBe(8);
  });

  it("zhongyuan 8 城小地图退化:8 人仍可全部完成选都", () => {
    const e = makeEngine(3, Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, isBot: true })), ZHONGYUAN);
    e.doDraftRoll();
    expect(e.offeredCapitals).toHaveLength(3);
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 100) e.aiSetupStep();
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  });

  it("zhongyuan 候选数随剩余退化(允许 ≤3)", () => {
    const e = makeEngine(3, humans(8), ZHONGYUAN);
    e.doDraftRoll();
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 50) {
      expect(e.offeredCapitals.length).toBeLessThanOrEqual(3);
      const idx = e.currentSetupPlayerIndex;
      const cap = e.firstAvailableCapitalIndex();
      if (idx < 0 || cap < 0) break;
      e.pickCapital(idx, cap);
    }
    expect(e.phase).toBe("Playing");
  });
});

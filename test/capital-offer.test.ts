// 选都候选单测:候选生成 / pickCapital 校验 / bot 限定候选 / 快照恢复 / 八人局。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type { EngineConfig, SeatConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import guanzhongData from "../packages/core/maps/guanzhong.json";
import zhongyuanData from "../packages/core/maps/zhongyuan.json";
import { loadMap } from "@dafung/core/engine/board-loader";

const GUANZHONG = loadMap(guanzhongData);
const ZHONGYUAN = loadMap(zhongyuanData);

function makeEngine(seed: number, seats: SeatConfig[], map = GUANZHONG): GameEngine {
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(map.board, map.catalog, createDice(seed), cfg);
}

function humans(n: number): SeatConfig[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isBot: false }));
}

/** 推进到第 stepIndex 位玩家选都轮(全人类座位,不动 rng 之外的状态)。 */
function stepToDraft(e: GameEngine, stepIndex: number): number {
  e.beginCapitalSelection();
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
      e.beginCapitalSelection();
      expect(e.offeredCapitals).toHaveLength(3);
      expect(new Set(e.offeredCapitals).size).toBe(3);
      for (const i of e.offeredCapitals) expect(e.takenCapitalIndices.has(i)).toBe(false);
    }
  });

  it("价格三档各一(剩余充足时:候选按建价排序分别落在低/中/高三分位)", () => {
    for (const seed of [1, 3, 5, 9, 11, 13]) {
      const e = makeEngine(seed, humans(2));
      e.beginCapitalSelection();
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

  it("地理分散:三候选两两间距足够远(固定 seed 断言)", () => {
    // 生成算法本就是纯几何选点(距离排名,setup-flow rollOfferedCapitals),group 只是
    // 地理 proxy。按真不变量断言:阈值 640 ≈ 关中两格步距(步距 320/380),观测
    // seed 1-8 最小两两间距 760,聚到邻格(≤380)即炸。
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const e = makeEngine(seed, humans(2));
      e.beginCapitalSelection();
      const ts = e.offeredCapitals.map((i) => e.board.at(i));
      for (let a = 0; a < ts.length; a++) {
        for (let b = a + 1; b < ts.length; b++) {
          const d = Math.hypot(
            ts[a].position.x - ts[b].position.x,
            ts[a].position.y - ts[b].position.y,
          );
          expect(d).toBeGreaterThanOrEqual(640);
        }
      }
    }
  });

  it("不同玩家的候选集互不重复(不与已选都、不与历史候选重叠)", () => {
    const e = makeEngine(42, humans(4));
    e.beginCapitalSelection();
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
    e.beginCapitalSelection();
    const idx = e.currentSetupPlayerIndex;
    const outsider = e.board.tiles.find(
      (t) =>
        t.isCapitalEligible &&
        !e.takenCapitalIndices.has(t.index) &&
        !e.offeredCapitals.includes(t.index),
    )!;
    expect(e.pickCapital(idx, outsider.index)).toEqual({ ok: false, reason: "非本轮候选城" });
    // #826 全城池制:装载图无「不可作都城」的格(loader 恒置 eligible),改夹具直改一格
    // 布防,钉住守卫的拒绝 reason 映射本身
    const nonCity = e.board.tiles.find(
      (t) => !e.takenCapitalIndices.has(t.index) && !e.offeredCapitals.includes(t.index),
    )!;
    (nonCity as { isCapitalEligible: boolean }).isCapitalEligible = false;
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
    e.beginCapitalSelection();
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
  it("六席选都中途恢复时保留顺序、当前候选与后续骰流", () => {
    const seats = humans(6);
    const a = makeEngine(21, seats);
    stepToDraft(a, 2);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const b = makeEngine(999, seats);
    b.restoreFromSnapshot(snap);
    expect(b.snapshot()).toEqual(snap);
    const picker = snap.currentSetupPlayerIndex;
    const chosen = snap.offeredCapitals[0];
    expect(a.pickCapital(picker, chosen).ok).toBe(true);
    expect(b.pickCapital(picker, chosen).ok).toBe(true);
    // 续走只比较对局状态，两次提交各自写入战报时间戳。
    expect({ ...b.snapshot(), log: [] }).toEqual({ ...a.snapshot(), log: [] });
  });

  it("8 人局(关中 28 城)候选不耗尽,全员有都城", () => {
    const e = makeEngine(
      11,
      Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, isBot: true })),
    );
    e.beginCapitalSelection();
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 100) e.aiSetupStep();
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
    expect(new Set(e.players.map((p) => p.capitalIndex)).size).toBe(8);
  });

  it("zhongyuan 8 城小地图退化:8 人仍可全部完成选都", () => {
    const e = makeEngine(
      3,
      Array.from({ length: 8 }, (_, i) => ({ name: `B${i}`, isBot: true })),
      ZHONGYUAN,
    );
    e.beginCapitalSelection();
    expect(e.offeredCapitals).toHaveLength(3);
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 100) e.aiSetupStep();
    expect(e.phase).toBe("Playing");
    expect(e.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  });

  it("中原争霸八席选都，最后一席定都于唯一剩余的城池", () => {
    const e = makeEngine(3, humans(8), ZHONGYUAN);
    e.beginCapitalSelection();
    for (let remaining = 8; remaining > 1; remaining--) {
      expect(e.offeredCapitals).toHaveLength(Math.min(3, remaining));
      expect(e.pickCapital(e.currentSetupPlayerIndex, e.offeredCapitals[0]).ok).toBe(true);
    }
    const lastCity = e.board.tiles.filter(({ index }) => !e.takenCapitalIndices.has(index));
    expect(lastCity).toHaveLength(1);
    expect(e.offeredCapitals).toEqual([lastCity[0].index]);
    expect(e.pickCapital(e.currentSetupPlayerIndex, lastCity[0].index).ok).toBe(true);
    expect(e.phase).toBe("Playing");
    expect(new Set(e.players.map(({ capitalIndex }) => capitalIndex))).toEqual(
      new Set(e.board.tiles.map(({ index }) => index)),
    );
  });
});

describe("选都落账守卫(#226):建城费与都城持仓双写一致", () => {
  it("2-8 座位全座位选都后:每座位 capitalIndex 指向的城都在 properties 中且为 1 级满防、现金=起手−建城费", () => {
    for (let n = 2; n <= 8; n++) {
      for (const seed of [3, 42]) {
        const e = makeEngine(
          seed,
          Array.from({ length: n }, (_, i) => ({ name: `B${i}`, isBot: true })),
        );
        e.beginCapitalSelection();
        let guard = 0;
        while (e.phase === "Setup" && guard++ < 100) e.aiSetupStep();
        expect(e.phase).toBe("Playing"); // 全员选都完成,无人轮空(轮空=另一类 bug,当场炸)
        expect(new Set(e.players.map((p) => p.capitalIndex)).size).toBe(n); // 都城互不重复
        for (const p of e.players) {
          const tile = e.board.at(p.capitalIndex);
          const holding = p.properties.find((x) => x.propertyId === tile.propertyId);
          const def = e.catalog.get(tile.propertyId)!;
          expect(
            holding,
            `${p.id}(${p.guohao}) seed=${seed} n=${n}:都城持仓缺失(#226)`,
          ).toBeDefined();
          expect(holding).toMatchObject({ level: 1, defense: 40 });
          expect(p.cash).toBe(e.startingCash - def.buildCost); // 钱账一致:恰好扣一次建城费
        }
      }
    }
  });
});

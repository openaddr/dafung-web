import { describe, it, expect } from "vitest";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import {
  TREASURE_PRICE,
  CITY_LEVEL_MULTIPLIER,
  TREASURES,
  createTreasureDeck,
  premiumPriceOf,
  tradePriceOf,
} from "@core/treasures";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 8000,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) { e.aiSetupStep(); continue; }
    const taken = new Set(e.snapshot().takenCapitalIndices);
    const tile = e.board.tiles.find((t) => !taken.has(t.index) && t.isCapitalEligible)!;
    e.pickCapital(idx, tile.index);
  }
}

const TID = "test-treasure";
const TLEVEL = 1; // 指导价 100,交易不会触发破产

/** 置引擎于 AwaitingTreasureOwner:活跃玩家(访客)落到 owner 的 def 城;城主持有该城 + 一件 Lv1 珍宝。 */
function setupOwnerChoice(e: GameEngine, defId: string) {
  const mover = e.activePlayer;
  const owner = e.players.find((p) => p !== mover)!;
  const ownerIdx = e.players.indexOf(owner);
  const def = e.catalog.get(defId)!;
  owner.properties.push({
    propertyId: defId, group: def.group, purchasePrice: def.purchasePrice,
    totalUpgradeCost: 0, level: 0, maxLevel: def.maxLevel,
  });
  owner.treasures.push({ id: TID, name: "测试珍宝", level: TLEVEL, count: 1, desc: "" });
  e.treasureVisitor = { def, ownerIdx };
  e.turnPhase = "AwaitingTreasureOwner";
  return { owner, mover: e.activePlayer, def, guide: TREASURE_PRICE[TLEVEL] ?? TLEVEL * 100 };
}

describe("珍宝系统", () => {
  it("牌堆:数量 = 各珍宝 count 之和,每张 id 唯一", () => {
    const deck = createTreasureDeck();
    expect(deck.length).toBe(TREASURES.reduce((s, t) => s + (t.count ?? 1), 0)); // 1+1+3+3+1+5=14
    expect(new Set(deck.map((t) => t.id)).size).toBe(deck.length);
  });

  it("公道买卖:访客付指导价得宝,城主收银(玩家间流转,无银行注入)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    e.resolveTreasureOwner({ type: "fair", treasureId: TID });
    expect(mover.treasures.length).toBe(1); // 访客得宝
    expect(owner.treasures.length).toBe(0); // 城主送出
    expect(mover.cash).toBe(moverCash0 - guide); // 访客付指导价
    expect(owner.cash).toBe(ownerCash0 + guide); // 城主收银(玩家间)
  });

  it("坐地起价(翻倍城·洛阳 tradeMult):售价 = 指导价×tradeMult[level],且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-luoyang")!;
    expect(def.tradeMult).toEqual([2, 4, 6, 10]); // 由旧 multiply(2) 转换
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    const price = guide * 2; // L0 tradeMult=2
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(owner.treasures.length).toBe(0);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(owner.cash).toBe(ownerCash0 + price);
    expect(price).toBeGreaterThan(guide); // 高于指导价
  });

  it("坐地起价(加价城·襄阳 tradeAdd):售价 = 指导价 + tradeAdd[level],且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-xiangyang")!;
    expect(def.tradeAdd).toEqual([300, 600, 900, 1500]); // 由旧 markup(300) 转换
    const { mover, guide } = setupOwnerChoice(e, "prop-xiangyang");
    const moverCash0 = mover.cash;
    const price = guide + 300; // L0 tradeAdd=300
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(price).toBeGreaterThan(guide);
  });

  it("坐地起价随城等级提升:L2 价格 > L0 价格", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-luoyang")!;
    const guide = TREASURE_PRICE[TLEVEL];
    // L0 vs L2:tradeMult=[2,4,6,10]
    const priceL0 = premiumPriceOf(guide, def, 0);
    const priceL2 = premiumPriceOf(guide, def, 2);
    expect(priceL0).toBe(guide * 2);
    expect(priceL2).toBe(guide * 6);
    expect(priceL2).toBeGreaterThan(priceL0);
  });

  it("premiumPriceOf:无 tradeAdd/tradeMult 时回退旧 trade 公式 + CITY_LEVEL_MULTIPLIER", () => {
    const guide = 1000;
    // multiply(2) + level 1
    const p1 = premiumPriceOf(guide, { trade: { type: "multiply", param: 2 } }, 1);
    expect(p1).toBe(guide * 2 * CITY_LEVEL_MULTIPLIER[1]);
    // markup(300) + level 2
    const p2 = premiumPriceOf(guide, { trade: { type: "markup", param: 300 } }, 2);
    expect(p2).toBe(guide + 300 * CITY_LEVEL_MULTIPLIER[2]);
    // 都没设:tradePriceOf 默认 ×1.5
    const p3 = premiumPriceOf(guide, {}, 0);
    expect(p3).toBe(tradePriceOf(guide, undefined, 1));
  });

  it("跳过:不交易,无珍宝/资金变化,结束回合", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover } = setupOwnerChoice(e, "prop-luoyang");
    const ownerCash0 = owner.cash;
    const ownerTreas0 = owner.treasures.length;
    e.resolveTreasureOwner({ type: "skip" });
    expect(owner.treasures.length).toBe(ownerTreas0);
    expect(owner.cash).toBe(ownerCash0);
    expect(mover.treasures.length).toBe(0);
    expect(e.turnPhase).toBe("Roll"); // 已 endTurn → 下一玩家 Roll
  });
});

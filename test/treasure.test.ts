import { describe, it, expect } from "bun:test";
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
    level: 1, maxLevel: def.maxLevel,
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
    expect(def.tradeMult).toEqual([4, 6, 10]); // 逐级(Lv1-3),由旧 multiply(2) 转换
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    const price = guide * 4; // Lv1 tradeMult=4
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
    expect(def.tradeAdd).toEqual([600, 900, 1500]); // 逐级(Lv1-3),由旧 markup(300) 转换
    const { mover, guide } = setupOwnerChoice(e, "prop-xiangyang");
    const moverCash0 = mover.cash;
    const price = guide + 600; // Lv1 tradeAdd=600
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(price).toBeGreaterThan(guide);
  });

  it("坐地起价随城等级提升:Lv3 价格 > Lv1 价格", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-luoyang")!;
    const guide = TREASURE_PRICE[TLEVEL];
    // Lv1 vs Lv3:tradeMult=[4,6,10](等级 1..3)
    const priceL1 = premiumPriceOf(guide, def, 1);
    const priceL3 = premiumPriceOf(guide, def, 3);
    expect(priceL1).toBe(guide * 4);
    expect(priceL3).toBe(guide * 10);
    expect(priceL3).toBeGreaterThan(priceL1);
  });

  it("premiumPriceOf:无 tradeAdd/tradeMult 时回退旧 trade 公式 + CITY_LEVEL_MULTIPLIER", () => {
    const guide = 1000;
    // multiply(2) + Lv1(下标 = 等级-1)
    const p1 = premiumPriceOf(guide, { trade: { type: "multiply", param: 2 } }, 1);
    expect(p1).toBe(guide * 2 * CITY_LEVEL_MULTIPLIER[0]);
    // markup(300) + Lv2
    const p2 = premiumPriceOf(guide, { trade: { type: "markup", param: 300 } }, 2);
    expect(p2).toBe(guide + 300 * CITY_LEVEL_MULTIPLIER[1]);
    // 都没设:tradePriceOf 默认 ×1.5
    const p3 = premiumPriceOf(guide, {}, 1);
    expect(p3).toBe(tradePriceOf(guide, undefined, CITY_LEVEL_MULTIPLIER[0]));
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

  it("访客现金不足:珍宝进托管区,不可被访客变卖抵抗破产(套利封堵)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const ownerCash0 = owner.cash;
    mover.cash = guide - 1; // 现金不够付指导价
    mover.treasures.push({ id: "other-treasure", name: "旧藏", level: 2, count: 1, desc: "" }); // 有资产可清算
    e.resolveTreasureOwner({ type: "fair", treasureId: TID });
    expect(mover.treasures.map((t) => t.id)).toEqual(["other-treasure"]); // 未得宝:珍宝在托管区
    expect(e.escrowTreasure).not.toBeNull(); // 托管区有此珍宝
    expect(e.pendingDebt).not.toBeNull(); // 进入破产清算
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.sellTreasureBankruptcy(TID); // 托管珍宝不在访客手中 → 拒绝,仅告警
    expect(mover.cash).toBe(guide - 1); // 未借托管珍宝套现
    expect(owner.cash).toBe(ownerCash0); // 城主尚未收款
    expect(owner.treasures.length).toBe(0); // 也不在城主手中(在托管区)
  });

  it("清算自救成功:付清欠款后托管珍宝交货给买家", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const ownerCash0 = owner.cash;
    mover.cash = guide - 1;
    // 给访客一件可变卖的其他珍宝(Lv2,指导价足以自救)
    mover.treasures.push({ id: "other-treasure", name: "旧藏", level: 2, count: 1, desc: "" });
    e.resolveTreasureOwner({ type: "fair", treasureId: TID });
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.sellTreasureBankruptcy("other-treasure"); // 只能变卖自己的旧藏
    e.confirmBankruptcySettle();
    expect(mover.treasures.map((t) => t.id)).toEqual([TID]); // 付清后托管珍宝交割
    expect(e.escrowTreasure).toBeNull();
    expect(mover.cash).toBe(guide - 1 + 200 - guide); // 变卖旧藏(Lv2=200)后恰好清偿,余 199
    expect(owner.cash).toBe(ownerCash0 + guide); // 城主足额收款
    expect(e.turnPhase).toBe("Roll"); // 已 endTurn
  });

  it("清算失败破产:托管珍宝退回卖家,不随买家资产转债主", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    mover.cash = guide - 1;
    mover.treasures = []; // 无可变卖资产 → 直接破产(无清算阶段)
    e.resolveTreasureOwner({ type: "fair", treasureId: TID });
    expect(mover.isBankrupt).toBe(true);
    expect(e.escrowTreasure).toBeNull();
    expect(owner.treasures.map((t) => t.id)).toEqual([TID]); // 珍宝退回卖家
    expect(mover.treasures.length).toBe(0);
  });

  it("坐地起价现金不足:同样进托管区,不得先得宝(premium 路径)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const ownerCash0 = owner.cash;
    const price = guide * 4; // Lv1 tradeMult=4
    mover.cash = price - 1;
    mover.treasures.push({ id: "other-treasure", name: "旧藏", level: 2, count: 1, desc: "" }); // 有资产可清算
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1); // 只有旧藏,托管珍宝未入袋
    expect(mover.treasures[0].id).toBe("other-treasure");
    expect(e.escrowTreasure).not.toBeNull();
    expect(e.escrowTreasure!.price).toBe(price);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(owner.cash).toBe(ownerCash0);
  });
});

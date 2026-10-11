import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
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
import { testEngine } from "@core/testing";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
      continue;
    }
    e.pickCapital(idx, e.offeredCapitals[0]!); // 三选一首项(候选外落子会被引擎拒绝)
  }
}

/** 放行军师窗(开局发牌后入相位;endTurn 后下家停在 AwaitingJinnang,已 Roll 时零操作)。 */
function passJinnang(e: GameEngine): GameEngine {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
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
    propertyId: defId,
    group: def.group,
    level: 0,
    maxLevel: def.maxLevel,
  });
  owner.treasures.push({ id: TID, name: "测试珍宝", level: TLEVEL, count: 1, desc: "" });
  e.treasureVisitor = { def, ownerIdx };
  testEngine(e).forceTurnPhase("AwaitingTreasureOwner");
  return { owner, mover: e.activePlayer, def, guide: TREASURE_PRICE[TLEVEL] };
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

  it("坐地起价(翻倍城·成都 tradeMult):售价 = 指导价×tradeMult[level],且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-chengdu")!;
    expect(def.tradeMult).toEqual([2, 3, 4, 5]); // 乘法城逐级(Lv0-3),下标 = 等级
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-chengdu");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    const price = guide * 2; // Lv0 tradeMult=2(乘法城)
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
    expect(def.tradeAdd).toEqual([300, 1000, 2500, 5500]); // 襄阳 34 两档(Lv0-3),下标 = 等级
    const { mover, guide } = setupOwnerChoice(e, "prop-xiangyang");
    const moverCash0 = mover.cash;
    const price = guide * 2 + 300; // Lv0 = 指导价×tradeMult[0](2) + tradeAdd[0](300),先乘再加
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(price).toBeGreaterThan(guide);
  });

  it("坐地起价随城等级提升:Lv3 价格 > Lv0 价格", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-chengdu")!;
    const guide = TREASURE_PRICE[TLEVEL];
    // Lv0 vs Lv3:乘法城 tradeMult=[2,3,4,5](等级 0..3)
    const priceL0 = premiumPriceOf(guide, def, 0);
    const priceL3 = premiumPriceOf(guide, def, 3);
    expect(priceL0).toBe(guide * 2);
    expect(priceL3).toBe(guide * 5);
    expect(priceL3).toBeGreaterThan(priceL0);
  });

  it("premiumPriceOf:无 tradeAdd/tradeMult 时回退旧 trade 公式 + CITY_LEVEL_MULTIPLIER", () => {
    const guide = 1000;
    // multiply(2) + Lv0(下标 = 等级)
    const p0 = premiumPriceOf(guide, { trade: { type: "multiply", param: 2 } }, 0);
    expect(p0).toBe(guide * 2 * CITY_LEVEL_MULTIPLIER[0]);
    // markup(300) + Lv1
    const p1 = premiumPriceOf(guide, { trade: { type: "markup", param: 300 } }, 1);
    expect(p1).toBe(guide + 300 * CITY_LEVEL_MULTIPLIER[1]);
    // 都没设:tradePriceOf 默认 ×1.5
    const p2 = premiumPriceOf(guide, {}, 0);
    expect(p2).toBe(tradePriceOf(guide, undefined, CITY_LEVEL_MULTIPLIER[0]));
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
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 已 endTurn(军师窗放行)→ 下一玩家 Roll
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
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 已 endTurn
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
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-chengdu");
    const ownerCash0 = owner.cash;
    const price = guide * 2; // Lv0 乘法城 tradeMult=2
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

describe("宝物城并权与落格顺序(ADR-0024)", () => {
  /** sanguo 首座未作都城的宝物城(ADR-0024 后宝物城可选都,须避开 taken)。 */
  function treasureTile(e: GameEngine) {
    return e.board.tiles.find(
      (t) => t.type === "TreasureCity" && !e.takenCapitalIndices.has(t.index),
    )!;
  }
  /** 宝物城链尾探宝的战报行(treasureGain 得宝 / treasureMiss 失之交臂)。 */
  const treasureTrail = (e: GameEngine) =>
    e.log.some((l) => l.detail.includes("treasureGain") || l.detail.includes("treasureMiss"));

  it("落无主宝物城 → 可购决策 → 买成后链尾探宝(buy+探宝留痕),探宝自带 endTurn", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = treasureTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 同权:进购地决策(不再直探)
    expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: def.id });
    e.buyProperty();
    expect(mover.properties.some((h) => h.propertyId === def.id)).toBe(true); // 得地
    expect(e.log.some((l) => l.detail.includes(`buy player=${mover.id} prop=${def.id}`))).toBe(
      true,
    );
    expect(treasureTrail(e)).toBe(true); // 交易链尾探宝留痕
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 探宝自带 endTurn
    expect(e.treasureDeck.length).toBe(13); // 牌堆 14 → 抽 1(失败也回堆底,此处不计成败只计抽动)
  });

  it("落己方宝物城 → 扩军成功 → 链尾探宝", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = treasureTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    mover.properties.push({
      propertyId: def.id,
      group: def.group,
      level: 0,
      maxLevel: def.maxLevel,
    });
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingDecision");
    e.upgradeProperty();
    expect(mover.properties.find((h) => h.propertyId === def.id)!.level).toBe(1);
    expect(treasureTrail(e)).toBe(true); // PropertyUpgraded 派发后才探宝
    expect(passJinnang(e).turnPhase).toBe("Roll");
  });

  it("落他人宝物城:城主有宝 → 交涉 skip 终端接探宝;城主无宝 → 无事发生终端直探", () => {
    // 有宝:skip 后接链尾探宝(牌堆清空 → treasureEmpty 终端,隔离拼点结果)
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const owner = e.players.find((p) => p !== mover)!;
    const tile = treasureTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    owner.properties.push({
      propertyId: def.id,
      group: def.group,
      level: 0,
      maxLevel: def.maxLevel,
    });
    owner.treasures.push({ id: TID, name: "测试珍宝", level: TLEVEL, count: 1, desc: "" });
    e.treasureDeck = [];
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner");
    e.resolveTreasureOwner({ type: "skip" });
    expect(passJinnang(e).turnPhase).toBe("Roll"); // skip → 链尾探宝(空堆)→ endTurn
    expect(e.log.some((l) => l.detail.includes("treasureEmpty"))).toBe(true);

    // 无宝:无事发生终端直接探宝(Lv1 拼点恒成),无决策相位
    const e2 = makeEngine(1);
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    const owner2 = e2.players.find((p) => p !== mover2)!;
    const tile2 = treasureTile(e2);
    const def2 = e2.catalog.get(tile2.propertyId!)!;
    owner2.properties.push({
      propertyId: def2.id,
      group: def2.group,
      level: 0,
      maxLevel: def2.maxLevel,
    });
    e2.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    testEngine(e2).landActiveAt(tile2.index);
    expect(passJinnang(e2).turnPhase).toBe("Roll"); // 无交涉窗口:探宝一步收口
    expect(e2.log.some((l) => l.detail.includes("noTreasure"))).toBe(true);
    expect(mover2.treasures.map((t) => t.id)).toEqual(["probe-t"]);
  });

  it("自动拒绝(无委任状)仍探宝:自动执行终端接链尾探宝", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.warrants = 0; // 无委任状 → 购地选项不可用 → 仅剩默认行为,自动不取
    const tile = treasureTile(e);
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    testEngine(e).landActiveAt(tile.index);
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 自动拒绝 → 探宝一步收口
    expect(e.log.some((l) => l.detail.includes("skipAvailable"))).toBe(true); // 自动不取留痕
    expect(mover.properties.some((h) => h.propertyId === tile.propertyId)).toBe(false); // 未购
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 仍探宝
  });

  it("交涉 premium 付款进清算:探宝不触发(链中断),清算交割后仍不触发", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const owner = e.players.find((p) => p !== mover)!;
    const tile = treasureTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    owner.properties.push({
      propertyId: def.id,
      group: def.group,
      level: 0,
      maxLevel: def.maxLevel,
    });
    owner.treasures.push({ id: TID, name: "测试珍宝", level: TLEVEL, count: 1, desc: "" });
    // 咸阳 Lv0 premium = 指导价×2 + 300;付不起但有可变卖资产 → 清算自救挂起
    const price = TREASURE_PRICE[TLEVEL] * 2 + 300;
    mover.cash = price - 1;
    mover.treasures.push({ id: "old-t", name: "旧藏", level: 5, count: 1, desc: "" }); // 变卖 600 足额自救
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner");
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle"); // 链中途清算:探宝不触发
    expect(treasureTrail(e)).toBe(false);
    e.sellTreasureBankruptcy("old-t");
    e.confirmBankruptcySettle();
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 交割完成收回合
    expect(mover.treasures.map((t) => t.id)).toEqual([TID]); // 付清交割(escrow 语义)
    expect(treasureTrail(e)).toBe(false); // 清算路全程不补探宝
  });
});

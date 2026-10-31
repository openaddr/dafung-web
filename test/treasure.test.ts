import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { TREASURE_PRICE, TREASURES, createTreasureDeck, premiumPriceOf } from "@core/treasures";
import { beginGameEventBatch } from "@core/game-events";
import { testEngine } from "@core/testing";

const MAP = loadMap(huanyouData);

function makeEngine(
  seed = 1,
  encounter?: { good?: number; neutral?: number; bad?: number },
  seats?: SeatConfig[],
): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    ...(encounter
      ? {
          encounter: {
            enabled: true,
            baseRates: {
              good: encounter.good ?? 34,
              neutral: encounter.neutral ?? 33,
              bad: encounter.bad ?? 33,
            },
          },
        }
      : {}),
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

/** 放行出牌阶段(开局发牌后入相位;endTurn 后下家停在 AwaitingJinnang,已 Roll 时零操作)。 */
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

  it("坐地起价(纯乘城·街亭 tradeMult):售价 = 指导价×tradeMult[level],且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-jieting")!;
    expect(def.tradeMult).toEqual([2, 3, 4, 7]); // 奇城逐级(Lv0-3;#827 再平衡 Lv2 5→4),下标 = 等级
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-jieting");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    const price = guide * 2; // Lv0 tradeMult=2(奇城)
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(owner.treasures.length).toBe(0);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(owner.cash).toBe(ownerCash0 + price);
    expect(price).toBeGreaterThan(guide); // 高于指导价
  });

  it("坐地起价(纯加城·襄阳 tradeAdd):售价 = 指导价×1 + tradeAdd[level],且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-xiangyang")!;
    expect(def.tradeAdd).toEqual([200, 400, 800, 1600]); // 郡城加值逐级(Lv0-3),下标 = 等级
    expect(def.tradeMult).toEqual([1, 1, 1, 1]); // 纯加城倍率恒 1
    const { mover, guide } = setupOwnerChoice(e, "prop-xiangyang");
    const moverCash0 = mover.cash;
    const price = guide + 200; // Lv0 = 指导价×tradeMult[0](1) + tradeAdd[0](200),先乘再加
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(price).toBeGreaterThan(guide);
  });

  it("坐地起价随城等级提升:Lv3 价格 > Lv0 价格", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-jieting")!;
    const guide = TREASURE_PRICE[TLEVEL];
    // Lv0 vs Lv3:奇城 tradeMult=[2,3,5,7](等级 0..3)
    const priceL0 = premiumPriceOf(guide, def, 0);
    const priceL3 = premiumPriceOf(guide, def, 3);
    expect(priceL0).toBe(guide * 2);
    expect(priceL3).toBe(guide * 7);
    expect(priceL3).toBeGreaterThan(priceL0);
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
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 已 endTurn(出牌阶段放行)→ 下一玩家 Roll
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
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-jieting");
    const ownerCash0 = owner.cash;
    const price = guide * 2; // Lv0 奇城 tradeMult=2
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

describe("珍宝城落格固定事件与链序(#825;ADR-0024 同权)", () => {
  /** huanyou 珍宝城(#825 后由 event:"treasure" 承载,旧格型已退役;须避开已占都城)。 */
  function treasureTile(e: GameEngine) {
    return e.board.tiles.find(
      (t) => t.event === "treasure" && !e.takenCapitalIndices.has(t.index),
    )!;
  }
  /** 探宝拼点战报行(treasureGain 得宝 / treasureMiss 失之交臂)。 */
  const treasureTrail = (e: GameEngine) =>
    e.log.some((l) => l.detail.includes("treasureGain") || l.detail.includes("treasureMiss"));

  it("落无主珍宝城:落格即探宝(先于可购决策),买成收口零探宝(#825 链序)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = treasureTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }]; // Lv1 拼点恒成
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 探宝毕直进购地决策(交易链)
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝已在落格发生
    const gainIdx = e.log.findIndex((l) => l.detail.includes("treasureGain"));
    const availIdx = e.log.findIndex((l) => l.detail.includes("available"));
    expect(gainIdx).toBeGreaterThanOrEqual(0);
    expect(availIdx).toBeGreaterThan(gainIdx); // 探宝先于交易链(可购留痕在后)
    beginGameEventBatch(e); // 批界=购地收口(#636 探宝拼点事件面断言)
    e.buyProperty();
    expect(mover.properties.some((h) => h.propertyId === def.id)).toBe(true); // 得地
    expect(e.log.some((l) => l.detail.includes(`buy player=${mover.id} prop=${def.id}`))).toBe(
      true,
    );
    expect(e.log.some((l) => l.detail.includes("treasureEmpty"))).toBe(false); // 收口零补抽(堆已空,补抽必留痕)
    expect(e.snapshot().events.some((ev) => ev.kind === "duelResolved")).toBe(false); // 探宝拼点=单人判定不走 resolveDuel,不派(#636)
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 收口结束回合
  });

  it("落己方珍宝城:探宝先行,扩军收口零探宝", () => {
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
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝先行于扩军决策
    e.upgradeProperty();
    expect(mover.properties.find((h) => h.propertyId === def.id)!.level).toBe(1);
    expect(treasureTrail(e)).toBe(true); // 全程恰落格一次探宝
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 收口结束回合(链尾零探宝)
  });

  it("落他人珍宝城:探宝先于交涉窗口,skip 收口零补探;城主无宝同链序", () => {
    // 有宝:落格探宝(堆空 → treasureEmpty 沉默留痕)后进交涉;skip → endTurn 零补探
    const e = makeEngine(1);
    finishSetup(e);
    const owner = e.players.find((p) => p !== e.activePlayer)!;
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
    expect(e.turnPhase).toBe("AwaitingTreasureOwner"); // 探宝毕进交涉窗口
    expect(e.log.filter((l) => l.detail.includes("treasureEmpty")).length).toBe(1); // 探宝事件位已走(堆空沉默)
    e.resolveTreasureOwner({ type: "skip" });
    expect(passJinnang(e).turnPhase).toBe("Roll"); // skip 收口结束回合
    expect(e.log.filter((l) => l.detail.includes("treasureEmpty")).length).toBe(1); // 零补探

    // 无宝:探宝先行(拼点必得),随后 noTreasure 终端收口,无交涉窗口
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
    expect(passJinnang(e2).turnPhase).toBe("Roll"); // 探宝+无事发生一步收口
    expect(e2.log.some((l) => l.detail.includes("noTreasure"))).toBe(true);
    expect(mover2.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝已发生
    const gainIdx2 = e2.log.findIndex((l) => l.detail.includes("treasureGain"));
    const noTreasureIdx = e2.log.findIndex((l) => l.detail.includes("noTreasure"));
    expect(gainIdx2).toBeLessThan(noTreasureIdx); // 探宝先于城池结算终端
  });

  it("自动拒绝(无委任状):探宝已在落格先行,收口零补探", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.warrants = 0; // 无委任状 → 购地选项不可用 → 仅剩默认行为,自动不取
    const tile = treasureTile(e);
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    testEngine(e).landActiveAt(tile.index);
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 探宝+自动拒绝一步收口
    expect(e.log.some((l) => l.detail.includes("skipAvailable"))).toBe(true); // 自动不取留痕
    expect(mover.properties.some((h) => h.propertyId === tile.propertyId)).toBe(false); // 未购
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝照常(先于拒绝已结算)
  });

  it("交涉 premium 付款进清算:探宝已先行发生(位移语义,清算不再抑制、链尾零补抽)", () => {
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
    // 落格探宝先成(probe Lv1 恒得),再交涉:premium 价付不起 → 清算自救挂起
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    const price = premiumPriceOf(TREASURE_PRICE[TLEVEL], def, 0);
    mover.cash = price - 1;
    testEngine(e).landActiveAt(tile.index);
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝已先行发生(付银之前)
    const gainIdx = e.log.findIndex((l) => l.detail.includes("treasureGain"));
    const awaitIdx = e.log.findIndex((l) => l.detail.includes("treasureAwait"));
    expect(gainIdx).toBeLessThan(awaitIdx); // 探宝先于交涉窗口
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle"); // 链中途清算
    e.sellTreasureBankruptcy("probe-t"); // 变卖落格探得之宝(Lv1=100 ≥ 欠差)自救
    e.confirmBankruptcySettle();
    expect(passJinnang(e).turnPhase).toBe("Roll"); // 交割完成收回合
    expect(mover.treasures.map((t) => t.id)).toEqual([TID]); // 付清交割(escrow 语义)
    const treasureLines = e.log.filter(
      (l) =>
        l.detail.includes("treasureGain") ||
        l.detail.includes("treasureMiss") ||
        l.detail.includes("treasureEmpty"),
    );
    expect(treasureLines.length).toBe(1); // 全程恰落格一次探宝(清算不抑制、链尾零补抽)
  });

  it("交涉付款直破产:探宝已先行发生(堆空沉默留痕),破产收口零补抽", () => {
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
    e.treasureDeck = []; // 堆空:探宝事件位沉默留痕(treasureEmpty),不产可变卖资产
    mover.cash = 0; // 无银无资产 → premium 付款直破产
    testEngine(e).landActiveAt(tile.index);
    const emptyIdx = e.log.findIndex((l) => l.detail.includes("treasureEmpty"));
    const awaitIdx = e.log.findIndex((l) => l.detail.includes("treasureAwait"));
    expect(emptyIdx).toBeGreaterThanOrEqual(0);
    expect(emptyIdx).toBeLessThan(awaitIdx); // 探宝事件位已结算(先于交涉)
    e.resolveTreasureOwner({ type: "premium", treasureId: TID });
    expect(mover.isBankrupt).toBe(true); // 付款破产(位移语义:探宝不被抑制,已先行)
    expect(e.log.filter((l) => l.detail.includes("treasureEmpty")).length).toBe(1); // 破产收口零补抽
    expect(passJinnang(e).turnPhase).toBe("GameOver"); // 2 人局:破产即终局(引擎真终端)
  });
});

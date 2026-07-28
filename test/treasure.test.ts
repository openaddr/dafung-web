import { describe, it, expect } from "vitest";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { TREASURE_PRICE, CITY_LEVEL_MULTIPLIER, TREASURES, createTreasureDeck } from "@core/treasures";

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
const TLEVEL = 1; // 指导价 100,贸易不会触发破产

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

  it("赠宝:访客得宝、城主得指导价赏银(银行注入)、城升级", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const { owner, mover, def, guide } = setupOwnerChoice(e, "prop-luoyang");
    const ownerCash0 = owner.cash;
    e.resolveTreasureOwner({ type: "gift", treasureId: TID });
    expect(mover.treasures.length).toBe(1); // 访客得宝
    expect(owner.treasures.length).toBe(0); // 城主送出
    expect(owner.cash).toBe(ownerCash0 + guide); // 朝廷赏银
    expect(owner.properties.find((p) => p.propertyId === def.id)!.level).toBe(1); // 城升级
  });

  it("贸易(翻倍城·洛阳):售价 = 指导价×param×等级倍率,且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-luoyang")!;
    expect(def.trade?.type).toBe("multiply");
    const { owner, mover, guide } = setupOwnerChoice(e, "prop-luoyang");
    const moverCash0 = mover.cash;
    const ownerCash0 = owner.cash;
    const price = guide * def.trade!.param * CITY_LEVEL_MULTIPLIER[0];
    e.resolveTreasureOwner({ type: "trade", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(owner.treasures.length).toBe(0);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(owner.cash).toBe(ownerCash0 + price);
    expect(price).toBeGreaterThan(guide); // 高于指导价
  });

  it("贸易(加价城·襄阳):售价 = (指导价+param)×等级倍率,且高于指导价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const def = e.catalog.get("prop-xiangyang")!;
    expect(def.trade?.type).toBe("markup");
    const { mover, guide } = setupOwnerChoice(e, "prop-xiangyang");
    const moverCash0 = mover.cash;
    const price = guide + def.trade!.param * CITY_LEVEL_MULTIPLIER[0];
    e.resolveTreasureOwner({ type: "trade", treasureId: TID });
    expect(mover.treasures.length).toBe(1);
    expect(mover.cash).toBe(moverCash0 - price);
    expect(price).toBeGreaterThan(guide);
  });

  it("跳过:不赠不卖,无珍宝/资金/城变化,结束回合", () => {
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

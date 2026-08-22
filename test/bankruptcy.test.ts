import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import type { Player } from "@core/types";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

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
    if (e.players[idx].isBot) { e.aiSetupStep(); continue; }
    const capIdx = e.firstAvailableCapitalIndex();
    if (capIdx < 0) break;
    e.pickCapital(idx, capIdx);
  }
}

function hero(id: string, name: string) {
  return { id, name, title: "", desc: "", skills: [{ id: `${id}-move+1`, when: "BeforeMarch" as const, effect: "moveBonus", params: { steps: 1 }, scope: "self" as const }], image: "/assets/heroes/hero-zhouyu-sgs.png" };
}

/** 给玩家塞一座非都城的可变卖城(catalog 里 valueByLevel 齐全的普通城),返回其 Lv.0 变卖价。 */
function giveSellableCity(e: GameEngine, p: Player): { propId: string; lv0Value: number } {
  const capProp = e.board.at(p.capitalIndex)?.propertyId!;
  const tile = e.board.tiles.find((t) => !!t.propertyId && t.propertyId !== capProp && e.catalog.get(t.propertyId) != null)!;
  const def = e.catalog.get(tile.propertyId!)!;
  p.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
  return { propId: def.id, lv0Value: def.valueByLevel[0] };
}

describe("破产清算", () => {
  it("现金不足但有珍宝 → 进入清算;卖珍宝凑够 → 免破产继续", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600(经济 v2)
    const r = (e as any).payOrLiquidate(p, null, 200); // 欠 200,cash 100,有珍宝 → 清算
    expect(r).toBe("liquidating");
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(e.pendingDebt?.amount).toBe(200);
    e.sellTreasureBankruptcy("t1"); // 卖宝 +600 → cash 700
    expect(p.cash).toBe(700);
    e.confirmBankruptcySettle(); // 凑够 → 扣 200
    expect(p.cash).toBe(500);
    expect(p.isBankrupt).toBe(false);
  });

  it("无资产可清(仅都城)→ 直接破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 50;
    // 选都后只有都城(不可卖)+ 无珍宝/名士
    const r = (e as any).payOrLiquidate(p, null, 200);
    expect(r).toBe("bankrupt");
    expect(p.isBankrupt).toBe(true);
  });

  it("清算卖光仍不足 → 破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 指导价 100
    (e as any).payOrLiquidate(p, null, 500); // 欠 500,宝仅 100
    e.sellTreasureBankruptcy("t1"); // +100 → cash 100
    e.confirmBankruptcySettle(); // 仍不足 → 破产
    expect(p.isBankrupt).toBe(true);
  });

  it("名士换银 200 + 释放回招贤池", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.heroes.push(hero("zhouyu", "周瑜"));
    (e as any).payOrLiquidate(p, null, 150); // 欠 150,有名士 → 清算
    e.cashHeroBankruptcy("zhouyu"); // +200,释放
    expect(p.cash).toBe(200);
    expect(p.heroes.length).toBe(0);
    e.confirmBankruptcySettle(); // 凑够 → 扣 150
    expect(p.cash).toBe(50);
    expect(p.isBankrupt).toBe(false);
  });

  it("都城不可变卖(清算时 sellPropertyBankruptcy 拒绝)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const capProp = e.board.at(p.capitalIndex)?.propertyId!;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 有珍宝才能进清算
    (e as any).payOrLiquidate(p, null, 99999);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.sellPropertyBankruptcy(capProp); // 都城 → 拒绝(warn,不变)
    expect(p.properties.some((h) => h.propertyId === capProp)).toBe(true); // 都城仍在
    expect(p.cash).toBe(0); // 没卖成都城
  });

  it("凑足即止:自救达标(现金≥债务)后,三类变卖命令一律被引擎硬拒绝", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    p.heroes.push(hero("zhouyu", "周瑜"), hero("zhugeliang", "诸葛亮"));
    const city = giveSellableCity(e, p);
    (e as any).payOrLiquidate(p, null, 150); // 欠 150
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.cashHeroBankruptcy("zhouyu"); // +200 → cash 200 ≥ 150,自救达标
    expect(p.cash).toBe(200);
    // 达标后珍宝/城/名士三类守卫一致:一律拒绝,资产原封不动
    e.sellTreasureBankruptcy("t1");
    e.sellPropertyBankruptcy(city.propId);
    e.cashHeroBankruptcy("zhugeliang");
    expect(p.cash).toBe(200);
    expect(p.treasures.map((t) => t.id)).toEqual(["t1"]);
    expect(p.properties.some((h) => h.propertyId === city.propId)).toBe(true);
    expect(p.heroes.map((h) => h.id)).toEqual(["zhugeliang"]);
    expect(e.log.some((l) => l.brief.includes("已凑足债务,不可再卖"))).toBe(true); // 明确 reason 进日志
    e.confirmBankruptcySettle(); // 确认结算语义不变:照常清偿 150
    expect(p.cash).toBe(50);
    expect(p.isBankrupt).toBe(false);
  });

  it("恰好差 1 分时卖最便宜的仍允许(单笔可超额凑足),凑足后立刻封死", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 499;
    p.treasures.push(
      { id: "cheap", name: "草帽", level: 1, count: 1, desc: "" }, // 指导价 100(最便宜)
      { id: "pricey", name: "玉玺", level: 10, count: 1, desc: "" }, // 指导价 3000
    );
    (e as any).payOrLiquidate(p, null, 500); // 欠 500,cash 499,差 1 分
    e.sellTreasureBankruptcy("cheap"); // 仍欠 1 分 → 卖最便宜的允许(卖出即凑足)
    expect(p.cash).toBe(599);
    e.sellTreasureBankruptcy("pricey"); // 已达标 → 拒绝
    expect(p.cash).toBe(599);
    expect(p.treasures.map((t) => t.id)).toEqual(["pricey"]);
    e.confirmBankruptcySettle();
    expect(p.cash).toBe(99); // 599 − 500
    expect(p.isBankrupt).toBe(false);
  });

  it("清算自救走完后状态干净(pendingDebt/托管/访客态复位,回到 Roll)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" });
    (e as any).payOrLiquidate(p, null, 200);
    e.sellTreasureBankruptcy("t1"); // +600 → 700
    e.confirmBankruptcySettle();
    expect(e.pendingDebt).toBeNull();
    expect(e.escrowTreasure).toBeNull();
    expect(e.treasureVisitor).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // endTurn 后轮到下一玩家
    expect(p.isBankrupt).toBe(false);
    expect(p.treasures.length).toBe(0); // 卖掉的珍宝不在手中
  });

  it("破产出局走完后状态干净(pendingDebt 清空、名士回招贤池)", () => {
    const e = makeEngine(1, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.heroes.push(hero("zhouyu", "周瑜"));
    (e as any).payOrLiquidate(p, null, 500); // 欠 500,仅有名士(+200)可卖
    e.cashHeroBankruptcy("zhouyu"); // +200,仍差 300
    e.confirmBankruptcySettle(); // 凑不够 → 破产出局
    expect(p.isBankrupt).toBe(true);
    expect(e.pendingDebt).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // 3 人在局,游戏未结束
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false); // 名士释放回招贤池
  });
});

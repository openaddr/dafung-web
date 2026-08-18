import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

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
    const capIdx = e.firstAvailableCapitalIndex();
    if (capIdx < 0) break;
    e.pickCapital(idx, capIdx);
  }
}

describe("破产清算", () => {
  it("现金不足但有珍宝 → 进入清算;卖珍宝凑够 → 免破产继续", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 500
    const r = (e as any).payOrLiquidate(p, null, 200); // 欠 200,cash 100,有珍宝 → 清算
    expect(r).toBe("liquidating");
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(e.pendingDebt?.amount).toBe(200);
    e.sellTreasureBankruptcy("t1"); // 卖宝 +500 → cash 600
    expect(p.cash).toBe(600);
    e.confirmBankruptcySettle(); // 凑够 → 扣 200
    expect(p.cash).toBe(400);
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
    p.heroes.push({ id: "zhouyu", name: "周瑜", title: "", desc: "", skill: { kind: "moveBonus", steps: 1 }, image: "/assets/heroes/hero-zhouyu-sgs.png" });
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
});

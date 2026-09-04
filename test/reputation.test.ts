// 声望贯通单测(#121):初值恒 0 / ±100 夹紧 / 天命格落格 +20 / 锦囊格退役按普通格。
// 落格经 testEngine.landActiveAt 直摆直结算,与随机流无关,种子不影响断言。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import { createDice } from "@core/dice";
import { testEngine } from "@core/testing";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);
const FATE_TILE = 13;
const CHANCE_TILE = 31;

function makeEngine(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  });
}

describe("声望字段贯通(#121)", () => {
  it("所有 Seat 初值恒 0", () => {
    const e = makeEngine();
    for (const p of e.players) expect(p.reputation).toBe(0);
  });

  it("addReputation 累加并夹紧 ±100,各 Seat 互不影响", () => {
    const e = makeEngine();
    e.addReputation(0, 40);
    expect(e.players[0].reputation).toBe(40);
    e.addReputation(0, 150); // 40+150 → 夹到 100
    expect(e.players[0].reputation).toBe(100);
    e.addReputation(0, -500); // → 夹到 -100
    expect(e.players[0].reputation).toBe(-100);
    e.addReputation(1, 25);
    expect(e.players[1].reputation).toBe(25);
    expect(e.players[0].reputation).toBe(-100);
  });

  it("落天命格 +20 声望(固定事件,不抽随机)", () => {
    const e = makeEngine();
    const te = testEngine(e);
    const seat = e.activeIndex;
    te.placeActive(FATE_TILE);
    te.land();
    expect(e.players[seat].reputation).toBe(20);
  });

  it("锦囊格退役:按普通格落空结算,声望不变", () => {
    const e = makeEngine();
    const te = testEngine(e);
    const seat = e.activeIndex;
    te.placeActive(CHANCE_TILE);
    te.land();
    expect(e.players[seat].reputation).toBe(0);
    expect(e.activeIndex).not.toBe(seat); // 落空后照常交回合
  });
});

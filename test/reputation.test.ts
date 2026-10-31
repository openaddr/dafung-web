// 声望贯通单测(#121):初值恒 0 / ±100 夹紧 / 天命城落格 +20 / 锦囊城抽牌不动声望。
// 落格经 testEngine.landActiveAt 直摆直结算,与随机流无关,种子不影响断言。
// (#826 全城池制:天命/锦囊都是 event 城池,固定事件解毕续跑交易链。)
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import { testEngine } from "@core/testing";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(huanyouData);
const byEvent = (event: string) => MAP.board.tiles.find((t) => t.event === event)!.index;
const FATE_TILE = byEvent("fate"); // tile-fate-1 天命城(ADR-0027 环位 P37)
const CHANCE_TILE = byEvent("jinnang"); // tile-chance-1 锦囊城(ADR-0027 环位 P41)

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

  it("落天命城 +20 声望(固定事件,不抽随机)", () => {
    const e = makeEngine();
    const te = testEngine(e);
    const seat = e.activeIndex;
    te.placeActive(FATE_TILE);
    te.land();
    expect(e.players[seat].reputation).toBe(20);
  });

  it("落锦囊城:抽牌不改声望,续进交易链", () => {
    const e = makeEngine();
    const te = testEngine(e);
    const seat = e.activeIndex;
    te.placeActive(CHANCE_TILE);
    te.land();
    expect(e.players[seat].reputation).toBe(0);
    expect(e.activeIndex).toBe(seat); // 固定事件解毕续交易链(无主城停可购决策),不交回合
    expect(e.turnPhase).toBe("AwaitingDecision");
  });
});

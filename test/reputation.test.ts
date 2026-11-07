// 声望贯通单测(#121;#1090 去夹紧):初值恒 0 / 无界累加 / 跨档不献牌(#1098 里程碑
// 机制退役,加声望只剩无界累加)/ 天命城落格 +20 / 锦囊城抽牌不动声望。
// 落格经 testEngine.landActiveAt 直摆直结算,与随机流无关,种子不影响断言。
// (#826 全城池制:天命/锦囊都是 event 城池,固定事件解毕续跑交易链。)
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { beginGameEventBatch } from "@core/game-events";
import { createDice } from "@core/dice";
import { testEngine } from "@core/testing";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);
const byEvent = (event: string) => MAP.board.tiles.find((t) => t.event === event)!.index;
const FATE_TILE = byEvent("fate"); // tile-fate-1 受禅台(ADR-0027 环位 P37)
const CHANCE_TILE = byEvent("jinnang"); // tile-chance-1 锦囊城(ADR-0027 环位 P41)

function makeEngine(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

describe("声望字段贯通(#121)", () => {
  it("所有 Seat 初值恒 0", () => {
    const e = makeEngine();
    for (const p of e.players) expect(p.reputation).toBe(0);
  });

  it("addReputation 直接累加无夹紧(#1090),各 Seat 互不影响", () => {
    const e = makeEngine();
    e.addReputation(0, 40);
    expect(e.players[0].reputation).toBe(40);
    e.addReputation(0, 150); // 40+150=190,越界继续
    expect(e.players[0].reputation).toBe(190);
    e.addReputation(0, -500); // 190−500=−310,无下界
    expect(e.players[0].reputation).toBe(-310);
    e.addReputation(1, 25);
    expect(e.players[1].reputation).toBe(25);
    expect(e.players[0].reputation).toBe(-310);
  });

  it("无夹紧越界累加(#1090):90 加 +30 → 120,不再停 100", () => {
    const e = makeEngine();
    e.addReputation(0, 90);
    expect(e.players[0].reputation).toBe(90);
    e.addReputation(0, 30);
    expect(e.players[0].reputation).toBe(120);
  });

  it("跨档不献牌(#1098 否定断言):越过 +30/+60/+90 手牌不增、无 repMilestoneCrossed/jinnangDrawn 产出", () => {
    const e = makeEngine();
    e.doDraftRoll(); // 先走完开局(事件批在开局驱动时开):跨档断言按真实牌库计
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 50) {
      const idx = e.currentSetupPlayerIndex;
      if (idx < 0) break;
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
    const seat = 0;
    const baseHand = e.players[seat].jinnangHandCount;
    beginGameEventBatch(e);
    e.addReputation(seat, 100); // 一口气跨 30/60/90
    expect(e.players[seat].reputation).toBe(100);
    expect(e.players[seat].jinnangHandCount).toBe(baseHand); // 手牌不增
    const kinds = e.snapshot().events.map((ev) => ev.kind);
    expect(kinds).not.toContain("repMilestoneCrossed");
    expect(kinds).not.toContain("jinnangDrawn");
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

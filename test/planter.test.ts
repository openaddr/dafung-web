// 种植件行为面单测(#1298,#1295 Testing Decisions):数值种下后快照与派生量正确——
// 塞牌后手牌=指定牌集、jinnangHandCount 派生一致、目录外牌/坏座位/未知指令当场炸
// (零兜底)。判词单源 src/core/planter.ts 头注;桥/e2e 经同一实现分发(#1298 三层共用)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig } from "@core/authority";
import { createDice } from "@core/dice";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import { applyPlant, giveJinnang, type PlantOp } from "@core/planter";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 1) {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

describe("giveJinnang(塞指定锦囊,裸写形)", () => {
  it("手牌终态=指定牌集(多张与重复牌原样保留),jinnangHandCount 派生一致", () => {
    const e = makeEngine();
    giveJinnang(e, 0, ["火烧连营", "识破诡计", "识破诡计"]);
    expect(e.players[0].jinnangHand).toEqual(["火烧连营", "识破诡计", "识破诡计"]);
    expect(e.players[0].jinnangHandCount).toBe(3);
  });

  it("空牌集=清空手牌(peek 空手目标形)", () => {
    const e = makeEngine();
    giveJinnang(e, 1, ["求贤令"]);
    giveJinnang(e, 1, []);
    expect(e.players[1].jinnangHand).toEqual([]);
    expect(e.players[1].jinnangHandCount).toBe(0);
  });

  it("目录外牌与越界座位当场炸(零兜底:种错的场要响,不静默长出死牌)", () => {
    const e = makeEngine();
    expect(() => giveJinnang(e, 0, ["不是牌"])).toThrow();
    expect(() => giveJinnang(e, 9, ["求贤令"])).toThrow();
  });
});

describe("applyPlant(桥 plant(op) 分发单源)", () => {
  it("giveJinnang 指令与直呼同一实现(终态逐位一致)", () => {
    const a = makeEngine();
    const b = makeEngine();
    giveJinnang(a, 0, ["军情密探"]);
    const op: PlantOp = { kind: "giveJinnang", seat: 0, cards: ["军情密探"] };
    applyPlant(b, op);
    expect(b.players[0].jinnangHand).toEqual(a.players[0].jinnangHand);
    expect(b.players[0].jinnangHandCount).toBe(a.players[0].jinnangHandCount);
  });

  it("未知 kind 当场炸(分发口不吞错)", () => {
    const e = makeEngine();
    expect(() => applyPlant(e, { kind: "noSuchFamily" } as never)).toThrow(/noSuchFamily/);
  });
});

import { expect, it } from "bun:test";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine } from "@core/authority";
import { tileIndexOfProperty } from "@core/board";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { applyCityDamage } from "@core/defense";
import { beginGameEventBatch } from "@core/game-events";
import {
  armBankrupt,
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setDefense,
  setStamina,
} from "@core/planter";
import guanzhongData from "../public/maps/guanzhong.json";

const MAP = loadMap(guanzhongData);
const CITY = "prop-wujun"; // 购入价 3000，两项攻陷奖励各按此计价。
const TILE = tileIndexOfProperty(MAP.board, CITY);

function makeEngine(): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), {
    seats: ["魏", "蜀", "吴", "汉", "晋"].map((guohao) => ({
      name: guohao,
      guohao,
      isBot: false,
    })),
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function burnCity(e: GameEngine, seat: number): void {
  armPhase(e, { phase: "Playing", activeIndex: seat, turnPhase: "AwaitingJinnang" });
  giveJinnang(e, seat, ["火烧连营"]);
  e.submitCommand({ type: "useJinnang", cardId: "火烧连营" });
  e.submitCommand({ type: "useJinnang", cardId: "火烧连营", targets: [TILE] });
}

it("火攻打空后先达到同伤害者接城，最后一击独得攻陷奖励，事件批同步归属和分银", () => {
  const e = makeEngine();
  grantProperty(e, 2, CITY, 1);
  setDefense(e, 2, CITY, 10);
  // 种攻陷前的伤害记录，银两断言只核对下面的实际火攻。
  for (const seat of [4, 4, 4, 4, 4, 1, 0, 1, 0]) {
    applyCityDamage(e, e.players[2], CITY, 1, e.players[seat]);
  }
  armBankrupt(e, 4);

  armPhase(e, { activeIndex: 3, turnPhase: "AwaitingJinnang" });
  placePlayer(e, 3, TILE);
  armHero(e, 3, "zhouyu", ["huogong"]);
  e.submitCommand({ type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" });
  const replica = makeEngine();
  replica.restoreFromSnapshot(e.snapshot());
  e.submitCommand({ type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong", targets: [TILE] });
  foldEventBatch(replica, JSON.parse(JSON.stringify(e.gameEvents)));

  for (const engine of [e, replica]) {
    expect(engine.findOwner(CITY)).toBe(engine.players[1]);
    expect(engine.players[1].properties).toEqual([
      expect.objectContaining({ propertyId: CITY, level: 1, defense: 40, damageRanking: [] }),
    ]);
    expect(engine.players.map((player) => player.cash)).toEqual([
      10120, 10120, 10000, 10215, 10000,
    ]);
  }
  expect(e.gameEvents.filter((event) => event.kind === "cashChanged")).toMatchObject([
    { seat: 3, reason: "city-damage", delta: 5 },
    { seat: 3, reason: "city-conquest", delta: 150 },
    { seat: 3, reason: "city-conquest-pool", delta: 60 },
    { seat: 0, reason: "city-conquest-pool", delta: 120 },
    { seat: 1, reason: "city-conquest-pool", delta: 120 },
  ]);
});

it("己方火烧攻陷时按存活敌方的既有伤害接城，从当前席依次分满 300 两", () => {
  const e = makeEngine();
  grantProperty(e, 2, CITY, 1);
  setDefense(e, 2, CITY, 8);
  for (const seat of [0, 1, 3, 0, 1, 3, 3]) {
    applyCityDamage(e, e.players[2], CITY, 1, e.players[seat]);
  }

  burnCity(e, 2);

  expect(e.findOwner(CITY)).toBe(e.players[3]);
  expect(e.gameEvents.filter((event) => event.kind === "cashChanged")).toMatchObject([
    { seat: 3, reason: "city-conquest-pool", delta: 129 },
    { seat: 0, reason: "city-conquest-pool", delta: 86 },
    { seat: 1, reason: "city-conquest-pool", delta: 85 },
  ]);
  expect(e.players.map((player) => player.cash)).toEqual([10086, 10085, 10000, 10129, 10000]);
});

it("攻陷伤害来自另一座位时，攻陷奖金和分池从当前行动诸侯起发放", () => {
  const e = makeEngine();
  grantProperty(e, 2, CITY, 1);
  setDefense(e, 2, CITY, 2);
  setStamina(e, 2, 1);
  armPhase(e, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  applyCityDamage(e, e.players[2], CITY, 1, e.players[0]);

  beginGameEventBatch(e);
  e.damageStamina(2, 1, 1);

  const rewards = e.gameEvents.filter(
    (event) => event.kind === "cashChanged" && event.reason !== "city-damage",
  );
  expect(rewards).toMatchObject([
    { seat: 0, reason: "city-conquest-pool", delta: 150 },
    { seat: 1, reason: "city-conquest", delta: 150 },
    { seat: 1, reason: "city-conquest-pool", delta: 150 },
  ]);
});

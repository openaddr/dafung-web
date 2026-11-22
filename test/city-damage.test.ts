import { expect, it } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { upgrade } from "@dafung/core/engine/economy";
import { findHolding } from "@dafung/core/engine/player";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setDefense,
} from "@dafung/core/engine/planter";
import guanzhongData from "../packages/core/maps/guanzhong.json";

const MAP = loadMap(guanzhongData);

function makeEngine(): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

it("火攻即时发银，同一城主升降级后保留伤害，相同点数按达到顺序排列", () => {
  const e = makeEngine();
  const city = "prop-jinyang";
  const owner = e.players[1];
  grantProperty(e, 1, city, 2);
  setDefense(e, 1, city, 10);

  armPhase(e, { phase: "Playing", activeIndex: 2, turnPhase: "AwaitingJinnang" });
  placePlayer(e, 2, 1);
  armHero(e, 2, "zhouyu", ["huogong"]);
  e.submitCommand({ type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" });
  e.submitCommand({ type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong", targets: [1] });
  expect(findHolding(owner, city)).toMatchObject({
    level: 1,
    defense: 40,
    damageRanking: [{ seat: 2, damage: 10 }],
  });

  expect(upgrade(owner, MAP.catalog.get(city)!).status).toBe("Ok");
  armPhase(e, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  placePlayer(e, 0, 1);
  armHero(e, 0, "zhugeliang", ["huogong"]);
  e.submitCommand({ type: "useHeroSkill", heroId: "zhugeliang", skillId: "huogong" });
  e.submitCommand({ type: "useHeroSkill", heroId: "zhugeliang", skillId: "huogong", targets: [1] });
  expect(findHolding(owner, city)).toMatchObject({
    level: 2,
    defense: 20,
    damageRanking: [
      { seat: 2, damage: 10 },
      { seat: 0, damage: 10 },
    ],
  });
  expect(e.players.map((p) => p.cash)).toEqual([10050, 10000, 10050]);
});

it("火烧连营在识破保护的城之外结算，己城仅扣防，敌城伤害发银", () => {
  const e = makeEngine();
  armPhase(e, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(e, 1, "prop-jinyang", 1);
  grantProperty(e, 0, "prop-youzhou", 1);
  grantProperty(e, 2, "prop-liaodong", 1);
  giveJinnang(e, 0, ["火烧连营"]);
  giveJinnang(e, 1, ["识破诡计"]);

  e.submitCommand({ type: "useJinnang", cardId: "火烧连营" });
  e.submitCommand({ type: "useJinnang", cardId: "火烧连营", targets: [1] });
  e.submitCommand({
    type: "respondReaction",
    seat: 1,
    use: true,
    cardId: "识破诡计",
    shareSeat: 1,
  });

  expect(findHolding(e.players[1], "prop-jinyang")).toMatchObject({
    defense: 40,
    damageRanking: [],
  });
  expect(findHolding(e.players[0], "prop-youzhou")).toMatchObject({
    defense: 32,
    damageRanking: [],
  });
  expect(findHolding(e.players[2], "prop-liaodong")).toMatchObject({
    defense: 32,
    damageRanking: [{ seat: 0, damage: 8 }],
  });
  expect(e.players.map((p) => p.cash)).toEqual([10040, 10000, 10000]);
});

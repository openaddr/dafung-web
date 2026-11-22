import { expect, it } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import {
  armBankrupt,
  armHero,
  armPhase,
  grantProperty,
  setDefense,
  setStamina,
} from "@dafung/core/engine/planter";
import { testEngine } from "@dafung/core/engine/testing";
import guanzhong from "../packages/core/maps/guanzhong.json";

const { board, catalog } = loadMap(guanzhong);

function makeEngine(): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: [
      { name: "甲", isBot: false, guohao: "魏" },
      { name: "乙", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

it("归零一击使对手耗竭，伤害来源接城得银并在行殇应答后继续原行动", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  armHero(engine, 0, "caopi", ["xingshang"]);
  setStamina(engine, 1, 6);
  grantProperty(engine, 1, "prop-youzhou", 1);
  setDefense(engine, 1, "prop-youzhou", 3);
  grantProperty(engine, 1, "prop-jinyang", 2);
  setDefense(engine, 1, "prop-jinyang", 2);

  expect(engine.damageStamina(1, 8, 0)).toBe(0);
  expect(engine.players[0].properties).toMatchObject([
    { propertyId: "prop-youzhou", level: 1, defense: 40, damageRanking: [] },
  ]);
  expect(engine.players[1].properties).toMatchObject([
    { propertyId: "prop-jinyang", level: 1, defense: 40, damageRanking: [{ seat: 0, damage: 2 }] },
  ]);
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  restored.submitCommand({ type: "respondSkillChoice", seat: 0, use: false });

  // 晋阳和幽州共扣 5 点防御；幽州另有攻陷奖励 90 与结算奖励 180。
  expect(restored.players[0].cash).toBe(10295);
  expect(restored.players[1]).toMatchObject({ stamina: 0, skipTurns: 2, resting: true });
  expect(restored.activeIndex).toBe(0);
  expect(restored.turnPhase).toBe("Roll");
});

it("归零一击的来源随放逐待决状态恢复，城损和奖励只结算一次", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  setStamina(engine, 1, 65);
  armHero(engine, 1, "caopi", ["fangzhu"]);
  grantProperty(engine, 1, "prop-youzhou", 2);
  setDefense(engine, 1, "prop-youzhou", 2);

  expect(engine.damageStamina(1, 65, 0)).toBe(0);
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.players[0].cash).toBe(10000);

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  restored.submitCommand({ type: "respondSkillChoice", seat: 1, use: false });

  expect(restored.players[0].cash).toBe(10010);
  expect(restored.players[1].properties[0]).toMatchObject({
    level: 1,
    defense: 40,
    damageRanking: [{ seat: 0, damage: 2 }],
  });
  expect(restored.players[1].skipTurns).toBe(2);
  expect(restored.gameEvents.filter((event) => event.kind === "propertyDamaged")).toHaveLength(1);
  expect(restored.turnPhase).toBe("Roll");
});

it("已破产来源造成的外敌乘虚照常扣防，保留来源且无即时奖励", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 1 });
  armBankrupt(engine, 0);
  setStamina(engine, 1, 6);
  grantProperty(engine, 1, "prop-youzhou", 3);
  setDefense(engine, 1, "prop-youzhou", 2);
  const sourceCash = engine.players[0].cash;

  expect(engine.damageStamina(1, 8, 0)).toBe(0);

  expect(engine.players[1].properties).toMatchObject([
    { propertyId: "prop-youzhou", level: 2, defense: 30, damageRanking: [] },
  ]);
  expect(engine.players[0].cash).toBe(sourceCash);
  expect(engine.gameEvents).toContainEqual(
    expect.objectContaining({
      kind: "exhaustionResolved",
      seat: 1,
      sourceSeat: 0,
      downgradedPropertyIds: ["prop-youzhou"],
      lostPropertyIds: [],
    }),
  );
  expect(testEngine(engine).logText()).toContain("伤害来源：魏");
  expect(
    engine.gameEvents.filter(
      (event) => event.kind === "cashChanged" && event.reason === "city-damage",
    ),
  ).toHaveLength(0);
});

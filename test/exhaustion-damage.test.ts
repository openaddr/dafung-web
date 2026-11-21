import { expect, it } from "bun:test";
import { GameEngine } from "@core/authority";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { armHero, armPhase, grantProperty, setDefense, setStamina } from "@core/planter";
import guanzhong from "../public/maps/guanzhong.json";

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
  grantProperty(engine, 1, "prop-youzhou", 0);
  setDefense(engine, 1, "prop-youzhou", 3);
  grantProperty(engine, 1, "prop-jinyang", 1);
  setDefense(engine, 1, "prop-jinyang", 2);

  expect(engine.damageStamina(1, 8, 0)).toBe(0);
  expect(engine.players[0].properties).toMatchObject([
    { propertyId: "prop-youzhou", level: 0, defense: 5, damageRanking: [] },
  ]);
  expect(engine.players[1].properties).toMatchObject([
    { propertyId: "prop-jinyang", level: 0, defense: 5, damageRanking: [{ seat: 0, damage: 2 }] },
  ]);
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  restored.submitCommand({ type: "respondSkillChoice", seat: 0, use: false });

  // 两城每点 36 两；幽州另有攻陷奖励 90 与结算奖励 180。
  expect(restored.players[0].cash).toBe(10450);
  expect(restored.players[1]).toMatchObject({ stamina: 0, skipTurns: 2, resting: true });
  expect(restored.activeIndex).toBe(0);
  expect(restored.turnPhase).toBe("Roll");
});

it("归零一击的来源随放逐待决状态恢复，城损和奖励只结算一次", () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  setStamina(engine, 1, 65);
  armHero(engine, 1, "caopi", ["fangzhu"]);
  grantProperty(engine, 1, "prop-youzhou", 1);
  setDefense(engine, 1, "prop-youzhou", 2);

  expect(engine.damageStamina(1, 65, 0)).toBe(0);
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.players[0].cash).toBe(10000);

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  restored.submitCommand({ type: "respondSkillChoice", seat: 1, use: false });

  expect(restored.players[0].cash).toBe(10072);
  expect(restored.players[1].properties[0]).toMatchObject({
    level: 0,
    defense: 5,
    damageRanking: [{ seat: 0, damage: 2 }],
  });
  expect(restored.players[1].skipTurns).toBe(2);
  expect(restored.gameEvents.filter((event) => event.kind === "propertyDamaged")).toHaveLength(1);
  expect(restored.turnPhase).toBe("Roll");
});

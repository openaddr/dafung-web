import { afterEach, expect, it } from "bun:test";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@core/authority";
import { tileIndexOfProperty } from "@core/board";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { defineChoiceEffect, EFFECTS, type EffectCtx } from "@core/effects";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
} from "@core/planter";
import { SKILLS, type TriggerSkill } from "@core/skills";
import guanzhong from "../public/maps/guanzhong.json";

const { board, catalog } = loadMap(guanzhong);
const contestedCity = "prop-wujun"; // 吴郡 3000 两，轮末收入 90 两
const roundEndEffect = "test-round-end-choice";
const cityIncomeEffect = "test-city-income-choice";
const offerChoice = (_engine: GameEngine, ctx: EffectCtx) => ({
  heroId: ctx.slotHeroId,
  skillId: ctx.skillId,
  ownerSeat: ctx.owner,
  subjectSeat: ctx.subject,
});
const chooseAtRoundEnd: TriggerSkill = {
  id: "test-round-end-choice",
  name: "轮末选择",
  desc: "测试轮末续作",
  when: "RoundEnd",
  stage: "during",
  effect: roundEndEffect,
};
const chooseAtIncome: TriggerSkill = {
  ...chooseAtRoundEnd,
  id: "test-income-choice",
  name: "得银选择",
  when: "CashGained",
  effect: cityIncomeEffect,
};
const gainAfterIncome: TriggerSkill = {
  ...chooseAtIncome,
  id: "test-income-after",
  stage: "after",
  effect: "gainCash",
  params: { amount: 7 },
};

afterEach(() => {
  delete EFFECTS[roundEndEffect];
  delete EFFECTS[cityIncomeEffect];
  for (const skill of [chooseAtRoundEnd, chooseAtIncome, gainAfterIncome]) {
    const index = SKILLS.indexOf(skill);
    if (index !== -1) SKILLS.splice(index, 1);
  }
});

function makeEngine(): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: ["魏", "蜀", "吴", "汉"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function submit(e: GameEngine, command: GameCommand): void {
  e.submitCommand(JSON.parse(JSON.stringify(command)));
}

it("轮末按易主后归属逐城发银，跳过者照领，先前达标者败于收益造成的最高现金并列", () => {
  const e = makeEngine();
  grantProperty(e, 1, contestedCity, 0);
  setDefense(e, 1, contestedCity, 1);
  grantProperty(e, 3, "prop-xiapi", 1); // 下邳 3000 两，升级不改变 90 两收入
  grantProperty(e, 3, "prop-youzhou", 0); // 幽州 1800 两，收入 54 两
  const tile = tileIndexOfProperty(board, contestedCity);
  armPhase(e, { phase: "Playing", activeIndex: 2, turnPhase: "AwaitingJinnang" });
  placePlayer(e, 2, tile);
  armHero(e, 2, "zhouyu", ["huogong"]);
  giveJinnang(e, 2, ["缓兵之计"]);
  submit(e, { type: "useJinnang", cardId: "缓兵之计" });
  submit(e, { type: "useJinnang", cardId: "缓兵之计", targets: [3] });
  submit(e, { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" });
  submit(e, { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong", targets: [tile] });
  expect(e.findOwner(contestedCity)).toBe(e.players[2]);

  setCash(e, 0, 30000);
  setCash(e, 2, 29940);
  setCash(e, 3, 29886);
  pinDice(e, "duel", [2, 5]);
  armPhase(e, { turnPhase: "AwaitingDecision" });
  const replica = makeEngine();
  replica.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
  submit(e, { type: "endDecision" });
  foldEventBatch(replica, JSON.parse(JSON.stringify(e.gameEvents)));

  for (const engine of [e, replica]) {
    expect(engine.players.map(({ cash }) => cash)).toEqual([30000, 10000, 30030, 30030]);
    expect(engine.winner).toBe(engine.players[3]);
  }
  expect(
    e.gameEvents.filter((ev) => ev.kind === "cashChanged" && ev.reason === "city-income"),
  ).toMatchObject([
    { seat: 2, delta: 90 },
    { seat: 3, delta: 90 },
    { seat: 3, delta: 54 },
  ]);
  expect(e.gameEvents.map((ev) => ev.kind)).toEqual([
    "turnEnded",
    "turnSkipped",
    "roundEnded",
    "cashChanged",
    "cashChanged",
    "cashChanged",
    "duelResolved",
    "gameOver",
  ]);
});

it("结束实际回合后，下一轮所有诸侯休整也立即按本轮持城收益判胜", () => {
  const e = makeEngine();
  armPhase(e, { phase: "Playing", activeIndex: 3, turnPhase: "Roll" });
  grantProperty(e, 0, "prop-youzhou", 1); // 降为 0 级后仍保有幽州，收入 54 两
  setCash(e, 0, 29946);

  for (const seat of [0, 1, 2, 3]) e.damageStamina(seat, 100, null);

  expect(e.players[0].cash).toBe(30000);
  expect(e.winner).toBe(e.players[0]);
  expect(e.round).toBe(1);
  expect(e.gameEvents.filter((event) => event.kind === "roundEnded")).toHaveLength(1);
  expect(e.gameEvents.filter((event) => event.kind === "turnSkipped")).toHaveLength(0);
});

it("空轮收入达标也要等下一次实际回合结束，空轮的轮末选择可恢复", () => {
  const e = makeEngine();
  armPhase(e, { phase: "Playing", activeIndex: 3, turnPhase: "Roll" });
  giveJinnang(e, 0, []);
  grantProperty(e, 0, "prop-youzhou", 1);
  setCash(e, 0, 29900);
  EFFECTS[roundEndEffect] = defineChoiceEffect("RoundEnd", offerChoice);
  SKILLS.push(chooseAtRoundEnd);
  armHero(e, 0, "caopi", [chooseAtRoundEnd.id]);

  for (const seat of [0, 1, 2, 3]) e.damageStamina(seat, 100, null);
  submit(e, { type: "respondSkillChoice", seat: 0, use: false });
  expect(e.round).toBe(2);
  expect(e.players[0].cash).toBe(29954);
  expect(e.turnPhase).toBe("AwaitingSkillChoice");

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
  submit(restored, { type: "respondSkillChoice", seat: 0, use: false });
  expect(restored.round).toBe(3);
  expect(restored.players[0].cash).toBe(30008);
  expect(restored.turnPhase).toBe("AwaitingSkillChoice");
  submit(restored, { type: "respondSkillChoice", seat: 0, use: false });
  expect(restored.players[0].cash).toBe(30062);
  expect(restored.winner).toBeNull();
  expect(restored.round).toBe(4);

  armPhase(restored, { turnPhase: "AwaitingDecision" });
  submit(restored, { type: "endDecision" });
  expect(restored.winner).toBe(restored.players[0]);
});

it("轮末与首笔得银各自应答后续发，跨过跳行动的轮次锚点并进入下一回合", () => {
  const e = makeEngine();
  pinDice(e, "duel", [6, 5, 4, 3]); // 选都骰使座位 0 成为轮次锚点
  e.doDraftRoll();
  while (e.phase === "Setup")
    e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
  const anchor = e.roundAnchor;
  const mover = (anchor + 3) % e.players.length;
  const later = (anchor + 1) % e.players.length;
  const eligibleCities = ["prop-jinyang", "prop-youzhou", "prop-liaodong", "prop-shangshi"].filter(
    (propertyId) => e.findOwner(propertyId) == null,
  );
  expect(eligibleCities.length).toBeGreaterThanOrEqual(2);
  grantProperty(e, anchor, eligibleCities[0], 0);
  grantProperty(e, later, eligibleCities[1], 0);
  const cashBefore = e.players.map(({ cash }) => cash);

  for (const [seat] of e.players.entries()) giveJinnang(e, seat, []);
  armPhase(e, { activeIndex: mover, turnPhase: "AwaitingJinnang" });
  giveJinnang(e, mover, ["缓兵之计"]);
  submit(e, { type: "useJinnang", cardId: "缓兵之计" });
  submit(e, { type: "useJinnang", cardId: "缓兵之计", targets: [anchor] });
  expect(e.players[anchor].skipTurns).toBe(1);

  EFFECTS[roundEndEffect] = defineChoiceEffect("RoundEnd", offerChoice);
  EFFECTS[cityIncomeEffect] = defineChoiceEffect("CashGained", offerChoice);
  const skills = [chooseAtRoundEnd, chooseAtIncome, gainAfterIncome];
  SKILLS.push(...skills);
  armHero(
    e,
    anchor,
    "caopi",
    skills.map(({ id }) => id),
  );
  armPhase(e, { turnPhase: "AwaitingDecision" });
  submit(e, { type: "endDecision" });
  expect(e.turnPhase).toBe("AwaitingSkillChoice");
  expect(e.players.map(({ cash }) => cash)).toEqual(cashBefore);
  expect(e.gameEvents.filter((ev) => ev.kind === "roundEnded")).toHaveLength(1);

  submit(e, { type: "respondSkillChoice", seat: anchor, use: false });
  expect(e.turnPhase).toBe("AwaitingSkillChoice");
  expect(e.players[anchor].cash).toBe(cashBefore[anchor] + 54);
  expect(e.players[later].cash).toBe(cashBefore[later]);

  const restored = makeEngine();
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
  submit(restored, { type: "respondSkillChoice", seat: anchor, use: false });
  expect(restored.players[anchor].cash).toBe(cashBefore[anchor] + 61);
  expect(restored.players[later].cash).toBe(cashBefore[later] + 54);
  expect(restored.round).toBe(2);
  expect(restored.activeIndex).toBe(later);
  expect(restored.players[anchor].skipTurns).toBe(0);
  expect(restored.gameEvents.map((ev) => ev.kind)).toEqual([
    "skillChoiceAnswered",
    "cashChanged",
    "skillFired",
    "cashChanged",
    "roundStarted",
    "turnSkipped",
    "turnStarted",
  ]);
});

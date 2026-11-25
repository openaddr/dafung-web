import { afterEach, expect, it } from "bun:test";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { defineChoiceEffect, EFFECTS, type EffectCtx } from "@dafung/core/engine/effects";
import { beginGameEventBatch, type GameEvent } from "@dafung/core/engine/game-events";
import { findHolding } from "@dafung/core/engine/player";
import {
  armDebt,
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setCash,
  setDefense,
  setJinnangPiles,
} from "@dafung/core/engine/planter";
import { SKILLS, type TriggerSkill } from "@dafung/core/engine/skills";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import guanzhong from "../packages/core/maps/guanzhong.json";
import { cmdMsg, type InboundMsg } from "@dafung/core/protocol/wire";

const { board, catalog } = loadMap(guanzhong);
const CITY = "prop-jinyang";
const TILE = 1;
const LATER_CITY = "prop-youzhou";

const temporarySkills: TriggerSkill[] = [];

afterEach(() => {
  for (const skill of temporarySkills) {
    SKILLS.splice(SKILLS.indexOf(skill), 1);
    delete EFFECTS[skill.effect];
  }
  temporarySkills.length = 0;
});

const offerChoice = (_engine: GameEngine, ctx: EffectCtx) => ({
  heroId: ctx.slotHeroId,
  skillId: ctx.skillId,
  ownerSeat: ctx.owner,
  subjectSeat: ctx.subject,
});

function grantTestSkill(
  id: string,
  when: TriggerSkill["when"],
  stage: TriggerSkill["stage"],
  effect: (typeof EFFECTS)[string],
): string {
  const skill: TriggerSkill = { id, name: id, desc: id, when, stage, effect: id };
  SKILLS.push(skill);
  temporarySkills.push(skill);
  EFFECTS[id] = effect;
  return id;
}

function json<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

function replicaOf(g: GameEngine, seat: number): GameEngine {
  const replica = makeEngine();
  replica.restoreFromSnapshot(json(redactSnapshotForSeat(g.snapshot(), seat)));
  return replica;
}

function receive(g: GameEngine, replica: GameEngine, seat: number): void {
  foldEventBatch(replica, json(redactEvents(g.gameEvents, seat)));
}

function burnPayments(events: GameEvent[]) {
  const reasons = ["city-damage", "city-conquest", "city-conquest-pool"];
  return events.filter((event) => event.kind === "cashChanged" && reasons.includes(event.reason));
}

function makeEngine(): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: ["魏", "蜀", "吴", "汉"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function submit(g: GameEngine, command: GameCommand): void {
  const message = JSON.parse(cmdMsg(command)) as Extract<InboundMsg, { type: "cmd" }>;
  g.submitCommand(message.cmd);
}

function finishTurn(g: GameEngine): void {
  armPhase(g, { turnPhase: "AwaitingDecision" });
  submit(g, { type: "endDecision" });
}

function playJinnang(g: GameEngine, cardId: string, target: number): void {
  giveJinnang(g, g.activeIndex, [cardId]);
  armPhase(g, { turnPhase: "AwaitingJinnang" });
  submit(g, { type: "useJinnang", cardId });
  submit(g, { type: "useJinnang", cardId, targets: [target] });
}

it("从点火后的下一实际回合计时，跳过的座位不计，续火仍在原定回合扣防", () => {
  const g = makeEngine();
  armPhase(g, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 1, CITY, 1);
  armHero(g, 0, "zhouyu", ["huogong"]);
  placePlayer(g, 0, TILE);
  submit(g, { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" });
  submit(g, { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong", targets: [TILE] });
  playJinnang(g, "缓兵之计", 2);
  const holding = () => findHolding(g.players[1], CITY);
  const replica = replicaOf(g, 1);
  const fold = () => {
    receive(g, replica, 1);
    expect(findHolding(replica.players[1], CITY)).toEqual(holding());
  };

  finishTurn(g);
  fold();
  expect(holding()).toMatchObject({ defense: 30, burning: { progress: 0 } });
  finishTurn(g);
  fold();
  expect(g.activeIndex).toBe(3);
  expect(holding()).toMatchObject({ defense: 30, burning: { progress: 1 } });

  playJinnang(g, "火烧连营", TILE);
  fold();
  finishTurn(g);
  fold();
  expect(holding()).toMatchObject({ defense: 22, burning: { sourceSeat: 3, progress: 2 } });
  const sourceCash = g.players[3].cash;
  finishTurn(g);
  fold();

  expect(holding()).toMatchObject({
    defense: 21,
    burning: { sourceSeat: 3, marks: 2, progress: 0 },
    damageRanking: [
      { seat: 0, damage: 10 },
      { seat: 3, damage: 9 },
    ],
  });
  expect(g.players[3].cash).toBe(sourceCash + 5);

  for (let i = 0; i < 6; i++) finishTurn(g);
  expect(holding()).toMatchObject({ defense: 19, burning: null });
});

it("多城到期等回合结束选择、逐城发银和失城选择，重连后按新城主发轮末收入并判胜", () => {
  let g = makeEngine();
  armPhase(g, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 1, LATER_CITY, 2);
  grantProperty(g, 1, CITY, 1);
  grantProperty(g, 3, "prop-wujun", 1);
  setDefense(g, 1, CITY, 9);
  setDefense(g, 1, LATER_CITY, 9);
  playJinnang(g, "火烧连营", TILE);
  for (let i = 0; i < 3; i++) finishTurn(g);
  expect(g.activeIndex).toBe(3);

  const turnBefore = grantTestSkill("test-burn-turn-before", "TurnEnd", "before", (engine, ctx) => {
    engine.grantSkillCash(ctx.owner, 1);
    return true;
  });
  const turnChoice = grantTestSkill(
    "test-burn-turn-choice",
    "TurnEnd",
    "during",
    defineChoiceEffect("TurnEnd", offerChoice),
  );
  const turnAfter = grantTestSkill("test-burn-turn-after", "TurnEnd", "after", (engine, ctx) => {
    engine.grantSkillCash(ctx.owner, 1);
    return true;
  });
  const gainChoice = grantTestSkill(
    "test-burn-cash-choice",
    "CashGained",
    "during",
    defineChoiceEffect("CashGained", (engine, ctx) =>
      ctx.amount === 90 ? offerChoice(engine, ctx) : false,
    ),
  );
  const lostChoice = grantTestSkill(
    "test-burn-lost-choice",
    "PropertyLost",
    "during",
    defineChoiceEffect("PropertyLost", offerChoice),
  );
  armHero(g, 0, "simayi", [gainChoice]);
  armHero(g, 1, "zhangxingcai", [lostChoice]);
  armHero(g, 3, "caopi", [turnBefore, turnChoice, turnAfter]);
  setCash(g, 0, 29730);
  setCash(g, 3, 29975);
  const events: GameEvent[] = [];
  const viewSeat = 1;
  let replica = replicaOf(g, viewSeat);
  const collect = () => {
    receive(g, replica, viewSeat);
    events.push(...g.gameEvents);
  };

  finishTurn(g);
  collect();
  expect(replica.turnPhase).toBe("AwaitingSkillChoice");
  expect(g.decisionOwner).toBe(3);
  expect(g.players[3].cash).toBe(29976);
  expect(findHolding(replica.players[1], CITY)).toMatchObject({
    defense: 1,
    burning: { progress: 2 },
  });

  submit(g, { type: "respondSkillChoice", seat: 3, use: false });
  collect();
  expect(replica.decisionOwner).toBe(0);
  expect(replica.players[3].cash).toBe(29977);
  expect(replica.findOwner(CITY)).toBe(replica.players[0]);
  expect(replica.players[0].cash).toBe(29825);
  expect(findHolding(replica.players[1], LATER_CITY)).toMatchObject({ level: 2, defense: 1 });
  expect(burnPayments(events)).toMatchObject([{ delta: 5 }, { delta: 90 }]);

  const restored = makeEngine();
  restored.restoreFromSnapshot(json(g.snapshot()));
  g = restored;
  replica = replicaOf(g, viewSeat);
  expect(g.decisionOwner).toBe(0);
  expect(replica.players[0].cash).toBe(29825);

  submit(g, { type: "respondSkillChoice", seat: 0, use: false });
  collect();
  expect(replica.decisionOwner).toBe(1);
  expect(replica.players[0].cash).toBe(30005);
  expect(g.winner).toBeNull();
  expect(findHolding(replica.players[1], LATER_CITY)).toMatchObject({ level: 2, defense: 1 });
  expect(events.filter(({ kind }) => kind === "roundEnded")).toHaveLength(0);

  const reconnectDuringCityLoss = makeEngine();
  reconnectDuringCityLoss.restoreFromSnapshot(json(g.snapshot()));
  g = reconnectDuringCityLoss;
  replica = replicaOf(g, viewSeat);

  submit(g, { type: "respondSkillChoice", seat: 1, use: false });
  collect();
  for (const engine of [g, replica]) {
    expect(findHolding(engine.players[0], CITY)).toMatchObject({
      level: 1,
      defense: 40,
      damageRanking: [],
      burning: null,
    });
    expect(findHolding(engine.players[1], LATER_CITY)).toMatchObject({
      level: 1,
      defense: 40,
      damageRanking: [{ seat: 0, damage: 9 }],
      burning: null,
    });
    expect(engine.players[0].cash).toBe(30064);
    expect(engine.players[3].cash).toBe(30067);
    expect(engine.winner).toBe(engine.players[3]);
  }
  expect(burnPayments(events)).toMatchObject([
    { seat: 0, delta: 5, reason: "city-damage" },
    { seat: 0, delta: 90, reason: "city-conquest" },
    { seat: 0, delta: 180, reason: "city-conquest-pool" },
    { seat: 0, delta: 5, reason: "city-damage" },
  ]);
  expect(
    events.filter(
      ({ kind }) =>
        kind === "propertyBurningTicked" || kind === "roundEnded" || kind === "gameOver",
    ),
  ).toMatchObject([
    { kind: "propertyBurningTicked", propertyId: CITY, marks: 3 },
    { kind: "propertyBurningTicked", propertyId: LATER_CITY, marks: 3 },
    { kind: "roundEnded" },
    { kind: "gameOver", seat: 3 },
  ]);
});

it("先结算的失城效果清除后一城的旧燃烧，已到期的标记不再扣防", () => {
  const g = makeEngine();
  armPhase(g, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 1, CITY, 1);
  grantProperty(g, 2, LATER_CITY, 2);
  setDefense(g, 1, CITY, 9);
  playJinnang(g, "火烧连营", TILE);
  for (let i = 0; i < 3; i++) finishTurn(g);
  const exhaustAfterLoss = grantTestSkill(
    "test-burn-stale-city",
    "PropertyLost",
    "after",
    (engine) => {
      engine.damageStamina(2, 100, null);
      return true;
    },
  );
  armHero(g, 1, "zhangxingcai", [exhaustAfterLoss]);

  finishTurn(g);

  expect(findHolding(g.players[2], LATER_CITY)).toMatchObject({
    level: 1,
    defense: 40,
    burning: null,
    damageRanking: [{ seat: 0, damage: 8 }],
  });
  expect(g.gameEvents.filter(({ kind }) => kind === "propertyBurningTicked")).toMatchObject([
    { propertyId: CITY },
  ]);
});

it("主动破产也完成实际回合并取消额外回合，由存活的旧伤来源接城", () => {
  const g = makeEngine();

  armPhase(g, { phase: "Playing", activeIndex: 1, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 2, CITY, 1);
  setDefense(g, 2, CITY, 17);
  playJinnang(g, "火烧连营", TILE);
  for (let i = 0; i < 3; i++) finishTurn(g);
  expect(g.activeIndex).toBe(0);
  playJinnang(g, "火烧连营", TILE);
  expect(findHolding(g.players[2], CITY)).toMatchObject({
    defense: 1,
    burning: { sourceSeat: 0, progress: 2 },
  });

  giveJinnang(g, 0, ["挟天子以令诸侯"]);
  armPhase(g, { turnPhase: "AwaitingJinnang" });
  submit(g, { type: "useJinnang", cardId: "挟天子以令诸侯" });
  armDebt(g, 20000, null);
  submit(g, { type: "declareBankruptcy" });

  expect(g.players[0].isBankrupt).toBe(true);
  expect(g.activeIndex).toBe(1);
  expect(g.findOwner(CITY)).toBe(g.players[1]);
  expect(findHolding(g.players[1], CITY)).toMatchObject({ defense: 40, burning: null });
  expect(burnPayments(g.gameEvents)).toMatchObject([
    { seat: 1, delta: 180, reason: "city-conquest-pool" },
  ]);
});

it("待接续的额外回合消耗休整的一个跳过，不摸牌", () => {
  const g = makeEngine();
  g.doDraftRoll();
  while (g.phase === "Setup")
    g.pickCapital(g.currentSetupPlayerIndex, g.firstAvailableCapitalIndex());
  const active = g.activeIndex;
  const next = (active + 1) % g.players.length;
  const cardId = "挟天子以令诸侯";
  for (const seat of g.players.keys()) giveJinnang(g, seat, []);
  giveJinnang(g, active, [cardId]);
  giveJinnang(g, next, ["识破诡计"]);
  setJinnangPiles(g, ["半路杀出"], []);
  armPhase(g, { turnPhase: "AwaitingJinnang" });
  const replica = replicaOf(g, active);

  submit(g, { type: "useJinnang", cardId });
  receive(g, replica, active);
  expect(replica.turnPhase).toBe("AwaitingReaction");
  submit(g, { type: "respondReaction", seat: next, use: false });
  receive(g, replica, active);
  expect(replica.turnPhase).toBe("Roll");

  beginGameEventBatch(g);
  g.damageStamina(active, 100, null);
  receive(g, replica, active);
  expect(
    g.gameEvents.filter((event) => event.kind === "turnSkipped" || event.kind === "turnStarted"),
  ).toMatchObject([
    { kind: "turnSkipped", seat: active, round: 1, turn: 2 },
    { kind: "turnStarted", seat: next, round: 1, turn: 3 },
  ]);
  for (const engine of [g, replica]) {
    expect(engine).toMatchObject({ activeIndex: next, round: 1, turnNumber: 3, turnPhase: "Roll" });
    expect(engine.players[active]).toMatchObject({
      resting: true,
      skipTurns: 1,
      jinnangHandCount: 0,
    });
    expect(engine.players[next].jinnangHandCount).toBe(2);
  }
});

it("待接续的额外回合等收尾选择与燃烧，燃烧满足胜利后立即终局", () => {
  const g = makeEngine();
  armPhase(g, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 1, CITY, 1);
  grantProperty(g, 3, "prop-wujun", 1);
  setDefense(g, 1, CITY, 9);
  playJinnang(g, "火烧连营", TILE);
  for (let i = 0; i < 3; i++) finishTurn(g);
  expect(g.activeIndex).toBe(3);
  const choice = grantTestSkill(
    "test-extra-turn-end-choice",
    "TurnEnd",
    "during",
    defineChoiceEffect("TurnEnd", offerChoice),
  );
  armHero(g, 3, "caopi", [choice]);
  setCash(g, 0, 29996);
  setCash(g, 3, 29999);
  giveJinnang(g, 3, ["挟天子以令诸侯"]);
  armPhase(g, { turnPhase: "AwaitingJinnang" });
  submit(g, { type: "useJinnang", cardId: "挟天子以令诸侯" });

  finishTurn(g);
  expect(g.turnPhase).toBe("AwaitingSkillChoice");
  expect(findHolding(g.players[1], CITY)).toMatchObject({ defense: 1, burning: { progress: 2 } });
  const replica = replicaOf(g, 3);
  submit(g, { type: "respondSkillChoice", seat: 3, use: false });
  receive(g, replica, 3);

  expect(
    g.gameEvents.filter(
      ({ kind }) =>
        kind === "propertyBurningTicked" ||
        kind === "roundEnded" ||
        kind === "turnStarted" ||
        kind === "gameOver",
    ),
  ).toMatchObject([
    { kind: "propertyBurningTicked", propertyId: CITY },
    { kind: "gameOver", seat: 0 },
  ]);
  for (const engine of [g, replica]) {
    expect(engine).toMatchObject({ round: 1, turnPhase: "GameOver", winReason: "TargetNetWorth" });
    expect(engine.winner).toBe(engine.players[0]);
    expect(engine.players[3].cash).toBe(29999);
  }
});

it("没有实际回合的整轮不推进燃烧", () => {
  const g = makeEngine();
  armPhase(g, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(g, 1, CITY, 1);
  playJinnang(g, "火烧连营", TILE);
  finishTurn(g);
  finishTurn(g);
  playJinnang(g, "缓兵之计", 1);

  for (const seat of [0, 3, 2]) g.damageStamina(seat, 100, null);

  expect(g.round).toBe(3);
  expect(g.activeIndex).toBe(1);
  expect(g.gameEvents.filter(({ kind }) => kind === "roundEnded")).toHaveLength(2);
  expect(findHolding(g.players[1], CITY)).toMatchObject({ defense: 32, burning: { progress: 2 } });

  finishTurn(g);

  expect(findHolding(g.players[1], CITY)).toMatchObject({
    defense: 31,
    burning: { marks: 2, progress: 0 },
  });
});

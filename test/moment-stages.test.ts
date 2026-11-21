import { afterEach, expect, it } from "bun:test";
import { GameEngine, type GameCommand } from "@core/authority";
import type { GameSnapshot } from "@core/snapshot";
import { loadMap } from "@core/board-loader";
import { fullDefenseOf } from "@core/defense";
import { createDice } from "@core/dice";
import { defineChoiceEffect, EFFECTS } from "@core/effects";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  pinDice,
  placePlayer,
  setDefense,
  setStamina,
} from "@core/planter";
import { SKILLS, type TriggerSkill } from "@core/skills";
import { foldEventBatch } from "@app/net/event-fold";
import { redactEvents, redactSnapshotForSeat } from "../scripts/seat-projection";
import { cmdMsg, type InboundMsg } from "../scripts/wire";
import guanzhong from "../public/maps/guanzhong.json";

const { board, catalog } = loadMap(guanzhong);
const stages = [
  { stage: "after", amount: 13 },
  { stage: "during", amount: 11 },
  { stage: "before", amount: 7 },
] as const;
const skills: TriggerSkill[] = stages.map(({ stage, amount }) => ({
  id: `stamina-loss-${stage}`,
  name: "体力损耗测试技",
  desc: "得到银两",
  when: "StaminaLoss",
  stage,
  effect: "gainCash",
  params: { amount },
}));
const restAfter: TriggerSkill = {
  id: "turn-skip-after",
  name: "被强加跳回合测试技",
  desc: "得到银两",
  when: "TurnSkipImposed",
  stage: "after",
  effect: "gainCash",
  params: { amount: 13 },
};
const onEncounterStaminaChanged: TriggerSkill = {
  id: "encounter-stamina-changed",
  name: "机遇体力变化测试技",
  desc: "得到银两",
  when: "StaminaChanged",
  stage: "during",
  effect: "gainCash",
  params: { amount: 17 },
};
const cityBefore: TriggerSkill = {
  id: "city-demolished-before",
  name: "城池受损前测试技",
  desc: "得到银两",
  when: "PropertyDemolished",
  stage: "before",
  effect: "gainCash",
  params: { amount: 7 },
};
const cityChoice: TriggerSkill = {
  id: "city-demolished-choice",
  name: "城池受损时测试技",
  desc: "你可让另一座位被强加跳回合",
  when: "PropertyDemolished",
  stage: "during",
  effect: "cityDemolishedTestChoice",
};
const cityAfter: TriggerSkill = {
  id: "city-demolished-after",
  name: "城池受损后测试技",
  desc: "得到银两",
  when: "PropertyDemolished",
  stage: "after",
  effect: "gainCash",
  params: { amount: 11 },
};
const cityLost: TriggerSkill = {
  id: "city-lost",
  name: "失城测试技",
  desc: "得到银两",
  when: "PropertyLost",
  stage: "during",
  effect: "gainCash",
  params: { amount: 17 },
};
const cityRewardChoice: TriggerSkill = {
  id: "city-reward-choice",
  name: "城损得银测试技",
  desc: "你可让另一座位被强加跳回合",
  when: "CashGained",
  stage: "during",
  effect: "cityRewardTestChoice",
};

function armCityDamageChoice(g: GameEngine, seat: number) {
  SKILLS.push(cityBefore, cityChoice, cityAfter);
  EFFECTS[cityChoice.effect] = defineChoiceEffect(cityChoice.when, (_g, ctx) => ({
    skillId: ctx.skillId,
    heroId: ctx.slotHeroId,
    ownerSeat: ctx.owner,
    subjectSeat: ctx.subject,
  }));
  armHero(g, seat, "zhangxingcai", [cityAfter.id, cityChoice.id, cityBefore.id]);
}

afterEach(() => {
  for (const skill of [
    ...skills,
    restAfter,
    onEncounterStaminaChanged,
    cityBefore,
    cityChoice,
    cityAfter,
    cityLost,
    cityRewardChoice,
  ]) {
    const index = SKILLS.indexOf(skill);
    if (index !== -1) SKILLS.splice(index, 1);
  }
  delete EFFECTS[cityChoice.effect];
  delete EFFECTS[cityRewardChoice.effect];
});

function makeEngine(seed: number): GameEngine {
  return new GameEngine(board, catalog, createDice(seed), {
    seats: [
      { name: "甲", isBot: false, guohao: "魏", reputation: -300 },
      { name: "乙", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
    encounter: { enabled: true },
  });
}

function submit(engine: GameEngine, command: GameCommand): void {
  const message = JSON.parse(cmdMsg(command)) as Extract<InboundMsg, { type: "cmd" }>;
  engine.submitCommand(message.cmd);
}

function prepareMarch(seed: number): GameEngine {
  const engine = makeEngine(seed);
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  placePlayer(engine, 0, 1); // 晋阳 → 无主幽州
  pinDice(engine, "march", [1]);
  armHero(engine, 0, "caopi", ["fangzhu"]);
  setStamina(engine, 0, 45); // 先攒 55 点标记，下一笔损耗越过发动门槛
  return engine;
}

it("尚未达到发动条件的放逐标记也随真实机遇事件更新", () => {
  const authority = makeEngine(1);
  armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  placePlayer(authority, 0, 1);
  pinDice(authority, "march", [1]);
  armHero(authority, 0, "caopi", ["fangzhu"]);
  const replica = makeEngine(0);
  replica.restoreFromSnapshot(authority.snapshot());

  submit(authority, { type: "rollAndMove" });
  foldEventBatch(replica, JSON.parse(JSON.stringify(redactEvents(authority.snapshot().events, 1))));

  expect(replica.turnPhase).toBe("AwaitingDecision");
  expect(replica.players[0].heroes[0].marks).toEqual({ fangzhu: 10 });
});

it("有无来源的直接体力伤害均只派损耗时机，仍同步每次掉体力", () => {
  const engine = makeEngine(1);
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  SKILLS.push(onEncounterStaminaChanged);
  armHero(engine, 1, "caopi", ["fangzhu", onEncounterStaminaChanged.id]);

  engine.damageStamina(1, 15, 0);
  engine.damageStamina(1, 10, null);

  expect(engine.players[1].cash).toBe(10000);
  expect(engine.players[1].heroes[0].marks).toEqual({ fangzhu: 25 });
  expect(engine.snapshot().events.filter((event) => event.kind === "staminaChanged")).toMatchObject(
    [
      { seat: 1, delta: -15 },
      { seat: 1, delta: -10 },
    ],
  );
});

it("通过事件批在联机副本打开和完成放逐，续到同一落格", () => {
  const authority = prepareMarch(1);
  const replica = makeEngine(0);
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(authority.snapshot(), 1))),
  );
  const receive = () =>
    foldEventBatch(
      replica,
      JSON.parse(JSON.stringify(redactEvents(authority.snapshot().events, 1))),
    );

  submit(authority, { type: "rollAndMove" });
  receive();
  expect(replica.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.decisionOwner).toBe(0);
  expect(replica.players[0].stamina).toBe(35);

  submit(authority, { type: "respondSkillChoice", seat: 0, use: true, targetSeat: 1 });
  receive();
  expect(replica.turnPhase).toBe("AwaitingDecision");
  expect(replica.pendingSkillChoices).toHaveLength(0);
  expect(replica.pendingLand).toEqual(authority.pendingLand);
  expect(replica.players[0].cash).toBe(9750);
  expect(replica.players[1].skipTurns).toBe(1);
});

it("粮道被劫扣体力时先问放逐，恢复后完成同一落格", () => {
  const engine = prepareMarch(1);
  SKILLS.push(...skills, onEncounterStaminaChanged);
  armHero(engine, 0, "zhangxingcai", [
    ...skills.map((skill) => skill.id),
    onEncounterStaminaChanged.id,
  ]);

  submit(engine, { type: "rollAndMove" });
  expect(engine.snapshot().events).toContainEqual(
    expect.objectContaining({ kind: "encounterTriggered", encounterId: "粮道被劫" }),
  );
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.players[0].stamina).toBe(35);
  expect(engine.players[0].cash).toBe(9757);
  expect(
    engine.snapshot().events.flatMap((ev) => (ev.kind === "skillFired" ? [ev.skillId] : [])),
  ).toEqual(["stamina-loss-before", "fangzhu"]);
  expect(engine.pendingLand).toBeNull();

  const snapshot: GameSnapshot = JSON.parse(JSON.stringify(engine.snapshot()));
  const restored = makeEngine(0);
  restored.restoreFromSnapshot(snapshot);
  expect(restored.choicesFor()).toEqual(engine.choicesFor());
  expect(restored.decisionOwner).toBe(0);
  expect(restored.players[0].stamina).toBe(35);

  submit(restored, { type: "respondSkillChoice", seat: 0, use: true, targetSeat: 1 });
  expect(restored.turnPhase).toBe("AwaitingDecision");
  expect(restored.pendingLand?.propertyId).toBe("prop-youzhou");
  expect(restored.activeIndex).toBe(0);
  expect(restored.players[0].stamina).toBe(35);
  expect(restored.players[0].cash).toBe(9798);
  expect(
    restored.snapshot().events.flatMap((ev) => (ev.kind === "skillFired" ? [ev.skillId] : [])),
  ).toEqual(["stamina-loss-during", "stamina-loss-after", onEncounterStaminaChanged.id]);
  expect(restored.players[1].skipTurns).toBe(1);
  expect(restored.pendingSkillChoices).toHaveLength(0);
  expect(
    restored.snapshot().events.filter((event) => event.kind === "landingResolved"),
  ).toHaveLength(1);
  expect(
    restored.snapshot().events.filter((event) => event.kind === "staminaChanged"),
  ).toHaveLength(0);
});

it("疫病入营选项扣除体力，放弃发动后接回城池结算", () => {
  const engine = prepareMarch(17);
  submit(engine, { type: "rollAndMove" });
  expect(engine.turnPhase).toBe("AwaitingEncounter");
  expect(engine.snapshot().events).toContainEqual(
    expect.objectContaining({ kind: "encounterTriggered", encounterId: "疫病入营" }),
  );

  submit(engine, { type: "resolveEncounterChoice", index: 1 });
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.players[0].stamina).toBe(20);
  expect(engine.pendingLand).toBeNull();

  submit(engine, { type: "respondSkillChoice", seat: 0, use: false });
  expect(engine.turnPhase).toBe("AwaitingDecision");
  expect(engine.pendingLand?.propertyId).toBe("prop-youzhou");
  expect(engine.players[0].stamina).toBe(20);
  expect(engine.players[0].heroes[0].marks?.fangzhu).toBe(80);
  expect(engine.players[1].skipTurns).toBe(0);
});

it("行殇先于休整时机的后阶段应答，派生结算完成才收尾回合", () => {
  const engine = makeEngine(1);
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  placePlayer(engine, 0, 1); // 晋阳 → 无主幽州，粮道被劫耗竭
  pinDice(engine, "march", [1]);
  setStamina(engine, 0, 5);
  SKILLS.push(restAfter);
  armHero(engine, 0, "simayi", ["taoguangyanghui", restAfter.id]);
  armHero(engine, 1, "caopi", ["xingshang"]);
  const replica = makeEngine(0);
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(engine.snapshot(), 1))),
  );
  const receive = (authority: GameEngine) =>
    foldEventBatch(
      replica,
      JSON.parse(JSON.stringify(redactEvents(authority.snapshot().events, 1))),
    );

  submit(engine, { type: "rollAndMove" });
  receive(engine);
  expect(engine.snapshot().events.map((event) => event.kind)).toContain("exhaustionResolved");
  expect(engine.snapshot().events.map((event) => event.kind)).not.toContain("turnEnded");
  expect(engine.players[0].cash).toBe(9850); // 机遇 -250，耗竭休整一笔的韬光养晦 +100
  expect(replica.players[0].cash).toBe(9850);
  expect(replica.players[0].skipTurns).toBe(2);
  expect(replica.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.decisionOwner).toBe(1);

  const restored = makeEngine(0);
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  submit(restored, { type: "respondSkillChoice", seat: 1, use: true });
  receive(restored);
  const milestones = restored.snapshot().events.flatMap((event) => {
    if (event.kind === "skillFired") return [event.skillId];
    if (event.kind === "skillChoiceAnswered" || event.kind === "turnEnded") return [event.kind];
    return [];
  });
  expect(milestones).toEqual([
    "taoguangyanghui",
    restAfter.id,
    "skillChoiceAnswered",
    restAfter.id,
    "turnEnded",
  ]);
  expect(restored.players[0].cash).toBe(9976);
  expect(restored.players[0].skipTurns).toBe(3);
  expect(replica.players[0].cash).toBe(9976);
  expect(replica.players[0].skipTurns).toBe(3);
  expect(replica.turnPhase).toBe(restored.turnPhase);
  expect(replica.activeIndex).toBe(1);
  expect(replica.pendingSkillChoices).toHaveLength(0);
});

it("反识破恢复火烧连营后，城损选择经重连结清才烧下一座己城", () => {
  const authority = makeEngine(1);
  armPhase(authority, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(authority, 0, ["火烧连营", "识破诡计"]);
  giveJinnang(authority, 1, ["识破诡计"]);
  grantProperty(authority, 1, "prop-jinyang", 3);
  setDefense(authority, 1, "prop-jinyang", 1);
  grantProperty(authority, 0, "prop-youzhou", 3);
  setDefense(authority, 0, "prop-youzhou", 1);
  armCityDamageChoice(authority, 1);
  armHero(authority, 0, "simayi", ["taoguangyanghui"]);

  const replica = makeEngine(0);
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(authority.snapshot(), 1))),
  );
  const apply = (engine: GameEngine, command: GameCommand) => {
    submit(engine, command);
    foldEventBatch(replica, JSON.parse(JSON.stringify(redactEvents(engine.snapshot().events, 1))));
  };

  apply(authority, { type: "useJinnang", cardId: "火烧连营" });
  apply(authority, { type: "useJinnang", cardId: "火烧连营", targets: [1] });
  apply(authority, {
    type: "respondReaction",
    seat: 1,
    use: true,
    cardId: "识破诡计",
    shareSeat: 1,
  });
  apply(authority, { type: "respondReaction", seat: 0, use: true, cardId: "识破诡计" });

  expect(authority.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.turnPhase).toBe("AwaitingSkillChoice");
  expect(replica.decisionOwner).toBe(1);
  expect(replica.players[1].properties[0]).toMatchObject({ level: 2, defense: fullDefenseOf(2) });
  expect(replica.players[1].cash).toBe(10007);
  expect(replica.players[0].properties[0]).toMatchObject({ level: 3, defense: 1 });
  const cashBeforeChoice = authority.players[0].cash;

  const restored = makeEngine(0);
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(authority.snapshot())));
  apply(restored, { type: "respondSkillChoice", seat: 1, use: true, targetSeat: 0 });

  const events = restored.snapshot().events;
  expect(
    events.flatMap((event) => {
      if (event.kind === "skillFired") return [event.skillId];
      if (event.kind === "propertyDamaged") return [event.propertyId];
      return [];
    }),
  ).toEqual(["taoguangyanghui", cityAfter.id, "prop-youzhou"]);
  expect(replica.players[0].cash).toBe(cashBeforeChoice + 100);
  expect(replica.players[1].cash).toBe(10018);
  expect(replica.players[0].skipTurns).toBe(1);
  expect(replica.players[0].properties[0]).toMatchObject({ level: 2, defense: fullDefenseOf(2) });
  expect(restored.turnPhase).toBe("Roll");
  expect(replica.turnPhase).toBe("Roll");
});

it("火烧连营的即时奖励触发选择，恢复后发完其余银两并烧下一座城", () => {
  const engine = makeEngine(1);
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(engine, 0, ["火烧连营"]);
  grantProperty(engine, 1, "prop-jinyang", 1);
  setDefense(engine, 1, "prop-jinyang", 1);
  grantProperty(engine, 0, "prop-youzhou", 3);
  SKILLS.push(cityRewardChoice, cityLost);
  EFFECTS[cityRewardChoice.effect] = defineChoiceEffect("CashGained", (_g, ctx) =>
    ctx.amount === 5
      ? {
          skillId: ctx.skillId,
          heroId: ctx.slotHeroId,
          ownerSeat: ctx.owner,
          subjectSeat: ctx.subject,
        }
      : false,
  );
  armHero(engine, 0, "simayi", [cityRewardChoice.id]);
  armHero(engine, 1, "zhangxingcai", [cityLost.id]);

  submit(engine, { type: "useJinnang", cardId: "火烧连营" });
  submit(engine, { type: "useJinnang", cardId: "火烧连营", targets: [1] });

  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.decisionOwner).toBe(0);
  expect(engine.findOwner("prop-jinyang")).toBe(engine.players[0]);
  expect(engine.players[0].cash).toBe(10005);
  expect(engine.players[1].cash).toBe(10000);
  expect(engine.activePlayer.properties[0]).toMatchObject({ defense: 20, burning: null });

  const restored = makeEngine(0);
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  submit(restored, { type: "respondSkillChoice", seat: 0, use: false });

  expect(restored.activePlayer.cash).toBe(10275);
  expect(restored.players[1].cash).toBe(10017);
  expect(restored.activePlayer.properties[0]).toMatchObject({
    propertyId: "prop-youzhou",
    defense: 12,
    burning: { sourceSeat: 0, marks: 3, progress: 0 },
  });
  expect(
    restored.snapshot().events.filter((event) => event.kind === "propertyDamaged"),
  ).toMatchObject([{ propertyId: "prop-youzhou" }]);
  expect(restored.turnPhase).toBe("Roll");
});

it("无来源的一击使对手归零，外敌乘虚逐城等待原城主的选择", () => {
  const engine = makeEngine(1);
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  armCityDamageChoice(engine, 1);
  SKILLS.push(cityLost);
  armHero(engine, 1, "huatuo", [cityLost.id]);
  setStamina(engine, 1, 8);
  grantProperty(engine, 1, "prop-jinyang", 3);
  setDefense(engine, 1, "prop-jinyang", 2);
  grantProperty(engine, 1, "prop-youzhou", 1);
  setDefense(engine, 1, "prop-youzhou", 1);

  engine.damageStamina(1, 3, 0);
  engine.damageStamina(1, 5, null);

  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  expect(engine.decisionOwner).toBe(1);
  expect(engine.players[1].properties[0]).toMatchObject({
    propertyId: "prop-jinyang",
    level: 2,
    defense: fullDefenseOf(2),
    damageRanking: [],
  });
  expect(engine.findOwner("prop-youzhou")).toBe(engine.players[1]);
  expect(engine.players[1].resting).toBe(false);

  const restored = makeEngine(0);
  restored.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  submit(restored, { type: "respondSkillChoice", seat: 1, use: false });

  expect(restored.findOwner("prop-youzhou")).toBeNull();
  expect(restored.players[1].resting).toBe(true);
  expect(restored.players[0].cash).toBe(10000);
  expect(restored.players[1].cash).toBe(10035);
  expect(restored.gameEvents).toContainEqual(
    expect.objectContaining({
      kind: "exhaustionResolved",
      sourceSeat: null,
      downgradedPropertyIds: ["prop-jinyang"],
      lostPropertyIds: ["prop-youzhou"],
    }),
  );
  expect(restored.snapshot().events.filter((event) => event.kind === "skillFired")).toMatchObject([
    { skillId: cityAfter.id, seat: 1 },
    { skillId: cityLost.id, seat: 1 },
  ]);
  expect(restored.activeIndex).toBe(0);
  expect(restored.turnPhase).toBe("Roll");
});

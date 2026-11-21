import { expect, it } from "bun:test";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@core/authority";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { findHolding } from "@core/player";
import {
  armDebt,
  armHero,
  armLanding,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setDefense,
} from "@core/planter";
import guanzhongData from "../public/maps/guanzhong.json";
import { redactEvents, redactSnapshotForSeat } from "../scripts/seat-projection";
import { cmdMsg, type InboundMsg } from "../scripts/wire";

const MAP = loadMap(guanzhongData);
const CITY = "prop-jinyang";
const TILE = 1;
const VIEW_SEAT = 2;

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

function json<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reconnect(authority: GameEngine): GameEngine {
  const replica = makeEngine();
  replica.restoreFromSnapshot(json(redactSnapshotForSeat(authority.snapshot(), VIEW_SEAT)));
  return replica;
}

function submit(authority: GameEngine, replica: GameEngine, cmd: GameCommand): void {
  const message = JSON.parse(cmdMsg(cmd)) as Extract<InboundMsg, { type: "cmd" }>;
  authority.submitCommand(message.cmd);
  foldEventBatch(replica, json(redactEvents(authority.gameEvents, VIEW_SEAT)));
}

function castFireBlast(authority: GameEngine, replica: GameEngine): void {
  const command = { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" } as const;
  submit(authority, replica, command);
  submit(authority, replica, { ...command, targets: [TILE] });
}

function castFireWall(authority: GameEngine, replica: GameEngine): void {
  const command = { type: "useJinnang", cardId: "火烧连营" } as const;
  submit(authority, replica, command);
  submit(authority, replica, { ...command, targets: [TILE] });
}

function armFireBlast(level: number): GameEngine {
  const authority = makeEngine();
  grantProperty(authority, 1, CITY, level);
  armPhase(authority, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  placePlayer(authority, 0, TILE);
  armHero(authority, 0, "zhouyu", ["huogong"]);
  return authority;
}

it("火攻点燃，火烧连营误伤续火并换源，扩军清除；事件批和快照保持一致", () => {
  const authority = armFireBlast(1);
  let replica = reconnect(authority);

  castFireBlast(authority, replica);

  const ignition = {
    defense: 30,
    burning: { sourceSeat: 0, marks: 3, progress: 0, ignitedTurn: 0 },
    damageRanking: [{ seat: 0, damage: 10 }],
  };
  expect(findHolding(authority.players[1], CITY)).toMatchObject(ignition);
  expect(findHolding(replica.players[1], CITY)).toMatchObject(ignition);
  expect(findHolding(reconnect(authority).players[1], CITY)).toMatchObject(ignition);

  const snapshot = json(authority.snapshot());
  snapshot.players[1].properties[0].burning = { ...ignition.burning, marks: 2, progress: 1 };
  snapshot.turnNumber = 4;
  authority.restoreFromSnapshot(snapshot);
  armPhase(authority, { activeIndex: 1, turnPhase: "AwaitingJinnang" });
  giveJinnang(authority, 1, ["火烧连营"]);
  replica = reconnect(authority);

  castFireWall(authority, replica);

  const refreshed = {
    defense: 22,
    burning: { sourceSeat: 1, marks: 3, progress: 1, ignitedTurn: 0 },
    damageRanking: [{ seat: 0, damage: 10 }],
  };
  expect(findHolding(authority.players[1], CITY)).toMatchObject(refreshed);
  expect(findHolding(replica.players[1], CITY)).toMatchObject(refreshed);
  expect(findHolding(reconnect(authority).players[1], CITY)).toMatchObject(refreshed);

  placePlayer(authority, 1, TILE);
  armPhase(authority, { turnPhase: "AwaitingDecision" });
  armLanding(authority, { kind: "OwnProperty", propertyId: CITY });
  replica = reconnect(authority);
  submit(authority, replica, { type: "upgradeProperty" });

  const upgraded = { level: 2, defense: 30, burning: null, damageRanking: refreshed.damageRanking };
  expect(findHolding(authority.players[1], CITY)).toMatchObject(upgraded);
  expect(findHolding(replica.players[1], CITY)).toMatchObject(upgraded);
  expect(findHolding(reconnect(authority).players[1], CITY)).toMatchObject(upgraded);
});

it("识破保护已有燃烧的单城，反识破恢复该城的本次扣防并可破防灭火", () => {
  const authority = armFireBlast(3);
  castFireBlast(authority, reconnect(authority));
  setDefense(authority, 1, CITY, 8);
  grantProperty(authority, 2, "prop-youzhou", 1);
  armPhase(authority, { activeIndex: 2, turnPhase: "AwaitingJinnang" });
  giveJinnang(authority, 2, ["火烧连营", "识破诡计"]);
  giveJinnang(authority, 1, ["识破诡计"]);
  const replica = reconnect(authority);
  castFireWall(authority, replica);
  submit(authority, replica, {
    type: "respondReaction",
    seat: 1,
    use: true,
    cardId: "识破诡计",
    shareSeat: 1,
  });
  const protectedResult = makeEngine();
  protectedResult.restoreFromSnapshot(json(authority.snapshot()));
  submit(protectedResult, reconnect(protectedResult), {
    type: "respondReaction",
    seat: 2,
    use: false,
  });
  expect(findHolding(protectedResult.players[1], CITY)).toMatchObject({
    level: 3,
    defense: 8,
    burning: { sourceSeat: 0, marks: 3, progress: 0, ignitedTurn: 0 },
  });
  expect(findHolding(protectedResult.players[2], "prop-youzhou")).toMatchObject({
    defense: 32,
    burning: { sourceSeat: 2, marks: 3 },
  });

  submit(authority, replica, {
    type: "respondReaction",
    seat: 2,
    use: true,
    cardId: "识破诡计",
  });
  expect(findHolding(authority.players[1], CITY)).toMatchObject({
    level: 2,
    defense: 30,
    burning: null,
  });
  expect(replica.players[1].properties).toEqual(authority.players[1].properties);
  expect(authority.players[2].properties).toEqual(protectedResult.players[2].properties);
});

it("施火者破产后仍是伤害来源，燃烧城被债主接收后清除异常", () => {
  const authority = armFireBlast(2);
  castFireBlast(authority, reconnect(authority));
  armDebt(authority, 20000, 2);
  let replica = reconnect(authority);
  submit(authority, replica, { type: "declareBankruptcy" });

  expect(authority.players[0].isBankrupt).toBe(true);
  expect(replica.players[0].isBankrupt).toBe(true);
  for (const engine of [authority, replica, reconnect(authority)]) {
    expect(findHolding(engine.players[1], CITY)).toMatchObject({
      defense: 20,
      burning: { sourceSeat: 0, marks: 3, progress: 0, ignitedTurn: 0 },
    });
  }

  armPhase(authority, { activeIndex: 1 });
  armDebt(authority, 20000, 2);
  replica = reconnect(authority);
  submit(authority, replica, { type: "declareBankruptcy" });

  for (const engine of [authority, replica, reconnect(authority)]) {
    expect(findHolding(engine.players[2], CITY)).toMatchObject({
      level: 2,
      defense: 30,
      burning: null,
      damageRanking: [],
    });
  }
});

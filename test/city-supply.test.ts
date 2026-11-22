import { expect, it } from "bun:test";
import { GameEngine, type GameCommand } from "@core/authority";
import { loadMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import type { GameEvent } from "@core/game-events";
import {
  armPhase,
  giveJinnang,
  grantProperty,
  pinDice,
  placePlayer,
  setStamina,
} from "@core/planter";
import { extractBatchEvents } from "@app/fx/event-extract";
import { foldEventBatch } from "@app/net/event-fold";
import { redactEvents, redactSnapshotForSeat } from "../scripts/seat-projection";
import { cmdMsg, type InboundMsg } from "../scripts/wire";
import guanzhongData from "../public/maps/guanzhong.json";

const MAP = loadMap(guanzhongData);

function makeEngine(): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(42), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

function prepared(): GameEngine {
  const e = makeEngine();
  e.doDraftRoll();
  while (e.phase === "Setup") {
    e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
  }
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

function submit(e: GameEngine, command: GameCommand): void {
  const message = JSON.parse(cmdMsg(command)) as Extract<InboundMsg, { type: "cmd" }>;
  e.submitCommand(message.cmd);
}

function restore(e: GameEngine, seat: number): GameEngine {
  const replica = makeEngine();
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(e.snapshot(), seat))),
  );
  return replica;
}

it("从己城出发，实际经过两座己城、到达另一座己城各摸一张", () => {
  const e = prepared();
  const seat = e.activeIndex;
  const mover = e.activePlayer;
  for (const id of ["prop-hanzhong", "prop-jieting", "prop-xianyang", "prop-liangzhou"]) {
    grantProperty(e, seat, id, 1);
  }
  placePlayer(e, seat, 13); // 汉中 → 街亭 → 咸阳 → 凉州
  pinDice(e, "march", [3]);
  const before = [...mover.jinnangHand];
  const drawn = e.jinnangDeck.slice(-3).reverse();
  const observer = 1 - seat;
  const replica = restore(e, observer);
  const prePositions = replica.players.map((player) => player.position);

  submit(e, { type: "rollAndMove" });

  expect(mover.jinnangHand).toEqual([...before, ...drawn]);
  const events: GameEvent[] = JSON.parse(JSON.stringify(redactEvents(e.gameEvents, observer)));
  expect(events.filter((event) => event.kind === "jinnangDrawn")).toMatchObject([
    { seat, count: 1, reason: "cityPassed", tileIndex: 14 },
    { seat, count: 1, reason: "cityPassed", tileIndex: 15 },
    { seat, count: 1, reason: "cityArrived", tileIndex: 16 },
  ]);
  foldEventBatch(replica, events);
  const fx = extractBatchEvents(replica, events, prePositions);
  const supply = fx
    .filter((event) => event.kind === "textFloat")
    .filter((event) => event.text === "获锦囊一封");
  expect(supply.map((event) => event.atTile)).toEqual([14, 15, 16]);
  const march = fx.findIndex((event) => event.kind === "tokenMoved");
  expect(march).toBeGreaterThanOrEqual(0);
  expect(march).toBeLessThan(fx.indexOf(supply[0]));
  expect(replica.players[seat]).toMatchObject({
    jinnangHand: [],
    jinnangHandCount: before.length + 3,
  });
  expect(mover.position).toBe(16);
  expect(e.pendingLand).toMatchObject({ kind: "OwnProperty", propertyId: "prop-liangzhou" });
});

it.each([
  { mode: "止步", ownerRoll: 6, landing: 15, drawn: 1 },
  { mode: "续走", ownerRoll: 2, landing: 18, drawn: 3 },
])("拦检重连后 $mode 按实际路线结算且已摸的牌只发一次", ({ ownerRoll, landing, drawn }) => {
  const e = prepared();
  const seat = e.activeIndex;
  const owner = 1 - seat;
  for (const id of ["prop-jieting", "prop-liangzhou", "prop-ziwu"]) {
    grantProperty(e, seat, id, 1);
  }
  grantProperty(e, owner, "prop-xianyang", 1);
  giveJinnang(e, owner, ["半路杀出"]);
  placePlayer(e, seat, 13); // 先离开己城街亭，再到咸阳受拦检
  pinDice(e, "march", [5]);
  const before = [...e.activePlayer.jinnangHand];
  const cards = e.jinnangDeck.slice(-3).reverse();
  const beforeMarch = restore(e, owner);
  const prePositions = beforeMarch.players.map((player) => player.position);

  submit(e, { type: "rollAndMove" });

  expect(e.turnPhase).toBe("AwaitingReaction");
  const opening: GameEvent[] = JSON.parse(JSON.stringify(redactEvents(e.gameEvents, owner)));
  foldEventBatch(beforeMarch, opening);
  const supply = extractBatchEvents(beforeMarch, opening, prePositions)
    .filter((event) => event.kind === "textFloat")
    .filter((event) => event.text === "获锦囊一封");
  expect(supply.map((event) => event.atTile)).toEqual([14]);
  expect(restore(e, seat).players[seat].jinnangHand).toEqual([...before, cards[0]]);
  expect(restore(e, owner).players[seat]).toMatchObject({
    jinnangHand: [],
    jinnangHandCount: before.length + 1,
  });
  const resumed = makeEngine();
  resumed.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
  const replica = restore(resumed, owner);
  pinDice(resumed, "duel", [ownerRoll, 4]);
  submit(resumed, { type: "respondReaction", seat: owner, use: true, cardId: "半路杀出" });
  foldEventBatch(replica, JSON.parse(JSON.stringify(redactEvents(resumed.gameEvents, owner))));

  expect(resumed.players[seat].jinnangHand).toEqual([...before, ...cards.slice(0, drawn)]);
  expect(replica.players[seat]).toMatchObject({
    position: landing,
    jinnangHand: [],
    jinnangHandCount: before.length + drawn,
  });
});

it("南徐按普通城购入，本次到达不摸牌，下次到达己城摸一张", () => {
  const e = prepared();
  const seat = e.activeIndex;
  const mover = e.activePlayer;
  const handSize = mover.jinnangHandCount;
  placePlayer(e, seat, 22); // 合肥 → 南徐
  pinDice(e, "march", [1, 1]);

  submit(e, { type: "rollAndMove" });

  expect(mover.jinnangHandCount).toBe(handSize);
  expect(e.pendingLand?.kind).toBe("PropertyAvailable");
  submit(e, { type: "buyProperty" });
  expect(mover.jinnangHandCount).toBe(handSize);
  armPhase(e, { activeIndex: seat, turnPhase: "Roll" });
  placePlayer(e, seat, 22);
  submit(e, { type: "rollAndMove" });

  expect(e.pendingLand?.kind).toBe("OwnProperty");
  expect(mover.jinnangHandCount).toBe(handSize + 1);
});

it.each([
  { mode: "正落", steps: 1, before: 39, after: 70, turnEnds: false },
  { mode: "必停", steps: 2, before: 40, after: 70, turnEnds: true },
  { mode: "满体力正落", steps: 1, before: 100, after: 100, turnEnds: false },
])("己都城 $mode 按实际恢复量和到达结算补给", ({ steps, before, after, turnEnds }) => {
  const e = prepared();
  const seat = e.activeIndex;
  const mover = e.activePlayer;
  const capital = mover.capitalIndex;
  grantProperty(e, seat, e.board.at(capital + 1).propertyId!, 1);
  placePlayer(e, seat, (capital - 1 + e.board.count) % e.board.count);
  setStamina(e, seat, before);
  pinDice(e, "march", [steps]);
  const handSize = mover.jinnangHandCount;
  const cash = mover.cash;
  const observer = 1 - seat;
  const replica = restore(e, observer);

  submit(e, { type: "rollAndMove" });
  foldEventBatch(replica, JSON.parse(JSON.stringify(redactEvents(e.gameEvents, observer))));

  expect(mover).toMatchObject({
    position: capital,
    stamina: after,
    cash: cash + 1000,
    jinnangHandCount: handSize + 1,
  });
  expect(replica.players[seat]).toMatchObject({
    position: capital,
    stamina: after,
    cash: cash + 1000,
    jinnangHandCount: handSize + 1,
    jinnangHand: [],
  });
  expect(e.gameEvents.filter((event) => event.kind === "staminaChanged")).toMatchObject(
    before === after ? [] : [{ seat, delta: after - before, reason: "supply" }],
  );
  expect(
    e.gameEvents.filter((event) => event.kind === "jinnangDrawn" && event.seat === seat),
  ).toMatchObject([{ count: 1, reason: "cityArrived" }]);
  expect(e.activeIndex).toBe(turnEnds ? observer : seat);
  expect(replica.activeIndex).toBe(e.activeIndex);
  expect(replica.turnPhase).toBe(e.turnPhase);
  if (!turnEnds) expect(e.turnPhase).toBe("AwaitingHeroPick");
});

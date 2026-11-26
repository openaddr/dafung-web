import { expect, it } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { botAct } from "@dafung/core/engine/bot";
import { HERO_CAPACITY } from "@dafung/core/engine/constants";
import { createDice } from "@dafung/core/engine/dice";
import { HEROES } from "@dafung/core/engine/heroes";
import { armHero, armPhase, pinDice, placePlayer } from "@dafung/core/engine/planter";
import { isSkillBook } from "@dafung/core/engine/treasures";
import { foldEventBatch } from "@app/net/event-fold";
import guanzhongData from "../packages/core/maps/guanzhong.json";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import {
  cmdMsg,
  dispatchInbound,
  eventsMsg,
  type InboundOps,
  type ServerMsg,
} from "@dafung/core/protocol/wire";

const map = loadMap(guanzhongData);
const recruitCity = map.board.tiles.find((tile) => tile.event === "hero")!;

function makeEngine(seatCount = 2, seed = 7): GameEngine {
  return new GameEngine(map.board, map.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
      { name: "D", isBot: false, guohao: "群" },
    ].slice(0, seatCount),
    startingCash: 10000,
    startingTreasures: 0,
    targetNetWorth: 30000,
  });
}

function startGame(seatCount = 2, seed?: number): GameEngine {
  const engine = makeEngine(seatCount, seed);
  engine.beginCapitalSelection();
  while (engine.phase === "Setup") {
    const capital = engine.offeredCapitals.find((index) => index !== recruitCity.index)!;
    engine.pickCapital(engine.currentSetupPlayerIndex, capital);
  }
  return engine;
}

function landOn(engine: GameEngine, tileIndex: number): void {
  if (engine.turnPhase === "AwaitingJinnang") {
    engine.submitCommand({ type: "useJinnang", cardId: null });
  }
  placePlayer(
    engine,
    engine.activeIndex,
    (tileIndex + engine.board.count - 1) % engine.board.count,
  );
  pinDice(engine, "march", [1]);
  engine.submitCommand({ type: "rollAndMove" });
}

it("满编正落己都城仍可求书，选求书前不送书且结算后换回合", () => {
  const engine = startGame();
  const seat = engine.activeIndex;
  const mover = engine.activePlayer;
  armHero(engine, seat, "zhouyu");
  armHero(engine, seat, "zhugeliang");
  armHero(engine, seat, "caopi");

  landOn(engine, mover.capitalIndex);
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  expect(engine.offeredHeroes).toEqual([]);
  expect(mover.treasures).toEqual([]);

  engine.dice.setRngState(7);
  engine.submitCommand({ type: "resolveHeroPick", action: "seekBook" });
  expect(mover.treasures.filter(isSkillBook).map((book) => book.skillId)).toEqual(["jixing"]);
  expect(engine.activeIndex).toBe(1 - seat);
});

it("名将池招空后，尚无名将的诸侯仍可在招贤城求书", () => {
  const engine = startGame(4);
  for (const [index] of HEROES.entries()) {
    const seat = 1 + Math.floor(index / HERO_CAPACITY);
    armPhase(engine, { activeIndex: seat });
    engine.tryRecruitHero(engine.activePlayer);
    engine.resolveHeroPick(0);
  }
  armPhase(engine, { activeIndex: 0 });
  const mover = engine.activePlayer;
  landOn(engine, recruitCity.index);
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  expect(engine.offeredHeroes).toEqual([]);
  engine.submitCommand({ type: "resolveHeroPick", action: "seekBook" });
  expect(mover.treasures.filter(isSkillBook)).toHaveLength(1);
  expect(engine.turnPhase).toBe("AwaitingDecision");
});

it("有候选时可跳过招贤并续行城池交易", () => {
  const engine = startGame();
  const mover = engine.activePlayer;
  landOn(engine, recruitCity.index);
  expect(engine.offeredHeroes).toHaveLength(3);
  engine.submitCommand({ type: "resolveHeroPick", action: "skip" });
  expect(mover.heroes).toEqual([]);
  expect(mover.treasures).toEqual([]);
  expect(engine.turnPhase).toBe("AwaitingDecision");
});

it.each([
  [1635, "fangzhu"], // 略低于 0.5，再取可学池前半。重复计入火攻会改变抽中结果。
  [98, "jixing"], // 略高于 0.5，再取其他池首位。
])("招贤城求书重放骰流并用珍宝事件续行交易（骰态 %i）", async (rngState, skillId) => {
  const engine = startGame();
  const seat = engine.activeIndex;
  armHero(engine, seat, "zhouyu", ["yingzi"]);
  armHero(engine, seat, "zhugeliang", ["yuli"]);
  armHero(engine, seat, "caopi", ["xingshang"]);
  landOn(engine, recruitCity.index);
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  engine.dice.setRngState(rngState);
  const recovered = makeEngine();
  recovered.restoreFromSnapshot(JSON.parse(JSON.stringify(engine.snapshot())));
  const replica = makeEngine();
  replica.restoreFromSnapshot(redactSnapshotForSeat(engine.snapshot(), 1 - seat));

  const ops: InboundOps = {
    cmd: (cmd) => engine.submitCommand(cmd),
    pickCapital: () => {
      throw new Error("场景未提交选都命令");
    },
    setAutoPilot: () => {
      throw new Error("场景未提交托管命令");
    },
  };
  const invalid = await dispatchInbound(cmdMsg({ type: "resolveHeroPick", index: 0 }), ops);
  expect(invalid).toMatchObject({ ok: false, reason: "rejected" });
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  const seekBook = { type: "resolveHeroPick", action: "seekBook" } as const;
  expect(await dispatchInbound(cmdMsg(seekBook), ops)).toEqual({ ok: true });
  recovered.submitCommand(seekBook);
  const downlink = JSON.parse(eventsMsg(redactEvents(engine.gameEvents, 1 - seat))) as Extract<
    ServerMsg,
    { type: "events" }
  >;
  foldEventBatch(replica, downlink.events);

  for (const game of [engine, recovered, replica]) {
    expect(game.players[seat]!.treasures.filter(isSkillBook).map((book) => book.skillId)).toEqual([
      skillId,
    ]);
    expect(game.turnPhase).toBe("AwaitingDecision");
    expect(game.pendingCityEvent).toBe(false);
    expect(game.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "prop-wolong" });
  }
  expect(recovered.snapshot().rngState).toBe(engine.snapshot().rngState);
});

it("托管在没有招将候选时求书并结清招贤机会", () => {
  const engine = startGame();
  const mover = engine.activePlayer;
  for (const heroId of ["zhouyu", "zhugeliang", "caopi"])
    armHero(engine, engine.activeIndex, heroId);
  landOn(engine, recruitCity.index);
  botAct(engine);
  expect(mover.treasures.filter(isSkillBook)).toHaveLength(1);
  expect(engine.turnPhase).toBe("AwaitingDecision");
});

it("首回合抽到袭扰，行军求书后在下个己方出牌阶段研读", () => {
  const engine = startGame(2, 62); // 首回合摸到袭扰，两座都城也在射程内。
  const seat = engine.activeIndex;
  const opponent = 1 - seat;
  const mover = engine.activePlayer;
  expect(mover.jinnangHandCount).toBe(2);
  expect(engine.players[opponent].jinnangHandCount).toBe(1);
  expect(engine.gameEvents).toContainEqual(
    expect.objectContaining({ kind: "jinnangDrawn", seat, reason: "turnStart", cardIds: ["袭扰"] }),
  );

  armHero(engine, seat, "zhouyu", ["yingzi"]);
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰" });
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰", targets: [opponent] });
  expect(engine.players[opponent].stamina).toBe(90);
  expect(mover.stamina).toBe(100);

  landOn(engine, recruitCity.index);
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  engine.dice.setRngState(1635);
  engine.submitCommand({ type: "resolveHeroPick", action: "seekBook" });
  const [book] = mover.treasures.filter(isSkillBook);
  expect(book).toBeDefined();
  expect(engine.turnPhase).toBe("AwaitingDecision");
  engine.submitCommand({ type: "endDecision" });

  expect(engine.activeIndex).toBe(opponent);
  const ordinaryCity = engine.board.tiles.find(
    (tile) => tile.propertyId && engine.findOwner(tile.propertyId) === null && !tile.event,
  )!;
  landOn(engine, ordinaryCity.index);
  engine.submitCommand({ type: "endDecision" });

  expect(engine.activeIndex).toBe(seat);
  expect(engine.turnPhase).toBe("AwaitingJinnang");
  const count = mover.jinnangHandCount;
  engine.submitCommand({ type: "useBookSkill", treasureId: book.id, heroId: "zhouyu" });
  expect(mover.heroes[0].skillIds).toContain(book.skillId);
  expect(mover.treasures).toEqual([]);
  expect(mover.jinnangHandCount).toBe(count);
});

import { expect, it } from "bun:test";
import { extractBatchEvents } from "@app/fx/event-extract";
import { present } from "@app/fx/orchestrator";
import { createMemorySink } from "@app/fx/sinks";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import {
  armHero,
  armHeroOffer,
  armPhase,
  giveJinnang,
  giveTreasure,
  pinDice,
  placePlayer,
} from "@dafung/core/engine/planter";
import { makeSkillBook } from "@dafung/core/engine/treasures";
import guanzhongData from "../../packages/core/maps/guanzhong.json";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 7) {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "甲", isBot: false, guohao: "魏" },
      { name: "乙", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30_000,
    startingCash: 10_000,
    startingTreasures: 0,
  });
}

async function playCommand(engine: GameEngine, command: GameCommand) {
  const positions = engine.players.map((player) => player.position);
  engine.submitCommand(command);
  const sink = createMemorySink();
  await present(extractBatchEvents(engine, engine.gameEvents, positions), sink);
  return sink.calls;
}

it("遣散名将折入两册技能书时只响一次书册入案", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
  armHero(engine, 0, "zhouyu", ["jixing", "huogong"]);

  const calls = await playCommand(engine, { type: "dismissHero", heroId: "zhouyu" });

  expect(engine.players[0].treasures.map((treasure) => treasure.id)).toEqual([
    "skillbook-jixing",
    "skillbook-huogong",
  ]);
  expect(calls.filter((call) => call.op === "sound")).toEqual([
    { op: "sound", event: "bookSetDown" },
  ]);
  expect(calls.filter((call) => call.op === "seal").map((call) => call.sound)).toEqual([
    null,
    null,
  ]);
});

it("求书入册的书册声随得印落定", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingHeroPick", activeIndex: 0 });

  const calls = await playCommand(engine, { type: "resolveHeroPick", action: "seekBook" });

  expect(engine.players[0].treasures).toMatchObject([{ kind: "book" }]);
  expect(calls.filter((call) => call.op === "seal")).toMatchObject([
    { char: "得", sound: "bookSetDown" },
  ]);
  expect(calls.filter((call) => call.op === "sound")).toEqual([]);
});

it.each([
  ["成功", 1, "treasureGain ", ["treasure"]],
  ["落空", 6, "treasureMiss ", []],
] as const)("探宝%s时按实际结果呈现得印和声音", async (_outcome, seed, trail, sounds) => {
  const engine = makeEngine(seed);
  engine.doDraftRoll();
  for (let i = 0; i < engine.players.length; i++) {
    engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
  }
  engine.players.forEach((_, seat) => giveJinnang(engine, seat, []));
  armPhase(engine, { turnPhase: "Roll", activeIndex: 0 });
  const city = engine.board.tiles.find(
    (tile) => tile.event === "treasure" && !engine.takenCapitalIndices.has(tile.index),
  )!;
  placePlayer(engine, 0, city.index - 1);
  pinDice(engine, "march", [1]);

  const calls = await playCommand(engine, { type: "rollAndMove" });

  expect(engine.log.some((line) => line.detail.startsWith(trail))).toBe(true);
  expect(
    calls.flatMap((call) => (call.op === "seal" && call.char === "得" ? [call.sound] : [])),
  ).toEqual([...sounds]);
  expect(calls.filter((call) => call.op === "sound")).toEqual([]);
});

it("窃书选人无结果声，得印闷拨与被动得银各随结算", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  const book = makeSkillBook("huogong");
  armHero(engine, 0, "mizhu", ["delongwangshu"]);
  giveJinnang(engine, 0, ["窃玉偷香"]);
  giveTreasure(engine, 1, [book]);

  expect(await playCommand(engine, { type: "useJinnang", cardId: "窃玉偷香" })).toEqual([]);
  const calls = await playCommand(engine, {
    type: "useJinnang",
    cardId: "窃玉偷香",
    targets: [1],
  });

  expect(engine.players[0].treasures).toEqual([book]);
  expect(calls.filter((call) => call.op === "seal")).toMatchObject([
    { char: "得", sound: "treasureStolen" },
  ]);
  expect(calls.filter((call) => call.op === "cashFly")).toMatchObject([
    { arrivalCues: [{ event: "coin" }] },
  ]);
  expect(calls.filter((call) => call.op === "sound")).toEqual([]);
});

it("招将入麾下后，甲扣短弦贴来投宣告", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingHeroPick", activeIndex: 0 });
  armHeroOffer(engine, ["zhouyu"]);

  const calls = await playCommand(engine, { type: "resolveHeroPick", index: 0 });

  expect(engine.players[0].heroes).toMatchObject([{ heroId: "zhouyu" }]);
  expect(calls.slice(0, 2)).toMatchObject([
    { op: "sound", event: "heroRecruited" },
    { op: "textFloater", text: "周瑜 来投" },
  ]);
});

it("实际研读后，翻页收弦贴习得宣告", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  const book = makeSkillBook("huogong");
  armHero(engine, 0, "zhouyu", ["jixing"]);
  giveTreasure(engine, 0, [book]);

  const calls = await playCommand(engine, {
    type: "useBookSkill",
    treasureId: book.id,
    heroId: "zhouyu",
  });

  expect(engine.players[0].heroes[0].skillIds).toContain("huogong");
  expect(calls.filter((call) => call.op === "textFloater" || call.op === "sound")).toMatchObject([
    { op: "sound", event: "skillLearned" },
    { op: "textFloater", text: "魏 习得【火攻】" },
  ]);
});

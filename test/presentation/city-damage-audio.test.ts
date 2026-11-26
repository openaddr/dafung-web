import { expect, it } from "bun:test";
import { extractBatchEvents } from "@app/fx/event-extract";
import { present } from "@app/fx/orchestrator";
import { createMemorySink } from "@app/fx/sinks";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import {
  armDebt,
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setDefense,
} from "@dafung/core/engine/planter";
import guanzhong from "../../packages/core/maps/guanzhong.json";

const { board, catalog } = loadMap(guanzhong);
const JINYANG = "prop-jinyang";
const YOUZHOU = "prop-youzhou";
const citySounds = new Set(["cityHit", "cityBreach", "cityConquest"]);

function makeEngine(): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: ["魏", "蜀", "吴"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

async function play(engine: GameEngine) {
  const sink = createMemorySink();
  await present(extractBatchEvents(engine, engine.gameEvents), sink);
  return sink.calls;
}

it.each([
  { defense: 20, sound: "cityHit" },
  { defense: 1, sound: "cityBreach" },
])("火攻把都城防御值从 $defense 扣低时播放 $sound", async ({ defense, sound }) => {
  const engine = makeEngine();
  engine.doDraftRoll();
  while (engine.phase === "Setup")
    engine.pickCapital(engine.currentSetupPlayerIndex, engine.firstAvailableCapitalIndex());
  const capital = engine.players[1].capitalIndex;
  const propertyId = engine.board.at(capital).propertyId!;
  armPhase(engine, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  armHero(engine, 0, "zhouyu", ["huogong"]);
  placePlayer(engine, 0, capital);
  setDefense(engine, 1, propertyId, defense);

  const command = { type: "useHeroSkill", heroId: "zhouyu", skillId: "huogong" } as const;
  engine.submitCommand(command);
  engine.submitCommand({ ...command, targets: [capital] });
  const calls = await play(engine);
  expect(calls.filter((call) => call.op === "sound" || call.op === "cashFly")).toMatchObject([
    { op: "sound", event: sound },
    { op: "cashFly", arrivalCues: [{ event: "coin" }] },
  ]);
  expect(engine.findOwner(propertyId)).toBe(engine.players[1]);
});

it("同一回合的燃烧沿用画面，只有实际降级响碎石", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  grantProperty(engine, 1, JINYANG, 2);
  setDefense(engine, 1, JINYANG, 9);
  grantProperty(engine, 2, YOUZHOU, 1);
  setDefense(engine, 2, YOUZHOU, 11);
  giveJinnang(engine, 0, ["火烧连营"]);
  engine.submitCommand({ type: "useJinnang", cardId: "火烧连营" });
  engine.submitCommand({ type: "useJinnang", cardId: "火烧连营", targets: [1] });

  for (let turn = 0; turn < 4; turn++) {
    armPhase(engine, { turnPhase: "AwaitingDecision" });
    engine.submitCommand({ type: "endDecision" });
  }
  const calls = await play(engine);
  expect(
    calls.filter(
      (call) => call.op === "burningPulse" || (call.op === "sound" && citySounds.has(call.event)),
    ),
  ).toEqual([
    { op: "burningPulse", tileIndex: 1, marks: 3 },
    { op: "sound", event: "cityBreach" },
    { op: "burningPulse", tileIndex: 2, marks: 3 },
  ]);
});

it("破产交城沿用易主和倒旗演出", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", activeIndex: 0 });
  grantProperty(engine, 0, JINYANG, 2);
  armDebt(engine, 20000, 1);
  engine.submitCommand({ type: "declareBankruptcy" });

  const calls = await play(engine);
  expect(
    calls.filter(
      (call) =>
        call.op === "announceTile" ||
        call.op === "bankruptCeremony" ||
        (call.op === "sound" && citySounds.has(call.event)),
    ),
  ).toMatchObject([
    { op: "announceTile", tileIndex: 1, level: 2, ownerChanged: true, ownerColorIndex: 1 },
    { op: "bankruptCeremony", playerId: engine.players[0].id },
  ]);
});

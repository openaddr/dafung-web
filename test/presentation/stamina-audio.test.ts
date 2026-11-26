import { expect, it } from "bun:test";
import { withGlobal } from "@sinonjs/fake-timers";
import { extractBatchEvents } from "@app/fx/event-extract";
import { present } from "@app/fx/orchestrator";
import { createMemorySink } from "@app/fx/sinks";
import { FX } from "@app/fx/timings";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import type { GameEvent } from "@dafung/core/engine/game-events";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setDefense,
  setStamina,
} from "@dafung/core/engine/planter";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import guanzhong from "../../packages/core/maps/guanzhong.json";

const { board, catalog } = loadMap(guanzhong);

function makeEngine(): GameEngine {
  return new GameEngine(board, catalog, createDice(7), {
    seats: ["魏", "蜀"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
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

it("袭扰实际扣体时，钝击随体力浮字出现", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  giveJinnang(engine, 0, ["袭扰"]);
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰" });
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰", targets: [1] });

  const calls = await play(engine);
  expect(
    calls.filter(
      (call) => call.op === "sound" || (call.op === "textFloater" && call.text.startsWith("体力 ")),
    ),
  ).toMatchObject([
    { op: "sound", event: "staminaHit" },
    { op: "textFloater", text: "体力 −10" },
  ]);
});

it.each([
  { stamina: 96, sounds: ["staminaRecover"] },
  { stamina: 100, sounds: [] },
])("赈济前体力为 $stamina 时，只有实际恢复才发声", async ({ stamina, sounds }) => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  armHero(engine, 0, "huatuo", ["zhenji"]);
  setStamina(engine, 1, stamina);
  const command = { type: "useHeroSkill", heroId: "huatuo", skillId: "zhenji" } as const;
  engine.submitCommand(command);
  engine.submitCommand({ ...command, targets: [1] });

  const calls = await play(engine);
  expect(calls.flatMap((call) => (call.op === "sound" ? [call.event] : []))).toEqual([...sounds]);
});

it("归零一击跨放逐应答时，先呈现降级和失城，再以最重城声接一记闷鼓", async () => {
  const engine = makeEngine();
  armPhase(engine, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  giveJinnang(engine, 0, ["袭扰"]);
  setStamina(engine, 1, 60);
  armHero(engine, 1, "caopi", ["fangzhu"]);
  setStamina(engine, 1, 6);
  grantProperty(engine, 1, "prop-jinyang", 2);
  grantProperty(engine, 1, "prop-youzhou", 1);

  const replica = makeEngine();
  replica.restoreFromSnapshot(
    JSON.parse(JSON.stringify(redactSnapshotForSeat(engine.snapshot(), 0))),
  );
  const apply = (command: GameCommand) => {
    engine.submitCommand(command);
    const batch: GameEvent[] = JSON.parse(JSON.stringify(redactEvents(engine.gameEvents, 0)));
    foldEventBatch(replica, batch);
    return extractBatchEvents(replica, batch);
  };

  apply({ type: "useJinnang", cardId: "袭扰" });
  const damage = apply({ type: "useJinnang", cardId: "袭扰", targets: [1] });
  expect(engine.turnPhase).toBe("AwaitingSkillChoice");
  const beforeChoice = createMemorySink();
  await present(damage, beforeChoice);
  const outcome = apply({ type: "respondSkillChoice", seat: 1, use: false });
  expect(beforeChoice.calls.filter((call) => call.op === "sound")).toEqual([]);

  const clock = withGlobal(globalThis).install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const sink = createMemorySink();
    const playback = present(outcome, sink);
    expect(
      sink.calls.filter((call) => call.op === "sound" || call.op === "announceTile"),
    ).toMatchObject([
      { op: "announceTile", tileIndex: 1, level: 1, levelChanged: true },
      { op: "announceTile", tileIndex: 2, ownerColorIndex: 0, ownerChanged: true },
      { op: "sound", event: "cityConquest" },
    ]);
    await clock.tickAsync(FX.exhaustionLeadMs);
    await playback;
    expect(sink.calls.filter((call) => call.op === "sound")).toEqual([
      { op: "sound", event: "cityConquest" },
      { op: "sound", event: "exhaustionDrum" },
    ]);
  } finally {
    clock.uninstall();
  }
});

it("都城被打空也响碎石，休整中跳回合静默，期满回体发声", async () => {
  const engine = makeEngine();
  engine.beginCapitalSelection();
  while (engine.phase === "Setup")
    engine.pickCapital(engine.currentSetupPlayerIndex, engine.firstAvailableCapitalIndex());
  const capital = engine.players[1].capitalIndex;
  const propertyId = board.at(capital).propertyId!;
  armPhase(engine, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
  placePlayer(engine, 0, capital);
  giveJinnang(engine, 0, ["袭扰"]);
  giveJinnang(engine, 1, []);
  setStamina(engine, 1, 6);
  setDefense(engine, 1, propertyId, 1);
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰" });
  engine.submitCommand({ type: "useJinnang", cardId: "袭扰", targets: [1] });

  const clock = withGlobal(globalThis).install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const playback = play(engine);
    await clock.tickAsync(FX.exhaustionLeadMs);
    expect((await playback).filter((call) => call.op === "sound")).toEqual([
      { op: "sound", event: "cityBreach" },
      { op: "sound", event: "exhaustionDrum" },
    ]);
  } finally {
    clock.uninstall();
  }

  armPhase(engine, { turnPhase: "AwaitingDecision" });
  engine.submitCommand({ type: "endDecision" });
  expect((await play(engine)).filter((call) => call.op === "sound")).toEqual([]);
  armPhase(engine, { turnPhase: "AwaitingDecision" });
  engine.submitCommand({ type: "endDecision" });
  expect((await play(engine)).filter((call) => call.op === "sound")).toEqual([
    { op: "sound", event: "staminaRecover" },
  ]);
});

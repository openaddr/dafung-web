import { afterEach, beforeEach, expect, it } from "bun:test";
import { withGlobal } from "@sinonjs/fake-timers";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armPhase, pinDice, placePlayer, setStamina } from "@dafung/core/engine/planter";
import { setAudio } from "@app/fx/audio";
import { anchorMarches, extractBatchEvents } from "@app/fx/event-extract";
import { useFxStore } from "@app/fx/fxStore";
import { present, resetFxOrchestration } from "@app/fx/orchestrator";
import { createEngineSink } from "@app/fx/sinks";
import { FX } from "@app/fx/timings";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import { recordAudio } from "../wiring/record-audio";

beforeEach(resetFxOrchestration);
afterEach(() => {
  resetFxOrchestration();
  setAudio(null);
});

function marchToCapital(die: number, resupply = guanzhongData.resupply, stamina = 50) {
  const { board, catalog } = loadMap({ ...guanzhongData, resupply });
  const engine = new GameEngine(board, catalog, createDice(7), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 999999,
    startingCash: 10000,
    startingTreasures: 0,
  });
  engine.doDraftRoll();
  for (const _ of engine.players) {
    engine.pickCapital(engine.currentSetupPlayerIndex, engine.firstAvailableCapitalIndex());
  }
  const seat = engine.activeIndex;
  const player = engine.activePlayer;
  placePlayer(engine, seat, (player.capitalIndex + board.count - 1) % board.count);
  setStamina(engine, seat, stamina);
  armPhase(engine, { turnPhase: "Roll" });
  pinDice(engine, "march", [die]);

  const prePositions = engine.players.map((p) => p.position);
  engine.submitCommand({ type: "rollAndMove" });
  expect(player.position).toBe(player.capitalIndex);
  const events = extractBatchEvents(engine, engine.gameEvents, prePositions);
  const sink = createEngineSink();
  anchorMarches(events, sink);
  return { play: () => present(events, sink), engine, player };
}

function arriveSupplyCoin(playerId: string) {
  const fx = useFxStore.getState();
  const fly = fx.cashFlies.find((f) => f.playerId === playerId);
  if (!fly) throw new Error("都城补给没有发出归账铜钱");
  fx.removeCashFly(fly.id)?.onArrival?.();
}

it("路过己都城先随驻跸条带响门闩，再由归账铜钱合鸣银两与回体", async () => {
  const clock = withGlobal(globalThis).install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const sounds = recordAudio();
    const { play, engine, player } = marchToCapital(3);
    expect(player.stamina).toBe(75);
    expect(engine.turnPhase).not.toBe("AwaitingHeroPick");
    const playback = play();
    await clock.tickAsync(0);
    expect(sounds).toEqual(["haltLatch"]);
    expect(useFxStore.getState().cashFlies).toHaveLength(0);
    await clock.tickAsync(FX.haltHoldMs);
    await playback;

    expect(sounds).toEqual(["haltLatch"]);
    arriveSupplyCoin(player.id);
    expect(sounds).toEqual(["haltLatch", "coin"]);
  } finally {
    clock.uninstall();
  }
});

it("正落己都城时，银两与回体只在归账时发出一组补给声", async () => {
  const sounds = recordAudio();
  const { play, engine, player } = marchToCapital(1);
  expect(player.stamina).toBe(75);
  expect(engine.turnPhase).toBe("AwaitingHeroPick");
  await play();
  expect(sounds).toEqual([]);
  arriveSupplyCoin(player.id);
  expect(sounds).toEqual(["coin"]);
});

it("地图没有补给银两时，实际回体单独发声，满体力的落点留白", async () => {
  const sounds = recordAudio();
  await marchToCapital(1, 0).play();
  expect(useFxStore.getState().cashFlies).toHaveLength(0);
  expect(sounds).toEqual(["staminaRecover"]);

  resetFxOrchestration();
  sounds.length = 0;
  await marchToCapital(1, 0, 100).play();
  expect(sounds).toEqual([]);
});

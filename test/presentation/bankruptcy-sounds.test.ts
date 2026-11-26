import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { getAudio, MediaAudioPlayer, setAudio } from "@app/fx/audio";
import { extractBatchEvents } from "@app/fx/event-extract";
import { useFxStore } from "@app/fx/fxStore";
import { present, resetFxOrchestration } from "@app/fx/orchestrator";
import { createEngineSink, createMemorySink } from "@app/fx/sinks";
import { SOUND_CLIPS, soundClipUrl } from "@app/fx/sound-clips";
import { CEREMONY, setCatchupScale } from "@app/fx/timings";
import { foldEventBatch } from "@app/net/event-fold";
import { GameEngine, type GameCommand } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armDebt, giveTreasure, grantProperty, setCash } from "@dafung/core/engine/planter";
import { eventsMsg, type EventBatchMsg } from "@dafung/core/protocol/wire";
import { redactEvents } from "@dafung/core/room/seat-projection";
import mapData from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "../wiring/controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "../wiring/happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

const map = loadMap(mapData);

function makeEngine() {
  return new GameEngine(map.board, map.catalog, createDice(7), {
    seats: ["魏", "蜀"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: 30_000,
    startingCash: 10_000,
    startingTreasures: 0,
  });
}

function finishSetup(engine: GameEngine) {
  engine.doDraftRoll();
  while (engine.phase === "Setup") {
    const outcome = engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
    if (!outcome.ok) throw new Error(`选都失败 ${outcome.reason}`);
  }
}

it("真实下行只在批量出售并清偿后响一声账册合拢", async () => {
  resetFxOrchestration();
  const engine = makeEngine();
  finishSetup(engine);
  const seat = engine.activeIndex;
  const city = "prop-youzhou";
  const treasure = { id: "hat", name: "草帽", level: 1 };
  expect(engine.findOwner(city)).toBeNull();
  grantProperty(engine, seat, city, 1);
  giveTreasure(engine, seat, [treasure]);
  setCash(engine, seat, 0);
  armDebt(engine, 1000, null);

  const replica = makeEngine();
  replica.restoreFromSnapshot(engine.snapshot());
  const playCommand = async (command: GameCommand) => {
    const positions = replica.players.map((player) => player.position);
    engine.submitCommand(command);
    const { events } = JSON.parse(
      eventsMsg(redactEvents(engine.gameEvents, 1 - seat)),
    ) as EventBatchMsg;
    foldEventBatch(replica, events);
    const sink = createMemorySink();
    await present(extractBatchEvents(replica, events, positions), sink);
    return sink.calls;
  };

  const asset = { kind: "treasure", id: treasure.id } as const;
  expect(await playCommand({ type: "confirmBankruptcySettle", assets: [asset] })).toEqual([]);
  expect(replica.pendingDebt?.amount).toBe(1000);

  const calls = await playCommand({
    type: "confirmBankruptcySettle",
    assets: [asset, { kind: "property", id: city }],
  });
  expect(replica.pendingDebt).toBeNull();
  expect(replica.findOwner(city)).toBeNull();
  expect(calls.filter((call) => call.op === "announceTile")).toHaveLength(1);
  expect(calls.filter((call) => call.op === "bankruptCeremony")).toEqual([]);
  expect(
    calls.flatMap<string>((call) => {
      if (call.op === "sound") return [call.event];
      if (call.op === "cashFly") return call.arrivalCues?.map((cue) => cue.event) ?? [];
      return [];
    }),
  ).toEqual(["ledgerClose"]);
});

function declareExit() {
  const engine = makeEngine();
  finishSetup(engine);
  setCash(engine, engine.activeIndex, 0);
  armDebt(engine, 1000, null);
  engine.submitCommand({ type: "declareBankruptcy" });
  expect(engine.isOver).toBe(true);
  return extractBatchEvents(engine, engine.gameEvents);
}

function observeMedia() {
  const clock = installControlledClock();
  const active = new Map<HTMLMediaElement, string | null>();
  const played: { src: string | null; alreadyPlaying: (string | null)[] }[] = [];
  const play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const src = this.getAttribute("src");
    played.push({ src, alreadyPlaying: [...active.values()] });
    active.set(this, src);
    return Promise.resolve();
  });
  const pause = spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    active.delete(this);
  });

  resetFxOrchestration();
  setCatchupScale(3);
  setAudio(new MediaAudioPlayer());
  return {
    advance: clock.advance,
    played,
    [Symbol.dispose]() {
      setAudio(null);
      setCatchupScale(1);
      resetFxOrchestration();
      play.mockRestore();
      pause.mockRestore();
      clock.restore();
    },
  };
}

it("追帧中的出局锣雨在起拍、铜钱在撒落拍，仪式交棒前停声", async () => {
  const events = declareExit();
  using media = observeMedia();
  const gong = soundClipUrl(SOUND_CLIPS.bankrupt);
  const rain = soundClipUrl(SOUND_CLIPS.rain);
  const coins = soundClipUrl(SOUND_CLIPS.coinsBox);

  const playing = present([...events, { kind: "sound", event: "coin" }], createEngineSink());
  expect(media.played.map((play) => play.src)).toEqual([gong, rain]);
  expect(useFxStore.getState().coinBursts).toEqual([]);
  await media.advance(CEREMONY.blotAtMs);
  expect(useFxStore.getState().inkBlots).toHaveLength(1);
  await media.advance(CEREMONY.coinsAtMs - CEREMONY.blotAtMs);
  expect(useFxStore.getState().coinBursts).toHaveLength(1);
  expect(media.played.map((play) => play.src)).toEqual([gong, rain, coins]);

  getAudio().play("reactionTick");
  await media.advance(CEREMONY.settleMs - CEREMONY.coinsAtMs);
  await playing;
  expect(media.played[4]).toEqual({
    src: soundClipUrl(SOUND_CLIPS.coin),
    alreadyPlaying: [soundClipUrl(SOUND_CLIPS.reactionTick)],
  });
});

it("仪式进行时重新开声，旧撒币拍保持静默", async () => {
  const events = declareExit();
  using media = observeMedia();

  const playing = present([...events, { kind: "sound", event: "coin" }], createEngineSink());
  await media.advance(CEREMONY.blotAtMs);
  getAudio().setMuted(true);
  getAudio().setMuted(false);
  await media.advance(CEREMONY.coinsAtMs - CEREMONY.blotAtMs);
  await media.advance(CEREMONY.settleMs - CEREMONY.coinsAtMs);
  await playing;

  expect(media.played.map((play) => play.src)).toEqual([
    soundClipUrl(SOUND_CLIPS.bankrupt),
    soundClipUrl(SOUND_CLIPS.rain),
    soundClipUrl(SOUND_CLIPS.coin),
  ]);
});

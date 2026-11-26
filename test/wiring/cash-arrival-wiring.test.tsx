import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { MediaAudioPlayer, setAudio } from "@app/fx/audio";
import { setSnapPin } from "@app/fx/catchup";
import { FxLayer } from "@app/fx/FxLayer";
import { resetFxOrchestration } from "@app/fx/orchestrator";
import { SOUND_CLIPS, soundClipUrl } from "@app/fx/sound-clips";
import { stashEventBatch } from "@app/net/event-feed";
import { foldEventBatch } from "@app/net/event-fold";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { defineChoiceEffect, EFFECTS } from "@dafung/core/engine/effects";
import { beginGameEventBatch, type GameEvent } from "@dafung/core/engine/game-events";
import {
  armHero,
  armPhase,
  armVisitor,
  giveJinnang,
  giveTreasure,
  grantProperty,
  setCash,
  setDefense,
} from "@dafung/core/engine/planter";
import { SKILLS, type TriggerSkill } from "@dafung/core/engine/skills";
import { eventsMsg, type EventBatchMsg } from "@dafung/core/protocol/wire";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { act } from "react";
import { createRoot } from "react-dom/client";
import mapData from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

beforeAll(ensureHappyDom);
afterAll(releaseHappyDom);

function makeEngine(): GameEngine {
  const { board, catalog } = loadMap(mapData);
  return new GameEngine(board, catalog, createDice(7), {
    seats: ["魏", "蜀", "吴"].map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: 30_000,
    startingCash: 10_000,
    startingTreasures: 0,
  });
}

function mountPresentation(engine: GameEngine) {
  const clock = installControlledClock({ monotonic: true });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const effects = new SnapshotEffects(
    () => engine,
    () => null,
  );
  const played: Array<string | null> = [];
  const active = new Set<HTMLMediaElement>();
  const play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this.getAttribute("src"));
    active.add(this);
    return Promise.resolve();
  });
  const pause = spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    active.delete(this);
  });
  setAudio(new MediaAudioPlayer());
  act(() => {
    useGameStore.getState().syncFromEngine(engine);
    root.render(
      <>
        <svg id="board" />
        {engine.players.map((player, seat) => (
          <span key={player.id} data-testid={TESTIDS.seatCash(seat)} />
        ))}
        <FxLayer />
      </>,
    );
  });
  // happy-dom 不做棋盘排版，铜钱只需有可供换算的屏幕矩阵。
  Object.defineProperty(document.getElementById("board"), "getScreenCTM", {
    value: () => new DOMMatrix(),
  });
  return {
    played,
    active,
    advance: clock.advance,
    async present(events: GameEvent[]) {
      await act(async () => {
        stashEventBatch(events);
        effects.play(engine.players.map((player) => player.position));
        useGameStore.getState().syncFromEngine(engine);
      });
    },
    disconnect() {
      act(() => effects.dropStalledBatch());
    },
    swapBoard() {
      act(() => effects.voidQueuedForBoardSwap());
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
      resetFxOrchestration();
      useGameStore.getState().reset();
      useNetStore.getState().reset();
      setAudio(null);
      play.mockRestore();
      pause.mockRestore();
      host.remove();
      clock.restore();
    },
  };
}

function cashFly(seat: number): Element {
  const coin = document.querySelector(`[data-testid="${TESTIDS.cashFly(seat)}"]`);
  if (coin == null) throw new Error("归账铜钱尚未起飞");
  return coin;
}

function finishCashFly(coin: Element): void {
  act(() => {
    coin.dispatchEvent(new Event("animationend", { bubbles: true }));
  });
}

function closeRound(engine: GameEngine) {
  const count = engine.players.length;
  const lastSeat = (engine.roundAnchor + count - 1) % count;
  armPhase(engine, { activeIndex: lastSeat, phase: "Playing", turnPhase: "EndTurn" });
  beginGameEventBatch(engine);
  engine.endTurn();
  return engine
    .snapshot()
    .events.filter(
      (event): event is Extract<GameEvent, { kind: "cashChanged" }> =>
        event.kind === "cashChanged" && event.reason === "city-income",
    );
}

it("轮末持城收益分两批播，第一枚铜钱抵达才响，同一轮只响一次", async () => {
  const engine = makeEngine();
  grantProperty(engine, 0, "prop-youzhou", 1);
  grantProperty(engine, 1, "prop-xiapi", 1);
  using view = mountPresentation(engine);

  const incomes = closeRound(engine);
  expect(incomes.map((event) => event.delta)).toEqual([54, 90]);

  await view.present([incomes[0]]);
  await view.present([incomes[1]]);
  expect(view.played).toEqual([]);
  finishCashFly(cashFly(1));
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.coin)]);

  finishCashFly(cashFly(0));
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.coin)]);

  await view.present(closeRound(engine));
  finishCashFly(cashFly(0));
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.coin), soundClipUrl(SOUND_CLIPS.coin)]);
});

it.each(["断线", "吸附", "换图"] as const)(
  "%s收回已起飞的归账，迟到的抵达保持静默",
  async (boundary) => {
    const engine = makeEngine();
    grantProperty(engine, 0, "prop-youzhou", 1);
    using view = mountPresentation(engine);

    await view.present(closeRound(engine));
    const coin = cashFly(0);
    if (boundary === "吸附") {
      setSnapPin(true);
      try {
        await view.present(closeRound(engine));
      } finally {
        setSnapPin(false);
      }
    } else if (boundary === "换图") {
      view.swapBoard();
    } else {
      view.disconnect();
    }
    expect(coin.isConnected).toBe(false);
    finishCashFly(coin);
    expect(view.played).toEqual([]);
  },
);

it("吸附让已响的归账短声渐出，同时丢掉过时的归账", async () => {
  const engine = makeEngine();
  grantProperty(engine, 0, "prop-youzhou", 1);
  using view = mountPresentation(engine);
  await view.present(closeRound(engine));
  finishCashFly(cashFly(0));
  const [coin] = view.active;
  const startVolume = coin.volume;

  setSnapPin(true);
  try {
    await view.present(closeRound(engine));
  } finally {
    setSnapPin(false);
  }
  expect(view.active.has(coin)).toBe(true);
  await view.advance(48);
  expect(coin.volume).toBeGreaterThan(0);
  expect(coin.volume).toBeLessThan(startVolume);
  await view.advance(150);
  expect(view.active.has(coin)).toBe(false);
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.coin)]);
});

function armCityLossChoice(engine: GameEngine, seat: number): Disposable {
  const choice: TriggerSkill = {
    id: "test-fire-wall-arrival-choice",
    name: "失城抉择",
    desc: "测试火烧连营续作",
    when: "PropertyLost",
    stage: "during",
    effect: "test-fire-wall-arrival-choice",
  };
  EFFECTS[choice.effect] = defineChoiceEffect("PropertyLost", (_engine, ctx) => ({
    heroId: ctx.slotHeroId,
    skillId: ctx.skillId,
    ownerSeat: ctx.owner,
    subjectSeat: ctx.subject,
  }));
  SKILLS.push(choice);
  armHero(engine, seat, "zhangxingcai", [choice.id]);
  return {
    [Symbol.dispose]() {
      SKILLS.splice(SKILLS.indexOf(choice), 1);
      delete EFFECTS[choice.effect];
    },
  };
}

function castFireWall(engine: GameEngine, tileIndex: number): void {
  engine.submitCommand({ type: "useJinnang", cardId: "火烧连营" });
  engine.submitCommand({ type: "useJinnang", cardId: "火烧连营", targets: [tileIndex] });
}

it.each([false, true])(
  "断线后的同一张火烧连营归账只响一次（断线前已抵达：%s）",
  async (arrived) => {
    const engine = makeEngine();
    using _choice = armCityLossChoice(engine, 1);
    armPhase(engine, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
    grantProperty(engine, 1, "prop-jinyang", 1);
    setDefense(engine, 1, "prop-jinyang", 4);
    grantProperty(engine, 1, "prop-youzhou", 2);
    giveJinnang(engine, 0, ["火烧连营"]);
    using view = mountPresentation(engine);
    const conquest = soundClipUrl(SOUND_CLIPS.cityConquest);
    const coinSound = soundClipUrl(SOUND_CLIPS.coin);

    castFireWall(engine, 1);
    expect(engine.turnPhase).toBe("AwaitingSkillChoice");
    await view.present(engine.snapshot().events);
    expect(view.played).toEqual([conquest]);
    const before = cashFly(0);
    if (arrived) finishCashFly(before);
    view.disconnect();
    finishCashFly(before);
    expect(view.played).toEqual(arrived ? [conquest, coinSound] : [conquest]);

    engine.submitCommand({ type: "respondSkillChoice", seat: 1, use: false });
    expect(engine.gameEvents).toContainEqual(
      expect.objectContaining({
        kind: "cashChanged",
        cityReward: {
          propertyId: "prop-youzhou",
          fireWall: expect.objectContaining({ stage: "impactKnown" }),
        },
      }),
    );
    await view.present(engine.snapshot().events);
    finishCashFly(cashFly(0));
    expect(view.played).toEqual([conquest, coinSound]);
  },
);

it("旁观席漏收同回合第二张火烧的宣布，恢复后该牌余款单独归账一次", async () => {
  let authority = makeEngine();
  const observer = 2;
  using _choice = armCityLossChoice(authority, 1);
  armPhase(authority, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
  giveJinnang(authority, 0, ["火烧连营", "火烧连营"]);
  grantProperty(authority, 1, "prop-jieting", 1);
  for (const city of ["prop-jinyang", "prop-youzhou"]) {
    grantProperty(authority, 1, city, 1);
    setDefense(authority, 1, city, 4);
  }
  grantProperty(authority, 1, "prop-liaodong", 1);

  const replica = makeEngine();
  const rehydrate = () =>
    replica.restoreFromSnapshot(
      JSON.parse(JSON.stringify(redactSnapshotForSeat(authority.snapshot(), observer))),
    );
  rehydrate();
  using view = mountPresentation(replica);
  const restartAuthority = () => {
    const saved = JSON.parse(JSON.stringify(authority.snapshot()));
    authority = makeEngine();
    authority.restoreFromSnapshot(saved);
  };
  const deliver = async () => {
    const { events } = JSON.parse(
      eventsMsg(redactEvents(authority.gameEvents, observer)),
    ) as EventBatchMsg;
    foldEventBatch(replica, events);
    await view.present(events);
  };
  const coinSound = soundClipUrl(SOUND_CLIPS.coin);
  const sounds = () => view.played.filter((sound) => sound === coinSound);

  castFireWall(authority, 14);
  await deliver();
  finishCashFly(cashFly(0));
  expect(sounds()).toHaveLength(1);
  const turn = authority.turnNumber;
  view.disconnect();
  restartAuthority();

  castFireWall(authority, 1);
  expect(authority.turnPhase).toBe("AwaitingSkillChoice");
  rehydrate();
  restartAuthority();

  authority.submitCommand({ type: "respondSkillChoice", seat: 1, use: false });
  expect(authority.turnPhase).toBe("AwaitingSkillChoice");
  await deliver();
  finishCashFly(cashFly(0));
  expect(sounds()).toHaveLength(2);

  authority.submitCommand({ type: "respondSkillChoice", seat: 1, use: false });
  expect(authority.turnNumber).toBe(turn);
  await deliver();
  finishCashFly(cashFly(0));
  expect(sounds()).toHaveLength(2);
});

it("珍宝托管时只播公道买卖的升级声，清偿后由卖家归账响一声交接", async () => {
  const engine = makeEngine();
  engine.beginCapitalSelection();
  while (engine.phase === "Setup") {
    const outcome = engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
    if (!outcome.ok) throw new Error(`选都失败 ${outcome.reason}`);
  }
  const buyer = engine.roundAnchor;
  const seller = (buyer + 1) % engine.players.length;
  const city = engine.board.tiles.find(
    (tile) => tile.propertyId != null && engine.findOwner(tile.propertyId) == null,
  );
  if (city?.propertyId == null) throw new Error("种植场景没有可授予的无主城");
  const treasure = { id: "hat", name: "草帽", level: 1 };
  const asset = { id: "hu", name: "小斛", level: 3 };
  const sellerCash = engine.players[seller].cash;
  giveTreasure(engine, seller, [treasure]);
  giveTreasure(engine, buyer, [asset]);
  grantProperty(engine, seller, city.propertyId, 1);
  armVisitor(engine, city.propertyId, seller);
  armPhase(engine, { activeIndex: buyer, turnPhase: "AwaitingTreasureOwner" });
  setCash(engine, buyer, 0);
  using view = mountPresentation(engine);

  engine.submitCommand({
    type: "resolveTreasureOwner",
    action: { type: "fair", treasureId: treasure.id },
  });
  await view.present(engine.snapshot().events);
  expect(engine.turnPhase).toBe("AwaitingBankruptcySettle");
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.upgrade)]);

  engine.submitCommand({
    type: "confirmBankruptcySettle",
    assets: [{ kind: "treasure", id: asset.id }],
  });
  await view.present(engine.snapshot().events);
  expect(engine.players[buyer].treasures.map((held) => held.id)).toEqual([treasure.id]);
  expect(engine.players[seller].cash).toBe(sellerCash + 100);
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.upgrade)]);

  finishCashFly(cashFly(buyer));
  expect(view.played).toEqual([soundClipUrl(SOUND_CLIPS.upgrade)]);
  finishCashFly(cashFly(seller));
  expect(view.played).toEqual([
    soundClipUrl(SOUND_CLIPS.upgrade),
    soundClipUrl(SOUND_CLIPS.cashTransfer),
  ]);
});

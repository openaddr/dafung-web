import { afterAll, afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import { MediaAudioPlayer, setAudio, type SoundEvent } from "@app/fx/audio";
import { setSnapPin } from "@app/fx/catchup";
import { resetFxOrchestration } from "@app/fx/orchestrator";
import { SOUND_CLIPS, soundClipUrl } from "@app/fx/sound-clips";
import { CEREMONY, DUEL, FX } from "@app/fx/timings";
import { waitForGameArchive } from "@app/gameLogArchive";
import { stashEventBatch } from "@app/net/event-feed";
import { SCROLL_TESTIDS as T } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { defineChoiceEffect, EFFECTS } from "@dafung/core/engine/effects";
import { beginGameEventBatch } from "@dafung/core/engine/game-events";
import { heroById } from "@dafung/core/engine/heroes";
import {
  armDebt,
  armHero,
  armLanding,
  armPhase,
  grantProperty,
  pinDice,
  setCash,
} from "@dafung/core/engine/planter";
import { SKILLS, type TriggerSkill } from "@dafung/core/engine/skills";
import { IDBFactory } from "fake-indexeddb";
import type { Window as HappyDomWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import rawMap from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const mapData = rawMap as MapData;
const map = loadMap(mapData);
const indexedDb = new IDBFactory();

type WiringController = import("@app/controllers/controller").GameController & {
  resync(): void;
  playCurrentBatch(): void;
};
let createController: (engine: GameEngine) => WiringController;
let setController: typeof import("@app/controllers/registry").setController;
let GameScreen: typeof import("@app/screens/game/GameScreen").GameScreen;
let originalIndexedDb: PropertyDescriptor | undefined;
let dom: HappyDomWindow["happyDOM"];
let root: Root | undefined;
let host: HTMLElement;
let clock: ReturnType<typeof installControlledClock>;
let restoreMediaPlay: (() => void) | undefined;

beforeAll(async () => {
  ensureHappyDom();
  dom = (window as unknown as HappyDomWindow).happyDOM;
  // 给根相对资源一个有效基址，happy-dom 禁用图像下载，只核对实际资源路径。
  dom.setURL("https://dafung.test");
  // 给无排版的 happy-dom 提供棋盘挂载尺寸，版本取 Vite 注入同源值。
  Object.defineProperty(SVGSVGElement.prototype, "clientWidth", {
    get: () => 844,
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, "clientHeight", {
    get: () => 390,
    configurable: true,
  });
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
  (globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
  ({ GameScreen } = await import("@app/screens/game/GameScreen"));
  ({ setController } = await import("@app/controllers/registry"));
  const { GameController } = await import("@app/controllers/controller");
  class TerminalController extends GameController {
    protected readonly mySeat = 0;

    constructor(readonly engine: GameEngine) {
      super();
    }

    get viewSeat(): number {
      return this.engine.decisionOwner;
    }

    dispatchCommand(): void {
      throw new Error("终局卷轴不发游戏命令");
    }

    resync(): void {
      this.sync();
    }

    playCurrentBatch(): void {
      stashEventBatch(this.engine.snapshot().events);
      this.fx.play(this.engine.players.map((player) => player.position));
      this.sync();
    }
  }
  createController = (engine) => new TerminalController(engine);
});

afterEach(async () => {
  setAudio(null);
  restoreMediaPlay?.();
  restoreMediaPlay = undefined;
  setSnapPin(false);
  dom.settings.device.prefersReducedMotion = "no-preference";
  if (root === undefined) return;
  await clock.settle();
  const mounted = root;
  act(() => mounted.unmount());
  root = undefined;
  host.remove();
  const gameId = useGameStore.getState().snapshot!.gameId;
  setController(null);
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  resetFxOrchestration();
  clock.restore();
  await waitForGameArchive(gameId);
  await Bun.sleep(0);
});

afterAll(async () => {
  for (const { name } of await indexedDb.databases()) {
    if (name === undefined) throw new Error("测试归档库无名称");
    await new Promise<void>((resolve, reject) => {
      const remove = indexedDb.deleteDatabase(name);
      remove.onsuccess = () => resolve();
      remove.onerror = () => reject(remove.error);
    });
  }
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await releaseHappyDom();
});

function makeSetupEngine(guohaos: string[]): GameEngine {
  const seed = 1416;
  const engine = new GameEngine(map.board, map.catalog, createDice(seed), {
    seats: guohaos.map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    startingTreasures: map.startingTreasures,
    seed,
    mapId: "guanzhong",
  });
  engine.beginCapitalSelection();
  return engine;
}

function seedEngine(guohaos: string[]): GameEngine {
  const engine = makeSetupEngine(guohaos);
  while (engine.phase === "Setup") {
    const result = engine.pickCapital(
      engine.currentSetupPlayerIndex,
      Math.min(...engine.offeredCapitals),
    );
    if (!result.ok) throw new Error(`选都失败 ${result.reason}`);
  }
  return engine;
}

function mount(engine: GameEngine): WiringController {
  const controller = createController(engine);
  setController(controller, mapData);
  clock = installControlledClock();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const mounted = root;
  act(() => {
    controller.resync();
    mounted.render(<GameScreen />);
  });
  return controller;
}

function find<T extends Element = HTMLElement>(id: string, scope: ParentNode = host): T | null {
  return scope.querySelector<T>(`[data-testid="${id}"]`);
}

function observeSounds(): SoundEvent[] {
  const sounds: SoundEvent[] = [];
  const soundsByUrl = new Map(
    (Object.keys(SOUND_CLIPS) as SoundEvent[]).map((event) => [
      soundClipUrl(SOUND_CLIPS[event]),
      event,
    ]),
  );
  const play = spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const src = this.getAttribute("src");
    const event = src === null ? undefined : soundsByUrl.get(src);
    if (event === undefined) throw new Error(`未知音效素材 ${src}`);
    sounds.push(event);
    return Promise.resolve();
  });
  restoreMediaPlay = () => play.mockRestore();
  setAudio(new MediaAudioPlayer());
  return sounds;
}

function finishVictorySeal() {
  const seal = find(T.victorySeal);
  if (seal === null) throw new Error("终局朱印尚未挂载");
  act(() => {
    seal.dispatchEvent(
      new AnimationEvent("animationend", {
        animationName: "victory-stamp-in",
        bubbles: true,
      }),
    );
  });
}

function simulateBackgroundReturn() {
  const previous = Object.getOwnPropertyDescriptor(document, "visibilityState");
  try {
    for (const state of ["hidden", "visible"]) {
      act(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
  } finally {
    if (previous === undefined) Reflect.deleteProperty(document, "visibilityState");
    else Object.defineProperty(document, "visibilityState", previous);
  }
}

it("全员实际定都后只播放一次起兵主题，校准与回前台不重播", async () => {
  const engine = makeSetupEngine(["魏", "蜀", "吴"]);
  const controller = mount(engine);
  const sounds = observeSounds();
  for (let picked = 1; picked <= engine.players.length; picked++) {
    await act(async () => {
      beginGameEventBatch(engine);
      const result = engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
      if (!result.ok) throw new Error(`选都失败 ${result.reason}`);
      controller.playCurrentBatch();
    });
    expect(sounds.filter((sound) => sound === "gameStart")).toHaveLength(
      picked === engine.players.length ? 1 : 0,
    );
  }
  simulateBackgroundReturn();
  act(() => controller.resync());
  await clock.advance(1000);
  expect(sounds.filter((sound) => sound === "gameStart")).toHaveLength(1);
});

it("正常胜局在终榜一拍开放入口，并走原再战路由", async () => {
  const engine = seedEngine(["东魏", "蜀", "吴", "魏", "燕", "赵", "楚", "齐"]);
  armPhase(engine, { activeIndex: 0, phase: "Playing", turnPhase: "EndTurn" });
  setCash(engine, 0, 30480);
  setCash(engine, 1, 32000);
  armHero(engine, 0, "zhouyu");
  for (const id of ["simayi", "caoren", "dengai"]) armHero(engine, 1, id);
  const controller = mount(engine);
  const sounds = observeSounds();
  expect(find(T.victoryScreen) === null).toBe(true);
  await act(async () => {
    beginGameEventBatch(engine);
    engine.endTurn();
    controller.playCurrentBatch();
  });

  await clock.advance(899);
  expect(find(T.victoryScreen) !== null).toBe(true);
  expect(find(T.victoryStandings) !== null).toBe(false);
  expect(find(T.victoryRestart) !== null).toBe(false);
  expect(sounds).toEqual(["victoryDrum"]);
  finishVictorySeal();
  finishVictorySeal();
  expect(sounds).toEqual(["victoryDrum", "victory"]);

  await clock.advance(1);
  const rows = Array.from(find(T.victoryStandings)!.querySelectorAll("li"));
  expect(rows).toHaveLength(8);
  expect(rows[0].textContent).toContain("胜者");
  expect(rows[0].textContent).toContain("蜀");
  expect(rows[0].textContent).toContain("32000 两");
  expect(rows[1].textContent).toContain("东魏");
  expect(find(T.victorySub)?.textContent).toContain("蜀称帝");
  expect(find(T.victoryInfo)?.textContent).toContain("富甲天下");
  expect(find(T.victoryInfo)?.textContent).toContain("32000 两");
  expect(find(T.victoryInfo)?.textContent).toContain("第 1 轮");
  const capital = engine.board.at(engine.players[1].capitalIndex);
  const victory = find(T.victoryScreen)!;
  expect(victory.textContent).toContain(`都城 ${capital.name}`);
  expect(find(TESTIDS.cityLedgerThumb(capital.propertyId!), victory) !== null).toBe(true);
  expect(Array.from(victory.querySelectorAll("img"), (img) => img.getAttribute("src"))).toEqual(
    ["simayi", "caoren", "dengai"].map((id) => heroById(id).image),
  );
  const restart = find<HTMLButtonElement>(T.victoryRestart)!;
  expect(restart.disabled).toBe(false);
  restart.focus();
  expect(document.activeElement === restart).toBe(true);
  const reload = spyOn(location, "reload").mockImplementation(() => {});
  try {
    await act(async () => {
      restart.click();
      await waitForGameArchive(engine.gameId);
      await Bun.sleep(0);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    reload.mockRestore();
  }
});

it("终局保留轮末收入，依序播放重掷并揭晓胜者", async () => {
  const engine = seedEngine(["魏", "蜀", "吴"]);
  dom.settings.device.prefersReducedMotion = "reduce";
  const lastSeat = (engine.roundAnchor + 2) % engine.players.length;
  armPhase(engine, { activeIndex: lastSeat, phase: "Playing", turnPhase: "EndTurn" });
  for (const seat of [0, 1, 2]) setCash(engine, seat, engine.targetNetWorth);
  grantProperty(engine, 0, "prop-jinyang", 1);
  grantProperty(engine, 1, "prop-xiapi", 1);
  // 晋阳和下邳分别到账 54、90 两，到账后方三家并列。
  setCash(engine, 0, engine.targetNetWorth - 54);
  setCash(engine, 1, engine.targetNetWorth - 90);
  pinDice(engine, "duel", [5, 4, 5, 6, 2]);
  const controller = mount(engine);
  const sounds = observeSounds();
  setSnapPin(true);

  await act(async () => {
    beginGameEventBatch(engine);
    engine.endTurn();
    controller.playCurrentBatch();
  });
  const sign = (seat: number) => find(TESTIDS.duelSign(seat), document.body);
  const signTexts = (...seats: number[]) => seats.map((seat) => sign(seat)?.textContent?.trim());
  const firstCoin = find(TESTIDS.cashFly(1), document.body);
  const secondCoin = find(TESTIDS.cashFly(0), document.body);
  if (firstCoin === null || secondCoin === null) throw new Error("两枚归账铜钱应已起飞");
  expect(find(T.victoryScreen) === null).toBe(true);
  await clock.advance(FX.cashFlyMs + 1);
  expect(find(TESTIDS.duelOverlay, document.body) === null).toBe(true);
  expect(sounds).toEqual([]);
  await act(async () => {
    firstCoin.dispatchEvent(new Event("animationend", { bubbles: true }));
  });
  expect(sounds).toEqual(["coin"]);
  expect(signTexts(0, 1, 2)).toEqual(["魏", "蜀", "吴"]);
  act(() => {
    secondCoin.dispatchEvent(new Event("animationend", { bubbles: true }));
  });

  async function reachVerdict(sides: number) {
    await clock.advance(DUEL.curtainMs);
    await clock.advance(DUEL.windupMs);
    await clock.advance(DUEL.shakeMs);
    for (let side = 1; side < sides; side++) await clock.advance(DUEL.clackGapMs);
    await clock.advance(DUEL.verdictMs);
  }
  await reachVerdict(3);
  expect(signTexts(0, 1, 2)).toEqual(["魏五", "蜀四", "吴五"]);
  expect(sounds).toEqual(["coin", "duelClash", "diceLand", "diceLand", "diceLand", "verdictChime"]);
  expect(find(TESTIDS.duelVerdict, document.body)?.textContent).toBe("平");
  await clock.advance(DUEL.holdMs);
  await clock.advance(DUEL.fadeOutMs);
  expect(find(T.victoryScreen)).toBeNull();
  expect(sign(1)).toBeNull();

  await reachVerdict(2);
  expect(signTexts(0, 2)).toEqual(["魏六", "吴二"]);
  expect(sounds.slice(-4)).toEqual(["duelClash", "diceLand", "diceLand", "verdictChimeWin"]);
  await clock.advance(DUEL.holdMs);
  await clock.advance(DUEL.fadeOutMs);
  const rows = Array.from(find(T.victoryStandings)!.querySelectorAll("li"));
  expect(rows[0].textContent).toContain("胜者 魏");
  expect(sounds.at(-1)).toBe("victoryDrum");
  finishVictorySeal();
  expect(sounds.slice(-2)).toEqual(["victoryDrum", "victory"]);
});

it("终局跳过休整者时，先播同次结算的破产仪式", async () => {
  const engine = seedEngine(["魏", "蜀"]);
  const survivor = 1 - engine.activeIndex;
  engine.damageStamina(survivor, 100, null);
  armDebt(engine, engine.activePlayer.cash + 1000, null);
  const controller = mount(engine);
  const sounds = observeSounds();

  await act(async () => {
    engine.submitCommand({ type: "declareBankruptcy" });
    controller.playCurrentBatch();
  });
  expect(engine.gameEvents.map(({ kind, turn }) => `${kind}@${turn}`)).toEqual([
    "assetTransferred@1",
    "playerBankrupt@1",
    "turnEnded@1",
    "turnSkipped@2",
    "roundEnded@2",
    "gameOver@2",
  ]);
  expect(sounds).toEqual(["bankrupt", "rain"]);
  expect(find(T.victoryScreen)).toBeNull();
  await clock.advance(CEREMONY.blotAtMs);
  await clock.advance(CEREMONY.coinsAtMs - CEREMONY.blotAtMs);
  expect(sounds).toEqual(["bankrupt", "rain", "coinsBox"]);
  await clock.advance(CEREMONY.settleMs - CEREMONY.coinsAtMs);
  expect(sounds.at(-1)).toBe("victoryDrum");
});

it.each(["待播", "在飞", "作废"] as const)(
  "技能收窗判胜，前批%s归账按有效性接棒",
  async (status) => {
    const choice: TriggerSkill = {
      id: "test-victory-income-choice",
      name: "得银选择",
      desc: "测试轮末续作",
      when: "CashGained",
      stage: "during",
      effect: "test-victory-income-choice",
    };
    EFFECTS[choice.effect] = defineChoiceEffect("CashGained", (_engine, ctx) => ({
      heroId: ctx.slotHeroId,
      skillId: ctx.skillId,
      ownerSeat: ctx.owner,
      subjectSeat: ctx.subject,
    }));
    SKILLS.push(choice);
    try {
      const engine = seedEngine(["魏", "蜀"]);
      const last = 1 - engine.roundAnchor;
      armPhase(engine, { activeIndex: last, turnPhase: "AwaitingDecision" });
      armLanding(engine, { kind: "PropertyAvailable", propertyId: "prop-wujun" });
      grantProperty(engine, 0, "prop-youzhou", 1);
      setCash(engine, 0, engine.targetNetWorth - 54);
      armHero(engine, 0, "caopi", [choice.id]);
      const controller = mount(engine);
      const sounds = observeSounds();
      const income = () => {
        engine.submitCommand({ type: "endDecision" });
        expect(engine.turnPhase).toBe("AwaitingSkillChoice");
        controller.playCurrentBatch();
      };
      const verdict = () => {
        engine.submitCommand({ type: "respondSkillChoice", seat: 0, use: false });
        expect(engine.gameEvents.map(({ kind }) => kind)).toEqual([
          "skillChoiceAnswered",
          "gameOver",
        ]);
        controller.playCurrentBatch();
      };
      const findCoin = () => find<SVGSVGElement>(TESTIDS.cashFly(0), document.body);
      let priorCoin: SVGSVGElement | null = null;
      if (status === "待播") {
        // 同一拍先收到有效入账批，再收到权威续结算，播放器尚未从队列取出入账批。
        await act(async () => {
          income();
          verdict();
        });
      } else {
        await act(async () => income());
        priorCoin = findCoin();
        if (priorCoin === null) throw new Error("首枚归账铜钱尚未起飞");
        if (status === "作废") simulateBackgroundReturn();
        await act(async () => verdict());
      }

      if (status === "作废") {
        expect(findCoin()).toBeNull();
        expect(sounds).toEqual(["victoryDrum"]);
      } else {
        const activeCoin = findCoin();
        if (activeCoin === null) throw new Error("终局前应有一枚有效归账铜钱");
        if (priorCoin !== null) expect(activeCoin).toBe(priorCoin);
        expect(find(T.victoryScreen)).toBeNull();
        expect(sounds).toEqual([]);
        await act(async () => {
          activeCoin.dispatchEvent(new Event("animationend", { bubbles: true }));
        });
        expect(sounds).toEqual(["coin", "victoryDrum"]);
      }
    } finally {
      SKILLS.splice(SKILLS.indexOf(choice), 1);
      delete EFFECTS[choice.effect];
    }
  },
);

it("终局画卷切回前台时，旧的落印和短角句随演出退场", async () => {
  const engine = seedEngine(["魏", "蜀"]);
  const winner = engine.roundAnchor;
  armPhase(engine, { activeIndex: winner, phase: "Playing", turnPhase: "EndTurn" });
  setCash(engine, winner, engine.targetNetWorth);
  const controller = mount(engine);
  const sounds = observeSounds();

  await act(async () => {
    beginGameEventBatch(engine);
    engine.endTurn();
    controller.playCurrentBatch();
  });
  expect(sounds).toEqual(["victoryDrum"]);
  simulateBackgroundReturn();
  finishVictorySeal();
  await clock.advance(900);
  expect(sounds).toEqual(["victoryDrum"]);
  expect(find<HTMLButtonElement>(T.victoryRestart)?.disabled).toBe(false);
});

it("归账等待被切前后台作废时，胜利画卷照常出现，旧铜钱抵达保持静默", async () => {
  const engine = seedEngine(["魏", "蜀"]);
  const lastSeat = (engine.roundAnchor + 1) % engine.players.length;
  armPhase(engine, { activeIndex: lastSeat, phase: "Playing", turnPhase: "EndTurn" });
  grantProperty(engine, 0, "prop-youzhou", 1);
  setCash(engine, 0, engine.targetNetWorth - 54);
  const controller = mount(engine);
  const sounds = observeSounds();

  await act(async () => {
    beginGameEventBatch(engine);
    engine.endTurn();
    controller.playCurrentBatch();
  });
  const coin = find(TESTIDS.cashFly(0), document.body);
  if (coin === null) throw new Error("首枚归账铜钱尚未起飞");
  expect(find(T.victoryScreen) === null).toBe(true);
  simulateBackgroundReturn();
  expect(find(T.victoryScreen) !== null).toBe(true);
  act(() => {
    coin.dispatchEvent(new Event("animationend", { bubbles: true }));
  });
  finishVictorySeal();
  expect(sounds).toEqual([]);
});

it("减少动态效果时，恢复双席无将胜局立即显示实际都城、终榜及可点入口", () => {
  const engine = seedEngine(["魏", "蜀"]);
  const debtor = engine.activePlayer;
  dom.settings.device.prefersReducedMotion = "reduce";
  const controller = mount(engine);
  const sounds = observeSounds();
  act(() => {
    engine.payOrLiquidate(debtor, null, debtor.cash + 1000);
    engine.declareBankruptcy();
    controller.resync();
  });
  const rows = Array.from(find(T.victoryStandings)!.querySelectorAll("li"));
  expect(rows).toHaveLength(2);
  expect(rows[1].textContent).toContain(debtor.guohao);
  expect(rows[1].textContent).toContain("破产");
  expect(find(T.victoryInfo)?.textContent).toContain("群雄尽灭");
  const capital = engine.board.at(engine.winner!.capitalIndex);
  const victory = find(T.victoryScreen)!;
  expect(find(TESTIDS.cityLedgerThumb(capital.propertyId!), victory) !== null).toBe(true);
  expect(victory.querySelectorAll("figure").length).toBe(1);
  expect(find<HTMLButtonElement>(T.victoryRestart)?.disabled).toBe(false);
  finishVictorySeal();
  expect(sounds).toEqual([]);
});

it("减少动态效果时，作废面板保留独立的 1.8 秒出口", async () => {
  const engine = seedEngine(["魏", "蜀"]);
  dom.settings.device.prefersReducedMotion = "reduce";
  const controller = mount(engine);
  const sounds = observeSounds();
  await act(async () => {
    beginGameEventBatch(engine);
    engine.abortGame("接线测试");
    controller.playCurrentBatch();
  });
  expect(find(T.victoryAbortedTitle)?.textContent).toBe("对局作废");
  await clock.advance(1799);
  expect(find(T.victoryRestart) !== null).toBe(false);
  await clock.advance(1);
  expect(find<HTMLButtonElement>(T.victoryRestart)?.disabled).toBe(false);
  expect(find(T.victoryStandings) !== null).toBe(false);
  expect(sounds).toEqual([]);
});

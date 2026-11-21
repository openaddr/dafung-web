import { afterAll, afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import { setAudio, type SoundEvent } from "@app/fx/audio";
import { setSnapPin } from "@app/fx/catchup";
import { useFxStore } from "@app/fx/fxStore";
import { resetFxOrchestration } from "@app/fx/orchestrator";
import { DUEL, FX } from "@app/fx/timings";
import { waitForGameArchive } from "@app/gameLogArchive";
import { stashEventBatch } from "@app/net/event-feed";
import { SCROLL_TESTIDS as T } from "@app/screens/game/scroll/testids";
import { TESTIDS } from "@app/screens/game/testids";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { GameEngine } from "@core/authority";
import { loadMap, type MapData } from "@core/board-loader";
import { createDice } from "@core/dice";
import { beginGameEventBatch } from "@core/game-events";
import { heroById } from "@core/heroes";
import { armHero, armPhase, grantProperty, pinDice, setCash } from "@core/planter";
import { IDBFactory } from "fake-indexeddb";
import type { Window as HappyDomWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import pkg from "../../package.json";
import rawMap from "../../public/maps/guanzhong.json";
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
    protected readonly hotSeat = true;

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

function seedEngine(guohaos: string[]): GameEngine {
  const seed = 1416;
  const engine = new GameEngine(map.board, map.catalog, createDice(seed), {
    seats: guohaos.map((guohao) => ({ name: guohao, guohao, isBot: false })),
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    startingTreasures: map.startingTreasures,
    seed,
    mapId: "guanzhong",
  });
  engine.doDraftRoll();
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

it("正常胜局在终榜一拍开放入口，并走原再战路由", async () => {
  const engine = seedEngine(["东魏", "蜀", "吴", "魏", "燕", "赵", "楚", "齐"]);
  armPhase(engine, { activeIndex: 0, phase: "Playing", turnPhase: "EndTurn" });
  setCash(engine, 0, 30480);
  setCash(engine, 1, 32000);
  armHero(engine, 0, "zhouyu");
  for (const id of ["simayi", "caoren", "dengai"]) armHero(engine, 1, id);
  const controller = mount(engine);
  expect(find(T.victoryScreen) === null).toBe(true);
  act(() => {
    engine.endTurn();
    controller.resync();
  });

  await clock.advance(899);
  expect(find(T.victoryScreen) !== null).toBe(true);
  expect(find(T.victoryStandings) !== null).toBe(false);
  expect(find(T.victoryRestart) !== null).toBe(false);

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
  grantProperty(engine, 0, "prop-youzhou", 1); // 幽州收入 54 两，到账后方三家并列。
  setCash(engine, 0, engine.targetNetWorth - 54);
  pinDice(engine, "duel", [4, 5, 5, 2, 6]);
  const controller = mount(engine);
  const sounds: SoundEvent[] = [];
  setAudio({ play: (event) => sounds.push(event), setMuted: () => {}, dispose: () => {} });
  setSnapPin(true);

  await act(async () => {
    beginGameEventBatch(engine);
    engine.endTurn();
    controller.playCurrentBatch();
  });
  const sign = (seat: number) => find(TESTIDS.duelSign(seat), document.body);
  const signTexts = (...seats: number[]) => seats.map((seat) => sign(seat)?.textContent?.trim());
  expect(find(T.victoryScreen)).toBeNull();
  expect(useFxStore.getState().floaters).toContainEqual(expect.objectContaining({ amount: 54 }));
  expect(sign(0)).toBeNull();
  await clock.advance(FX.cashFlyMs);
  expect(signTexts(0, 1, 2)).toEqual(["魏", "蜀", "吴"]);

  async function reachVerdict(sides: number) {
    await clock.advance(DUEL.curtainMs);
    await clock.advance(DUEL.windupMs);
    await clock.advance(DUEL.shakeMs);
    for (let side = 1; side < sides; side++) await clock.advance(DUEL.clackGapMs);
    await clock.advance(DUEL.verdictMs);
  }
  await reachVerdict(3);
  expect(signTexts(0, 1, 2)).toEqual(["魏四", "蜀五", "吴五"]);
  expect(find(TESTIDS.duelVerdict, document.body)?.textContent).toBe("平");
  await clock.advance(DUEL.holdMs);
  await clock.advance(DUEL.fadeOutMs);
  expect(find(T.victoryScreen)).toBeNull();
  expect(sign(0)).toBeNull();

  await reachVerdict(2);
  expect(signTexts(1, 2)).toEqual(["蜀二", "吴六"]);
  await clock.advance(DUEL.holdMs);
  await clock.advance(DUEL.fadeOutMs);
  const rows = Array.from(find(T.victoryStandings)!.querySelectorAll("li"));
  expect(rows[0].textContent).toContain("胜者 吴");
  expect(sounds.filter((sound) => sound === "victory")).toHaveLength(0);
  await clock.advance(700);
  expect(sounds.filter((sound) => sound === "victory")).toHaveLength(1);
});

it("减少动态效果时，双席无将胜局立即显示真实都城、终榜及可点入口", () => {
  const engine = seedEngine(["魏", "蜀"]);
  const debtor = engine.activePlayer;
  dom.settings.device.prefersReducedMotion = "reduce";
  const controller = mount(engine);
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
});

it("减少动态效果时，作废面板保留独立的 1.8 秒出口", async () => {
  const engine = seedEngine(["魏", "蜀"]);
  dom.settings.device.prefersReducedMotion = "reduce";
  const controller = mount(engine);
  act(() => {
    engine.abortGame("接线测试");
    controller.resync();
  });
  expect(find(T.victoryAbortedTitle)?.textContent).toBe("对局作废");
  await clock.advance(1799);
  expect(find(T.victoryRestart) !== null).toBe(false);
  await clock.advance(1);
  expect(find<HTMLButtonElement>(T.victoryRestart)?.disabled).toBe(false);
  expect(find(T.victoryStandings) !== null).toBe(false);
});

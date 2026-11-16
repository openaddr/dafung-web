import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { GameEngine } from "@core/authority";
import { loadMap } from "@core/board-loader";
import type { MapData } from "@core/board-loader";
import { createDice } from "@core/dice";
import type { MapSource } from "@core/map-source";
import type { LogEvent } from "@core/model";
import type { GameDiagnosticCapture } from "@app/game-diagnostic-record";
import { archiveGameCapture, archiveGameLog } from "@app/gameLogArchive";
import { TESTIDS } from "@app/screens/game/testids";
import { SCROLL_TESTIDS } from "@app/screens/game/scroll/testids";
import { HOME_TID } from "@app/screens/home/testids";
import { GAME_DIAG_TID } from "@app/screens/shared/testids";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { UI } from "@app/fx/timings";
import pkg from "../../package.json";
import rawMap from "../../public/maps/guanzhong.json";
import maps from "../../public/maps/index.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const mapSource: MapSource = {
  async listMaps() {
    return maps;
  },
  async loadMapData() {
    return rawMap as MapData;
  },
};

const database = new IDBFactory();
let HomeScreen: typeof import("@app/screens/home/HomeScreen").HomeScreen;
let SettingsDialog: typeof import("@app/screens/game/SettingsDialog").SettingsDialog;
let DecisionScrollLayer: typeof import("@app/screens/game/scroll/DecisionScrollLayer").DecisionScrollLayer;
let setController: typeof import("@app/controllers/registry").setController;
let root: Root;
let container: HTMLDivElement;
let clock: ReturnType<typeof installControlledClock>;
let originalIndexedDb: PropertyDescriptor | undefined;

beforeAll(async () => {
  ensureHappyDom();
  // 跳过与诊断无关的图片、字体预热。
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: database });
  (globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
  ({ HomeScreen } = await import("@app/screens/home/HomeScreen"));
  ({ SettingsDialog } = await import("@app/screens/game/SettingsDialog"));
  ({ DecisionScrollLayer } = await import("@app/screens/game/scroll/DecisionScrollLayer"));
  ({ setController } = await import("@app/controllers/registry"));
  clock = installControlledClock();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterAll(async () => {
  act(() => root.unmount());
  setController(null);
  setEngine(null);
  container.remove();
  useGameStore.getState().reset();
  clock.restore();
  // 先让生产连接收到 versionchange 并清掉模块内的连接，再还原全局。
  for (const { name } of await database.databases()) {
    if (name === undefined) throw new Error("归档测试数据库缺少名称");
    await new Promise<void>((resolve, reject) => {
      const request = database.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("归档测试数据库仍在使用"));
    });
  }
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await releaseHappyDom();
});

function capture(version: string, capturedAt: number, startedAt: number): GameDiagnosticCapture {
  return {
    appVersion: version,
    capturedAt,
    device: { ua: "旧局设备", dpr: 2, viewport: { w: 844, h: 390 } },
    client: {
      phase: "Playing",
      setupPhase: "Done",
      turnPhase: "Roll",
      round: 1,
      turnNumber: 2,
      activeIndex: 0,
      decisionOwner: 0,
      pendingLand: null,
      lastLandOutcomeKind: null,
      lastLandOutcomeProperty: null,
      choices: [],
      capitalChoices: null,
      reaction: null,
      seat: 0,
      interactive: true,
      selfPresenting: false,
      pending: false,
      fxBusy: false,
      autopilotOn: false,
    },
    connection: null,
    errors: [],
    perf: {
      startedAt,
      stoppedAt: null,
      loafSupported: false,
      windows: [],
      jank: [],
      slowFrames: [],
    },
  };
}

function logLine(brief: string, ts: number): LogEvent {
  return { ts, brief, round: 1, turn: 1, player: null, category: "system", detail: "" };
}

function find<T extends HTMLElement = HTMLElement>(tid: string): T | null {
  return document.querySelector<T>(`[data-testid="${tid}"]`);
}

async function click(tid: string): Promise<void> {
  await act(async () => {
    const target = find(tid);
    if (target === null) throw new Error(`缺少对局诊断入口 ${tid}`);
    target.click();
  });
}

async function until(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30 && !ready(); attempt++) await clock.settle();
  expect(ready()).toBe(true);
}

function makeGame(): GameEngine {
  const map = loadMap(rawMap as MapData);
  return new GameEngine(map.board, map.catalog, createDice(1), {
    mapId: "guanzhong",
    seats: [
      { name: "魏", isBot: false },
      { name: "蜀", isBot: true },
    ],
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    startingTreasures: map.startingTreasures,
  });
}

function abortNextWrite() {
  const put = IDBObjectStore.prototype.put;
  return spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
    this: globalThis.IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = put.call(this, value, key);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
}

it("主页默认最近游玩、局中默认当前局，保存只含选中局的记录", async () => {
  const now = Date.now();
  const engine = makeGame();
  const earlier = { gameId: engine.gameId, mapId: "guanzhong", mode: "solo" } as const;
  const nextLog = [logLine("未保存的新日志", now)];
  const recent = { gameId: "recent-game", mapId: "zhongyuan", mode: "online" } as const;
  await archiveGameLog(earlier, [logLine("历史局专属记录", now - 500)], now - 450);
  await archiveGameCapture(earlier, capture("2026.10.12", now - 400, 12));
  await archiveGameLog(
    recent,
    [logLine("最近局开局", now - 200), logLine("最近局第二行", now - 190)],
    now - 150,
  );
  await archiveGameCapture(recent, capture("2026.11.10", now - 100, 90));

  let text: string | undefined;
  let fileName: string | undefined;
  const createObjectUrl = spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new Error("诊断下载须导出 JSON 文件");
    void blob.text().then((result) => {
      text = result;
    });
    return "blob:diagnostic";
  });
  const download = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    fileName = this.download;
  });
  const saveSelected = async (): Promise<string> => {
    text = undefined;
    await until(() => find<HTMLButtonElement>(GAME_DIAG_TID.save)?.disabled === false);
    await click(GAME_DIAG_TID.save);
    await until(() => text !== undefined);
    if (text === undefined) throw new Error("所选局未生成诊断文件");
    return text;
  };
  try {
    const noop = () => {};
    await act(async () =>
      root.render(
        <HomeScreen onSolo={noop} onOnline={noop} initialMapId="guanzhong" mapSource={mapSource} />,
      ),
    );
    await click(HOME_TID.diagExport);
    const recentText = await saveSelected();
    expect(fileName).toBe("dafung-diag-recent-game-v2026.11.10.json");
    expect(recentText).not.toContain("历史局专属记录");
    expect(JSON.parse(recentText)).toMatchObject({
      gameId: "recent-game",
      appVersion: "2026.11.10",
      capturedAt: now - 100,
      logSource: "room-authority",
      logCapturedAt: now - 150,
      log: [{ brief: "最近局开局" }, { brief: "最近局第二行" }],
      perf: { startedAt: 90 },
    });

    await click(GAME_DIAG_TID.game(earlier.gameId));
    const earlierText = await saveSelected();
    expect(earlierText).not.toContain("最近局");
    expect(JSON.parse(earlierText)).toMatchObject({
      gameId: earlier.gameId,
      appVersion: "2026.10.12",
      logSource: "local-authority",
      log: [{ brief: "历史局专属记录" }],
      perf: { startedAt: 12 },
    });

    const requested: string[] = [];
    let completeCapture!: () => void;
    const captureDone = new Promise<void>((resolve) => {
      completeCapture = resolve;
    });
    const put = abortNextWrite();
    try {
      await expect(archiveGameLog(earlier, nextLog, now)).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      put.mockRestore();
    }
    await act(async () => {
      useGameStore.getState().syncFromEngine(engine);
      root.render(
        <SettingsDialog
          onClose={noop}
          onOpenWarReport={noop}
          onGoHome={noop}
          onCaptureDiagnostic={(gameId) => {
            requested.push(gameId);
            return captureDone;
          }}
        />,
      );
    });
    await click(TESTIDS.settingsDiagnostic);
    expect(requested).toEqual([engine.gameId]);
    expect(find(TESTIDS.settingsDialog)).toBeNull();
    expect(find<HTMLButtonElement>(GAME_DIAG_TID.save)?.disabled).toBe(true);
    await act(async () => completeCapture());
    await until(
      () => find(GAME_DIAG_TID.dialog)?.textContent?.includes("对局归档事务已中止") === true,
    );
    expect(JSON.parse(await saveSelected())).toMatchObject({
      gameId: engine.gameId,
      logCapturedAt: now - 450,
      log: [{ brief: "历史局专属记录" }],
      archiveFailures: [{ kind: "log", message: "对局归档事务已中止" }],
    });
  } finally {
    download.mockRestore();
    createObjectUrl.mockRestore();
    await archiveGameLog(earlier, nextLog, now);
  }
});

it("首次写入失败在主页和局中可见，现场随后写成也要确认再战", async () => {
  const engine = makeGame();
  const identity = { gameId: engine.gameId, mode: "solo", mapId: "guanzhong" } as const;
  await archiveGameLog(
    { ...identity, gameId: "history-with-log" },
    [logLine("此前有记录的一局", Date.now())],
    Date.now(),
  );
  const put = abortNextWrite();
  try {
    await expect(archiveGameLog(identity, engine.log, Date.now())).rejects.toMatchObject({
      name: "AbortError",
    });
  } finally {
    put.mockRestore();
  }

  const noop = () => {};
  await act(async () =>
    root.render(
      <HomeScreen onSolo={noop} onOnline={noop} initialMapId="guanzhong" mapSource={mapSource} />,
    ),
  );
  await click(HOME_TID.diagExport);
  await until(
    () => find(GAME_DIAG_TID.dialog)?.textContent?.includes("对局归档事务已中止") === true,
  );
  expect(find<HTMLButtonElement>(GAME_DIAG_TID.save)?.disabled).toBe(false);

  await act(async () => {
    useGameStore.getState().syncFromEngine(engine);
    root.render(
      <SettingsDialog
        onClose={noop}
        onOpenWarReport={noop}
        onGoHome={noop}
        onCaptureDiagnostic={async () => {}}
      />,
    );
  });
  await click(TESTIDS.settingsDiagnostic);
  await until(
    () => find(GAME_DIAG_TID.dialog)?.textContent?.includes("对局归档事务已中止") === true,
  );
  expect(find<HTMLButtonElement>(GAME_DIAG_TID.save)?.disabled).toBe(true);

  engine.abortGame("对局诊断测试");
  const now = Date.now();
  await archiveGameCapture(identity, capture(pkg.version, now, 12));
  const { GameController } = await import("@app/controllers/controller");
  const controller = new (class extends GameController {
    protected readonly hotSeat = true;
    readonly viewSeat = 0;
    protected get mySeat() {
      return 0;
    }
    get engine() {
      return engine;
    }
    dispatchCommand(): void {
      throw new Error("终局不可发游戏命令");
    }
  })();
  setController(controller, rawMap as MapData);
  const reload = spyOn(location, "reload").mockImplementation(() => {});
  try {
    await act(async () =>
      root.render(
        <DecisionScrollLayer
          snapshot={engine.snapshot()}
          viewSeat={0}
          interactive={false}
          tileDetail={null}
        />,
      ),
    );
    await clock.advance(UI.victoryButtonMs);
    await click(SCROLL_TESTIDS.victoryRestart);
    await until(() => find(SCROLL_TESTIDS.confirmDialog) !== null);
    expect(find(SCROLL_TESTIDS.confirmDialog)?.textContent).toContain("对局归档事务已中止");
    expect(find(SCROLL_TESTIDS.victoryRestart)?.closest("[inert]") != null).toBe(true);
    expect(reload).toHaveBeenCalledTimes(0);
    await click(SCROLL_TESTIDS.confirmOk);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    reload.mockRestore();
    await archiveGameLog(identity, engine.log, Date.now());
  }
});

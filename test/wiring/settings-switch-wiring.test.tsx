import { afterAll, beforeAll, expect, it, spyOn } from "bun:test";
import { AudioProvider } from "@app/fx/AudioProvider";
import { setSnapPin } from "@app/fx/catchup";
import { resetFxOrchestration } from "@app/fx/orchestrator";
import { waitForGameArchive } from "@app/gameLogArchive";
import { createWorkerClock } from "@app/net/worker-clock";
import { TESTIDS } from "@app/screens/game/testids";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { useNetStore } from "@app/store/netStore";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot } from "react-dom/client";
import pkg from "../../package.json";
import rawMap from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

let roomClock: ReturnType<typeof createWorkerClock>;
let originalIndexedDb: PropertyDescriptor | undefined;

beforeAll(() => {
  roomClock = createWorkerClock();
  roomClock.pause();
  ensureHappyDom();
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  (globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
});

afterAll(async () => {
  roomClock.dispose();
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await releaseHappyDom();
});

function findSwitch(testid: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testid}"][role="switch"]`);
  if (element === null) throw new Error(`设置弹层缺少开关 ${testid}`);
  return element;
}

function findSwitchLabel(element: HTMLElement): HTMLLabelElement {
  const labelId = element.getAttribute("aria-labelledby");
  if (labelId === null) throw new Error(`设置弹层开关没有关联标签 ${element.dataset.testid}`);
  const label = document.getElementById(labelId);
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`设置弹层缺少整行标签 ${labelId}`);
  }
  return label;
}

it("音效和托管整行独立切换，单机在同一个设置弹层收回操作", async () => {
  const { LocalController } = await import("@app/controllers/local");
  const { setController } = await import("@app/controllers/registry");
  const { SettingsDialog } = await import("@app/screens/game/SettingsDialog");
  const clock = installControlledClock();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  setSnapPin(true);
  try {
    const data = rawMap as MapData;
    const controller = new LocalController(
      loadMap(data),
      {
        seats: [
          { name: "诸侯1", isBot: false, guohao: "魏" },
          { name: "诸侯2", isBot: true },
          { name: "诸侯3", isBot: true },
        ],
        seed: 1,
        mapId: "guanzhong",
        botStepMs: 0,
      },
      roomClock,
    );
    setController(controller, data);
    controller.dispatchCommand({
      type: "pickCapital",
      tileIndex: controller.engine.offeredCapitals[0],
    });
    await clock.settle();
    expect(controller.interactive).toBe(true);
    using setAutoPilot = spyOn(controller, "setAutoPilot");

    const noop = () => {};
    await act(async () => {
      root.render(
        <AudioProvider>
          <SettingsDialog onClose={noop} onOpenWarReport={noop} onGoHome={noop} />
        </AudioProvider>,
      );
    });
    const sfx = findSwitch(TESTIDS.settingsSfx);
    const autopilot = findSwitch(TESTIDS.settingsAutopilot);
    expect(sfx.getAttribute("aria-checked")).toBe("true");
    expect(autopilot.getAttribute("aria-checked")).toBe("false");

    act(() => findSwitchLabel(sfx).click());
    expect(sfx.getAttribute("aria-checked")).toBe("false");
    expect(autopilot.getAttribute("aria-checked")).toBe("false");

    act(() => findSwitchLabel(autopilot).click());
    await clock.settle();
    expect(setAutoPilot.mock.calls).toEqual([[true]]);
    expect(controller.autoPilotOn).toBe(true);
    expect(autopilot.getAttribute("aria-checked")).toBe("true");
    expect(controller.interactive).toBe(false);

    act(() => autopilot.click());
    await clock.settle();
    expect(setAutoPilot.mock.calls).toEqual([[true], [false]]);
    expect(controller.autoPilotOn).toBe(false);
    expect(autopilot.getAttribute("aria-checked")).toBe("false");
    expect(controller.interactive).toBe(true);
    expect(sfx.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    const gameId = useGameStore.getState().snapshot?.gameId;
    setController(null);
    setEngine(null);
    useGameStore.getState().reset();
    useNetStore.getState().reset();
    resetFxOrchestration();
    setSnapPin(false);
    clock.restore();
    if (gameId !== undefined) await waitForGameArchive(gameId);
  }
});

import { afterAll, afterEach, beforeAll, beforeEach, expect, it, mock, spyOn } from "bun:test";
import * as tauriApp from "@tauri-apps/api/app";
import * as tauriCore from "@tauri-apps/api/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setAudio } from "@app/fx/audio";
import type { MapData } from "@dafung/core/engine/board-loader";
import type { MapSource } from "@dafung/core/engine/map-source";
import type { SetupConfig } from "@app/screens/setup/SoloSetupScreen";
import { TID } from "@app/screens/setup/testids";
import guanzhong from "../../packages/core/maps/guanzhong.json";
import maps from "../../packages/core/maps/index.json";
import zhongyuan from "../../packages/core/maps/zhongyuan.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import { recordAudio } from "./record-audio";

let setup: typeof import("@app/screens/setup/SoloSetupScreen");
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const mapSource: MapSource = {
  listMaps: async () => maps,
  loadMapData: async () => {
    throw new Error("仅准备对局，无需加载棋盘");
  },
};

beforeAll(async () => {
  ensureHappyDom();
  setup = await import("@app/screens/setup/SoloSetupScreen");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.removeItem(setup.GUOHAO_PREF_KEY);
  setAudio(null);
});

afterAll(async () => {
  await releaseHappyDom();
});

function find(tid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${tid}"]`);
}

async function click(tid: string): Promise<void> {
  const target = find(tid);
  if (target === null) throw new Error(`缺少单机准备页入口 ${tid}`);
  await act(async () => target.click());
}

function guohaoInput(): HTMLInputElement {
  const input = find(TID.seatGuohaoInput(0));
  if (!(input instanceof HTMLInputElement)) throw new Error("缺少国号输入框");
  return input;
}

async function typeGuohao(value: string): Promise<void> {
  await act(async () => {
    const input = guohaoInput();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("选图变更响一次纸扣，预选、重复点选与取消保持安静", async () => {
  const sounds = recordAudio();
  const previews = new Map<string, MapData>([
    ["guanzhong", guanzhong as MapData],
    ["zhongyuan", zhongyuan as MapData],
  ]);
  const onMapChange = mock((_mapId: string) => {});
  await act(async () =>
    root.render(
      <setup.SoloSetupScreen
        mapId="guanzhong"
        mapSource={{
          listMaps: mapSource.listMaps,
          loadMapData: async (id) => {
            const preview = previews.get(id);
            if (preview === undefined) throw new Error(`缺少地图测试数据 ${id}`);
            return preview;
          },
        }}
        onStart={async () => true}
        onBack={() => {}}
        onMapChange={onMapChange}
      />,
    ),
  );

  await click(TID.selectMap);
  await click(TID.mapItem("guanzhong"));
  expect(sounds).toEqual([]);
  await click(TID.mapItem("zhongyuan"));
  expect(find(TID.mapItem("zhongyuan"))?.getAttribute("aria-pressed")).toBe("true");
  expect(sounds).toEqual(["jinnangSelect"]);
  await click(TID.mapItem("zhongyuan"));
  await click(TID.mapCancel);
  expect(sounds).toEqual(["jinnangSelect"]);
  expect(onMapChange).not.toHaveBeenCalled();
});

it("关闭字盘保留手写国号，快选回填并在起兵成功后记为预设", async () => {
  const sounds = recordAudio();
  const { SoloSetupScreen, GUOHAO_PREF_KEY } = setup;
  const onStart = mock(async (_config: SetupConfig) => true).mockResolvedValueOnce(false);
  const render = () => (
    <SoloSetupScreen mapId="guanzhong" mapSource={mapSource} onStart={onStart} onBack={() => {}} />
  );
  localStorage.setItem(GUOHAO_PREF_KEY, "楚");
  await act(async () => root.render(render()));
  expect(find(TID.guohaoPool) === null, "字盘默认收起").toBe(true);

  await typeGuohao("x");
  expect(find(TID.guohaoError) !== null).toBe(true);
  expect(find(TID.startGame)?.hasAttribute("disabled")).toBe(true);
  await typeGuohao("燕");
  await click(TID.guohaoTrigger);
  expect(find(TID.guohaoChar("燕"))?.getAttribute("aria-pressed")).toBe("true");
  await click(TID.guohaoClose);
  expect(find(TID.guohaoPool) === null).toBe(true);
  expect(guohaoInput().value).toBe("燕");
  await click(TID.guohaoTrigger);
  await click(TID.guohaoChar("燕"));
  expect(sounds).toEqual([]);

  await click(TID.guohaoTrigger);
  await click(TID.guohaoChar("巴"));
  expect(find(TID.guohaoPool) === null).toBe(true);
  expect(guohaoInput().value).toBe("巴");
  expect(find(TID.seatRow(0))?.textContent).toContain("巴");
  expect(sounds).toEqual(["jinnangSelect"]);

  await click(`${TID.seatCount}-minus`);
  await click(`${TID.target}-60000`);
  await click(`${TID.target}-60000`);
  expect(sounds).toEqual(["jinnangSelect", "jinnangSelect"]);
  await click(TID.startGame);
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onStart).toHaveBeenCalledWith({
    seats: [
      { name: "诸侯1", isBot: false, guohao: "巴" },
      { name: "诸侯2", isBot: true },
      { name: "诸侯3", isBot: true },
    ],
    targetNetWorth: 60000,
    mapId: "guanzhong",
  });
  expect(localStorage.getItem(GUOHAO_PREF_KEY)).toBe("楚");
  expect(find(TID.startGame)?.hasAttribute("disabled")).toBe(false);

  await click(TID.startGame);
  expect(onStart).toHaveBeenCalledTimes(2);

  await act(async () => root.render(null));
  await act(async () => root.render(render()));
  expect(guohaoInput().value).toBe("巴");
});

it("安卓返回收起字盘并保留国号，关闭后清理已注册和在途监听", async () => {
  const { SoloSetupScreen } = setup;
  const isTauri = spyOn(tauriCore, "isTauri").mockReturnValue(true);
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 15)",
  });
  const listener = new tauriCore.PluginListener("app", "back-button", 0);
  const unregister = spyOn(listener, "unregister").mockResolvedValue(undefined);
  const lateListener = new tauriCore.PluginListener("app", "back-button", 1);
  const unregisterLate = spyOn(lateListener, "unregister").mockResolvedValue(undefined);
  const late = Promise.withResolvers<tauriCore.PluginListener>();
  const register = spyOn(tauriApp, "onBackButtonPress")
    .mockResolvedValueOnce(listener)
    .mockReturnValueOnce(late.promise);

  try {
    await act(async () =>
      root.render(
        <SoloSetupScreen
          mapId="guanzhong"
          mapSource={mapSource}
          onStart={async () => true}
          onBack={() => {}}
        />,
      ),
    );
    expect(register).toHaveBeenCalledTimes(0);
    await typeGuohao("燕");
    guohaoInput().focus();
    await click(TID.guohaoTrigger);
    expect(register).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(guohaoInput());

    const pressBack = register.mock.calls[0][0];
    await act(async () => pressBack({ canGoBack: false }));
    expect(find(TID.guohaoPool)).toBeNull();
    expect(document.activeElement).toBe(find(TID.guohaoTrigger));
    expect(guohaoInput().value).toBe("燕");
    expect(unregister).toHaveBeenCalledTimes(1);

    await click(TID.guohaoTrigger);
    expect(register).toHaveBeenCalledTimes(2);
    await act(async () => pressBack({ canGoBack: false }));
    expect(find(TID.guohaoPool)).not.toBeNull();
    await act(async () => root.render(null));
    await act(async () => late.resolve(lateListener));
    expect(unregisterLate).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.deleteProperty(navigator, "userAgent");
    register.mockRestore();
    isTauri.mockRestore();
  }
});

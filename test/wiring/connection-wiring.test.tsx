// 恢复接线(ADR-0065):真实横幅、store 与 OnlineController 的公共恢复行为。
// socket/fetch 仅在系统边界布场;验证恢复、防重及摘要校准撤条,不等退避墙钟。
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { waitForGameArchive } from "@app/gameLogArchive";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import type { WebSocketLike } from "@app/net/reconnecting-socket";
import { TESTIDS } from "@app/screens/game/testids";
import { LID } from "@app/screens/lobby/testids";
import { TID } from "@app/screens/setup/testids";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import zhongyuanData from "../../packages/core/maps/zhongyuan.json";
import maps from "../../packages/core/maps/index.json";
import { redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { encodeDownlink, type ServerMsg } from "@dafung/core/protocol/wire";

// JSON 导入使 tier 字面量拓宽;沿接线模板在地图数据边界收窄。
const DATA = guanzhongData as MapData;

type BannerModule = typeof import("@app/screens/shared/ConnectionBanner");
type OnlineModule = typeof import("@app/controllers/online");
type RegistryModule = typeof import("@app/controllers/registry");
let ConnectionBanner: BannerModule["ConnectionBanner"];
let LobbyScreen: (typeof import("@app/screens/lobby/LobbyScreen"))["LobbyScreen"];
let OnlineController: OnlineModule["OnlineController"];
let setController: RegistryModule["setController"];
let getController: RegistryModule["getController"];
let returnHome: (typeof import("@app/screens/shared/return-home"))["returnHome"];
let controller: import("@app/controllers/online").OnlineController;
let root: Root | null = null;
let container: HTMLDivElement;
let sockets: BoundarySocket[];
let originalFetch: typeof fetch;

class BoundarySocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(): void {
    throw new Error("恢复接线例不应发送局内命令");
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen!();
  }
  disconnect(): void {
    this.readyState = 3;
    this.onclose!();
  }
  lobby(fields: NetRoomFields = ROOM): void {
    this.receive({ type: "lobby", seatCount: fields.seats.length, ...fields });
  }
  receive(message: ServerMsg): void {
    this.onmessage!({ data: encodeDownlink(message) });
  }
}

const ROOM = {
  roomId: "RETRY",
  host: 0,
  mapId: "guanzhong",
  started: false,
  seats: [0, 1].map((seat) => ({
    seat,
    kind: "human",
    taken: true,
    online: true,
    autoPilot: false,
    guohao: null,
  })),
} satisfies NetRoomFields;

beforeAll(async () => {
  ensureHappyDom();
  // Base UI 必须在 DOM 注册后求值。
  ({ ConnectionBanner } = await import("@app/screens/shared/ConnectionBanner"));
  ({ LobbyScreen } = await import("@app/screens/lobby/LobbyScreen"));
  ({ OnlineController } = await import("@app/controllers/online"));
  ({ setController, getController } = await import("@app/controllers/registry"));
  ({ returnHome } = await import("@app/screens/shared/return-home"));
});

beforeEach(() => {
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
  localStorage.setItem("dafung.server-base", "http://connection.test");
  originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => Response.json({ ok: true, seat: 1, seatToken: "same-seat", ...ROOM }),
    { preconnect: originalFetch.preconnect },
  );
  sockets = [];
  controller = new OnlineController(loadMap(DATA), "guanzhong", {
    maxAttempts: 0,
    socketFactory: () => {
      const socket = new BoundarySocket();
      sockets.push(socket);
      return socket;
    },
  });
  setController(controller, DATA);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  if (root !== null) act(() => root!.unmount());
  root = null;
  container.remove();
  setController(null);
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  useFxStore.getState().resetFx();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await releaseHappyDom();
});

it("耗尽后恢复入口与校准忙碌", async () => {
  await controller.joinRoom(ROOM.roomId);
  sockets[0]!.open();
  sockets[0]!.lobby();
  expect(controller.sessionReady).toBe(true);
  sockets[0]!.disconnect();
  expect(useNetStore.getState().connection).toBe("gaveUp");
  act(() => {
    root = createRoot(container);
    root.render(<ConnectionBanner onReconnect={() => controller.reconnect()} onExit={() => {}} />);
  });
  const banner = () => container.querySelector(`[data-testid="${TESTIDS.connectionBanner}"]`);
  const retry = banner()!.querySelector("button");
  // 从横幅公开交互入口验证恢复行为。
  expect(retry).not.toBeNull();
  expect(retry!.textContent).toBe("重新连接");
  act(() => retry!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(sockets).toHaveLength(2);
  expect(useNetStore.getState().connection).toBe("connecting");
  expect(retry!.disabled).toBe(true);
  act(() => retry!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(sockets).toHaveLength(2);
  act(() => sockets[1]!.open());
  expect(useNetStore.getState().connection).toBe("calibrating");
  expect(controller.sessionReady).toBe(false);
  expect(banner()!.textContent).toContain("校准");
  expect(retry!.disabled).toBe(true);
  act(() => sockets[1]!.lobby());
  expect(controller.sessionReady).toBe(true);
  expect(banner()).toBeNull();
});

it("恢复失败可重试与返回首页", async () => {
  await controller.joinRoom(ROOM.roomId);
  sockets[0]!.open();
  sockets[0]!.lobby();
  sockets[0]!.disconnect();
  useGameStore.getState().setScreen("game");
  act(() => {
    root = createRoot(container);
    root.render(
      <ConnectionBanner onReconnect={() => controller.reconnect()} onExit={returnHome} />,
    );
  });
  const retry = () =>
    container.querySelector<HTMLButtonElement>(`[data-testid="${TESTIDS.connectionRetry}"]`)!;
  const clickRetry = () =>
    act(() => retry().dispatchEvent(new MouseEvent("click", { bubbles: true })));
  clickRetry();
  act(() => {
    sockets[1]!.open();
    sockets[1]!.onmessage!({ data: JSON.stringify({ type: "error", error: "原座恢复被拒绝" }) });
  });
  expect(useNetStore.getState().connection).toBe("failed");
  expect(container.textContent).toContain("原座恢复被拒绝");
  expect(sockets[1]!.readyState).toBe(3);
  act(() => useGameStore.getState().pushHint(null));
  expect(container.textContent).toContain("原座恢复被拒绝");
  expect(retry().disabled).toBe(false);
  clickRetry();
  act(() => sockets[2]!.disconnect());
  expect(container.textContent).toContain("自动重连已耗尽");
  expect(retry().disabled).toBe(false);
  clickRetry();
  expect(sockets).toHaveLength(4);
  const lateOpen = sockets[3]!.onopen!;
  const lateMessage = sockets[3]!.onmessage!;
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${TESTIDS.connectionExit}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(getController()).toBeNull();
  expect(useGameStore.getState().screen).toBe("setup");
  expect(useNetStore.getState().roomId).toBe("");
  expect(useNetStore.getState().connection).toBe("idle");
  expect(useNetStore.getState().pending).toBe(false);
  act(() => {
    lateOpen();
    lateMessage({ data: JSON.stringify({ type: "lobby", ...ROOM }) });
    controller.reconnect();
  });
  expect(getController()).toBeNull();
  expect(useGameStore.getState().screen).toBe("setup");
  expect(useNetStore.getState().roomId).toBe("");
  expect(sockets).toHaveLength(4);
});

async function mountLobby(
  respond: (path: string, body: unknown) => Response | Promise<Response>,
): Promise<void> {
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url), "http://connection.test").pathname;
      switch (path) {
        case "/health":
          return Response.json({ ok: true });
        case "/maps/index.json":
          return Response.json(maps);
        case "/maps/guanzhong.json":
          return Response.json(guanzhongData);
        case "/maps/zhongyuan.json":
          return Response.json(zhongyuanData);
        default:
          return respond(path, JSON.parse(String(init?.body)));
      }
    },
    { preconnect: originalFetch.preconnect },
  );
  await act(async () => {
    useGameStore.getState().setScreen("lobby");
    root = createRoot(container);
    root.render(<LobbyScreen onExit={returnHome} />);
  });
}

function control<T extends HTMLElement = HTMLButtonElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (element === null) throw new Error(`缺少联机大厅控件 ${id}`);
  return element;
}

async function click(id: string): Promise<void> {
  await act(async () => control(id).click());
}

it("联机大厅使用地图默认值，开局接受后等待权威首份棋局切屏", async () => {
  const createRequests: unknown[] = [];
  const startRequests: unknown[] = [];
  const response = Promise.withResolvers<Response>();
  await mountLobby((path, body) => {
    switch (path) {
      case "/room/new":
        createRequests.push(body);
        return Response.json({ ...ROOM, ok: true, seat: 0, seatToken: "host-seat", mapId: null });
      case "/room/start":
        startRequests.push(body);
        return response.promise;
      default:
        throw new Error(`未布置的大厅请求 ${path}`);
    }
  });

  await click(LID.create);
  expect(createRequests).toEqual([{ seats: 2 }]);
  expect(container.textContent).toContain("目标身价按地图默认");
  await act(async () => {
    sockets[0]!.open();
    sockets[0]!.lobby();
  });
  expect(container.textContent).toContain(`地图默认 ${DATA.targetNetWorth} 两`);

  await click(LID.start);
  expect(startRequests).toEqual([{ roomId: ROOM.roomId, seatToken: "host-seat" }]);
  expect(container.textContent).toContain("正在开局…");
  await act(async () => response.resolve(Response.json({ ok: true })));
  expect(container.textContent).toContain("正在同步棋局…");
  expect(control(LID.start).disabled).toBe(true);
  expect(control(LID.roomCode).disabled).toBe(true);
  expect(control(LID.leave).disabled).toBe(true);
  expect(control(LID.roomCode).textContent).toBe(ROOM.roomId);
  expect(useGameStore.getState().screen).toBe("lobby");

  act(() => sockets[0]!.disconnect());
  expect(container.textContent).toContain("自动重连已耗尽");
  expect(container.textContent).not.toContain("正在同步棋局…");

  await click(TESTIDS.connectionRetry);
  act(() => {
    sockets[1]!.open();
    sockets[1]!.lobby({ ...ROOM, started: true });
  });
  expect(useGameStore.getState().screen).toBe("lobby");

  const map = loadMap(DATA);
  const authority = new GameEngine(map.board, map.catalog, createDice(2), {
    seats: [
      { name: "甲", isBot: false },
      { name: "乙", isBot: false },
    ],
    seed: 2,
    mapId: ROOM.mapId,
    targetNetWorth: map.targetNetWorth,
    startingCash: map.startingCash,
    startingTreasures: map.startingTreasures,
  });
  authority.doDraftRoll();

  const indexedDb = new IDBFactory();
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
  try {
    await act(async () => {
      sockets[1]!.receive({
        type: "snapshot",
        ...ROOM,
        ...redactSnapshotForSeat(authority.snapshot(), 0),
        started: true,
      });
    });
    expect(useGameStore.getState().screen).toBe("game");
  } finally {
    await waitForGameArchive(authority.gameId);
    if (previousIndexedDb) Object.defineProperty(globalThis, "indexedDB", previousIndexedDb);
    else Reflect.deleteProperty(globalThis, "indexedDB");
    const databases = await indexedDb.databases();
    await Promise.all(
      databases.map(({ name }) => {
        if (name === undefined) throw new Error("测试归档库无名称");
        return new Promise<void>((resolve, reject) => {
          const remove = indexedDb.deleteDatabase(name);
          remove.onsuccess = () => resolve();
          remove.onerror = () => reject(remove.error);
        });
      }),
    );
  }
});

it("自定义目标随建房请求提交，换图期间可复制且目标由房主保留", async () => {
  const createRequests: unknown[] = [];
  const mapRequests: unknown[] = [];
  const mapReply = Promise.withResolvers<Response>();
  const waitingRoom = { ...ROOM, mapId: null };
  await mountLobby((path, body) => {
    switch (path) {
      case "/room/new":
        createRequests.push(body);
        return Response.json({ ...waitingRoom, ok: true, seat: 0, seatToken: "host-seat" });
      case "/room/map":
        mapRequests.push(body);
        return mapRequests.length === 1 ? Response.json({ ok: true }) : mapReply.promise;
      default:
        throw new Error(`未布置的大厅请求 ${path}`);
    }
  });

  await click(LID.targetCustom);
  await act(async () => {
    const target = control<HTMLInputElement>(LID.target);
    target.value = "25000";
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(LID.create);
  expect(createRequests).toEqual([{ seats: 2, target: 25000 }]);
  await act(async () => {
    sockets[0]!.open();
    sockets[0]!.lobby(waitingRoom);
  });
  expect(container.textContent).toContain("自定义目标 25000 两");

  await click(LID.selectMap);
  await click(TID.mapItem("guanzhong"));
  await click(TID.mapConfirm);
  await act(async () => sockets[0]!.lobby());
  expect(control(LID.mapName).textContent).toBe("关中图");

  await click(LID.selectMap);
  await click(TID.mapItem("zhongyuan"));
  await click(TID.mapConfirm);
  expect(mapRequests).toEqual([
    { roomId: ROOM.roomId, seatToken: "host-seat", mapId: "guanzhong" },
    { roomId: ROOM.roomId, seatToken: "host-seat", mapId: "zhongyuan" },
  ]);
  await click(LID.roomCode);
  expect(await navigator.clipboard.readText()).toBe(ROOM.roomId);

  await act(async () => {
    sockets[0]!.lobby({ ...ROOM, mapId: "zhongyuan" });
    mapReply.resolve(Response.json({ ok: true }));
  });
  expect(control(LID.mapName).textContent).toBe("中原争霸");
  expect(container.textContent).toContain("自定义目标 25000 两");
});

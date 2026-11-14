// #1421 / ADR-0062 层④:真横幅+真 store+真 OnlineController 公共恢复行为。
// socket/fetch 是系统边界,只在边界布场;不测假 DOM 几何、不泵演出、不等退避墙钟。
// 实测 98ms(2026-11-14):按钮缺席先红,点击恢复/忙碌防重/打开仍校准/摘要撤条再绿。
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { loadMap, type MapData } from "@core/board-loader";
import { useGameStore } from "@app/store/gameStore";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import { useFxStore } from "@app/fx/fxStore";
import type { WebSocketLike } from "@app/net/reconnecting-socket";
import { TESTIDS } from "@app/screens/game/testids";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";
import guanzhongData from "../../public/maps/guanzhong.json";

// JSON 导入使 tier 字面量拓宽;沿接线模板在地图数据边界收窄。
const DATA = guanzhongData as MapData;

type BannerModule = typeof import("@app/screens/shared/ConnectionBanner");
type OnlineModule = typeof import("@app/controllers/online");
type RegistryModule = typeof import("@app/controllers/registry");
let ConnectionBanner: BannerModule["ConnectionBanner"];
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
  lobby(): void {
    this.onmessage!({ data: JSON.stringify({ type: "lobby", ...ROOM }) });
  }
}

const ROOM: NetRoomFields = {
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
};

beforeAll(async () => {
  ensureHappyDom();
  // Base UI 必须在 DOM 注册后求值。
  ({ ConnectionBanner } = await import("@app/screens/shared/ConnectionBanner"));
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
  // 旧横幅只有“请刷新页面”,此处行为红不依赖新方法/新选择器缺席。
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

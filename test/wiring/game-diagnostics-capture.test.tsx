import { afterAll, afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { loadArchivedGame } from "@app/gameLogArchive";
import type { WebSocketLike } from "@app/net/reconnecting-socket";
import { TESTIDS } from "@app/screens/game/testids";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armPhase, giveJinnang } from "@dafung/core/engine/planter";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { assembleGameLogDelta, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { encodeDownlink, type ReactionTiming, type ServerMsg } from "@dafung/core/protocol/wire";
import pkg from "../../package.json";
import rawGuanzhongData from "../../packages/core/maps/guanzhong.json";
import { ensureHappyDom, releaseHappyDom } from "./happy-dom-register";

const DATA = rawGuanzhongData as MapData;
const MAP = loadMap(DATA);
const ROOM = {
  roomId: "DIAG",
  seatCount: 2,
  host: 0,
  mapId: "guanzhong",
  started: true,
  seats: [0, 1].map((seat) => ({
    seat,
    kind: "human" as const,
    taken: true,
    online: true,
    autoPilot: false,
    guohao: null,
  })),
};
const indexedDb = new IDBFactory();
let originalIndexedDb: PropertyDescriptor | undefined;
let OnlineController: (typeof import("@app/controllers/online"))["OnlineController"];
let setController: (typeof import("@app/controllers/registry"))["setController"];
let returnHome: (typeof import("@app/screens/shared/return-home"))["returnHome"];
let GameScreen: (typeof import("@app/screens/game/GameScreen"))["GameScreen"];
let originalFetch: typeof fetch;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

class BoundarySocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  send(): void {}

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

  receive(message: ServerMsg): void {
    this.onmessage!({ data: encodeDownlink(message) });
  }
}

beforeAll(async () => {
  ensureHappyDom();
  Object.defineProperty(SVGSVGElement.prototype, "clientWidth", {
    get: () => 844,
    configurable: true,
  });
  Object.defineProperty(SVGSVGElement.prototype, "clientHeight", {
    get: () => 390,
    configurable: true,
  });
  (globalThis as Record<string, unknown>).__APP_VERSION__ = pkg.version;
  originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDb });
  originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => Response.json({ ...ROOM, ok: true, seat: 1, seatToken: "seat-only-secret" }),
    { preconnect: originalFetch.preconnect },
  );
  localStorage.setItem("dafung.server-base", "http://diagnostics.test");
  ({ OnlineController } = await import("@app/controllers/online"));
  ({ setController } = await import("@app/controllers/registry"));
  ({ returnHome } = await import("@app/screens/shared/return-home"));
  ({ GameScreen } = await import("@app/screens/game/GameScreen"));
});

afterEach(() => {
  act(() => {
    returnHome();
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  setEngine(null);
  useGameStore.getState().reset();
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
  localStorage.removeItem("dafung.server-base");
  globalThis.fetch = originalFetch;
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
  await Bun.sleep(0);
  await releaseHappyDom();
});

function startAuthority(): GameEngine {
  const engine = new GameEngine(MAP.board, MAP.catalog, createDice(2), {
    seats: [
      { name: "甲", isBot: false },
      { name: "乙", isBot: false },
    ],
    seed: 2,
    mapId: ROOM.mapId,
    targetNetWorth: MAP.targetNetWorth,
    startingCash: MAP.startingCash,
    startingTreasures: MAP.startingTreasures,
  });
  engine.doDraftRoll();
  return engine;
}

function snapshotOf(
  engine: GameEngine,
  reactionTiming?: ReactionTiming,
): Extract<ServerMsg, { type: "snapshot" }> {
  return {
    type: "snapshot",
    ...ROOM,
    ...redactSnapshotForSeat(engine.snapshot(), 1),
    reactionTiming,
  };
}

async function join() {
  const sockets: BoundarySocket[] = [];
  const controller = new OnlineController(MAP, ROOM.mapId, {
    maxAttempts: 0,
    socketFactory: () => {
      const socket = new BoundarySocket();
      sockets.push(socket);
      return socket;
    },
  });
  setController(controller, DATA);
  await controller.joinRoom(ROOM.roomId);
  sockets[0]!.open();
  return { controller, sockets };
}

it("联机日志截止使用收包时钟，尾段和校准锚持续推进可信前缀", async () => {
  const authority = startAuthority();
  const { controller, sockets } = await join();
  const socket = sockets[0]!;
  const opening = snapshotOf(authority);
  const receivedAt = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(receivedAt);
  try {
    socket.receive(opening);
    expect((await loadArchivedGame(authority.gameId))?.log?.capturedAt).toBe(receivedAt);
    const pick = authority.pickCapital(
      authority.currentSetupPlayerIndex,
      authority.offeredCapitals[0],
    );
    expect(pick).toMatchObject({ ok: true });
    const tail = assembleGameLogDelta(authority, opening.log.length, receivedAt - 500)!;
    clock.mockReturnValue(receivedAt + 10);
    socket.receive(tail);
    clock.mockReturnValue(receivedAt + 20);
    socket.receive(tail);
    expect(useGameStore.getState().snapshot?.log).toEqual(opening.log);
    authority.logRoomEvent("离线记录", '{"type":"offline","seat":0}');
    authority.logRoomEvent("原座恢复记录", '{"type":"online","seat":0}');
    const end = tail.offset + tail.lines.length;
    socket.receive(assembleGameLogDelta(authority, end + 1, Date.now())!);
    socket.receive(assembleGameLogDelta(authority, end, Date.now())!);
    const beforeRejoin = await loadArchivedGame(authority.gameId);
    expect(beforeRejoin?.log?.lines).toHaveLength(end);
    expect(beforeRejoin?.log?.capturedAt).toBe(receivedAt + 10);

    socket.disconnect();
    controller.reconnect();
    const rejoined = sockets[1]!;
    rejoined.open();
    clock.mockReturnValue(receivedAt + 30);
    rejoined.receive(snapshotOf(authority));
    authority.logRoomEvent("托管记录", '{"type":"autopilot","seat":0,"on":true}');
    const afterRejoin = assembleGameLogDelta(authority, authority.log.length - 1, receivedAt - 50)!;
    clock.mockReturnValue(receivedAt + 40);
    rejoined.receive(afterRejoin);
    returnHome();

    const game = await loadArchivedGame(authority.gameId);
    const complete = JSON.parse(encodeDownlink(snapshotOf(authority))) as typeof opening;
    expect(game).toMatchObject({
      mode: "online",
      mapId: ROOM.mapId,
      log: { capturedAt: receivedAt + 40, lines: complete.log },
    });
  } finally {
    clock.mockRestore();
  }
});

function GameRoute() {
  return useGameStore((state) => state.screen) === "game" ? <GameScreen /> : null;
}

function mountGame(): void {
  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <StrictMode>
        <GameRoute />
      </StrictMode>,
    );
  });
}

it("选都与反应窗的现场记录本座可执行选项", async () => {
  const { checkpointGameDiagnostics } = await import("@app/game-diagnostics");
  const authority = startAuthority();
  if (authority.currentSetupPlayerIndex !== 1) {
    expect(authority.pickCapital(0, authority.offeredCapitals[0]).ok).toBe(true);
  }
  const { sockets } = await join();
  const socket = sockets[0]!;
  socket.receive(snapshotOf(authority));
  mountGame();
  await checkpointGameDiagnostics(authority.gameId);
  expect((await loadArchivedGame(authority.gameId))?.capture?.client).toMatchObject({
    setupPhase: "PickCapital",
    activeIndex: 0,
    decisionOwner: 1,
    seat: 1,
    capitalChoices: authority.offeredCapitals,
  });

  while (authority.phase === "Setup") {
    expect(
      authority.pickCapital(authority.currentSetupPlayerIndex, authority.offeredCapitals[0]).ok,
    ).toBe(true);
  }
  giveJinnang(authority, 0, ["横征暴敛", "半路杀出"]);
  giveJinnang(authority, 1, ["识破诡计", "连环计"]);
  armPhase(authority, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
  authority.submitCommand({ type: "useJinnang", cardId: "横征暴敛" });
  const pending = authority.pendingReaction;
  if (pending == null) throw new Error("布场缺少挂起的反应窗");
  act(() => {
    socket.receive(snapshotOf(authority, { seq: pending.seq, remainingMs: pending.view.windowMs }));
  });
  const decline = document.querySelector(`[data-testid="${TESTIDS.reactionDecline}"]`);
  expect(decline !== null).toBe(true);
  await checkpointGameDiagnostics(authority.gameId);
  const client = (await loadArchivedGame(authority.gameId))?.capture?.client;
  expect(client).toMatchObject({
    turnPhase: "AwaitingReaction",
    seat: 1,
    capitalChoices: null,
    reaction: {
      kind: "jinnang",
      asked: true,
      answered: false,
      muted: false,
      playable: ["识破诡计"],
      canDecline: true,
    },
  });
  expect(JSON.stringify(client)).not.toContain("半路杀出");
  expect(JSON.stringify(client)).not.toContain("连环计");

  const mute = document.querySelector<HTMLElement>(`[data-testid="${TESTIDS.reactionMute}"]`);
  if (mute === null) throw new Error("缺少反应窗静默入口");
  act(() => mute.click());
  await checkpointGameDiagnostics(authority.gameId);
  expect((await loadArchivedGame(authority.gameId))?.capture?.client).toMatchObject({
    pending: true,
    reaction: { asked: true, muted: true, playable: [], canDecline: false },
  });
});

it("保存离场前的同局交互、报错和帧诊，另起一局各自可取", async () => {
  const authority = startAuthority();
  while (authority.phase === "Setup") {
    const pick = authority.pickCapital(
      authority.currentSetupPlayerIndex,
      authority.offeredCapitals[0],
    );
    if (!pick.ok) throw new Error("布场选都被拒");
  }
  giveJinnang(authority, 0, ["火烧连营"]);
  giveJinnang(authority, 1, ["横征暴敛"]);
  armPhase(authority, { turnPhase: "AwaitingJinnang", activeIndex: 1 });
  const { controller, sockets } = await join();
  sockets[0]!.receive(snapshotOf(authority));
  mountGame();
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  try {
    document.dispatchEvent(new Event("visibilitychange"));
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
  const background = await loadArchivedGame(authority.gameId);
  expect(background?.capture?.client.interactive).toBe(true);
  expect(background?.capture?.perf?.stoppedAt).toBeNull();

  act(() => {
    controller.dispatchCommand({ type: "useJinnang", cardId: null });
    useGameStore.getState().pushHint("出牌等待回包");
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "连接异常 wss://diagnostics.test/ws?token=seat-only-secret (seat-only-secret)",
      }),
    );
    returnHome();
  });

  const first = await loadArchivedGame(authority.gameId);
  const firstText = JSON.stringify(first?.capture);
  const firstStoppedAt = first?.capture?.perf?.stoppedAt;
  expect(first?.capture).toMatchObject({
    appVersion: pkg.version,
    client: {
      phase: "Playing",
      turnPhase: "AwaitingJinnang",
      decisionOwner: 1,
      choices: expect.arrayContaining([{ id: "横征暴敛", available: true }]),
      seat: 1,
      interactive: false,
      selfPresenting: true,
      pending: true,
    },
    connection: { roomId: ROOM.roomId, status: "open", failure: null },
    errors: expect.arrayContaining([
      expect.objectContaining({ message: "出牌等待回包" }),
      expect.objectContaining({ message: expect.stringContaining("连接异常") }),
    ]),
    perf: { stoppedAt: expect.any(Number) },
  });
  expect(firstText).not.toContain("seat-only-secret");
  expect(firstText).not.toContain("wss://diagnostics.test");
  expect(firstText).not.toContain("火烧连营");

  const next = startAuthority();
  const nextJoin = await join();
  act(() => nextJoin.sockets[0]!.receive(snapshotOf(next)));
  act(() => nextJoin.sockets[0]!.receive({ type: "dismissed", roomId: ROOM.roomId }));
  const second = await loadArchivedGame(next.gameId);
  expect(second?.capture?.perf?.startedAt).toBeGreaterThanOrEqual(firstStoppedAt!);
  expect(second?.capture).toMatchObject({
    client: { phase: "Setup", pending: false },
    errors: [{ message: "房主已解散房间", at: expect.any(Number) }],
    perf: { stoppedAt: expect.any(Number) },
  });
  expect(JSON.stringify((await loadArchivedGame(authority.gameId))?.capture)).toBe(firstText);
});

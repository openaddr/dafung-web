import { afterAll, afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  getAudio,
  MediaAudioPlayer,
  setAudio,
  subscribeAudioPlayback,
  type AudioPlaybackEvent,
} from "@app/fx/audio";
import { loadArchivedGame } from "@app/gameLogArchive";
import type { WebSocketLike } from "@app/net/reconnecting-socket";
import { TESTIDS } from "@app/screens/game/testids";
import { GAME_DIAG_TID } from "@app/screens/shared/testids";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { GameEngine } from "@dafung/core/engine/authority";
import { loadMap, type MapData } from "@dafung/core/engine/board-loader";
import { createDice } from "@dafung/core/engine/dice";
import { armPhase, giveJinnang } from "@dafung/core/engine/planter";
import { capitalChoiceOf } from "@dafung/core/engine/setup-flow";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { assembleGameLogDelta, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { encodeDownlink, type ReactionTiming, type ServerMsg } from "@dafung/core/protocol/wire";
import pkg from "../../package.json";
import rawGuanzhongData from "../../packages/core/maps/guanzhong.json";
import { installControlledClock } from "./controlled-clock";
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
let controlledClock: ReturnType<typeof installControlledClock> | null = null;

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
  setAudio(null);
  setEngine(null);
  useGameStore.getState().reset();
  controlledClock?.restore();
  controlledClock = null;
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
  engine.beginCapitalSelection();
  return engine;
}

function snapshotOf(
  engine: GameEngine,
  reactionTiming?: ReactionTiming,
): Extract<ServerMsg, { type: "snapshot" }> {
  const capital = engine.phase === "Setup" && engine.currentSetupPlayerIndex === 1;
  const jinnang =
    engine.phase === "Playing" &&
    engine.turnPhase === "AwaitingJinnang" &&
    engine.decisionOwner === 1;
  return {
    type: "snapshot",
    ...ROOM,
    ...redactSnapshotForSeat(engine.snapshot(), 1),
    decisionPoint: capital
      ? "test/capital/1"
      : engine.pendingReaction
        ? `test/reaction/${engine.pendingReaction.seq}/1`
        : jinnang
          ? "test/jinnang/1"
          : null,
    decisionOptions: capital
      ? {
          kind: "pickCapital",
          options: engine.offeredCapitals.map((tileIndex) => {
            const option = capitalChoiceOf(engine, 1, tileIndex);
            if (!("tileIndex" in option)) throw new Error(option.reason);
            return option;
          }),
        }
      : jinnang
        ? {
            kind: "playJinnang",
            choices: engine.choicesFor(),
            pendingJinnang: engine.pendingJinnang,
            pendingSkill: engine.pendingSkill,
          }
        : undefined,
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
    const logMessage = (offset: number, at: number) => {
      const { message } = assembleGameLogDelta(
        authority,
        { rawOffset: offset, publicOffset: offset },
        at,
      );
      if (message === null) throw new Error("缺少测试日志尾段");
      return message;
    };
    const tail = logMessage(opening.log.length, receivedAt - 500);
    clock.mockReturnValue(receivedAt + 10);
    socket.receive(tail);
    clock.mockReturnValue(receivedAt + 20);
    socket.receive(tail);
    expect(useGameStore.getState().snapshot?.log).toEqual(opening.log);
    authority.logRoomEvent("离线记录", '{"type":"offline","seat":0}');
    authority.logRoomEvent("原座恢复记录", '{"type":"online","seat":0}');
    const end = tail.offset + tail.lines.length;
    socket.receive(logMessage(end + 1, Date.now()));
    socket.receive(logMessage(end, Date.now()));
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
    const afterRejoin = logMessage(authority.log.length - 1, receivedAt - 50);
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

function clickTestId(testId: string): void {
  const button = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`缺少操作入口 ${testId}`);
  button.click();
}

it("卸载诊断观察时归档，正在播放的演出音效继续响", async () => {
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  setAudio(new MediaAudioPlayer({ preload: false }));
  const authority = startAuthority();
  const { sockets } = await join();
  sockets[0]!.receive(snapshotOf(authority));
  mountGame();
  const playback: AudioPlaybackEvent[] = [];
  const unsubscribe = subscribeAudioPlayback((event) => {
    if (event.sound === "marchStart") playback.push(event);
  });
  try {
    await act(async () => getAudio().play("marchStart"));
    await act(async () => root!.unmount());
    root = null;

    expect(playback).toEqual([expect.objectContaining({ kind: "start" })]);
    const capture = (await loadArchivedGame(authority.gameId))?.capture;
    expect(capture?.perf?.stoppedAt).toBeNumber();
    expect(capture?.timeline?.events).toContainEqual(
      expect.objectContaining({ kind: "audio", sound: "marchStart", stage: "start" }),
    );
  } finally {
    unsubscribe();
  }
});

function startReaction(authority: GameEngine) {
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
  return pending;
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
  const city = document.querySelector(TESTIDS.city(authority.offeredCapitals[0]));
  if (city === null) throw new Error("缺少选都候选城");
  act(() => city.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(document.querySelector(`[data-testid="${TESTIDS.confirmCapitalOk}"]`)).not.toBeNull();
  act(() => clickTestId(TESTIDS.confirmCapitalCancel));
  expect(document.querySelector(`[data-testid="${TESTIDS.confirmCapitalOk}"]`)).toBeNull();
  await checkpointGameDiagnostics(authority.gameId);
  const capitalTimeline = (await loadArchivedGame(authority.gameId))?.capture?.timeline;
  expect(
    capitalTimeline?.events.flatMap((event) =>
      event.kind === "state" && event.changes.controls
        ? [event.changes.controls.decisionScroll]
        : [],
    ),
  ).toEqual(["available", "hidden"]);

  const pending = startReaction(authority);
  act(() => {
    socket.receive(snapshotOf(authority, { seq: pending.seq, remainingMs: pending.view.windowMs }));
  });
  const decline = document.querySelector<HTMLButtonElement>(
    `[data-testid="${TESTIDS.reactionDecline}"]`,
  );
  expect(decline?.disabled).toBe(false);
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

  act(() => {
    socket.receive(snapshotOf(authority, { seq: pending.seq, remainingMs: pending.view.windowMs }));
  });
  act(() => clickTestId(TESTIDS.reactionMute));
  expect(document.querySelector(`[data-testid="${TESTIDS.reactionDecline}"]`)).toBeNull();
  await checkpointGameDiagnostics(authority.gameId);
  const capture = (await loadArchivedGame(authority.gameId))?.capture;
  expect(capture?.client).toMatchObject({
    pending: true,
    reaction: { asked: true, muted: true, playable: [], canDecline: false },
  });
  const timeline = capture?.timeline;
  expect(timeline).toMatchObject({
    timeOrigin: capture?.perf?.timeOrigin,
    baseline: {
      state: { turn: { phase: "Setup", decisionOwner: 1 }, controls: { reaction: "hidden" } },
    },
    authorityAnchorBeforeStart: { source: "snapshot", offset: 0, count: expect.any(Number) },
    omitted: 0,
  });
  expect(timeline!.authorityAnchorBeforeStart!.at).toBeLessThanOrEqual(timeline!.baseline.at);
  const changes = timeline!.events.flatMap((event) =>
    event.kind === "state" ? [event.changes] : [],
  );
  expect(changes.flatMap((change) => (change.turn ? [change.turn.turnPhase] : []))).toEqual([
    "AwaitingReaction",
  ]);
  const reactionControls = [
    timeline!.baseline.state.controls.reaction,
    ...changes.flatMap((change) => (change.controls ? [change.controls.reaction] : [])),
  ];
  expect(reactionControls.filter((state, index) => state !== reactionControls[index - 1])).toEqual([
    "hidden",
    "available",
    "hidden",
  ]);
});

it("反应倒计时禁用实际按钮时立即采集入口锁定", async () => {
  controlledClock = installControlledClock({ monotonic: true });
  const { checkpointGameDiagnostics } = await import("@app/game-diagnostics");
  const authority = startAuthority();
  const pending = startReaction(authority);
  const { sockets } = await join();
  sockets[0]!.receive(
    snapshotOf(authority, { seq: pending.seq, remainingMs: pending.view.windowMs }),
  );
  mountGame();
  const decline = document.querySelector<HTMLButtonElement>(
    `[data-testid="${TESTIDS.reactionDecline}"]`,
  );
  expect(decline?.disabled).toBe(false);
  await controlledClock.advance(pending.view.windowMs);
  expect(decline?.disabled).toBe(true);
  await checkpointGameDiagnostics(authority.gameId);
  const expired = (await loadArchivedGame(authority.gameId))?.capture;
  expect(expired?.timeline?.events).toContainEqual(
    expect.objectContaining({
      kind: "state",
      changes: expect.objectContaining({
        controls: expect.objectContaining({ reaction: "locked" }),
      }),
    }),
  );
});

async function openDiagnostics(gameId: string) {
  act(() => clickTestId(TESTIDS.settingsButton));
  await act(async () => clickTestId(TESTIDS.settingsDiagnostic));
  return act(async () => loadArchivedGame(gameId));
}

async function saveDiagnosticFile(target: string): Promise<unknown> {
  const saved = Promise.withResolvers<unknown>();
  mockIPC((command, payload) => {
    if (command === "plugin:dialog|save") return target;
    if (command === "plugin:fs|write_text_file") {
      saved.resolve(JSON.parse(new TextDecoder().decode(payload as Uint8Array)) as unknown);
      return;
    }
    throw new Error(`未预期的原生命令 ${command}`);
  });
  try {
    return await act(async () => {
      clickTestId(GAME_DIAG_TID.save);
      return saved.promise;
    });
  } finally {
    clearMocks();
  }
}

it("在诊断面板直接保存和复制时均刷新当前局", async () => {
  const authority = startAuthority();
  const { sockets } = await join();
  sockets[0]!.receive(snapshotOf(authority));
  mountGame();
  await openDiagnostics(authority.gameId);

  const lateError = "打开诊断面板后才收到的错误";
  act(() => window.dispatchEvent(new ErrorEvent("error", { message: lateError })));
  const bundle = await saveDiagnosticFile("content://diagnostics/selected.json");
  expect(bundle).toMatchObject({
    gameId: authority.gameId,
    log: expect.arrayContaining([expect.objectContaining({ category: "header" })]),
    timeline: {
      timeOrigin: performance.timeOrigin,
      events: [expect.objectContaining({ kind: "error", message: lateError })],
    },
    perf: { timeOrigin: performance.timeOrigin },
    missing: {},
  });

  const written = Promise.withResolvers<string>();
  using _clipboard = spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => {
    written.resolve(text);
  });
  const copyError = "保存文件之后才收到的错误";
  await act(async () => {
    window.dispatchEvent(new ErrorEvent("error", { message: copyError }));
    clickTestId(GAME_DIAG_TID.copy);
    await written.promise;
  });
  const summary = await written.promise;
  expect(summary).toContain(`局 ID ${authority.gameId}`);
  expect(summary).toContain(copyError);
});

it("保存时刷新归档失败，会注明失败并导出已有记录", async () => {
  const authority = startAuthority();
  const { sockets } = await join();
  sockets[0]!.receive(snapshotOf(authority));
  mountGame();
  const previous = await openDiagnostics(authority.gameId);
  expect(previous?.capture).toBeDefined();

  const put = IDBObjectStore.prototype.put;
  using _failWrite = spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
    this: globalThis.IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = put.call(this, value, key);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  });
  const target = "content://diagnostics/retained.json";
  expect(await saveDiagnosticFile(target)).toMatchObject({
    gameId: authority.gameId,
    capturedAt: previous!.capture!.capturedAt,
    captureRefreshFailure: "当前局现场刷新失败：对局归档事务已中止",
  });
  const dialog = document.querySelector(`[data-testid="${GAME_DIAG_TID.dialog}"]`);
  expect(dialog?.textContent).toContain("当前局现场刷新失败");
  expect(dialog?.textContent).toContain(target);
});

it("保存离场前的同局交互、报错和帧诊，另起一局各自可取", async () => {
  using _play = spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  setAudio(new MediaAudioPlayer({ preload: false }));
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
  const initialSocket = sockets[0]!;
  initialSocket.receive(snapshotOf(authority));
  mountGame();
  const passButton = `[data-testid="${TESTIDS.actionbarPass}"]`;
  expect(document.querySelector(passButton)).not.toBeNull();
  act(() => clickTestId(TESTIDS.jinnangToggle));
  expect(document.querySelector(passButton)).toBeNull();
  act(() => clickTestId(TESTIDS.jinnangToggle));
  await act(async () => getAudio().play("marchStart"));
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  try {
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
  const background = await loadArchivedGame(authority.gameId);
  expect(background?.capture?.client.interactive).toBe(true);
  expect(background?.capture?.perf?.stoppedAt).toBeNull();
  const backgroundTimeline = background?.capture?.timeline;
  expect(backgroundTimeline?.baseline.state.controls.jinnang).toBe("available");
  expect(
    backgroundTimeline?.events.flatMap((event) =>
      event.kind === "state" && event.changes.controls ? [event.changes.controls.jinnang] : [],
    ),
  ).toEqual(["hidden", "available"]);
  const march = backgroundTimeline?.events
    .filter((event) => event.kind === "audio")
    .filter((event) => event.sound === "marchStart");
  expect(march).toEqual([
    expect.objectContaining({ stage: "start", instanceId: expect.any(Number) }),
    expect.objectContaining({ stage: "end", reason: "background", instanceId: expect.any(Number) }),
  ]);
  expect(march![1].instanceId).toBe(march![0].instanceId);
  expect(march![1].at).toBeLessThanOrEqual(backgroundTimeline!.capturedAt);

  act(() => {
    initialSocket.disconnect();
    controller.reconnect();
    sockets[1]!.open();
    sockets[1]!.receive(snapshotOf(authority));
  });
  await act(async () => getAudio().play("cityConquest"));

  act(() => {
    controller.dispatchCommand({ type: "useHeroSkill", heroId: "zhangxingcai", skillId: "leigu" });
    sockets[1]!.receive({
      type: "error",
      requestId: 1,
      error: "令牌失效：token=seat-only-secret wss://diagnostics.test/ws",
    });
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
  const events = first?.capture?.timeline?.events;
  const connections = events?.flatMap((event) =>
    event.kind === "state" && event.changes.connection ? [event.changes.connection.status] : [],
  );
  expect(connections).toEqual(["closed", "gaveUp", "connecting", "calibrating", "open"]);
  expect(events?.filter((event) => event.kind === "command")).toEqual([
    expect.objectContaining({ stage: "sent", command: "useHeroSkill", id: 1 }),
    expect.objectContaining({
      stage: "result",
      id: 1,
      outcome: "rejected",
      reason: expect.stringContaining("令牌失效"),
    }),
  ]);
  const conquest = events
    ?.filter((event) => event.kind === "audio")
    .filter((event) => event.sound === "cityConquest");
  expect(conquest).toEqual([
    expect.objectContaining({ stage: "start", instanceId: expect.any(Number) }),
    expect.objectContaining({ stage: "end", reason: "cancelled", instanceId: expect.any(Number) }),
  ]);
  expect(conquest![1].instanceId).toBe(conquest![0].instanceId);

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
    timeline: {
      events: [{ kind: "error", message: "房主已解散房间", at: expect.any(Number) }],
    },
  });
  expect(JSON.stringify((await loadArchivedGame(authority.gameId))?.capture)).toBe(firstText);
});

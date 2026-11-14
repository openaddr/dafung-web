// #1421:公共入座/重连行为经生产 ReconnectingSocket 装配,底层 socket/timer 确定性驱动。
// 守住原座凭证、摘要前上行锁和未开局大厅校准;不测 DOM/几何,不等待真实退避。
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GameEngine } from "@core/authority";
import { loadMap, type MapData } from "@core/board-loader";
import { createDice } from "@core/dice";
import { OnlineController } from "@app/controllers/online";
import type { WebSocketLike } from "@app/net/reconnecting-socket";
import { getEngine, useGameStore } from "@app/store/gameStore";
import { getController, setController } from "@app/controllers/registry";
import { useNetStore, type NetRoomFields } from "@app/store/netStore";
import type { ServerMsg } from "../../scripts/wire";
import guanzhongData from "../../public/maps/guanzhong.json" with { type: "json" };
import zhongyuanData from "../../public/maps/zhongyuan.json" with { type: "json" };
import mapCatalog from "../../public/maps/index.json" with { type: "json" };

const MAP_DATA = guanzhongData as MapData;
const MAP = loadMap(MAP_DATA);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];
  closes = 0;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closes++;
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
    this.onmessage!({ data: JSON.stringify(message) });
  }
}

let controller: OnlineController;
let sockets: FakeSocket[];
let requests: string[];
let originalFetch: typeof fetch;
let originalStorage: PropertyDescriptor | undefined;

beforeEach(() => {
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  sockets = [];
  requests = [];
  originalFetch = globalThis.fetch;
  originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "http://recovery.test" },
  });
  controller = new OnlineController(MAP, "guanzhong", {
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    maxAttempts: 0,
    random: () => 0.5,
    timer: {
      setTimeout: () => {
        throw new Error("maxAttempts=0 must not schedule a retry");
      },
      clearTimeout: () => {
        throw new Error("no retry timer exists");
      },
    },
  });
});

afterEach(() => {
  setController(null);
  controller.destroy();
  useGameStore.getState().reset();
  useNetStore.getState().reset();
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function roomFields(started: boolean, autoPilot = false): NetRoomFields {
  return {
    roomId: "SAME",
    host: 0,
    mapId: "guanzhong",
    started,
    seats: [0, 1].map((seat) => ({
      seat,
      kind: "human",
      taken: true,
      online: true,
      autoPilot,
      guohao: null,
    })),
  };
}

function serveRoom(fields: NetRoomFields, seat = 1): void {
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return Response.json({ ok: true, seat, seatToken: "original-token", ...fields });
  }) as typeof fetch;
}

function authority(): GameEngine {
  const engine = new GameEngine(MAP.board, MAP.catalog, createDice(1), {
    seats: [
      { name: "甲", isBot: false },
      { name: "乙", isBot: false },
    ],
    seed: 1,
    startingCash: MAP.startingCash,
    startingTreasures: 0,
    targetNetWorth: MAP.targetNetWorth,
  });
  engine.doDraftRoll();
  return engine;
}

function hydrate(socket: FakeSocket, engine: GameEngine, autoPilot = false): void {
  socket.receive({ type: "snapshot", ...roomFields(true, autoPilot), ...engine.snapshot() });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function replacementController(): OnlineController {
  return new OnlineController(MAP, "guanzhong", {
    maxAttempts: 0,
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
}

describe("OnlineController 原座恢复", () => {
  it("自动重连校准或退出后旧地图加载均不能覆盖当前会话", async () => {
    controller.destroy();
    let retry!: () => void;
    controller = new OnlineController(MAP, "guanzhong", {
      socketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      maxAttempts: 1,
      random: () => 0.5,
      timer: {
        setTimeout: (fn) => {
          retry = fn;
          return "retry";
        },
        clearTimeout: () => {
          throw new Error("本例已执行退避回调,不应残留退避定时器");
        },
      },
    });
    serveRoom(roomFields(false));
    await controller.joinRoom("SAME");
    setController(controller, MAP_DATA);
    const previous = sockets[0]!;
    previous.open();
    const mapReply = deferred<Response>();
    const requested = deferred<void>();
    globalThis.fetch = (async (input) => {
      if (String(input) === "/maps/index.json") return Response.json(mapCatalog);
      if (String(input) !== "/maps/zhongyuan.json") throw new Error(`意外请求:${String(input)}`);
      requested.resolve();
      return mapReply.promise;
    }) as typeof fetch;
    previous.receive({ type: "lobby", seatCount: 2, ...roomFields(false), mapId: "zhongyuan" });
    await requested.promise;
    previous.disconnect();
    retry(); // 真正驱动ReconnectingSocket的自动spawn,不走控制器手动reconnect。
    expect(sockets).toHaveLength(2);
    const current = sockets[1]!;
    current.open();
    current.receive({ type: "lobby", seatCount: 2, ...roomFields(false) });
    expect(controller.sessionReady).toBe(true);
    const engine = controller.engine;
    const snapshot = useGameStore.getState().snapshot;
    mapReply.resolve(Response.json(zhongyuanData));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(controller.engine).toBe(engine);
    expect(getEngine()).toBe(engine);
    expect(useGameStore.getState().snapshot).toBe(snapshot);
    expect(useNetStore.getState().mapId).toBe("guanzhong");
    // 同一异步资源边界的退出分支,不再另立重复地图回归。
    for (const outcome of ["resolve", "reject"] as const) {
      serveRoom(roomFields(false));
      await controller.joinRoom("SAME");
      setController(controller, MAP_DATA);
      const socket = sockets.at(-1)!;
      socket.open();
      const mapReply = deferred<Response>();
      const requested = deferred<void>();
      globalThis.fetch = (async (input) => {
        if (String(input) === "/maps/index.json") return Response.json(mapCatalog);
        if (String(input) !== "/maps/zhongyuan.json") throw new Error(`意外请求:${String(input)}`);
        requested.resolve();
        return mapReply.promise;
      }) as typeof fetch;
      socket.receive({ type: "lobby", seatCount: 2, ...roomFields(false), mapId: "zhongyuan" });
      await requested.promise;
      const replacement = replacementController();
      setController(replacement, MAP_DATA); // 生产换会话入口销毁旧控制器。
      useNetStore.getState().reset();
      useNetStore.getState().pushHint("新会话提示");
      useGameStore.getState().setScreen("setup");
      const engine = getEngine();
      const snapshot = useGameStore.getState().snapshot;
      if (outcome === "resolve") mapReply.resolve(Response.json(zhongyuanData));
      else mapReply.reject(new Error("旧地图加载失败"));
      // 让本次响应的完整微任务链结束;不等待生产时钟或演出。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(getController()).toBe(replacement);
      expect(getEngine()).toBe(engine);
      expect(useGameStore.getState().snapshot).toBe(snapshot);
      expect(useGameStore.getState().screen).toBe("setup");
      expect(useNetStore.getState().roomId).toBe("");
      expect(useNetStore.getState().hint).toBe("新会话提示");
      controller = replacement;
    }
  });

  it("退出后createRoom或joinRoom迟到均明确取消且不重新入座", async () => {
    for (const action of ["create", "join"] as const) {
      const reply = deferred<Response>();
      globalThis.fetch = Object.assign(() => reply.promise, {
        preconnect: originalFetch.preconnect,
      });
      setController(controller, MAP_DATA);
      const pending =
        action === "create" ? controller.createRoom({ seats: 2 }) : controller.joinRoom("SAME");
      const replacement = replacementController();
      setController(replacement, MAP_DATA);
      useNetStore.getState().reset();
      const engine = getEngine();
      reply.resolve(Response.json({ ok: true, seat: 1, seatToken: "late", ...roomFields(false) }));
      await expect(pending).rejects.toThrow("联机会话已结束");
      expect(getController()).toBe(replacement);
      expect(getEngine()).toBe(engine);
      expect(useNetStore.getState().roomId).toBe("");
      expect(useNetStore.getState().mySeat).toBe(-1);
      expect(useNetStore.getState().connection).toBe("idle");
      expect(sockets).toHaveLength(0);
      controller = replacement;
    }
  });

  it("耗尽后复用原凭证,open/events/开局元数据均不解锁,当前摘要才放行上行", async () => {
    const engine = authority();
    expect(engine.currentSetupPlayerIndex).toBe(1);
    serveRoom(roomFields(true));
    await controller.joinRoom("SAME");
    const first = sockets[0]!;
    first.open();
    // 旧实现把 open 当完成:此处先红,不靠 reconnect 方法缺席证明回归。
    expect(useNetStore.getState().connection).toBe("calibrating");
    hydrate(first, engine);
    expect(controller.sessionReady).toBe(true);
    controller.setupPickCapital(engine.offeredCapitals[0]!);
    expect(first.sent).toHaveLength(1);
    const readable = controller.engine.snapshot();
    const oldMessage = first.onmessage!;
    first.disconnect();
    expect(useNetStore.getState().connection).toBe("gaveUp");
    expect(controller.sessionReady).toBe(false);
    expect(controller.engine.snapshot()).toEqual(readable);

    controller.reconnect();
    controller.reconnect();
    expect(sockets).toHaveLength(2);
    expect(first.readyState).toBe(3);
    expect(useNetStore.getState().connection).toBe("connecting");
    const current = sockets[1]!;
    expect(current.url).toBe(first.url);
    expect(new URL(current.url).searchParams.get("token")).toBe("original-token");
    expect(controller.seat).toBe(1);
    expect(requests).toEqual(["http://recovery.test/room/join"]);
    oldMessage({ data: JSON.stringify({ type: "dismissed", roomId: "SAME" }) });
    expect(useNetStore.getState().dismissed).toBe(false);

    current.open();
    current.receive({ type: "lobby", seatCount: 2, ...roomFields(true) });
    current.receive({
      type: "events",
      events: [{ kind: "cashChanged", seat: 1, round: 0, turn: 0, delta: 999, reason: "income" }],
    });
    expect(useNetStore.getState().connection).toBe("calibrating");
    expect(controller.engine.snapshot()).toEqual(readable);
    expect(useNetStore.getState().eventBatchSeq).toBe(0);
    controller.setupPickCapital(engine.offeredCapitals[0]!);
    controller.setAutoPilot(false);
    expect(current.sent).toEqual([]);

    hydrate(current, engine);
    expect(controller.sessionReady).toBe(true);
    expect(useNetStore.getState().connection).toBe("open");
    expect(useNetStore.getState().pending).toBe(false);
    controller.setupPickCapital(engine.offeredCapitals[0]!);
    expect(JSON.parse(current.sent[0]!)).toEqual({
      type: "pickCapital",
      tileIndex: engine.offeredCapitals[0]!,
    });

    while (engine.phase === "Setup") {
      const result = engine.pickCapital(engine.currentSetupPlayerIndex, engine.offeredCapitals[0]!);
      expect(result.ok).toBe(true);
    }
    hydrate(current, engine);
    expect(controller.interactive).toBe(true);
    current.disconnect();
    expect(controller.interactive).toBe(false);
    expect(useGameStore.getState().interactive).toBe(false);
    controller.reconnect();
    const third = sockets[2]!;
    third.open();
    controller.dispatchCommand({ type: "useJinnang", cardId: null });
    controller.setAutoPilot(false);
    expect(third.sent).toEqual([]);
    hydrate(third, engine, true);
    expect(controller.sessionReady).toBe(true);
    expect(controller.autoPilotOn).toBe(true);
    expect(controller.interactive).toBe(false);
    controller.setAutoPilot(false);
    expect(JSON.parse(third.sent[0]!)).toEqual({ type: "autoPilot", on: false });
    hydrate(third, engine);
    controller.dispatchCommand({ type: "useJinnang", cardId: null });
    expect(JSON.parse(third.sent[1]!)).toEqual({
      type: "cmd",
      cmd: { type: "useJinnang", cardId: null },
    });
  });

  it("未开局大厅以当前lobby完成校准,再次耗尽仍可恢复且销毁后不复活", async () => {
    serveRoom(roomFields(false), 0);
    await controller.createRoom({ seats: 2 });
    sockets[0]!.open();
    expect(useNetStore.getState().connection).toBe("calibrating");
    sockets[0]!.receive({ type: "lobby", seatCount: 2, ...roomFields(false) });
    expect(controller.sessionReady).toBe(true);
    sockets[0]!.disconnect();
    controller.reconnect();
    sockets[1]!.disconnect();
    expect(useNetStore.getState().connection).toBe("gaveUp");
    controller.reconnect();
    expect(sockets).toHaveLength(3);
    const current = sockets[2]!;
    const open = current.onopen!;
    const message = current.onmessage!;
    controller.destroy();
    open();
    message({ data: JSON.stringify({ type: "lobby", seatCount: 2, ...roomFields(false) }) });
    controller.reconnect();
    expect(controller.sessionReady).toBe(false);
    expect(sockets).toHaveLength(3);
    expect(current.closes).toBe(1);
    expect(requests).toEqual(["http://recovery.test/room/new"]);
  });
});

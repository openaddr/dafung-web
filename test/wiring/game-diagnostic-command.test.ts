import { expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import type { GameControllerDiagnosticEvent } from "@app/controllers/controller";
import { LocalController } from "@app/controllers/local";
import { waitForGameArchive } from "@app/gameLogArchive";
import { createWorkerClock } from "@app/net/worker-clock";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { MAP } from "../../scripts/engine-helpers";

it("单机内存线上记录拦截、拒绝和成功，成功回执独立于状态拍", async () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const clock = createWorkerClock();
  clock.pause();
  const controller = new LocalController(
    MAP,
    {
      seats: [
        { name: "诸侯1", isBot: false, guohao: "魏" },
        { name: "诸侯2", isBot: true },
      ],
      seed: 1,
      mapId: "guanzhong",
      botStepMs: 0,
    },
    clock,
  );
  const events: GameControllerDiagnosticEvent[] = [];
  try {
    controller.subscribeDiagnostics((event) => events.push(event));
    const { gameId } = controller.engine;
    const capital = controller.engine.offeredCapitals[0];

    controller.dispatchCommand({ type: "rollAndMove" });
    expect(events).toEqual([
      {
        kind: "command",
        stage: "blocked",
        gameId,
        command: "rollAndMove",
        id: 1,
        at: expect.any(Number),
        reason: "对局未处于进行阶段",
      },
    ]);

    controller.setupPickCapital(-1);
    expect(controller.diagnosticInteraction.pending).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useGameStore.getState().hint).toBe("非本轮候选城");
    expect(controller.diagnosticInteraction.pending).toBe(false);
    expect(events.slice(1)).toEqual([
      {
        kind: "command",
        stage: "sent",
        gameId,
        command: "pickCapital",
        id: 2,
        at: expect.any(Number),
      },
      {
        kind: "command",
        stage: "result",
        outcome: "rejected",
        gameId,
        command: "pickCapital",
        id: 2,
        at: expect.any(Number),
        reason: "非本轮候选城",
      },
    ]);

    const logOffset = controller.engine.log.length;
    controller.setupPickCapital(capital);
    await Promise.resolve(); // 回执先到，状态批还在合并拍。
    expect(events.slice(3)).toEqual([
      {
        kind: "command",
        stage: "sent",
        gameId,
        command: "pickCapital",
        id: 3,
        at: expect.any(Number),
      },
      {
        kind: "command",
        stage: "result",
        outcome: "accepted",
        gameId,
        command: "pickCapital",
        id: 3,
        at: expect.any(Number),
        logOffset,
      },
    ]);
    expect(controller.diagnosticInteraction.pending).toBe(true);
    expect(controller.engine.players[0].capitalIndex).not.toBe(capital);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.engine.players[0].capitalIndex).toBe(capital);
    expect(controller.diagnosticInteraction.pending).toBe(false);
    expect(events.map(({ at }) => at)).toEqual(events.map(({ at }) => at).sort((a, b) => a - b));
  } finally {
    controller.destroy();
    setEngine(null);
    useGameStore.getState().reset();
    await waitForGameArchive(controller.engine.gameId);
    if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});

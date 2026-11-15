import { RoomRegistry } from "../../scripts/room";
import { createEngine, type RoomRecord } from "../../scripts/room-record";
import { armHero, pinDice, setStamina } from "../../src/core/planter";
import type { GameEngine } from "../../src/core/authority";
import { foldEventBatch } from "../../src/app/net/event-fold";
import type { ServerMsg } from "../../scripts/wire";
import { expect, it } from "bun:test";
import { MAP } from "../../scripts/engine-helpers";
import { LocalController } from "../../src/app/controllers/local";
import { setEngine, useGameStore } from "../../src/app/store/gameStore";
import { useNetStore } from "../../src/app/store/netStore";

// 下行合并拍的宏任务屏障;只等已排定的 0ms flush,不等待演出或业务窗口。
const downlinkTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("单机构造同步水合首帧,后续选都命令由下行推进副本", async () => {
  const controller = new LocalController(MAP, {
    seats: [
      { name: "诸侯1", isBot: false, guohao: "魏" },
      { name: "诸侯2", isBot: true },
      { name: "诸侯3", isBot: true },
    ],
    seed: 1,
    mapId: "guanzhong",
    botStepMs: 0,
  });
  try {
    expect(controller.autoPilotOn).toBe(false);
    expect(useGameStore.getState().snapshot).toEqual(controller.engine.snapshot());
    const before = controller.engine.phase;
    const capital = controller.engine.offeredCapitals[0]!;
    controller.setupPickCapital(capital);
    expect(controller.engine.phase).toBe(before);
    await downlinkTurn();
    expect(controller.engine.phase).toBe("Playing");
    expect(controller.engine.players[0]!.capitalIndex).toBe(capital);
    expect(useGameStore.getState().snapshot).toEqual(controller.engine.snapshot());
    expect(controller.viewSeat).toBe(controller.engine.decisionOwner);
    expect(useNetStore.getState().roomId).toBe("");
  } finally {
    controller.destroy();
    setEngine(null);
    useGameStore.getState().reset();
  }
});

async function playingRoom(beforeConnect?: (engine: GameEngine) => void) {
  const records = new Map<string, RoomRecord>();
  const registry = new RoomRegistry(
    {
      save: (record) => {
        records.set(record.roomId, record);
      },
      load: (id) => records.get(id) ?? null,
      remove: (id) => {
        records.delete(id);
      },
      exists: (id) => records.has(id),
      listIds: () => [...records.keys()],
    },
    undefined,
    undefined,
    { clock: { setTimeout: () => ({}), clearTimeout: () => {} } },
  );
  const { room, token } = registry.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
  });
  registry.joinSeat(room.roomId);
  registry.setMap(room.roomId, "guanzhong", token, new Set(["guanzhong"]));
  await registry.startGame(room.roomId, token, undefined, () => MAP);
  const engine = room.engine!;
  while (engine.phase === "Setup") {
    await registry.pickCapital(
      room.roomId,
      engine.currentSetupPlayerIndex,
      engine.offeredCapitals[0]!,
    );
  }
  await registry.applyCommand(room.roomId, { type: "useJinnang", cardId: null });
  if (beforeConnect) beforeConnect(engine);
  const replica = createEngine(
    {
      seats: [
        { name: "甲", isBot: false },
        { name: "乙", isBot: false },
      ],
      startingCash: MAP.startingCash,
      targetNetWorth: MAP.targetNetWorth,
      startingTreasures: MAP.startingTreasures,
    },
    false,
    MAP,
  );
  const messages: ServerMsg[] = [];
  registry.connectSeat(room.roomId, 0, token, {
    seat: 0,
    open: true,
    send: (raw) => {
      const message = JSON.parse(raw) as ServerMsg;
      messages.push(message);
      if (message.type === "snapshot") replica.restoreFromSnapshot(message);
      if (message.type === "events") foldEventBatch(replica, message.events);
    },
  });
  const broadcast = () => registry.transportBroadcast(room.roomId);
  broadcast();
  await downlinkTurn();
  messages.length = 0;
  return { registry, room, token, engine, replica, messages, broadcast };
}

it("首连水合后以事件批续行,非校准节点不恒发快照", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom();
  try {
    broadcast();
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual([]);
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    pinDice(engine, "march", [1]);
    await registry.applyCommand(room.roomId, { type: "rollAndMove" }, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["events"]);
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    expect(replica.turnPhase).toBe(engine.turnPhase);
    messages.length = 0;
    const turn = engine.turnNumber;
    await registry.applyCommand(room.roomId, { type: "endDecision" }, broadcast);
    await downlinkTurn();
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    expect(replica.turnNumber).toBe(engine.turnNumber);
    expect(replica.turnNumber).toBe(turn + 1);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("非校准拍房间托管元数据按变化下行,不依赖全量快照", async () => {
  const { registry, room, token, engine, messages, broadcast } = await playingRoom();
  try {
    const seat = 1 - engine.activeIndex;
    await registry.setAutoPilot(room.roomId, seat, true, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["lobby"]);
    const message = messages[0]!;
    if (message.type !== "lobby") throw new Error("缺少托管元数据消息");
    expect(message.seats[seat]!.autoPilot).toBe(true);
    messages.length = 0;
    await registry.setAutoPilot(room.roomId, seat, false, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["lobby"]);
    const returned = messages[0]!;
    if (returned.type !== "lobby") throw new Error("缺少收回托管元数据消息");
    expect(returned.seats[seat]!.autoPilot).toBe(false);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("放逐选择经下行开窗、续问和闭窗,水合副本可继续提交命令", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 2; seat++) {
        armHero(authority, seat, "caopi", ["fangzhu"]);
        setStamina(authority, seat, 30);
      }
    },
  );
  try {
    pinDice(engine, "march", [1]);
    await registry.applyCommand(room.roomId, { type: "rollAndMove" }, broadcast);
    await downlinkTurn();
    expect(replica.turnPhase).toBe("AwaitingDecision");
    messages.length = 0;
    await registry.applyCommand(room.roomId, { type: "endDecision" }, broadcast);
    await downlinkTurn();
    expect(replica.turnPhase).toBe("AwaitingSkillChoice");
    expect(replica.pendingSkillChoices).toEqual(engine.pendingSkillChoices);
    expect(replica.pendingSkillChoices).toHaveLength(2);
    expect(messages.some((message) => message.type === "snapshot")).toBe(true);

    const firstOwner = replica.decisionOwner;
    await registry.applyCommand(
      room.roomId,
      { type: "respondSkillChoice", seat: firstOwner, use: false },
      broadcast,
    );
    await downlinkTurn();
    expect(replica.turnPhase).toBe("AwaitingSkillChoice");
    expect(replica.pendingSkillChoices).toEqual(engine.pendingSkillChoices);
    expect(replica.pendingSkillChoices).toHaveLength(1);
    expect(replica.decisionOwner).not.toBe(firstOwner);

    await registry.applyCommand(
      room.roomId,
      { type: "respondSkillChoice", seat: replica.decisionOwner, use: false },
      broadcast,
    );
    await downlinkTurn();
    expect(replica.pendingSkillChoices).toEqual([]);
    expect(replica.turnPhase).toBe("Roll");
    const nextSeat = replica.activeIndex;
    const beforeMarch = replica.players[nextSeat]!.position;
    pinDice(engine, "march", [1]);
    await registry.applyCommand(room.roomId, { type: "rollAndMove" }, broadcast);
    await downlinkTurn();
    expect(replica.players[nextSeat]!.position).not.toBe(beforeMarch);
    expect(replica.turnPhase).toBe(engine.turnPhase);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

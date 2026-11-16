import { RoomRegistry } from "../../scripts/room";
import { createEngine, type RoomRecord } from "../../scripts/room-record";
import {
  armHero,
  armPhase,
  giveJinnang,
  giveTreasureFromDeck,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setReputation,
  setStamina,
} from "../../src/core/planter";
import type { GameCommand, GameEngine } from "../../src/core/authority";
import { foldEventBatch } from "../../src/app/net/event-fold";
import { cmdMsg, dispatchInbound, type InboundMsg, type ServerMsg } from "../../scripts/wire";
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

async function playingRoom(
  beforeConnect?: (engine: GameEngine) => void,
  { seatCount = 2, encounter = false } = {},
) {
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
    {
      encounter: { enabled: encounter },
      clock: { setTimeout: () => ({}), clearTimeout: () => {} },
    },
  );
  const { room, token } = registry.createRoom({
    seatCount,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
  });
  for (let seat = 1; seat < seatCount; seat++) registry.joinSeat(room.roomId);
  registry.setMap(room.roomId, "guanzhong", token, new Set(["guanzhong"]));
  await registry.startGame(room.roomId, token, undefined, () => MAP);
  const engine = room.engine!;
  while (engine.phase === "Setup") {
    await registry.pickCapital(
      room.roomId,
      engine.currentSetupPlayerIndex,
      engine.offeredCapitals.find((index) => index < 9 || index > 15)!,
    );
  }
  await registry.applyCommand(room.roomId, { type: "useJinnang", cardId: null });
  if (beforeConnect) beforeConnect(engine);
  const replica = createEngine(
    {
      seats: Array.from({ length: seatCount }, (_, seat) => ({
        name: `诸侯${seat + 1}`,
        isBot: false,
      })),
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
  const sendCommand = async (cmd: GameCommand) => {
    messages.length = 0;
    const result = await dispatchInbound(cmdMsg(cmd), {
      cmd: (command) => registry.applyCommandFromSeat(room.roomId, 0, command, broadcast),
      pickCapital: (tileIndex) => registry.pickCapital(room.roomId, 0, tileIndex, broadcast),
      setAutoPilot: (on) => registry.setAutoPilot(room.roomId, 0, on, broadcast),
    });
    await downlinkTurn();
    return result;
  };
  return { registry, room, token, engine, replica, messages, broadcast, sendCommand };
}

it("连环计返回改选经真实下行保留首选，最终提交才消耗并结算", async () => {
  const { registry, room, token, engine, replica, messages, sendCommand } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) {
        giveJinnang(authority, seat, seat === 0 ? ["连环计"] : []);
        setCash(authority, seat, 5000);
      }
      armPhase(authority, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
      pinDice(authority, "duel", [6, 1]);
    },
    { seatCount: 4 },
  );
  async function submit(fields: { targets?: number[]; back?: boolean; cancel?: boolean } = {}) {
    const cmd: GameCommand = { type: "useJinnang", cardId: "连环计", ...fields };
    expect(await sendCommand(cmd)).toEqual({ ok: true });
    expect(replica.pendingJinnang).toEqual(engine.pendingJinnang);
    expect(replica.players[0].jinnangHand).toEqual(engine.players[0].jinnangHand);
    expect(replica.turnPhase).toBe(engine.turnPhase);
  }
  const candidates = () =>
    replica
      .choicesFor()
      .flatMap((o) => (o.available && o.targetSeat != null ? [o.targetSeat] : []));
  try {
    await submit();
    expect(candidates()).toEqual([1, 2, 3]);
    await submit({ cancel: true });
    expect(replica.pendingJinnang).toBeNull();
    expect(replica.turnPhase).toBe("AwaitingJinnang");
    expect(replica.players[0].jinnangHand).toEqual(["连环计"]);
    await submit();
    await submit({ targets: [1] });
    expect(candidates()).toEqual([2, 3]);
    await submit({ back: true });
    expect(replica.pendingJinnang).toMatchObject({ stage: "two-a", picked: [1] });
    await submit({ targets: [2] });
    expect(candidates()).toEqual([1, 3]);
    await submit({ targets: [2] });
    expect(replica.players[0].jinnangHand).toEqual(["连环计"]);
    expect(replica.turnPhase).toBe("AwaitingJinnang");
    expect(replica.players.map((p) => p.cash)).toEqual([5000, 5000, 5000, 5000]);
    await submit({ targets: [1] });
    expect(replica.pendingJinnang).toBeNull();
    expect(replica.turnPhase).toBe("Roll");
    expect(replica.players[0].jinnangHand).toEqual([]);
    expect(replica.players.map((p) => p.cash)).toEqual([5400, 4600, 5300, 5000]);
    const events = messages.flatMap((message) => (message.type === "events" ? message.events : []));
    expect(events.filter((event) => event.kind === "duelResolved")).toHaveLength(1);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("目标锦囊最终提交后，下行副本从目标段进入反应窗", async () => {
  const { registry, room, token, engine, replica, messages, sendCommand } = await playingRoom(
    (authority) => {
      giveJinnang(authority, 0, ["缓兵之计"]);
      giveJinnang(authority, 1, ["识破诡计"]);
      armPhase(authority, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    },
  );
  try {
    expect(await sendCommand({ type: "useJinnang", cardId: "缓兵之计" })).toEqual({ ok: true });
    expect(replica.pendingJinnang?.stage).toBe("one");
    expect(await sendCommand({ type: "useJinnang", cardId: "缓兵之计", targets: [1] })).toEqual({
      ok: true,
    });
    expect(replica.pendingJinnang).toBeNull();
    expect(replica.players[0].jinnangHand).toEqual([]);
    expect(replica.turnPhase).toBe("AwaitingReaction");
    expect(engine.pendingReaction?.view.windowMs).toBe(30_000);
    expect(replica.pendingReaction?.view).toMatchObject({
      kind: "jinnang",
      targetSeats: [1],
      windowMs: 30_000,
    });
    const events = messages.flatMap((msg) => (msg.type === "events" ? msg.events : []));
    expect(events.map((ev) => ev.kind)).toEqual(["jinnangAnnounced", "reactionOpened"]);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("结盟互市自动结算后,真实下行将咸阳交易交给城主并可续行下一回合", async () => {
  // 守住机遇 → 最终城池决策的真实 JSON 下行接缝,单例只等两个合并拍。
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) giveJinnang(authority, seat, []);
      armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 3 });
      placePlayer(authority, 3, 9);
      grantProperty(authority, 0, "prop-xianyang", 1);
      giveTreasureFromDeck(authority, 0, 3);
      setReputation(authority, 3, 80);
      pinDice(authority, "march", [6]);
      authority.dice.setRngState(2);
    },
    { seatCount: 4, encounter: true },
  );
  try {
    const message = JSON.parse(cmdMsg({ type: "rollAndMove" })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, message.cmd, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["events"]);
    expect(engine.gameEvents).toContainEqual(
      expect.objectContaining({ kind: "encounterChoice", encounterId: "结盟互市" }),
    );
    expect(engine.turnPhase).toBe("AwaitingTreasureOwner");
    expect(engine.decisionOwner).toBe(0);
    expect({
      phase: replica.turnPhase,
      owner: replica.decisionOwner,
      pendingLand: replica.pendingLand,
      visitor: replica.snapshot().treasureVisitor,
      outcome: replica.snapshot().lastLandOutcome,
      cash: replica.players.map((player) => player.cash),
    }).toEqual({
      phase: engine.turnPhase,
      owner: engine.decisionOwner,
      pendingLand: engine.pendingLand,
      visitor: engine.snapshot().treasureVisitor,
      outcome: engine.snapshot().lastLandOutcome,
      cash: engine.players.map((player) => player.cash),
    });
    const turn = replica.turnNumber;
    const next = JSON.parse(
      cmdMsg({ type: "resolveTreasureOwner", action: { type: "skip" } }),
    ) as Extract<InboundMsg, { type: "cmd" }>;
    await registry.applyCommand(room.roomId, next.cmd, broadcast);
    await downlinkTurn();
    expect(replica.turnNumber).toBe(turn + 1);
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    expect(replica.turnPhase).toBe(engine.turnPhase);
    expect(replica.decisionOwner).toBe(engine.decisionOwner);
    expect(replica.snapshot().treasureVisitor).toBeNull();
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("即时机遇增加现金后,副本按最终购地决策提交命令", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) giveJinnang(authority, seat, []);
      armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 3 });
      placePlayer(authority, 3, 9);
      setCash(authority, 3, authority.catalog.get("prop-xianyang")!.purchasePrice - 50);
      setReputation(authority, 3, 80);
      pinDice(authority, "march", [6]);
      authority.dice.setRngState(0);
    },
    { seatCount: 4, encounter: true },
  );
  try {
    const message = JSON.parse(cmdMsg({ type: "rollAndMove" })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, message.cmd, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["events"]);
    expect(engine.gameEvents).toContainEqual(
      expect.objectContaining({ kind: "encounterTriggered", encounterId: "屯粮居奇" }),
    );
    expect(replica.turnPhase).toBe("AwaitingDecision");
    expect(replica.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "prop-xianyang" });
    expect(replica.snapshot().lastLandOutcome).toEqual(engine.snapshot().lastLandOutcome);
    expect(replica.choicesFor()).toEqual(engine.choicesFor());
    const turn = replica.turnNumber;
    const next = JSON.parse(cmdMsg({ type: "buyProperty" })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, next.cmd, broadcast);
    await downlinkTurn();
    expect(replica.players[3]!.cash).toBe(200);
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    expect(replica.turnNumber).toBe(turn + 1);
    expect(replica.turnPhase).toBe(engine.turnPhase);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("招贤选择闭窗后,真实事件下行进入城池决策并继续回合", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) giveJinnang(authority, seat, []);
      armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 3 });
      const heroCity = authority.board.tiles.find(
        (tile) =>
          tile.event === "hero" && !authority.players.some((p) => p.capitalIndex === tile.index),
      )!;
      placePlayer(authority, 3, heroCity.index - 1);
      pinDice(authority, "march", [1]);
      authority.dice.setRngState(7);
    },
    { seatCount: 4 },
  );
  try {
    await registry.applyCommand(room.roomId, { type: "rollAndMove" }, broadcast);
    await downlinkTurn();
    expect(replica.turnPhase).toBe("AwaitingHeroPick");
    expect(replica.offeredHeroes).toHaveLength(3);
    messages.length = 0;
    const next = JSON.parse(cmdMsg({ type: "resolveHeroPick", index: 0 })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, next.cmd, broadcast);
    await downlinkTurn();
    expect(messages.map((message) => message.type)).toEqual(["events"]);
    expect(engine.turnPhase).toBe("AwaitingDecision");
    expect(replica.turnPhase).toBe(engine.turnPhase);
    expect(replica.decisionOwner).toBe(engine.decisionOwner);
    expect(replica.pendingLand).toEqual(engine.pendingLand);
    expect(replica.pendingCityEvent).toBe(false);
    expect(replica.offeredHeroes).toEqual([]);
    expect(replica.snapshot().lastLandOutcome).toEqual(engine.snapshot().lastLandOutcome);
    expect(replica.snapshot().players).toEqual(engine.snapshot().players);
    const turn = replica.turnNumber;
    await registry.applyCommand(room.roomId, { type: "endDecision" }, broadcast);
    await downlinkTurn();
    expect(replica.turnNumber).toBe(turn + 1);
    expect(replica.turnPhase).toBe(engine.turnPhase);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

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

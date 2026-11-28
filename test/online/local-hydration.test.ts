import { submitCapitalForSetup } from "./room-capitals";
import { RoomRegistry } from "@dafung/core/room/room";
import { createEngine, type RoomRecord } from "@dafung/core/room/room-record";
import { createClock } from "@sinonjs/fake-timers";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import {
  armHero,
  armPhase,
  giveJinnang,
  giveTreasureFromDeck,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
  setStamina,
} from "@dafung/core/engine/planter";
import type { GameCommand, GameEngine } from "@dafung/core/engine/authority";
import { foldEventBatch } from "@dafung/core/protocol/event-fold";
import {
  hydrateSeatReplica,
  readSeatReplica,
  seatReactionOf,
} from "@dafung/core/protocol/seat-replica";
import { PlayerCommandOutbox } from "@dafung/core/protocol/player-command-outbox";
import { seatDecisionPointOf } from "@dafung/core/room/player-submissions";
import { assembleDownlinkShot, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import {
  cmdMsg,
  dispatchInbound,
  type InboundMsg,
  type ServerMsg,
} from "@dafung/core/protocol/wire";
import { expect, it } from "bun:test";
import { MAP } from "../../scripts/engine-helpers";
import { LocalController } from "../../apps/client/src/app/controllers/local";
import { setEngine, useGameStore } from "../../apps/client/src/app/store/gameStore";
import { useNetStore } from "../../apps/client/src/app/store/netStore";

// 下行合并拍的宏任务屏障;只等已排定的 0ms flush,不等待演出或业务窗口。
const downlinkTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 日志尾段与对局状态、房间元数据分别验证。 */
const stateFrameTypes = (messages: readonly ServerMsg[]) =>
  messages.filter(({ type }) => type !== "gameLog").map(({ type }) => type);

it("单机选都水合后，错误选份收到提示并可在原窗重答", async () => {
  const initialSeats: number[] = [];
  const unsubscribe = useGameStore.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot && state.snapshot) initialSeats.push(state.viewSeat);
  });
  const controller = new LocalController(MAP, {
    seats: [
      { name: "诸侯1", isBot: false, guohao: "魏" },
      { name: "诸侯2", isBot: true },
    ],
    seed: 4, // bot 首回合打出横征暴敛，真人持识破诡计。
    mapId: "guanzhong",
    botStepMs: 0,
  });
  unsubscribe();
  try {
    expect(initialSeats).toEqual([0]);
    expect(controller.autoPilotOn).toBe(false);
    expect(useGameStore.getState().snapshot).toEqual(readSeatReplica(controller.engine, 0));
    const before = controller.engine.phase;
    const capital = controller.engine.offeredCapitals[0]!;
    controller.dispatchCommand({ type: "pickCapital", tileIndex: capital });
    expect(controller.engine.phase).toBe(before);
    await downlinkTurn();
    expect(controller.engine.phase).toBe("Playing");
    expect(controller.engine.players[0]!.capitalIndex).toBe(capital);
    expect(useGameStore.getState().snapshot).toEqual(readSeatReplica(controller.engine, 0));
    expect(controller.viewSeat).toBe(0);
    expect(useNetStore.getState().roomId).toBe("");

    const reaction = readSeatReplica(controller.engine, 0).reaction;
    expect(reaction).toMatchObject({
      cardId: "横征暴敛",
      targets: { kind: "seat", ids: [0], requiresSelection: true },
    });
    expect(useGameStore.getState().interactive).toBe(true);
    const respond = { type: "respondReaction", seat: 0, use: true, cardId: "识破诡计" } as const;
    controller.dispatchCommand({ ...respond, target: { kind: "city", id: 0 } });
    expect(useGameStore.getState().interactive).toBe(false);
    await downlinkTurn();
    expect(useGameStore.getState().hint).toContain("须指定合法的座位");
    expect(useGameStore.getState().interactive).toBe(true);
    expect(readSeatReplica(controller.engine, 0).reaction).toEqual(reaction);
    controller.dispatchCommand({ ...respond, target: { kind: "seat", id: 0 } });
    await downlinkTurn();
    expect(readSeatReplica(controller.engine, 0).reaction).toBeNull();
    expect(controller.engine.jinnangDiscard).toContain("识破诡计");
  } finally {
    controller.destroy();
    setEngine(null);
    useGameStore.getState().reset();
  }
});

async function playingRoom(beforeConnect?: (engine: GameEngine) => void, { seatCount = 2 } = {}) {
  const records = new Map<string, RoomRecord>();
  const clock = createClock();
  const registry = new RoomRegistry(
    {
      save: (record) => {
        records.set(record.roomId, structuredClone(record));
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
      clock: {
        now: () => clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: (id) => clock.clearTimeout(id as ReturnType<typeof clock.setTimeout>),
      },
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
    await submitCapitalForSetup(
      registry,
      room.roomId,
      engine.currentSetupPlayerIndex,
      engine.offeredCapitals.find(
        (index) => (index < 9 || index > 15) && engine.board.at(index).event !== "hero",
      )!,
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
      if (message.type === "snapshot") hydrateSeatReplica(replica, message);
      if (message.type === "events") foldEventBatch(replica, message.events);
    },
  });
  const broadcast = () => registry.transportBroadcast(room.roomId);
  broadcast();
  await downlinkTurn();
  messages.length = 0;
  const sendCommand = async (cmd: GameCommand, seat = 0) => {
    messages.length = 0;
    const outbox = new PlayerCommandOutbox();
    const frame = outbox.encode(cmd, room.roomId, seat, seatDecisionPointOf(room, seat));
    let rejectReason: string | null = null;
    const result = await dispatchInbound(
      frame,
      {
        cmd: (command) => registry.applyCommandFromSeat(room.roomId, seat, command, broadcast),
        submit: (submission) => registry.submitFromSeat(room.roomId, seat, submission, broadcast),

        setAutoPilot: (on) => registry.setAutoPilot(room.roomId, seat, on, broadcast),
      },
      {
        sendCommandResult: (raw) => {
          const receipt: ServerMsg = JSON.parse(raw);
          if (receipt.type === "submissionResult" && receipt.outcome === "rejected")
            rejectReason = receipt.reason;
        },
      },
    );
    await downlinkTurn();
    if (rejectReason !== null) return { ok: false, reason: "rejected", message: rejectReason };
    return result;
  };
  return {
    registry,
    room,
    token,
    engine,
    replica,
    messages,
    broadcast,
    sendCommand,
    records,
    clock,
  };
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
  async function submit(
    fields: { targets?: number[]; back?: boolean; cancel?: boolean } = {},
    accepted = true,
  ) {
    const cmd: GameCommand = { type: "useJinnang", cardId: "连环计", handIndex: 0, ...fields };
    expect((await sendCommand(cmd)).ok).toBe(accepted);
    expect(replica.pendingJinnang).toEqual(engine.pendingJinnang);
    expect(replica.players[0].jinnangHand).toEqual(engine.players[0].jinnangHand);
    expect(replica.turnPhase).toBe(engine.turnPhase);
    if (accepted && engine.turnPhase === "AwaitingJinnang") {
      expect(messages.map(({ type }) => type)).toEqual(["events"]);
    }
  }
  const candidates = () =>
    readSeatReplica(replica, 0).choices.flatMap((o) =>
      o.available && o.targetSeat != null ? [o.targetSeat] : [],
    );
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
    await submit({ targets: [2] }, false);
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

it("目标锦囊进入反应窗，经房间拒绝错误应答后可重答", async () => {
  const { registry, room, token, engine, replica, messages, sendCommand, records } =
    await playingRoom((authority) => {
      giveJinnang(authority, 0, ["缓兵之计"]);
      giveJinnang(authority, 1, ["识破诡计"]);
      armPhase(authority, { activeIndex: 0, turnPhase: "AwaitingJinnang" });
    });
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
    expect(seatReactionOf(replica)?.view).toMatchObject({
      kind: "jinnang",
      targets: { kind: "seat", ids: [1], requiresSelection: false },
      windowMs: 30_000,
    });
    const events = messages.flatMap((msg) => (msg.type === "events" ? msg.events : []));
    expect(events.map((ev) => ev.kind)).toEqual(["jinnangAnnounced", "reactionOpened"]);

    const respond = { type: "respondReaction", seat: 1, use: true, cardId: "识破诡计" } as const;
    const priorLog = records.get(room.roomId)!.snapshot!.log;
    const rejected = await sendCommand({ ...respond, target: { kind: "seat", id: 1 } }, 1);
    expect(rejected).toEqual({
      ok: false,
      reason: "rejected",
      message: "respondReaction:本次应答无需选择对象",
    });
    const persisted = records.get(room.roomId)!;
    expect(persisted.snapshot!.log).toEqual(priorLog);
    expect(persisted.submissions.entries.at(-1)).toMatchObject({
      seat: 1,
      result: { outcome: "rejected", reason: "respondReaction:本次应答无需选择对象" },
    });
    expect(messages).toEqual([]);
    expect(seatReactionOf(replica)?.answers).toEqual([]);

    expect(await sendCommand(respond, 1)).toEqual({ ok: true });
    expect(seatReactionOf(replica)).toBeNull();
    expect(replica.turnPhase).toBe("Roll");
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("落到咸阳，真实下行将交易交给城主并可续行下一回合", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) giveJinnang(authority, seat, []);
      armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 3 });
      placePlayer(authority, 3, 9);
      grantProperty(authority, 0, "prop-xianyang", 2);
      giveTreasureFromDeck(authority, 0, 3);
      pinDice(authority, "march", [6]);
    },
    { seatCount: 4 },
  );
  try {
    const message = JSON.parse(cmdMsg({ type: "rollAndMove" })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, message.cmd, broadcast);
    await downlinkTurn();
    expect(stateFrameTypes(messages)).toEqual(["events"]);
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
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
    expect(replica.turnPhase).toBe(engine.turnPhase);
    expect(replica.decisionOwner).toBe(engine.decisionOwner);
    expect(replica.snapshot().treasureVisitor).toBeNull();
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("落到无主城，副本同步购买选项和成交结果", async () => {
  const { registry, room, token, engine, replica, messages, broadcast } = await playingRoom(
    (authority) => {
      for (let seat = 0; seat < 4; seat++) giveJinnang(authority, seat, []);
      armPhase(authority, { phase: "Playing", turnPhase: "Roll", activeIndex: 3 });
      placePlayer(authority, 3, 9);
      setCash(authority, 3, authority.catalog.get("prop-xianyang")!.purchasePrice + 200);
      pinDice(authority, "march", [6]);
    },
    { seatCount: 4 },
  );
  try {
    const message = JSON.parse(cmdMsg({ type: "rollAndMove" })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, message.cmd, broadcast);
    await downlinkTurn();
    expect(stateFrameTypes(messages)).toEqual(["events"]);
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
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
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
    expect(replica.offeredHeroes).toEqual([]);
    const owner = assembleDownlinkShot(room, new Set([0, 3]), 3, [], true);
    const ownerView = JSON.parse(owner.snapshot) as Extract<ServerMsg, { type: "snapshot" }>;
    expect(ownerView.offeredHeroes).toEqual(engine.snapshot().offeredHeroes);
    expect(ownerView.offeredHeroes).toHaveLength(3);
    messages.length = 0;
    const next = JSON.parse(cmdMsg({ type: "resolveHeroPick", index: 0 })) as Extract<
      InboundMsg,
      { type: "cmd" }
    >;
    await registry.applyCommand(room.roomId, next.cmd, broadcast);
    await downlinkTurn();
    expect(stateFrameTypes(messages)).toEqual(["events"]);
    expect(engine.turnPhase).toBe("AwaitingDecision");
    expect(replica.turnPhase).toBe(engine.turnPhase);
    expect(replica.decisionOwner).toBe(engine.decisionOwner);
    expect(replica.pendingLand).toEqual(engine.pendingLand);
    expect(replica.pendingCityEvent).toBe(false);
    expect(replica.offeredHeroes).toEqual([]);
    expect(replica.snapshot().lastLandOutcome).toEqual(engine.snapshot().lastLandOutcome);
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
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
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
    pinDice(engine, "march", [1]);
    await registry.applyCommand(room.roomId, { type: "rollAndMove" }, broadcast);
    await downlinkTurn();
    expect(stateFrameTypes(messages)).toEqual(["events"]);
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
    expect(replica.turnPhase).toBe(engine.turnPhase);
    messages.length = 0;
    const turn = engine.turnNumber;
    await registry.applyCommand(room.roomId, { type: "endDecision" }, broadcast);
    await downlinkTurn();
    expect(replica.snapshot().players).toEqual(redactSnapshotForSeat(engine.snapshot(), 0).players);
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
    expect(stateFrameTypes(messages)).toEqual(["lobby"]);
    const message = messages[0]!;
    if (message.type !== "lobby") throw new Error("缺少托管元数据消息");
    expect(message.seats[seat]!.autoPilot).toBe(true);
    messages.length = 0;
    await registry.setAutoPilot(room.roomId, seat, false, broadcast);
    await downlinkTurn();
    expect(stateFrameTypes(messages)).toEqual(["lobby"]);
    const returned = messages[0]!;
    if (returned.type !== "lobby") throw new Error("缺少收回托管元数据消息");
    expect(returned.seats[seat]!.autoPilot).toBe(false);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

it("袭扰归零后放逐、行殇先后下行，副本继续原出牌者回合", async () => {
  const { registry, room, token, engine, replica, messages, broadcast, sendCommand, clock } =
    await playingRoom((authority) => {
      armPhase(authority, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
      placePlayer(authority, 0, 1);
      placePlayer(authority, 1, 2);
      giveJinnang(authority, 0, ["袭扰", "识破诡计"]);
      giveJinnang(authority, 1, []);
      setStamina(authority, 1, 60);
      armHero(authority, 1, "caopi", ["fangzhu"]);
      armHero(authority, 0, "caopi", ["xingshang"]);
      setStamina(authority, 1, 5);
      grantProperty(authority, 1, "prop-xianyang", 2);
      setDefense(authority, 1, "prop-xianyang", 2);
    });
  try {
    await sendCommand({ type: "useJinnang", cardId: "袭扰" });
    await sendCommand({ type: "useJinnang", cardId: "袭扰", targets: [1] });
    expect(replica.turnPhase).toBe("AwaitingSkillChoice");
    expect(replica.pendingSkillChoices).toEqual(engine.pendingSkillChoices);
    expect(replica.pendingSkillChoices.map((choice) => choice.skillId)).toEqual(["fangzhu"]);
    expect(messages[0]?.type).toBe("events");

    const firstOwner = replica.decisionOwner;
    const onlineSeats = new Set([0, 1]);
    const reconnect = assembleDownlinkShot(room, onlineSeats, 1, [], true);
    const rejoined = JSON.parse(reconnect.snapshot) as Extract<ServerMsg, { type: "snapshot" }>;
    expect(rejoined.turnPhase).toBe("AwaitingSkillChoice");
    expect(rejoined.decisionOwner).toBe(1);
    expect(rejoined.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 1 });
    await registry.applyCommand(
      room.roomId,
      { type: "respondSkillChoice", seat: firstOwner, use: false },
      broadcast,
    );
    await downlinkTurn();
    expect(replica.pendingSkillChoices).toEqual(engine.pendingSkillChoices);
    expect(replica.pendingSkillChoices.map((choice) => choice.skillId)).toEqual(["xingshang"]);
    expect(replica.decisionOwner).toBe(0);
    expect(replica.players[1]).toMatchObject({ stamina: 0, skipTurns: 2, resting: true });
    expect(replica.players[1].properties).toContainEqual(
      expect.objectContaining({ propertyId: "prop-xianyang", level: 1 }),
    );

    await sendCommand({ type: "respondSkillChoice", seat: 0, use: false });
    expect(replica.pendingSkillChoices).toEqual([]);
    expect([replica.activeIndex, replica.turnPhase]).toEqual([0, "Roll"]);
    const beforeMarch = replica.players[0]!.position;
    pinDice(engine, "march", [1]);
    await clock.tickAsync(AUTO_ROLL_DELAY_MS);
    await downlinkTurn();
    expect(replica.players[0]!.position).not.toBe(beforeMarch);
    expect(replica.turnPhase).toBe(engine.turnPhase);
  } finally {
    registry.dismissRoom(room.roomId, token);
  }
});

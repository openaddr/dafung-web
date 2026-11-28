import { expect, it } from "bun:test";
import {
  giveJinnang,
  grantProperty,
  pinDice,
  placePlayer,
  setJinnangPiles,
} from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import {
  cmdMsg,
  submissionMsg,
  type EventBatchMsg,
  type PlayerSubmission,
  type ServerMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

it("按张提交无目标锦囊与结束出牌，两席按权威事件观察行军和途经补给", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    giveJinnang(engine, 0, ["横征暴敛", "识破诡计", "横征暴敛"]);
    setJinnangPiles(engine, ["求贤令", "缓兵之计"], []);
    placePlayer(engine, 0, 13);
    grantProperty(engine, 0, "prop-jieting", 1);
    grantProperty(engine, 0, "prop-xianyang", 1);
    pinDice(engine, "march", [3]);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const actorWire = await room.socket(0);
    const peerWire = await room.socket(1);
    await actor.connect(actorWire);
    await peer.connect(peerWire);
    const firstPoint = actor.view.decisionPoint!;
    const cash = actor.view.snapshot.players.map((player) => player.cash);
    expect(actor.view.decisionOptions).toMatchObject({
      kind: "playJinnang",
      choices: [
        { id: "横征暴敛", handIndex: 0, available: true },
        { id: "识破诡计", handIndex: 1, available: false, reason: "唯反应(反应窗打出)" },
        { id: "横征暴敛", handIndex: 2, available: true },
        { id: "pass", available: true },
      ],
    });
    expect(peer.view.decisionOptions).toBeUndefined();
    const forged: PlayerSubmission = {
      roomId: room.id,
      seat: 1,
      submissionId: "越席出牌",
      decisionPoint: firstPoint,
      cmd: { type: "useJinnang", cardId: "横征暴敛", handIndex: 2 },
    };
    peerWire.sendRaw(submissionMsg(forged));
    expect(await peer.readUntil(isReceipt, "越席拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    expect(actor.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
    expect(actor.view.jinnang).toMatchObject({ selectedHandIndex: 2, confirmAction: "playCard" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReceipt, "出牌回执")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    for (const player of [actor, peer]) {
      const batch = await player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" &&
          message.events.some((event) => event.kind === "jinnangAnnounced"),
        "出牌事件",
      );
      expect(batch.decisionOptions).toEqual(player.view.decisionOptions);
      expect(player.view.snapshot.players.map((seat) => seat.cash)).toEqual([
        cash[0] + 400,
        cash[1] - 200,
        cash[2] - 200,
      ]);
    }
    expect(actor.view.snapshot.players[0].jinnangHand).toEqual(["横征暴敛", "识破诡计"]);
    expect(peer.view.snapshot.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
    const nextPoint = actor.view.decisionPoint;
    expect(nextPoint).not.toBe(firstPoint);
    expect(actor.view.jinnang?.canPass).toBe(true);
    actorWire.sendRaw(submissionMsg({ ...forged, seat: 0, submissionId: "旧出牌步骤" }));
    expect(await actor.readUntil(isReceipt, "过期拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(actor.view.decisionPoint).toBe(nextPoint);
    expect(actor.act({ type: "pass" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReceipt, "结束出牌回执")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    for (const player of [actor, peer]) {
      await player.readUntil(
        (message) =>
          message.type === "events" &&
          message.events.some(
            (event) => event.kind === "jinnangPhaseResumed" && event.turnPhase === "Roll",
          ),
        "结束出牌事件",
      );
      expect(player.view.decisionPoint).toBeNull();
    }
    actorWire.sendRaw(cmdMsg({ type: "rollAndMove" }, 100));
    expect(
      await actor.readUntil((message) => message.type === "error", "裸掷骰拒绝"),
    ).toMatchObject({
      requestId: 100,
      error: "行军由房间自动起摇",
    });
    expect(actor.view.snapshot.players[0].position).toBe(13);

    await room.advance(AUTO_ROLL_DELAY_MS);
    for (const player of [actor, peer]) {
      const batch = await player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" &&
          message.events.some((event) => event.kind === "marchArrived"),
        "行军到达事件",
      );
      expect(batch.events).toContainEqual(
        expect.objectContaining({ kind: "diceRolled", seat: 0, die: 3 }),
      );
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          kind: "marchArrived",
          seat: 0,
          tileIndex: 16,
          path: expect.objectContaining({ traversed: [14, 15, 16] }),
        }),
      );
      const supply = batch.events.filter((event) => event.kind === "jinnangDrawn");
      expect(supply).toMatchObject([
        { reason: "cityPassed", seat: 0, tileIndex: 14, count: 1 },
        { reason: "cityPassed", seat: 0, tileIndex: 15, count: 1 },
      ]);
      expect(supply.map((event) => event.cardIds)).toEqual(
        player === actor ? [["缓兵之计"], ["求贤令"]] : [undefined, undefined],
      );
      expect(player.view.snapshot.players[0].position).toBe(16);
      expect(player.view.snapshot.turnPhase).toBe("AwaitingDecision");
    }
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

it("最后一张可出牌结算后失联，恢复原回执并由房间继续起摇", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    giveJinnang(engine, 0, ["横征暴敛", "识破诡计"]);
    placePlayer(engine, 0, 13);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const actorWire = await room.socket(0);
    const peerWire = await room.socket(1);
    await actor.connect(actorWire);
    await peer.connect(peerWire);
    const dropped = room.dropNextReceipt();
    actor.act({ type: "selectCard", handIndex: 0 });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    const receipt = await dropped;
    expect(receipt.outcome).toBe("accepted");
    await Promise.all([actorWire.waitClosed(1000), peerWire.waitClosed(1000)]);

    room.restart();
    await actor.connect(await room.socket(0));
    await peer.connect(await room.socket(1));
    expect(await actor.readUntil(isReceipt, "原回执")).toEqual(receipt);
    expect(actor.view.snapshot.turnPhase).toBe("Roll");
    expect(actor.view.decisionPoint).toBeNull();
    expect(actor.view.snapshot.players[0].jinnangHand).toEqual(["识破诡计"]);
    expect(peer.view.snapshot.players[0].jinnangHandCount).toBe(1);
    expect(peer.view.snapshot.jinnangDiscard).toEqual(["横征暴敛"]);

    await room.advance(AUTO_ROLL_DELAY_MS + 2);
    for (const player of [actor, peer]) {
      await player.readUntil(
        (message) =>
          message.type === "events" &&
          message.events.some((event) => event.kind === "diceRolled" && event.seat === 0),
        "恢复后的自动起摇",
        500,
      );
      expect(player.view.snapshot.players[0].position).not.toBe(13);
    }
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

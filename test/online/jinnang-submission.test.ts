import { expect, it } from "bun:test";
import { giveJinnang, grantProperty, setDefense } from "@dafung/core/engine/planter";
import {
  cmdMsg,
  type EventBatchMsg,
  type ServerMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

async function submitTargetStep(player: HeadlessPlayer, action: "confirm" | "cancel") {
  const originalPoint = player.view.decisionPoint;
  expect(player.act({ type: action })).toEqual({ status: "submitted" });
  let accepted = false;
  let stepChanged = false;
  await player.readUntil((message) => {
    if (isReceipt(message)) {
      expect(message.outcome).toBe("accepted");
      accepted = true;
    }
    if (
      (message.type === "events" || message.type === "snapshot") &&
      message.decisionPoint !== originalPoint &&
      message.decisionOptions?.kind === "playJinnang" &&
      (message.decisionOptions.pendingJinnang !== null) === (action === "confirm")
    )
      stepChanged = true;
    return accepted && stepChanged;
  }, "座位锦囊回执和下一步选项");
}

it("按牌位提交军情密探，取消或拒绝保留手牌，只有窥探当次向出牌座位交付牌面", async () => {
  const hand = ["军情密探", "缓兵之计", "军情密探"];
  const hiddenHand = ["求贤令", "窃玉偷香"];
  const room = await openHeadlessTestRoom(hiddenHand, (engine) => giveJinnang(engine, 0, hand));
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 2);
  try {
    let actorWire = await room.socket(0);
    const peerWire = await room.socket(2);
    await actor.connect(actorWire);
    await peer.connect(peerWire);
    const card = { type: "useJinnang", cardId: "军情密探", handIndex: 2 } as const;
    actorWire.sendRaw(cmdMsg(card, 100));
    expect(
      await actor.readUntil(
        (message) => message.type === "error" || message.type === "commandResult",
        "裸锦囊命令的结果",
      ),
    ).toMatchObject({
      type: "error",
      requestId: 100,
      error: "请携带原决策点和提交编号提交此操作",
    });

    expect(actor.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
    await submitTargetStep(actor, "confirm");
    const point = actor.view.decisionPoint!;
    expect(actor.view.jinnang).toMatchObject({
      stage: "one",
      selectedHandIndex: 2,
      targets: {
        domain: "seat",
        candidates: [
          { id: 0, available: false, reason: "不能指定自己" },
          { id: 1, available: true },
          { id: 2, available: true },
        ],
      },
    });
    expect(actor.act({ type: "toggleTarget", id: 0 })).toEqual({
      status: "unavailable",
      reason: "蜀 · 不能指定自己",
    });
    expect(actor.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
    actorWire = await room.socket(0);
    await actor.connect(actorWire);
    expect(actor.view.decisionPoint).toBe(point);
    expect(actor.view.jinnang).toMatchObject({
      selectedHandIndex: 2,
      canConfirm: false,
      targets: { selected: [] },
    });
    expect(actor.view.snapshot.players[1]).toMatchObject({
      jinnangHand: [],
      jinnangHandCount: 2,
    });
    actorWire.sendSubmission({
      roomId: room.id,
      seat: 0,
      submissionId: "指定自己",
      decisionPoint: point,
      cmd: { ...card, targets: [0] },
    });
    expect(await actor.readUntil(isReceipt, "非法诸侯回执")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
      reason: "所选目标不可用",
    });
    expect(actor.view.decisionPoint).toBe(point);
    await submitTargetStep(actor, "cancel");
    expect(actor.view.snapshot.players[0].jinnangHand).toEqual(hand);

    expect(actor.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
    await submitTargetStep(actor, "confirm");
    actorWire.sendSubmission({
      roomId: room.id,
      seat: 0,
      submissionId: "迟到的密探",
      decisionPoint: point,
      cmd: { ...card, targets: [1] },
    });
    expect(await actor.readUntil(isReceipt, "迟到提交回执")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(actor.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReceipt, "出牌回执")).toMatchObject({
      outcome: "accepted",
    });
    for (const player of [actor, peer]) {
      const batch = await player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" && message.events.some((event) => event.kind === "peekApplied"),
        "窥探生效事件",
      );
      expect(batch.events.find((event) => event.kind === "peekApplied")).toMatchObject({
        viewerSeat: 0,
        targetSeat: 1,
        hand: player === actor ? hiddenHand : [],
      });
    }
    expect(
      peerWire.frames
        .filter((message) => message.type === "events" || message.type === "snapshot")
        .every((message) => message.decisionOptions === undefined),
    ).toBe(true);
    expect(peer.view.snapshot.pendingJinnang).toBeNull();
    expect(peer.view.snapshot.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
    expect(actor.view.snapshot.players[0].jinnangHand).toEqual(["军情密探", "缓兵之计"]);
    const rejoined = await room.socket(0);
    await actor.connect(rejoined);
    expect(
      rejoined.snapshot?.events.flatMap((event) =>
        event.kind === "peekApplied" ? event.hand : [],
      ),
    ).toEqual([]);
    expect(rejoined.snapshot?.players[1]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

it("在真实房间确认火源城格，两席观察相邻两座有主城各受击一次", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    giveJinnang(engine, 0, ["火烧连营"]);
    grantProperty(engine, 0, "prop-jieting", 2);
    setDefense(engine, 0, "prop-jieting", 12);
    grantProperty(engine, 1, "prop-xianyang", 2);
    setDefense(engine, 1, "prop-xianyang", 13);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    await actor.connect(await room.socket(0));
    await peer.connect(await room.socket(1));
    expect(actor.act({ type: "selectCard", handIndex: 0 })).toEqual({ status: "draft" });
    await submitTargetStep(actor, "confirm");
    expect(actor.view.jinnang?.targets).toMatchObject({
      domain: "city",
      min: 1,
      max: 1,
      available: expect.arrayContaining([
        expect.objectContaining({ id: 13, label: "汉中(无主,作火源自身免伤)" }),
      ]),
    });
    expect(actor.act({ type: "toggleTarget", id: 13 })).toEqual({ status: "draft" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReceipt, "火烧连营出牌回执")).toMatchObject({
      outcome: "accepted",
    });
    for (const player of [actor, peer]) {
      const batch = await player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" &&
          message.events.some((event) => event.kind === "fireWallImpact"),
        "火烧连营生效事件",
      );
      expect(batch.events.filter((event) => event.kind === "propertyDamaged")).toMatchObject([
        { seat: 0, propertyId: "prop-jieting", defense: 4, origin: "fireWall" },
        { seat: 1, propertyId: "prop-xianyang", defense: 5, origin: "fireWall" },
      ]);
      expect(player.view.snapshot.jinnangDiscard).toEqual(["火烧连营"]);
      expect(player.view.snapshot.players[0].jinnangHandCount).toBe(0);
    }
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

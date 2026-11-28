import { afterEach, expect, it } from "bun:test";
import { giveJinnang, grantProperty, pinDice, placePlayer } from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import { submissionMsg, type EventBatchMsg, type ServerMsg } from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const openRooms: Awaited<ReturnType<typeof openHeadlessTestRoom>>[] = [];
afterEach(async () => {
  for (const room of openRooms.splice(0)) await room.close();
});

function eventFrame(kind: EventBatchMsg["events"][number]["kind"]) {
  return (message: ServerMsg): message is EventBatchMsg =>
    message.type === "events" && message.events.some((event) => event.kind === kind);
}

function answerFrame(seat: number) {
  return (message: ServerMsg): message is EventBatchMsg =>
    message.type === "events" &&
    message.events.some((event) => event.kind === "reactionAnswered" && event.seat === seat);
}

async function playLevy(player: HeadlessPlayer, ...others: HeadlessPlayer[]) {
  expect(player.act({ type: "selectCard", handIndex: 0 })).toEqual({ status: "draft" });
  expect(player.act({ type: "confirm" })).toEqual({ status: "submitted" });
  await Promise.all(
    [player, ...others].map((peer) => peer.readUntil(eventFrame("reactionOpened"), "横征暴敛开窗")),
  );
}

it("按份识破及反识破保留选中牌的位置，同份依座次扣牌，重复应答只取原回执", async () => {
  const twoCounters = ["识破诡计", "火烧连营", "识破诡计"];
  const room = await openHeadlessTestRoom(twoCounters, (game) => {
    giveJinnang(game, 0, ["横征暴敛", ...twoCounters]);
    giveJinnang(game, 2, twoCounters);
  });
  openRooms.push(room);
  const shu = new HeadlessPlayer(room.id, 0);
  const wu = new HeadlessPlayer(room.id, 1);
  const wei = new HeadlessPlayer(room.id, 2);
  const weiWire = await room.socket(2);
  await Promise.all([
    shu.connect(await room.socket(0)),
    wu.connect(await room.socket(1)),
    wei.connect(weiWire),
  ]);

  await playLevy(shu, wu, wei);
  expect(shu.view.reaction).toMatchObject({ playable: [], shares: null, canRespond: false });
  expect(shu.view.decisionOptions).toBeUndefined();
  expect(wu.view.reaction).toMatchObject({
    playable: [
      { cardId: "识破诡计", handIndex: 0 },
      { cardId: "识破诡计", handIndex: 2 },
    ],
    shares: {
      domain: "seat",
      candidates: [
        { id: 1, label: "吴" },
        { id: 2, label: "魏" },
      ],
    },
  });
  const cash = wu.view.snapshot.players.map((player) => player.cash);
  const submission = {
    roomId: room.id,
    seat: 2,
    submissionId: "魏先交右侧识破",
    decisionPoint: wei.view.decisionPoint!,
    cmd: {
      type: "respondReaction",
      seat: 2,
      use: true,
      cardId: "识破诡计",
      handIndex: 2,
      target: { kind: "seat", id: 1 },
    },
  } as const;
  const receiptFor = (id: string) => (message: ServerMsg) =>
    message.type === "submissionResult" && message.submissionId === id;
  weiWire.sendRaw(
    submissionMsg({
      ...submission,
      submissionId: "错位置",
      cmd: { ...submission.cmd, handIndex: 1 },
    }),
  );
  expect(await wei.readUntil(receiptFor("错位置"), "非法手牌位置回执")).toMatchObject({
    outcome: "rejected",
    reasonCode: "invalidCandidate",
  });
  expect(wei.view.decisionPoint).toBe(submission.decisionPoint);
  const firstPlay = submissionMsg(submission);
  weiWire.sendRaw(firstPlay);
  const firstReceipt = await wei.readUntil(receiptFor(submission.submissionId), "魏的首次回执");
  expect(firstReceipt).toMatchObject({ outcome: "accepted" });
  const otherAnswer = await wu.readUntil(answerFrame(2), "吴收到魏的应答进度");
  expect(otherAnswer.events.find((event) => event.kind === "reactionAnswered")).not.toHaveProperty(
    "handIndex",
  );
  expect(wei.view.snapshot.pendingReaction?.answers).toMatchObject([
    { seat: 2, use: true, handIndex: 2, target: { kind: "seat", id: 1 } },
  ]);
  expect(wei.view.snapshot.players[2].jinnangHand).toEqual(twoCounters);

  await wu.connect(await room.socket(1));
  expect(wu.view.snapshot.pendingReaction?.answers).toEqual([
    { seat: 2, use: true, cardId: "识破诡计" },
  ]);
  expect(wu.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
  expect(wu.view.reaction).toMatchObject({ selectedCard: { handIndex: 2 }, canConfirm: false });
  expect(wu.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
  expect(wu.view.reaction).toMatchObject({ targets: { selected: [1] }, canConfirm: true });
  expect(wu.view.snapshot.players[1].jinnangHand).toEqual(twoCounters);
  expect(wu.act({ type: "confirm" })).toEqual({ status: "submitted" });
  const [publicClose, ownClose] = await Promise.all([
    shu.readUntil(answerFrame(1), "蜀收到吴的应答与反识破"),
    wu.readUntil(answerFrame(1), "吴收窗并扣右侧牌"),
    wei.readUntil(answerFrame(1), "魏收窗并保留牌序"),
  ]);
  expect(publicClose.events.find((event) => event.kind === "reactionAnswered")).toMatchObject({
    spentCards: [{ seat: 1, cardId: "识破诡计" }],
  });
  expect(publicClose.events.find((event) => event.kind === "reactionAnswered")).not.toHaveProperty(
    "handIndex",
  );
  expect(JSON.stringify(publicClose.events)).not.toContain("handIndex");
  expect(ownClose.events.find((event) => event.kind === "reactionAnswered")).toMatchObject({
    handIndex: 2,
    spentCards: [{ seat: 1, cardId: "识破诡计", handIndex: 2 }],
  });

  expect(wu.view.snapshot.players[1].jinnangHand).toEqual(["识破诡计", "火烧连营"]);
  expect(shu.view.snapshot.players[1]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
  expect(wei.view.snapshot.players[2].jinnangHand).toEqual(twoCounters);
  weiWire.sendRaw(firstPlay);
  expect(await wei.readUntil(receiptFor(submission.submissionId), "原应答的重发回执")).toEqual(
    firstReceipt,
  );
  expect(wei.view.reaction).toMatchObject({ canRespond: true, answered: false });

  expect(shu.view.reaction).toMatchObject({ shares: null, canRespond: true });
  expect(shu.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
  expect(shu.act({ type: "confirm" })).toEqual({ status: "submitted" });
  await wei.readUntil(answerFrame(0), "蜀反识破，魏尚待应答");
  expect(wei.act({ type: "pass" })).toEqual({ status: "submitted" });
  await Promise.all([shu, wu, wei].map((peer) => peer.readUntil(answerFrame(2), "反识破续窗")));
  expect(shu.view.snapshot.players[0].jinnangHand).toEqual(["识破诡计", "火烧连营"]);
  expect(wu.act({ type: "pass" })).toEqual({ status: "submitted" });
  await wei.readUntil(answerFrame(1), "续窗吴已不出");
  expect(wei.act({ type: "pass" })).toEqual({ status: "submitted" });
  await wu.readUntil(eventFrame("jinnangRestored"), "反识破恢复受争夺的一份");
  expect(wu.view.snapshot.players.map((player) => player.cash)).toEqual([
    cash[0] + 400,
    cash[1] - 200,
    cash[2] - 200,
  ]);
});

it("拦检沿用按张应答，拼点获胜时行人停在拦检城", async () => {
  const room = await openHeadlessTestRoom(["半路杀出", "火烧连营", "半路杀出"], (game) => {
    placePlayer(game, 0, 13);
    grantProperty(game, 1, "prop-xianyang", 2);
    pinDice(game, "march", [3]);
  });
  openRooms.push(room);
  const shu = new HeadlessPlayer(room.id, 0);
  const wu = new HeadlessPlayer(room.id, 1);
  await Promise.all([shu, wu].map(async (peer) => peer.connect(await room.socket(peer.seat))));

  expect(shu.act({ type: "pass" })).toEqual({ status: "submitted" });
  await shu.readUntil(eventFrame("jinnangPhaseResumed"), "蜀结束出牌");
  await room.advance(AUTO_ROLL_DELAY_MS);
  await wu.readUntil(eventFrame("reactionOpened"), "吴收到咸阳拦检窗");
  expect(wu.view.reaction).toMatchObject({ kind: "march", shares: null, canRespond: true });
  expect(wu.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
  expect(wu.act({ type: "confirm" })).toEqual({ status: "submitted" });
  await Promise.all(
    [shu, wu].map((peer) => peer.readUntil(eventFrame("marchArrived"), "蜀止步咸阳")),
  );
  expect(wu.view.snapshot.players[1].jinnangHand).toEqual(["半路杀出", "火烧连营"]);
  expect(shu.view.snapshot.players[0].position).toBe(15);
});

it("本回合不再询问只为本席逐窗提交普通不出，下一回合恢复询问", async () => {
  const room = await openHeadlessTestRoom(["横征暴敛", "识破诡计"], (game) => {
    giveJinnang(game, 0, ["横征暴敛", "横征暴敛"]);
    giveJinnang(game, 2, ["识破诡计"]);
    placePlayer(game, 0, 13);
    pinDice(game, "march", [1]);
  });
  openRooms.push(room);
  const shu = new HeadlessPlayer(room.id, 0);
  const wu = new HeadlessPlayer(room.id, 1);
  const wei = new HeadlessPlayer(room.id, 2);
  const weiWire = await room.socket(2);
  await Promise.all([
    shu.connect(await room.socket(0)),
    wu.connect(await room.socket(1)),
    wei.connect(weiWire),
  ]);
  const receipt = (message: ServerMsg) => message.type === "submissionResult";

  await playLevy(shu, wu, wei);
  expect(wei.act({ type: "muteReactions" })).toEqual({ status: "submitted" });
  const [first, firstReceipt] = await Promise.all([
    wu.readUntil(answerFrame(2), "魏以不用应答首窗"),
    wei.readUntil(receipt, "首窗普通不出回执"),
  ]);
  expect(first.events.find((event) => event.kind === "reactionAnswered")).toMatchObject({
    seat: 2,
    use: false,
  });
  expect(wu.act({ type: "pass" })).toEqual({ status: "submitted" });
  await shu.readUntil(answerFrame(1), "蜀恢复出牌");

  await playLevy(shu, wu, wei);
  const [second, secondReceipt] = await Promise.all([
    wu.readUntil(answerFrame(2), "魏自动以不用应答续窗"),
    wei.readUntil(receipt, "后续窗普通不出回执"),
  ]);
  expect(second.events.filter((event) => event.kind === "reactionAnswered")).toMatchObject([
    { seat: 2, use: false },
  ]);
  expect(wu.view.reaction).toMatchObject({ canRespond: true, muted: false });
  expect(wei.view.snapshot.players[2].jinnangHand).toEqual(["识破诡计"]);
  expect(wu.act({ type: "pass" })).toEqual({ status: "submitted" });
  await Promise.all(
    [shu, wei].map((peer) => peer.readUntil(answerFrame(1), "两席应答结束，蜀起摇")),
  );
  expect(firstReceipt).toMatchObject({ outcome: "accepted" });
  expect(secondReceipt).toMatchObject({ outcome: "accepted" });
  expect(weiWire.frames.filter(receipt)).toEqual([firstReceipt, secondReceipt]);
  await room.advance(AUTO_ROLL_DELAY_MS);
  await shu.readUntil(eventFrame("marchArrived"), "蜀行军到达街亭");
  expect(shu.act({ type: "chooseLand", command: "endDecision" })).toEqual({ status: "submitted" });
  await wu.readUntil(eventFrame("turnStarted"), "轮到吴行动");

  await playLevy(wu, shu, wei);
  expect(wei.view.reaction).toMatchObject({ canRespond: true, muted: false });
  expect(wei.act({ type: "pass" })).toEqual({ status: "submitted" });
  await wu.readUntil(answerFrame(2), "魏自行应答新回合窗口");
});

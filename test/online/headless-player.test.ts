import { afterEach, expect, it } from "bun:test";
import type { SeatIntent } from "@dafung/core/protocol/seat-interaction";
import {
  submissionMsg,
  type ServerMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const openRooms: Awaited<ReturnType<typeof openHeadlessTestRoom>>[] = [];
afterEach(async () => {
  for (const room of openRooms.splice(0)) await room.close();
});

async function seatPlayers(guestHand: string[] = []) {
  const room = await openHeadlessTestRoom(guestHand);
  openRooms.push(room);
  const shu = new HeadlessPlayer(room.id, 0);
  const wu = new HeadlessPlayer(room.id, 1);
  const shuWire = await room.socket(0);
  const wuWire = await room.socket(1);
  await shu.connect(shuWire);
  await wu.connect(wuWire);
  return { room, shu, wu, shuWire, wuWire };
}

const receipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

function expectPrivateStep(shu: HeadlessPlayer, wu: HeadlessPlayer) {
  expect(shu.view.snapshot.players[0].jinnangHand).toEqual(["连环计", "火烧连营", "连环计"]);
  expect(wu.view.snapshot.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 3 });
  expect(wu.view.snapshot.pendingJinnang).toBeNull();
  expect(wu.view.snapshot.choices).toEqual([]);
  expect(wu.view.decisionPoint).toBeNull();
  expect(wu.view.jinnang).toBeNull();
}

/** 回执和局面帧各自保序，两者都到达后，才读下一步的操作机会。 */
async function waitForStep(
  shu: HeadlessPlayer,
  intent: SeatIntent,
  next: "two-a" | "two-b" | "reaction",
) {
  expect(shu.act(intent)).toEqual({ status: "submitted" });
  let accepted = false;
  let stepChanged = false;
  await shu.readUntil((message) => {
    if (receipt(message)) {
      expect(message.outcome).toBe("accepted");
      accepted = true;
    }
    if (
      message.type === "events" &&
      message.events.some((event) => event.kind === "jinnangTargetStepChanged")
    ) {
      stepChanged = true;
    }
    const view = shu.view;
    return (
      accepted &&
      (next === "reaction" ? view.reaction !== null : stepChanged && view.jinnang?.stage === next)
    );
  }, "蜀的回执和下一步");
}

async function submitStep(
  shu: HeadlessPlayer,
  wu: HeadlessPlayer,
  intent: SeatIntent,
  next: "two-a" | "two-b",
) {
  await waitForStep(shu, intent, next);
  expectPrivateStep(shu, wu);
}

it("右边的连环计从草选、重连、返回改选到拒绝迟到及非法指令，落盘失联后只结算一次", async () => {
  const { room, shu, wu, wuWire } = await seatPlayers();
  expect(shu.view.jinnang!.options.map((option) => [option.handIndex, option.id])).toEqual([
    [0, "连环计"],
    [1, "火烧连营"],
    [2, "连环计"],
  ]);
  expect(shu.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
  expect(shu.view.jinnang).toMatchObject({ selectedHandIndex: 2, canConfirm: true });
  expectPrivateStep(shu, wu);
  await submitStep(shu, wu, { type: "confirm" }, "two-a");
  expect(shu.view.jinnang!.targets!.available.map((option) => option.id)).toEqual([1, 2]);
  expect(shu.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
  expect(shu.view.jinnang!.targets!.selected).toEqual([1]);
  expectPrivateStep(shu, wu);
  await shu.connect(await room.socket(0));
  expect(shu.view.jinnang).toMatchObject({
    stage: "two-a",
    selectedHandIndex: 2,
    canConfirm: false,
    targets: { selected: [] },
  });
  expectPrivateStep(shu, wu);
  shu.act({ type: "toggleTarget", id: 1 });
  await submitStep(shu, wu, { type: "confirm" }, "two-b");
  const oldPoint = shu.view.decisionPoint!;
  const late = submissionMsg({
    roomId: room.id,
    seat: 0,
    submissionId: "旧第二步",
    decisionPoint: oldPoint,
    cmd: { type: "useJinnang", cardId: "连环计", handIndex: 2, targets: [2] },
  });
  shu.act({ type: "toggleTarget", id: 2 });
  expect(shu.view.jinnang!.targets!.selected).toEqual([2]);
  const wire = await room.socket(0);
  await shu.connect(wire);
  expect(shu.view.decisionPoint).toBe(oldPoint);
  expect(shu.view.jinnang).toMatchObject({
    stage: "two-b",
    selectedHandIndex: 2,
    canBack: true,
    targets: { firstSeat: { id: 1, label: "吴" }, selected: [] },
  });
  expectPrivateStep(shu, wu);
  await submitStep(shu, wu, { type: "back" }, "two-a");
  expect(shu.view.jinnang).toMatchObject({ selectedHandIndex: 2, targets: { selected: [1] } });
  shu.act({ type: "toggleTarget", id: 2 });
  expect(shu.view.jinnang!.targets!.selected).toEqual([2]);
  await submitStep(shu, wu, { type: "confirm" }, "two-b");
  expect(shu.view.jinnang!.targets!.firstSeat).toEqual({ id: 2, label: "魏" });
  await submitStep(shu, wu, { type: "back" }, "two-a");
  expect(shu.view.jinnang!.targets!.selected).toEqual([2]);
  shu.act({ type: "toggleTarget", id: 1 });
  await submitStep(shu, wu, { type: "confirm" }, "two-b");
  const point = shu.view.decisionPoint!;
  expect(point).not.toBe(oldPoint);
  const illegal = submissionMsg({
    roomId: room.id,
    seat: 0,
    submissionId: "同一目标",
    decisionPoint: point,
    cmd: { type: "useJinnang", cardId: "连环计", handIndex: 2, targets: [1] },
  });
  expect(shu.act({ type: "toggleTarget", id: 1 })).toMatchObject({
    status: "unavailable",
    reason: expect.stringContaining("已指定"),
  });
  async function expectRejected(frame: string, reason: string) {
    wire.sendRaw(frame);
    const rejected = await shu.readUntil(receipt, "原座拒绝回执");
    expect(rejected).toMatchObject({
      outcome: "rejected",
      reason: expect.stringContaining(reason),
    });
    expect(shu.view.decisionPoint).toBe(point);
    expect(shu.view.jinnang!.targets!.available.map((option) => option.id)).toEqual([2]);
    expect(shu.view.jinnang).toMatchObject({ stage: "two-b", selectedHandIndex: 2, canBack: true });
    expectPrivateStep(shu, wu);
    return rejected;
  }
  await expectRejected(late, "原决策点已结束");
  const rejected = await expectRejected(illegal, "所选目标不可用");

  const [shuCash, wuCash, weiCash] = shu.view.snapshot.players.map((player) => player.cash);
  const lostReceipt = room.dropNextReceipt();
  shu.act({ type: "toggleTarget", id: 2 });
  expect(shu.act({ type: "confirm" })).toEqual({ status: "submitted" });
  const saved = await lostReceipt;
  expect(saved.outcome).toBe("accepted");
  await Promise.all([wire.waitClosed(2000), wuWire.waitClosed(2000)]);
  expect(wire.frames.some((m) => receipt(m) && m.submissionId === saved.submissionId)).toBe(false);
  room.restart();
  const restored = await room.socket(0);
  await shu.connect(restored);
  await wu.connect(await room.socket(1));
  expect(await shu.readUntil(receipt, "原提交重发回执")).toEqual(saved);
  restored.sendRaw(illegal);
  expect(await shu.readUntil(receipt, "原拒绝重发回执")).toEqual(rejected);
  expect(shu.view.snapshot.players[0].jinnangHand).toEqual(["连环计", "火烧连营"]);
  expect(wu.view.snapshot.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
  for (const player of [shu, wu]) {
    expect(player.view.snapshot.players.map((p) => p.cash)).toEqual([
      shuCash + 400,
      wuCash + 300,
      weiCash - 400,
    ]);
    expect(player.view.snapshot.jinnangDiscard.filter((card) => card === "连环计")).toHaveLength(1);
    expect(player.view.snapshot.pendingJinnang).toBeNull();
  }
  expect(wuWire.frames.some(receipt)).toBe(false);
});

it("保存失败后，无界面玩家从原座摘要重发并取回回执", async () => {
  const { room, shu, shuWire } = await seatPlayers();
  const point = shu.view.decisionPoint;
  room.failNextSave();
  expect(shu.act({ type: "selectCard", handIndex: 2 })).toEqual({ status: "draft" });
  expect(shu.act({ type: "confirm" })).toEqual({ status: "submitted" });

  await expect(shu.readUntil(receipt, "出牌回执", 500)).rejects.toThrow("磁盘已满");
  expect(shu.connectionFailure).toBe("磁盘已满");
  expect(shuWire.isOpen).toBe(false);
  expect(shu.view.decisionPoint).toBe(point);

  const next = await room.socket(0);
  await shu.connect(next);
  expect(shu.connectionFailure).toBeNull();
  expect(await shu.readUntil(receipt, "重发回执")).toMatchObject({
    requestId: 1,
    outcome: "accepted",
  });
});

it.each(["截止前手答", "到期代答"] as const)(
  "%s 的识破结果经两个席位的事件批结算",
  async (mode) => {
    const { room, shu, wu, wuWire } = await seatPlayers(["识破诡计"]);
    const cash = shu.view.snapshot.players.map((p) => p.cash);
    shu.act({ type: "selectCard", handIndex: 2 });
    await submitStep(shu, wu, { type: "confirm" }, "two-a");
    shu.act({ type: "toggleTarget", id: 1 });
    await submitStep(shu, wu, { type: "confirm" }, "two-b");
    shu.act({ type: "toggleTarget", id: 2 });
    await Promise.all([
      waitForStep(shu, { type: "confirm" }, "reaction"),
      wuWire.waitSnapshot((s) => s.turnPhase === "AwaitingReaction", "吴收到开窗公告", 5000),
    ]);

    const deadline = room.now() + 1000;
    // 玩家稍后才查询已经收到的公告，排队时间也算在同一限期内。
    await room.advance(250);
    expect(shu.view.reaction).toMatchObject({ canRespond: false, playable: [], deadlineAt: null });
    expect(shu.view.snapshot.players[1]).toMatchObject({ jinnangHand: [], jinnangHandCount: 1 });
    expect(wu.view.reaction).toMatchObject({
      canRespond: true,
      playable: ["识破诡计"],
      deadlineAt: deadline,
      targets: { kind: "seat", ids: [1, 2], requiresSelection: false },
    });
    expect(wu.view.snapshot.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
    await room.advance(749);
    await wu.connect(await room.socket(1));
    expect(wu.view.reaction!.deadlineAt! - room.now()).toBe(1);

    const manual = mode === "截止前手答";
    if (manual) {
      expect(wu.act({ type: "respondReaction", use: true, cardId: "识破诡计" })).toEqual({
        status: "submitted",
      });
    } else {
      await room.advance(1);
    }
    const sawAnswer = (message: ServerMsg) =>
      message.type === "events" &&
      message.events.some((event) => event.kind === "reactionAnswered");
    const [fromShu, fromWu] = await Promise.all([
      shu.readUntil(sawAnswer, "蜀收到应答结算"),
      wu.readUntil(sawAnswer, "吴收到应答结算"),
    ]);
    for (const frame of [fromShu, fromWu]) {
      if (frame.type !== "events") throw new Error("缺少结算事件批");
      expect(frame.events.find((e) => e.kind === "reactionAnswered")).toMatchObject({
        seat: 1,
        use: manual,
      });
      expect(frame.events.some((e) => e.kind === "jinnangVoided")).toBe(manual);
      expect(frame.events.some((e) => e.kind === "duelResolved")).toBe(!manual);
    }
    for (const player of [shu, wu]) {
      expect(player.view.reaction).toBeNull();
      expect(player.view.snapshot.players.map((p) => p.cash)).toEqual(
        manual ? cash : [cash[0] + 400, cash[1] + 300, cash[2] - 400],
      );
    }
    expect(wu.view.snapshot.players[1].jinnangHand).toEqual(manual ? [] : ["识破诡计"]);
  },
);

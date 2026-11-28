import { expect, it } from "bun:test";
import type { GameEngine } from "@dafung/core/engine/authority";
import {
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
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

type TestRoom = Awaited<ReturnType<typeof openHeadlessTestRoom>>;
const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

function prepareMarches(engine: GameEngine, cash: number, level: number): void {
  setCash(engine, 0, cash);
  grantProperty(engine, 1, "prop-ziwu", level);
  setDefense(engine, 1, "prop-ziwu", 7);
  placePlayer(engine, 0, 12);
  placePlayer(engine, 1, 16);
  setJinnangPiles(engine, [], []);
  pinDice(engine, "march", [1, 2, 3]);
}

async function connect(room: TestRoom, player: HeadlessPlayer) {
  const socket = await room.socket(player.seat);
  await player.connect(socket);
  return socket;
}

async function march(
  room: TestRoom,
  players: HeadlessPlayer[],
  mover: HeadlessPlayer,
  from: number,
  traversed: number[],
): Promise<EventBatchMsg[]> {
  if (mover.view.snapshot.turnPhase === "AwaitingJinnang") {
    expect(mover.act({ type: "pass" })).toEqual({ status: "submitted" });
    expect(await mover.readUntil(isReceipt, "结束出牌回执")).toMatchObject({ outcome: "accepted" });
  }
  await room.advance(AUTO_ROLL_DELAY_MS + 2);
  const tileIndex = traversed.at(-1)!;
  const batches = await Promise.all(
    players.map((player) =>
      player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" &&
          message.events.some(
            (event) => event.kind === "marchArrived" && event.seat === mover.seat,
          ),
        "行军落格",
      ),
    ),
  );
  for (const batch of batches) {
    expect(batch.events).toContainEqual(
      expect.objectContaining({
        kind: "marchArrived",
        tileIndex,
        path: expect.objectContaining({ from, traversed }),
      }),
    );
  }
  return batches;
}

async function observeNextTurn(
  room: TestRoom,
  players: HeadlessPlayer[],
  turn: number,
  seat: number,
) {
  await room.advance(1);
  for (const player of players) {
    await player.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.kind === "turnStarted" && event.turn === turn),
      "换席",
    );
    expect(player.view.snapshot).toMatchObject({
      activeIndex: seat,
      turnNumber: turn,
      pendingLand: null,
    });
  }
}

it("无界面玩家经真实房间购地、免费扩军和不取，重发原购买只扣一次", async () => {
  const room = await openHeadlessTestRoom([], (engine) => prepareMarches(engine, 6500, 1));
  const buyer = new HeadlessPlayer(room.id, 0);
  const general = new HeadlessPlayer(room.id, 1);
  const next = new HeadlessPlayer(room.id, 2);
  const players = [buyer, general, next];
  try {
    const [buyerSocket, guestSocket] = await Promise.all(
      players.map((player) => connect(room, player)),
    );
    await march(room, players, buyer, 12, [13]);
    expect(buyer.view.decisionOptions).toEqual({
      kind: "landDecision",
      landing: { kind: "PropertyAvailable", propertyId: "prop-hanzhong", tileIndex: 13 },
      options: [
        { command: "buyProperty", label: "购地", available: true, cost: 3000 },
        { command: "endDecision", label: "不取", available: true, cost: 0 },
      ],
    });
    expect(general.view.decisionPoint).toBeNull();
    expect(general.view.decisionOptions).toBeUndefined();
    const purchase = {
      roomId: room.id,
      seat: 0,
      submissionId: "购地测试",
      decisionPoint: buyer.view.decisionPoint!,
      cmd: { type: "buyProperty" },
    } satisfies PlayerSubmission;
    guestSocket.sendRaw(submissionMsg({ ...purchase, seat: 1 }));
    expect(await general.readUntil(isReceipt, "越席拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    buyerSocket.sendRaw(
      submissionMsg({ ...purchase, submissionId: "错误动作", cmd: { type: "upgradeProperty" } }),
    );
    expect(await buyer.readUntil(isReceipt, "错误动作拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });
    buyerSocket.sendRaw(cmdMsg(purchase.cmd, 100));
    expect(
      await buyer.readUntil((message) => message.type === "error", "旧入口拒绝"),
    ).toMatchObject({
      requestId: 100,
      error: "请携带原决策点和提交编号提交此操作",
    });
    expect(buyer.view.decisionPoint).toBe(purchase.decisionPoint);

    expect(buyer.act({ type: "chooseLand", command: "buyProperty" })).toEqual({
      status: "submitted",
    });
    const bought = await buyer.readUntil(isReceipt, "购地回执");
    expect(bought.outcome).toBe("accepted");
    await observeNextTurn(room, players, 2, 1);
    for (const player of players) {
      // 买地恰逢轮末，扣 3000 后收回一轮 90 两。
      expect(player.view.snapshot.players[0]).toMatchObject({ position: 13, cash: 3590 });
      expect(player.view.snapshot.players[0].properties).toContainEqual(
        expect.objectContaining({ propertyId: "prop-hanzhong", level: 1, defense: 40 }),
      );
    }
    buyer.close();
    await buyerSocket.waitClosed(1000);
    const recoveredSocket = await connect(room, buyer);
    recoveredSocket.sendRaw(
      submissionMsg({ ...purchase, submissionId: bought.submissionId }, bought.requestId),
    );
    expect(await buyer.readUntil(isReceipt, "重发原购地回执")).toEqual(bought);
    recoveredSocket.sendRaw(submissionMsg({ ...purchase, submissionId: "迟到购地" }));
    expect(await buyer.readUntil(isReceipt, "已结束的城池决策拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(buyer.view.snapshot.players[0].cash).toBe(3590);

    await march(room, players, general, 16, [17, 18]);
    expect(general.view.decisionOptions).toEqual({
      kind: "landDecision",
      landing: { kind: "OwnProperty", propertyId: "prop-ziwu", tileIndex: 18 },
      options: [
        { command: "upgradeProperty", label: "扩军(免费)", available: true, cost: 0 },
        { command: "endDecision", label: "按兵不动", available: true, cost: 0 },
      ],
    });
    const generalCash = general.view.snapshot.players[1].cash;
    expect(general.act({ type: "chooseLand", command: "upgradeProperty" })).toEqual({
      status: "submitted",
    });
    expect(await general.readUntil(isReceipt, "扩军回执")).toMatchObject({ outcome: "accepted" });
    await observeNextTurn(room, players, 3, 2);
    for (const player of players) {
      expect(player.view.snapshot.players[1]).toMatchObject({ position: 18, cash: generalCash });
      expect(player.view.snapshot.players[1].properties).toContainEqual(
        expect.objectContaining({ propertyId: "prop-ziwu", level: 2, defense: 30 }),
      );
    }

    await march(room, players, next, 2, [3, 4, 5]);
    const nextCash = next.view.snapshot.players[2].cash;
    expect(next.act({ type: "chooseLand", command: "endDecision" })).toEqual({
      status: "submitted",
    });
    expect(await next.readUntil(isReceipt, "不取回执")).toMatchObject({ outcome: "accepted" });
    await observeNextTurn(room, players, 4, 0);
    for (const player of players) {
      expect(player.view.snapshot.players[2]).toMatchObject({ position: 5, cash: nextCash });
      expect(player.view.snapshot.players[2].properties).not.toContainEqual(
        expect.objectContaining({ propertyId: "prop-linzi" }),
      );
    }
  } finally {
    for (const player of players) player.close();
    await room.close();
  }
});

it("银两不足自动不取，己城满级自动按兵不动，均直接换席", async () => {
  const room = await openHeadlessTestRoom([], (engine) => prepareMarches(engine, 2999, 4));
  const buyer = new HeadlessPlayer(room.id, 0);
  const general = new HeadlessPlayer(room.id, 1);
  const players = [buyer, general];
  try {
    await Promise.all(players.map((player) => connect(room, player)));
    const withoutCash = await march(room, players, buyer, 12, [13]);
    for (const [index, batch] of withoutCash.entries()) {
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          kind: "propertyRejected",
          propertyId: "prop-hanzhong",
          reason: "insufficient-cash",
        }),
      );
      expect(batch.decisionOptions).toBeUndefined();
      expect(players[index].view.snapshot).toMatchObject({
        activeIndex: 1,
        turnNumber: 2,
        pendingLand: null,
      });
      expect(players[index].view.snapshot.players[0].cash).toBe(2999);
    }

    const fullLevel = await march(room, players, general, 16, [17, 18]);
    for (const [index, batch] of fullLevel.entries()) {
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          kind: "propertyRejected",
          propertyId: "prop-ziwu",
          reason: "maxed",
        }),
      );
      expect(batch.decisionOptions).toBeUndefined();
      const { snapshot } = players[index].view;
      expect(snapshot).toMatchObject({ activeIndex: 2, turnNumber: 3, pendingLand: null });
      expect(snapshot.players[1].properties).toContainEqual(
        expect.objectContaining({ propertyId: "prop-ziwu", level: 4, defense: 7 }),
      );
    }
  } finally {
    for (const player of players) player.close();
    await room.close();
  }
});

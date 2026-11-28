import { expect, it } from "bun:test";
import {
  giveTreasure,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
} from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import { createTreasureDeck, makeSkillBook } from "@dafung/core/engine/treasures";
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

type TestRoom = Awaited<ReturnType<typeof openHeadlessTestRoom>>;
type TestSocket = Awaited<ReturnType<TestRoom["socket"]>>;

async function withBankruptcyRoom(
  check: (
    room: TestRoom,
    debtor: HeadlessPlayer,
    creditor: HeadlessPlayer,
    debtorSocket: TestSocket,
    creditorSocket: TestSocket,
  ) => Promise<void>,
): Promise<void> {
  const room = await openHeadlessTestRoom([], (engine) => {
    placePlayer(engine, 0, 17);
    setCash(engine, 0, 600);
    grantProperty(engine, 0, "prop-hanzhong", 2);
    setDefense(engine, 0, "prop-hanzhong", 7);
    giveTreasure(engine, 0, [makeSkillBook("jixing"), makeSkillBook("jixing")]);
    grantProperty(engine, 1, "prop-ziwu", 1);
    giveTreasure(engine, 1, [createTreasureDeck().find(({ id }) => id === "seal-1")!]);
    pinDice(engine, "march", [1]);
  });
  const debtor = new HeadlessPlayer(room.id, 0);
  const creditor = new HeadlessPlayer(room.id, 1);
  try {
    const [debtorSocket, creditorSocket] = await Promise.all([room.socket(0), room.socket(1)]);
    await Promise.all([debtor.connect(debtorSocket), creditor.connect(creditorSocket)]);
    expect(debtor.act({ type: "pass" })).toEqual({ status: "submitted" });
    expect(await debtor.readUntil(isReceipt, "结束出牌")).toMatchObject({ outcome: "accepted" });
    await room.advance(AUTO_ROLL_DELAY_MS + 2);
    await creditor.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.kind === "marchArrived" && event.tileIndex === 18),
      "到子午谷",
    );
    expect(creditor.act({ type: "chooseTreasureMode", mode: "fair" })).toEqual({ status: "draft" });
    expect(creditor.act({ type: "selectTreasure", treasureId: "seal-1" })).toEqual({
      status: "draft",
    });
    expect(creditor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await creditor.readUntil(isReceipt, "公道买卖")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    await creditor.readUntil(
      (message) => message.type === "snapshot" && message.pendingDebt !== null,
      "交涉挂债",
    );
    await debtor.readUntil(
      (message) => message.type === "snapshot" && message.pendingDebt !== null,
      "交涉挂债",
    );
    await check(room, debtor, creditor, debtorSocket, creditorSocket);
  } finally {
    debtor.close();
    creditor.close();
    await room.close();
  }
}

async function observeContinuedTurn(
  room: TestRoom,
  players: HeadlessPlayer[],
): Promise<EventBatchMsg[]> {
  await room.advance(1);
  const batches = await Promise.all(
    players.map((player) =>
      player.readUntil(
        (message): message is EventBatchMsg =>
          message.type === "events" &&
          message.events.some((event) => event.kind === "turnStarted" && event.turn === 2),
        "清算后换席",
      ),
    ),
  );
  await Promise.all(
    players.map((player) =>
      player.readUntil(
        (message) => message.type === "snapshot" && message.turnNumber === 2,
        "清算后座位摘要",
      ),
    ),
  );
  for (const player of players) {
    expect(player.view.snapshot).toMatchObject({
      turnNumber: 2,
      activeIndex: 1,
      pendingDebt: null,
      escrowTreasure: null,
    });
  }
  return batches;
}

it("欠款席草选城池和珍宝整批清偿，非法资产及数量原样拒绝，重发只清偿一次", async () => {
  await withBankruptcyRoom(async (room, debtor, creditor, debtorSocket, creditorSocket) => {
    expect(debtor.view.decisionOptions).toMatchObject({
      kind: "bankruptcy",
      cash: 600,
      debt: { amount: 3000, creditorSeat: 1 },
      assets: [
        { kind: "treasure", id: "skillbook-jixing", price: 200, maxQuantity: 2 },
        { kind: "property", id: "prop-hanzhong", price: 2100, level: 2, maxQuantity: 1 },
      ],
    });
    const decisionPoint = debtor.view.decisionPoint;
    if (decisionPoint === null) throw new Error("清算缺少债务人的决策点");
    expect(creditor.view.decisionPoint).toBeNull();
    expect(creditor.view.decisionOptions).toBeUndefined();
    const book = { kind: "treasure", id: "skillbook-jixing" } as const;
    const city = { kind: "property", id: "prop-hanzhong" } as const;
    const assets = [book, city, book];
    const settlement = {
      roomId: room.id,
      seat: 0,
      decisionPoint,
      submissionId: "变卖确认",
      cmd: { type: "confirmBankruptcySettle", assets },
    } satisfies PlayerSubmission;

    creditorSocket.sendRaw(submissionMsg({ ...settlement, seat: 1 }));
    expect(await creditor.readUntil(isReceipt, "债主不可代选")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    debtorSocket.sendRaw(cmdMsg({ type: "declareBankruptcy" }, 100));
    expect(
      await debtor.readUntil((message) => message.type === "error", "旧上行拒绝"),
    ).toMatchObject({
      requestId: 100,
      error: "请携带原决策点和提交编号提交此操作",
    });
    for (const { submissionId, assets, reason } of [
      {
        submissionId: "变卖都城",
        assets: [book, { kind: "property", id: "prop-hangu" } as const, city],
        reason: "都城不可变卖",
      },
      {
        submissionId: "多卖一册",
        assets: [book, book, book, city],
        reason: "所选珍宝不可用于清偿",
      },
    ]) {
      debtorSocket.sendRaw(
        submissionMsg({ ...settlement, submissionId, cmd: { ...settlement.cmd, assets } }),
      );
      expect(await debtor.readUntil(isReceipt, "非法清算拒绝")).toMatchObject({
        submissionId,
        outcome: "rejected",
        reasonCode: "invalidCandidate",
        reason,
      });
      expect(debtor.view.decisionPoint).toBe(decisionPoint);
    }

    expect(debtor.act({ type: "addBankruptcyAsset", asset: book })).toEqual({ status: "draft" });
    expect(debtor.act({ type: "addBankruptcyAsset", asset: city })).toEqual({ status: "draft" });
    expect(debtor.act({ type: "confirm" })).toMatchObject({ status: "unavailable" });
    expect(debtor.act({ type: "addBankruptcyAsset", asset: book })).toEqual({ status: "draft" });
    expect(debtor.view.bankruptcy).toMatchObject({
      selected: assets,
      selectedValue: 2500,
      canConfirm: true,
    });
    expect(debtor.view.snapshot.players[0]).toMatchObject({ cash: 600, isBankrupt: false });

    expect(debtor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    const receipt = await debtor.readUntil(isReceipt, "清偿回执");
    expect(receipt.outcome).toBe("accepted");
    const players = [debtor, creditor];
    const batches = await observeContinuedTurn(room, players);
    for (const [index, { events }] of batches.entries()) {
      expect(
        events.filter((event) => event.kind === "assetLiquidated").map((event) => event.asset),
      ).toEqual(assets);
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "bankruptcySettled",
          seat: 0,
          cashAfter: 100,
          creditor: { seat: 1, cashAfter: 7100 },
        }),
      );
      const visiblePlayers = players[index].view.snapshot.players;
      const [buyer, seller] = visiblePlayers;
      expect(visiblePlayers.flatMap(({ properties }) => properties)).not.toContainEqual(
        expect.objectContaining({ propertyId: "prop-hanzhong" }),
      );
      expect(buyer).toMatchObject({
        cash: 100,
        isBankrupt: false,
        properties: [expect.objectContaining({ propertyId: "prop-hangu" })],
        treasures: [expect.objectContaining({ id: "seal-1" })],
      });
      expect(seller.properties).toContainEqual(
        expect.objectContaining({ propertyId: "prop-ziwu", level: 2, defense: 30 }),
      );
    }

    debtor.close();
    await debtorSocket.waitClosed(1000);
    const recoveredSocket = await room.socket(0);
    await debtor.connect(recoveredSocket);
    recoveredSocket.sendRaw(
      submissionMsg({ ...settlement, submissionId: receipt.submissionId }, receipt.requestId),
    );
    expect(await debtor.readUntil(isReceipt, "重发原清偿回执")).toEqual(receipt);
    recoveredSocket.sendRaw(submissionMsg({ ...settlement, submissionId: "迟到的清偿" }));
    expect(await debtor.readUntil(isReceipt, "迟到清偿拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(debtor.view.snapshot.players[0].cash).toBe(100);
  });
});

it("债务人确认认破产后，余款和资产归债主，托管珍宝退回并继续下一席", async () => {
  await withBankruptcyRoom(async (room, debtor, creditor) => {
    expect(debtor.act({ type: "declareBankruptcy" })).toEqual({ status: "submitted" });
    expect(await debtor.readUntil(isReceipt, "认破产回执")).toMatchObject({ outcome: "accepted" });
    const players = [debtor, creditor];
    const batches = await observeContinuedTurn(room, players);
    for (const [index, { events }] of batches.entries()) {
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "playerBankrupt", seat: 0, creditorSeat: 1 }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: "assetTransferred",
          propertyId: "prop-hanzhong",
          toSeat: 1,
        }),
      );
      const [bankrupt, seller] = players[index].view.snapshot.players;
      expect(bankrupt).toMatchObject({
        isBankrupt: true,
        cash: 0,
        capitalIndex: -1,
        properties: [],
        treasures: [],
      });
      // 4100 现钱 + 600 扫账 + 234 轮末城池收益。
      expect(seller.cash).toBe(4934);
      expect(seller.properties).toContainEqual(
        expect.objectContaining({ propertyId: "prop-hanzhong", level: 2, defense: 30 }),
      );
      expect(seller.treasures.map(({ id }) => id)).toEqual([
        "skillbook-jixing",
        "skillbook-jixing",
        "seal-1",
      ]);
    }
  });
});

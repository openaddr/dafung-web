import { expect, it } from "bun:test";
import type { GameEngine } from "@dafung/core/engine/authority";
import {
  armPhase,
  giveJinnang,
  giveTreasure,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
  setJinnangPiles,
} from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import { TREASURES } from "@dafung/core/engine/treasures";
import {
  cmdMsg,
  submissionMsg,
  type EventBatchMsg,
  type PlayerSubmission,
  type ServerMsg,
  type SnapshotMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

type TestRoom = Awaited<ReturnType<typeof openHeadlessTestRoom>>;
type TreasureVisit = {
  room: TestRoom;
  players: HeadlessPlayer[];
  sockets: Awaited<ReturnType<TestRoom["socket"]>>[];
  landings: EventBatchMsg[];
};

const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

function prepareTreasureVisit(engine: GameEngine, visitorCash: number): void {
  const treasure = (id: string) => ({
    ...TREASURES.find((item) => item.id === id)!,
    id: `${id}-0`,
  });
  giveTreasure(engine, 0, [treasure("hat"), treasure("edict")]);
  giveTreasure(engine, 1, []);
  setCash(engine, 0, 3000);
  setCash(engine, 1, visitorCash);
  grantProperty(engine, 0, "prop-hanzhong", 1);
  setDefense(engine, 0, "prop-hanzhong", 7);
  placePlayer(engine, 1, 12);
  giveJinnang(engine, 0, []);
  giveJinnang(engine, 1, ["军情密探"]);
  setJinnangPiles(engine, [], []);
  armPhase(engine, { activeIndex: 1, turnPhase: "AwaitingJinnang" });
  pinDice(engine, "march", [1]);
}

async function withTreasureVisit(
  check: (visit: TreasureVisit) => Promise<void>,
  visitorCash = 6500,
): Promise<void> {
  const room = await openHeadlessTestRoom([], (engine) =>
    prepareTreasureVisit(engine, visitorCash),
  );
  const players = [0, 1, 2].map((seat) => new HeadlessPlayer(room.id, seat));
  const visitor = players[1];
  try {
    const sockets = await Promise.all(
      players.map(async (player) => {
        const socket = await room.socket(player.seat);
        await player.connect(socket);
        return socket;
      }),
    );
    expect(visitor.act({ type: "pass" })).toEqual({ status: "submitted" });
    expect(await visitor.readUntil(isReceipt, "结束出牌回执")).toMatchObject({
      outcome: "accepted",
    });
    await room.advance(AUTO_ROLL_DELAY_MS + 2);
    const landings = await Promise.all(
      players.map((player) =>
        player.readUntil(
          (message): message is EventBatchMsg =>
            message.type === "events" &&
            message.events.some((event) => event.kind === "landingResolved"),
          "落格交涉",
        ),
      ),
    );
    await check({ room, players, sockets, landings });
  } finally {
    for (const player of players) player.close();
    await room.close();
  }
}

async function verifyOwnerAccess({
  room,
  players,
  sockets,
  landings,
}: TreasureVisit): Promise<void> {
  const [owner, visitor] = players;
  const [ownerSocket, visitorSocket] = sockets;
  expect(landings[0].decisionPoint).toEqual(expect.any(String));
  expect(landings[0].decisionOptions).toMatchObject({
    kind: "treasureOwner",
    tileIndex: 13,
    visitorSeat: 1,
    modes: ["skip", "fair", "premium"],
    fairUpgradesCity: true,
    candidates: [
      { id: "hat-0", guidePrice: 100, premiumPrice: 300 },
      { id: "edict-0", guidePrice: 2200, premiumPrice: 2400 },
    ],
  });
  for (const landing of landings.slice(1)) {
    expect(landing.decisionPoint).toBeNull();
    expect(landing.decisionOptions).toBeUndefined();
  }
  expect(visitor.view.snapshot).toMatchObject({
    activeIndex: 1,
    turnPhase: "AwaitingTreasureOwner",
    decisionOwner: 0,
  });
  expect(visitor.view.snapshot.players[0].treasures.map(({ id }) => id)).toEqual([
    "hat-0",
    "edict-0",
  ]);
  const attemptedTrade = {
    roomId: room.id,
    seat: owner.seat,
    submissionId: "城主交涉",
    decisionPoint: landings[0].decisionPoint!,
    cmd: { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "edict-0" } },
  } satisfies PlayerSubmission;
  visitorSocket.sendRaw(submissionMsg({ ...attemptedTrade, seat: visitor.seat }));
  expect(await visitor.readUntil(isReceipt, "越席交涉拒绝")).toMatchObject({
    outcome: "rejected",
    reasonCode: "wrongSeat",
  });
  ownerSocket.sendRaw(
    submissionMsg({
      ...attemptedTrade,
      cmd: { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "seal-0" } },
    }),
  );
  expect(await owner.readUntil(isReceipt, "未持有珍宝拒绝")).toMatchObject({
    outcome: "rejected",
    reasonCode: "invalidCandidate",
  });
  ownerSocket.sendRaw(cmdMsg(attemptedTrade.cmd, 100));
  expect(await owner.readUntil((message) => message.type === "error", "旧入口拒绝")).toMatchObject({
    requestId: 100,
    error: "请携带原决策点和提交编号提交此操作",
  });
  expect(owner.view.decisionPoint).toBe(attemptedTrade.decisionPoint);
}

it.each([
  ["公道买卖", "fair", 2200, 2, 30],
  ["坐地起价", "premium", 2400, 1, 7],
  ["不交易", "skip", 0, 1, 7],
] as const)(
  "%s由城主提交，访客从事件看到结算与换席",
  async (label, mode, price, level, defense) => {
    await withTreasureVisit(async (visit) => {
      const { room, players } = visit;
      const [owner] = players;
      if (mode === "fair") await verifyOwnerAccess(visit);
      const chosen = owner.act({ type: "chooseTreasureMode", mode });
      if (mode === "skip") {
        expect(chosen).toEqual({ status: "submitted" });
      } else {
        expect(chosen).toEqual({ status: "draft" });
        expect(owner.act({ type: "selectTreasure", treasureId: "edict-0" })).toEqual({
          status: "draft",
        });
        expect(owner.view.snapshot.players[0].cash).toBe(3000);
        expect(owner.act({ type: "confirm" })).toEqual({ status: "submitted" });
      }
      expect(await owner.readUntil(isReceipt, `${label}回执`)).toMatchObject({
        outcome: "accepted",
      });
      await room.advance(1);

      for (const player of players) {
        const settled = await player.readUntil(
          (message): message is EventBatchMsg =>
            message.type === "events" &&
            message.events.some((event) => event.kind === "turnStarted" && event.turn === 2),
          "交涉结束换席",
        );
        const traded = settled.events.filter((event) => event.kind === "treasureTraded");
        expect(traded).toEqual(
          mode === "skip"
            ? []
            : [
                expect.objectContaining({
                  buyerSeat: 1,
                  sellerSeat: 0,
                  treasureId: "edict-0",
                  price,
                }),
              ],
        );
        const { snapshot } = player.view;
        expect(snapshot).toMatchObject({ activeIndex: 2, turnNumber: 2, treasureVisitor: null });
        expect(snapshot.players[0].cash).toBe(3000 + price);
        expect(snapshot.players[1].cash).toBe(6500 - price);
        expect(snapshot.players[0].treasures.map(({ id }) => id)).toEqual(
          mode === "skip" ? ["hat-0", "edict-0"] : ["hat-0"],
        );
        expect(snapshot.players[1].treasures.map(({ id }) => id)).toEqual(
          mode === "skip" ? [] : ["edict-0"],
        );
        expect(snapshot.players[0].properties).toContainEqual(
          expect.objectContaining({ propertyId: "prop-hanzhong", level, defense }),
        );
      }
    });
  },
);

it("公道买卖价款不足时，访客在原回合进入清算，珍宝留在托管中", async () => {
  await withTreasureVisit(async ({ room, players }) => {
    const [owner, visitor] = players;
    owner.act({ type: "chooseTreasureMode", mode: "fair" });
    owner.act({ type: "selectTreasure", treasureId: "edict-0" });
    expect(owner.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await owner.readUntil(isReceipt, "欠款交易回执")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    const debt = await visitor.readUntil(
      (message): message is SnapshotMsg =>
        message.type === "snapshot" && message.turnPhase === "AwaitingBankruptcySettle",
      "清算状态",
    );
    expect(debt).toMatchObject({
      activeIndex: 1,
      turnNumber: 1,
      decisionOwner: 1,
      pendingDebt: { amount: 2200, creditor: debt.players[0].id },
      escrowTreasure: {
        buyerIdx: 1,
        sellerIdx: 0,
        price: 2200,
        treasure: { id: "edict-0" },
      },
    });
    expect(debt.players[0].cash).toBe(3000);
    expect(debt.players[1].cash).toBe(200);
    expect(debt.players[0].treasures.map(({ id }) => id)).toEqual(["hat-0"]);
    expect(debt.players[1].treasures).toEqual([]);
    expect(debt.players[0].properties).toContainEqual(
      expect.objectContaining({ propertyId: "prop-hanzhong", level: 2, defense: 30 }),
    );
  }, 200);
});

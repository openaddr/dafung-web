import { expect, it } from "bun:test";
import { armHero, pinDice, placePlayer, setCash } from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import {
  cmdMsg,
  submissionMsg,
  type EventBatchMsg,
  type PlayerSubmission,
  type ServerMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { MAP } from "../../scripts/engine-helpers";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

type TestRoom = Awaited<ReturnType<typeof openHeadlessTestRoom>>;
const recruitCity = MAP.board.tiles.find((tile) => tile.event === "hero")!;
const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

function openRecruitmentRoom(heroIds: readonly string[] = []) {
  return openHeadlessTestRoom([], (engine) => {
    for (const heroId of heroIds) armHero(engine, 0, heroId);
    placePlayer(engine, 0, recruitCity.index - 1);
    setCash(engine, 0, 7000);
    pinDice(engine, "march", [1]);
  });
}

async function connect(room: TestRoom, player: HeadlessPlayer) {
  const socket = await room.socket(player.seat);
  await player.connect(socket);
  return socket;
}

function readLanding(player: HeadlessPlayer, phase: "AwaitingHeroPick" | "AwaitingDecision") {
  return player.readUntil(
    (message): message is EventBatchMsg =>
      message.type === "events" &&
      message.events.some((event) => event.kind === "landingResolved" && event.turnPhase === phase),
    phase === "AwaitingHeroPick" ? "招贤开窗" : "城池交易续行",
  );
}

async function marchToRecruitment(room: TestRoom, mover: HeadlessPlayer, peer: HeadlessPlayer) {
  expect(mover.act({ type: "pass" })).toEqual({ status: "submitted" });
  expect(await mover.readUntil(isReceipt, "结束出牌回执")).toMatchObject({ outcome: "accepted" });
  await room.advance(AUTO_ROLL_DELAY_MS + 2);
  const [own, other] = await Promise.all([
    readLanding(mover, "AwaitingHeroPick"),
    readLanding(peer, "AwaitingHeroPick"),
  ]);
  expect(own.events).toContainEqual(
    expect.objectContaining({ kind: "marchArrived", seat: 0, tileIndex: recruitCity.index }),
  );
  expect(other.decisionPoint).toBeNull();
  expect(other.decisionOptions).toBeUndefined();
  expect(peer.view.snapshot.offeredHeroes).toEqual([]);
  if (own.decisionPoint === null || own.decisionOptions?.kind !== "recruitment")
    throw new Error("本席落招贤城未收到权威招贤选项");
  return { decisionPoint: own.decisionPoint, options: own.decisionOptions.options };
}

it("招将候选按席交付，断线后可确认原候选，拒绝越席和迟到操作并续接城池交易", async () => {
  const room = await openRecruitmentRoom();
  const mover = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const [oldSocket, peerSocket] = await Promise.all([connect(room, mover), connect(room, peer)]);
    const { decisionPoint, options } = await marchToRecruitment(room, mover, peer);
    const candidates = options.filter((option) => "index" in option);
    expect(candidates).toHaveLength(3);
    const picked = candidates[1];
    expect(picked.skillIds.length).toBeGreaterThan(0);
    const cmd = { type: "resolveHeroPick", index: picked.index } as const;
    const request: PlayerSubmission = {
      roomId: room.id,
      seat: 0,
      submissionId: "迟到招贤",
      decisionPoint,
      cmd,
    };
    peerSocket.sendRaw(submissionMsg({ ...request, seat: 1, submissionId: "越席招贤" }));
    expect(await peer.readUntil(isReceipt, "越席招贤拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });

    mover.close();
    await oldSocket.waitClosed(1000);
    const socket = await connect(room, mover);
    expect(mover.view.decisionPoint).toBe(decisionPoint);
    expect(mover.view.decisionOptions).toEqual({ kind: "recruitment", options });
    socket.sendRaw(cmdMsg(cmd, 18));
    expect(
      await mover.readUntil((message) => message.type === "error", "旧招贤入口拒绝"),
    ).toMatchObject({
      requestId: 18,
      error: "请携带原决策点和提交编号提交此操作",
    });
    socket.sendRaw(
      submissionMsg({ ...request, submissionId: "错误候选", cmd: { ...cmd, index: 3 } }),
    );
    expect(await mover.readUntil(isReceipt, "无效招贤候选拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });
    expect(mover.view.decisionPoint).toBe(decisionPoint);

    expect(mover.act({ type: "chooseRecruitment", optionId: picked.id })).toEqual({
      status: "submitted",
    });
    expect(await mover.readUntil(isReceipt, "招将回执")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    const settlements = await Promise.all([
      readLanding(mover, "AwaitingDecision"),
      readLanding(peer, "AwaitingDecision"),
    ]);
    for (const batch of settlements) {
      expect(batch.events).toContainEqual(
        expect.objectContaining({ kind: "heroRecruited", seat: 0, heroId: picked.heroId }),
      );
    }
    for (const player of [mover, peer]) {
      expect(player.view.snapshot.players[0].heroes).toContainEqual(
        expect.objectContaining({ heroId: picked.heroId, skillIds: picked.skillIds }),
      );
      expect(player.view.snapshot.offeredHeroes).toEqual([]);
    }
    expect(mover.view.decisionOptions).toMatchObject({
      kind: "landDecision",
      landing: { propertyId: recruitCity.propertyId, tileIndex: recruitCity.index },
    });
    const landPoint = mover.view.decisionPoint;
    expect(landPoint).not.toBe(decisionPoint);
    socket.sendRaw(submissionMsg(request));
    expect(await mover.readUntil(isReceipt, "已结束招贤拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(mover.view.decisionPoint).toBe(landPoint);
  } finally {
    mover.close();
    peer.close();
    await room.close();
  }
});

it.each([
  { optionId: "seekBook", heroIds: ["zhouyu", "zhugeliang", "caopi"], candidateCount: 0, books: 1 },
  { optionId: "skip", heroIds: [], candidateCount: 3, books: 0 },
])(
  "同一招贤提交接收 $optionId，两个座位看到资产与原城池交易",
  async ({ optionId, heroIds, candidateCount, books }) => {
    const room = await openRecruitmentRoom(heroIds);
    const mover = new HeadlessPlayer(room.id, 0);
    const peer = new HeadlessPlayer(room.id, 1);
    try {
      await Promise.all([connect(room, mover), connect(room, peer)]);
      const { options } = await marchToRecruitment(room, mover, peer);
      expect(options.filter((option) => "index" in option)).toHaveLength(candidateCount);
      expect(options.find(({ id }) => id === optionId)).toMatchObject({
        action: optionId,
        available: true,
      });
      const before = mover.view.snapshot.players[0];
      expect(mover.act({ type: "chooseRecruitment", optionId })).toEqual({ status: "submitted" });
      expect(await mover.readUntil(isReceipt, "招贤回执")).toMatchObject({ outcome: "accepted" });
      await room.advance(1);
      for (const player of [mover, peer]) {
        const { events } = await readLanding(player, "AwaitingDecision");
        expect(
          events.filter((event) => event.kind === "treasureGained" && event.seat === 0),
        ).toHaveLength(books);
        const { treasures, heroes } = player.view.snapshot.players[0];
        expect(treasures.filter(({ kind }) => kind === "book")).toHaveLength(
          before.treasures.filter(({ kind }) => kind === "book").length + books,
        );
        expect(heroes).toEqual(before.heroes);
      }
      expect(mover.view.decisionOptions).toMatchObject({
        kind: "landDecision",
        landing: { propertyId: recruitCity.propertyId },
      });
    } finally {
      mover.close();
      peer.close();
      await room.close();
    }
  },
);

import { expect, it } from "bun:test";
import { armHero, giveTreasure } from "@dafung/core/engine/planter";
import { makeSkillBook } from "@dafung/core/engine/treasures";
import {
  submissionMsg,
  type PlayerSubmission,
  type ServerMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const isReceipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";

it("按本席可学者研读技能书，取消保留书，重发只学一次且只扣一册", async () => {
  const fireBook = makeSkillBook("huogong");
  const medicineBook = makeSkillBook("qingnang");
  const room = await openHeadlessTestRoom([], (engine) => {
    armHero(engine, 0, "zhouyu", ["yingzi"]);
    armHero(engine, 0, "zhugeliang", ["yuli"]);
    armHero(engine, 1, "huatuo", ["zhenji"]);
    giveTreasure(engine, 0, [fireBook, fireBook, medicineBook]);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const actorWire = await room.socket(0);
    const peerWire = await room.socket(1);
    await actor.connect(actorWire);
    await peer.connect(peerWire);
    const { decisionPoint } = actor.view;
    if (decisionPoint === null) throw new Error("出牌座位缺少决策点");
    const request = {
      roomId: room.id,
      seat: 0,
      submissionId: "研读验证",
      decisionPoint,
      cmd: { type: "useBookSkill", treasureId: fireBook.id, heroId: "zhugeliang" },
    } satisfies PlayerSubmission;
    peerWire.sendRaw(submissionMsg({ ...request, seat: 1 }));
    expect(
      await peer.readUntil(
        (message) => isReceipt(message) || message.type === "error",
        "越席研读拒绝",
      ),
    ).toMatchObject({ type: "submissionResult", outcome: "rejected", reasonCode: "wrongSeat" });
    expect(actor.view.decisionOptions).toMatchObject({
      kind: "playJinnang",
      skillBooks: [
        { treasureId: fireBook.id, available: true, learnerHeroIds: ["zhouyu", "zhugeliang"] },
        { treasureId: fireBook.id, available: true, learnerHeroIds: ["zhouyu", "zhugeliang"] },
        {
          treasureId: medicineBook.id,
          available: false,
          learnerHeroIds: [],
          reason: expect.any(String),
        },
      ],
    });
    expect(peer.view.decisionOptions).toBeUndefined();
    actorWire.sendRaw(
      submissionMsg({
        ...request,
        cmd: { ...request.cmd, treasureId: medicineBook.id, heroId: "huatuo" },
      }),
    );
    expect(await actor.readUntil(isReceipt, "越名册人选拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });

    const selectBook = () => actor.act({ type: "selectSkillBook", treasureId: fireBook.id });
    const selectLearner = () => actor.act({ type: "selectBookLearner", heroId: "zhugeliang" });
    expect(selectBook()).toEqual({ status: "draft" });
    expect(selectLearner()).toEqual({ status: "draft" });
    expect(actor.act({ type: "cancel" })).toEqual({ status: "draft" });
    expect(actor.view.skillBookStudy).toBeNull();
    expect(actor.view.snapshot.players[0].treasures.map(({ id }) => id)).toEqual([
      fireBook.id,
      fireBook.id,
      medicineBook.id,
    ]);

    expect(selectBook()).toEqual({ status: "draft" });
    expect(selectLearner()).toEqual({ status: "draft" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    const receipt = await actor.readUntil(isReceipt, "研读回执");
    expect(receipt).toMatchObject({ outcome: "accepted" });
    await peer.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some(
          (event) =>
            event.kind === "skillLearned" &&
            event.seat === 0 &&
            event.heroId === "zhugeliang" &&
            event.skillId === "huogong" &&
            event.treasureId === fireBook.id,
        ),
      "学技事件",
    );
    for (const player of [actor, peer]) {
      const { heroes, treasures } = player.view.snapshot.players[0];
      expect(heroes.map(({ skillIds }) => skillIds)).toEqual([["yingzi"], ["huogong", "yuli"]]);
      expect(treasures.map(({ id }) => id)).toEqual([fireBook.id, medicineBook.id]);
    }
    actorWire.sendRaw(submissionMsg({ ...request, submissionId: "迟到研读" }));
    expect(await actor.readUntil(isReceipt, "旧出牌步骤拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    actorWire.sendRaw(submissionMsg({ ...request, submissionId: receipt.submissionId }));
    expect(await actor.readUntil(isReceipt, "重复研读回执")).toMatchObject({ outcome: "accepted" });
    expect(actor.view.snapshot.players[0].treasures.map(({ id }) => id)).toEqual([
      fireBook.id,
      medicineBook.id,
    ]);
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

it("结束出牌后仍可两次确认遣散，旁席与迟到提交被拒绝，重发不多返书", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    armHero(engine, 0, "zhouyu", ["yingzi", "huogong"]);
    armHero(engine, 1, "huatuo", ["zhenji"]);
    giveTreasure(engine, 0, []);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const actorWire = await room.socket(0);
    const peerWire = await room.socket(1);
    await actor.connect(actorWire);
    await peer.connect(peerWire);
    const oldPoint = actor.view.decisionPoint;
    if (oldPoint === null) throw new Error("出牌座位缺少决策点");
    expect(actor.act({ type: "pass" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReceipt, "结束出牌回执")).toMatchObject({ outcome: "accepted" });
    await room.advance(1);
    await actor.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some(
          (event) => event.kind === "jinnangPhaseResumed" && event.turnPhase === "Roll",
        ),
      "结束出牌事件",
    );
    expect(actor.view.snapshot.turnPhase).toBe("Roll");
    const { decisionPoint } = actor.view;
    expect(actor.view.decisionOptions).toMatchObject({
      kind: "heroDismissal",
      heroDismissals: [{ heroId: "zhouyu", available: true }],
    });
    if (decisionPoint === null) throw new Error("起摇等待期缺少遣散决策点");
    expect(peer.view.decisionOptions).toBeUndefined();
    const cmd = { type: "dismissHero", heroId: "zhouyu" } as const;
    const request: PlayerSubmission = {
      roomId: room.id,
      seat: 0,
      submissionId: "遣散验证",
      decisionPoint,
      cmd,
    };
    peerWire.sendRaw(submissionMsg({ ...request, seat: 1 }));
    expect(await peer.readUntil(isReceipt, "越席遣散拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    actorWire.sendRaw(
      submissionMsg({ ...request, decisionPoint: oldPoint, submissionId: "旧窗遣散" }),
    );
    expect(await actor.readUntil(isReceipt, "迟到遣散拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    actorWire.sendRaw(submissionMsg({ ...request, cmd: { ...cmd, heroId: "huatuo" } }));
    expect(await actor.readUntil(isReceipt, "越名册遣散拒绝")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });
    expect(actor.act({ type: "confirmHeroDismissal" })).toMatchObject({ status: "unavailable" });
    expect(actor.act({ type: "selectHeroToDismiss", heroId: "zhouyu" })).toEqual({
      status: "draft",
    });
    expect(actor.view.snapshot.players[0].heroes).toHaveLength(1);
    expect(actor.act({ type: "confirmHeroDismissal" })).toEqual({ status: "submitted" });
    const receipt = await actor.readUntil(isReceipt, "遣散回执");
    expect(receipt).toMatchObject({ outcome: "accepted" });
    await peer.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some((event) => event.kind === "heroDismissed" && event.heroId === "zhouyu"),
      "遣散事件",
    );
    const returnedBooks = ["skillbook-yingzi", "skillbook-huogong"];
    for (const player of [actor, peer]) {
      const { heroes, treasures } = player.view.snapshot.players[0];
      expect(heroes).toEqual([]);
      expect(treasures.map(({ id }) => id)).toEqual(returnedBooks);
      expect(player.view.snapshot.recruitedHeroIds).not.toContain("zhouyu");
    }
    actorWire.sendRaw(submissionMsg({ ...request, submissionId: receipt.submissionId }));
    expect(await actor.readUntil(isReceipt, "重复遣散回执")).toMatchObject({ outcome: "accepted" });
    expect(actor.view.snapshot.players[0].treasures.map(({ id }) => id)).toEqual(returnedBooks);
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

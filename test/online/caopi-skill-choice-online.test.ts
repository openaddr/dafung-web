import { expect, it } from "bun:test";
import { armHero } from "@dafung/core/engine/planter";
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

async function connect(room: TestRoom, player: HeadlessPlayer) {
  const socket = await room.socket(player.seat);
  await player.connect(socket);
  return socket;
}

async function readSkillAnswer(player: HeadlessPlayer) {
  return player.readUntil(
    (message): message is EventBatchMsg =>
      message.type === "events" &&
      message.events.some(({ kind }) => kind === "skillChoiceAnswered"),
    "技能应答结算",
  );
}

it("放逐由属主草选并确认，越席和非法目标被拒，结算续接原出牌阶段", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    armHero(engine, 1, "caopi", ["fangzhu"]);
    engine.damageStamina(1, 70, 0);
  });
  const owner = new HeadlessPlayer(room.id, 1);
  const actor = new HeadlessPlayer(room.id, 0);
  try {
    const [ownerSocket, actorSocket] = await Promise.all([
      connect(room, owner),
      connect(room, actor),
    ]);
    expect(actor.view.snapshot).toMatchObject({
      activeIndex: 0,
      decisionOwner: 1,
      turnPhase: "AwaitingSkillChoice",
    });
    expect(owner.view.decisionPoint).toEqual(expect.any(String));
    expect(owner.view.decisionOptions).toMatchObject({
      kind: "skillChoice",
      skillId: "fangzhu",
      ownerSeat: 1,
      fixedTargetSeat: null,
      targets: [
        { id: 0, label: "蜀", available: true },
        { id: 1, label: "吴", available: false, reason: "不能指定自己" },
        { id: 2, label: "魏", available: true },
      ],
    });
    expect(actor.view.decisionPoint).toBeNull();
    expect(actor.view.decisionOptions).toBeUndefined();
    expect(actor.view.snapshot.choices).toEqual([]);

    const decisionPoint = owner.view.decisionPoint!;
    const cmd = { type: "respondSkillChoice", seat: 1, use: true, targetSeat: 2 } as const;
    const request: PlayerSubmission = {
      roomId: room.id,
      seat: 1,
      submissionId: "放逐",
      decisionPoint,
      cmd,
    };
    actorSocket.sendRaw(submissionMsg({ ...request, seat: 0, cmd: { ...cmd, seat: 0 } }));
    expect(await actor.readUntil(isReceipt, "越席技能应答")).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    ownerSocket.sendRaw(submissionMsg({ ...request, cmd: { ...cmd, targetSeat: 1 } }));
    expect(await owner.readUntil(isReceipt, "非法技能目标")).toMatchObject({
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });
    ownerSocket.sendRaw(cmdMsg(cmd, 18));
    expect(
      await owner.readUntil((message) => message.type === "error", "旧技能应答入口"),
    ).toMatchObject({
      requestId: 18,
      error: "请携带原决策点和提交编号提交此操作",
    });
    expect(owner.view.decisionPoint).toBe(decisionPoint);

    expect(owner.act({ type: "confirm" })).toMatchObject({ status: "unavailable" });
    expect(owner.act({ type: "toggleTarget", id: 2 })).toEqual({ status: "draft" });
    expect(owner.view.snapshot.players[2].skipTurns).toBe(0);
    expect(owner.act({ type: "confirm" })).toEqual({ status: "submitted" });
    const accepted = await owner.readUntil(isReceipt, "放逐应答回执");
    expect(accepted).toMatchObject({ outcome: "accepted" });
    await room.advance(1);

    for (const player of [owner, actor]) {
      const settlement = await readSkillAnswer(player);
      expect(settlement.events).toContainEqual(
        expect.objectContaining({
          kind: "skillChoiceAnswered",
          skillId: "fangzhu",
          targetSeat: 2,
          skipTurns: 1,
          remainingMarks: 0,
          resumePhase: "AwaitingJinnang",
        }),
      );
      expect(player.view.snapshot).toMatchObject({
        activeIndex: 0,
        turnPhase: "AwaitingJinnang",
      });
      expect(player.view.snapshot.players[2].skipTurns).toBe(1);
    }
    expect(actor.view.decisionOptions?.kind).toBe("playJinnang");

    room.restart();
    await ownerSocket.waitClosed(1000);
    const restored = await connect(room, owner);
    restored.sendRaw(
      submissionMsg({ ...request, submissionId: accepted.submissionId }, accepted.requestId),
    );
    expect(await owner.readUntil(isReceipt, "恢复后重复应答回执")).toEqual(accepted);
    restored.sendRaw(submissionMsg({ ...request, submissionId: "迟到的放逐" }));
    expect(await owner.readUntil(isReceipt, "迟到技能应答")).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(owner.view.snapshot.players[2].skipTurns).toBe(1);
  } finally {
    owner.close();
    actor.close();
    await room.close();
  }
});

it.each([
  { label: "发动", intent: "confirm", resultTarget: 1, restTurns: 3 },
  { label: "暂不发", intent: "pass", resultTarget: null, restTurns: 2 },
] as const)(
  "行殇锁定进入休整的目标，$label 后继续原出牌阶段",
  async ({ intent, resultTarget, restTurns }) => {
    const room = await openHeadlessTestRoom([], (engine) => {
      armHero(engine, 2, "caopi", ["xingshang"]);
      engine.damageStamina(1, 100, 0);
    });
    const owner = new HeadlessPlayer(room.id, 2);
    const actor = new HeadlessPlayer(room.id, 0);
    try {
      const [socket] = await Promise.all([connect(room, owner), connect(room, actor)]);
      expect(owner.view.skillChoice).toMatchObject({
        decision: { skillId: "xingshang", fixedTargetSeat: 1 },
        targets: null,
        canConfirm: true,
        canPass: true,
      });
      expect(actor.view.skillChoice).toBeNull();
      expect(owner.view.snapshot.players[1]).toMatchObject({ skipTurns: 2, resting: true });
      expect(owner.act({ type: "toggleTarget", id: 0 })).toMatchObject({ status: "unavailable" });
      const decisionPoint = owner.view.decisionPoint!;
      socket.sendRaw(
        submissionMsg({
          roomId: room.id,
          seat: 2,
          decisionPoint,
          submissionId: "换掉行殇目标",
          cmd: { type: "respondSkillChoice", seat: 2, use: true, targetSeat: 0 },
        }),
      );
      expect(await owner.readUntil(isReceipt, "行殇目标替换拒绝")).toMatchObject({
        outcome: "rejected",
        reasonCode: "invalidCandidate",
      });
      expect(owner.view.decisionPoint).toBe(decisionPoint);
      expect(owner.act({ type: intent })).toEqual({ status: "submitted" });
      expect(await owner.readUntil(isReceipt, "行殇应答回执")).toMatchObject({
        outcome: "accepted",
      });
      await room.advance(1);

      for (const player of [owner, actor]) {
        const settlement = await readSkillAnswer(player);
        expect(settlement.events).toContainEqual(
          expect.objectContaining({
            kind: "skillChoiceAnswered",
            skillId: "xingshang",
            targetSeat: resultTarget,
            resumePhase: "AwaitingJinnang",
          }),
        );
        expect(player.view.snapshot).toMatchObject({
          activeIndex: 0,
          turnPhase: "AwaitingJinnang",
        });
        expect(player.view.snapshot.players[1]).toMatchObject({
          skipTurns: restTurns,
          resting: true,
        });
        expect(player.view.snapshot.players[0].skipTurns).toBe(0);
      }
    } finally {
      owner.close();
      actor.close();
      await room.close();
    }
  },
);

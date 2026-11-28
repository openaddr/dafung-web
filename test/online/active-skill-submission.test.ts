import { expect, it } from "bun:test";
import type { GameCommand } from "@dafung/core/engine/authority";
import { skillOptionId } from "@dafung/core/engine/choices";
import { armHero, giveJinnang, pinDice, setCash, setStamina } from "@dafung/core/engine/planter";
import { AUTO_ROLL_DELAY_MS } from "@dafung/core/engine/timings";
import { cmdMsg, submissionMsg, type ServerMsg } from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

type TestRoom = Awaited<ReturnType<typeof openHeadlessTestRoom>>;
type ActiveSkillCommand = Extract<GameCommand, { type: "useHeroSkill" }>;

const relief = { type: "useHeroSkill", heroId: "huatuo", skillId: "zhenji" } as const;
const reliefOption = skillOptionId(relief.heroId, relief.skillId);

async function connect(room: TestRoom, player: HeadlessPlayer) {
  const socket = await room.socket(player.seat);
  await player.connect(socket);
  return socket;
}

function skillSubmission(
  room: TestRoom,
  seat: number,
  decisionPoint: string,
  submissionId: string,
  cmd: ActiveSkillCommand,
  requestId?: number,
): string {
  return submissionMsg({ roomId: room.id, seat, decisionPoint, submissionId, cmd }, requestId);
}

function isReply(message: ServerMsg) {
  return (
    message.type === "submissionResult" ||
    message.type === "commandResult" ||
    message.type === "error"
  );
}

async function nextHandStep(player: HeadlessPlayer, previousPoint: string) {
  await player.readUntil(
    (message) =>
      (message.type === "events" || message.type === "snapshot") &&
      message.decisionPoint !== previousPoint &&
      message.decisionOptions?.kind === "playJinnang",
    "新的出牌决策点",
  );
  return player.view.decisionPoint!;
}

it("赈济由技能属主选择、取消和确认，拒绝越席及无效目标，恢复重发只付费一次", async () => {
  const room = await openHeadlessTestRoom([], (engine) => {
    armHero(engine, 0, relief.heroId, [relief.skillId]);
    setCash(engine, 0, 1000);
    setStamina(engine, 1, 50);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  const peer = new HeadlessPlayer(room.id, 1);
  try {
    const [actorSocket, peerSocket] = await Promise.all([
      connect(room, actor),
      connect(room, peer),
    ]);
    const handPoint = actor.view.decisionPoint!;
    expect(actor.view.jinnang?.options.find(({ id }) => id === reliefOption)).toMatchObject({
      skillHeroId: "huatuo",
      skillId: "zhenji",
      available: true,
    });
    expect(peer.view.decisionPoint).toBeNull();
    expect(actor.act({ type: "selectSkill", optionId: reliefOption })).toEqual({ status: "draft" });
    expect(actor.view.jinnang).toMatchObject({
      selectedOption: { id: reliefOption },
      confirmAction: "selectTargets",
    });
    expect(actor.view.decisionPoint).toBe(handPoint);

    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReply, "开始选择赈济目标回执")).toMatchObject({
      type: "submissionResult",
      outcome: "accepted",
    });
    await room.advance(1);
    const firstTargetPoint = await nextHandStep(actor, handPoint);
    expect(actor.view.jinnang).toMatchObject({
      pendingSkill: { heroId: "huatuo", skillId: "zhenji" },
      targets: {
        domain: "seat",
        candidates: [
          { id: 0, label: "蜀", available: true },
          { id: 1, label: "吴", available: true },
          { id: 2, label: "魏", available: true },
        ],
      },
      canConfirm: false,
    });

    expect(actor.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
    expect(actor.act({ type: "cancel" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReply, "作罢赈济回执")).toMatchObject({
      type: "submissionResult",
      outcome: "accepted",
    });
    await room.advance(1);
    const restoredHandPoint = await nextHandStep(actor, firstTargetPoint);
    expect(actor.view.jinnang).toMatchObject({ stage: "hand", pendingSkill: null, targets: null });
    expect(actor.view.jinnang?.options.find(({ id }) => id === reliefOption)?.available).toBe(true);
    expect(actor.view.snapshot.players[0].cash).toBe(1000);
    expect(actor.view.snapshot.players[1].stamina).toBe(50);

    expect(actor.act({ type: "selectSkill", optionId: reliefOption })).toEqual({ status: "draft" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReply, "重开赈济目标回执")).toMatchObject({
      outcome: "accepted",
    });
    await room.advance(1);
    const targetPoint = await nextHandStep(actor, restoredHandPoint);
    expect(targetPoint).not.toBe(firstTargetPoint);
    expect(actor.act({ type: "toggleTarget", id: 2 })).toEqual({ status: "draft" });
    actorSocket.close();
    await actorSocket.waitClosed(1000);
    const resumedSocket = await connect(room, actor);
    expect(actor.view.decisionPoint).toBe(targetPoint);
    expect(actor.view.jinnang).toMatchObject({
      pendingSkill: { heroId: "huatuo", skillId: "zhenji" },
      targets: { selected: [] },
    });

    const confirm = { ...relief, targets: [1] };
    peerSocket.sendRaw(skillSubmission(room, 1, targetPoint, "越席赈济", confirm));
    expect(await peer.readUntil(isReply, "越席赈济拒绝")).toMatchObject({
      type: "submissionResult",
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    resumedSocket.sendRaw(skillSubmission(room, 0, firstTargetPoint, "迟到赈济", confirm));
    expect(await actor.readUntil(isReply, "迟到赈济拒绝")).toMatchObject({
      type: "submissionResult",
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    resumedSocket.sendRaw(
      skillSubmission(room, 0, targetPoint, "无效赈济", { ...relief, targets: [99] }),
    );
    expect(await actor.readUntil(isReply, "无效赈济目标拒绝")).toMatchObject({
      type: "submissionResult",
      outcome: "rejected",
      reasonCode: "invalidCandidate",
    });
    resumedSocket.sendRaw(cmdMsg(confirm, 33));
    expect(await actor.readUntil(isReply, "旧主动技入口拒绝")).toMatchObject({
      type: "error",
      requestId: 33,
      error: "请携带原决策点和提交编号提交此操作",
    });
    expect(actor.view.decisionPoint).toBe(targetPoint);

    expect(actor.act({ type: "toggleTarget", id: 1 })).toEqual({ status: "draft" });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    const accepted = await actor.readUntil(isReply, "发动赈济回执");
    if (accepted.type !== "submissionResult") throw new Error("缺少座位提交回执");
    expect(accepted.outcome).toBe("accepted");
    await room.advance(1);
    for (const player of [actor, peer]) {
      const result = await player.readUntil(
        (message) =>
          message.type === "events" &&
          message.events.some(({ kind }) => kind === "heroSkillActivated"),
        "赈济结算事件",
      );
      expect(result).toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: "heroSkillActivated",
            heroId: "huatuo",
            skillId: "zhenji",
            targetSeat: 1,
          }),
        ]),
      });
      expect(player.view.snapshot.players[0].cash).toBe(900);
      expect(player.view.snapshot.players[1].stamina).toBe(80);
    }
    const cooling = { available: false, reason: "冷却中(还差 3 轮)", skillCooldownLeft: 3 };
    expect(actor.view.jinnang?.options.find(({ id }) => id === reliefOption)).toMatchObject(
      cooling,
    );
    expect(actor.act({ type: "selectSkill", optionId: reliefOption })).toEqual({
      status: "unavailable",
      reason: cooling.reason,
    });
    expect(actor.view.jinnang?.canPass).toBe(true);
    await peer.readUntil(
      (message) => message.type === "snapshot" && message.players[1].stamina === 80,
      "赈济后的公开战报摘要",
    );
    for (const frame of peerSocket.frames) {
      if (frame.type === "snapshot") expect(frame.pendingSkill).toBeNull();
      if (frame.type === "snapshot" || frame.type === "events")
        expect(frame.decisionOptions).toBeUndefined();
    }
    expect(peer.view.snapshot.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("heroRelief owner=p0") }),
      ]),
    );
    expect(
      peer.view.snapshot.log.some(
        ({ detail }) =>
          detail.includes("heroSkillCancel") || detail.includes('"type":"useHeroSkill"'),
      ),
    ).toBe(false);

    room.restart();
    await resumedSocket.waitClosed(1000);
    const reconnected = await connect(room, actor);
    reconnected.sendRaw(
      skillSubmission(room, 0, targetPoint, accepted.submissionId, confirm, accepted.requestId),
    );
    expect(await actor.readUntil(isReply, "恢复后重复发动赈济回执")).toEqual(accepted);
    expect(actor.view.snapshot.players[0].cash).toBe(900);
    expect(actor.view.snapshot.players[1].stamina).toBe(80);
    expect(actor.view.jinnang?.options.find(({ id }) => id === reliefOption)).toMatchObject(
      cooling,
    );
  } finally {
    actor.close();
    peer.close();
    await room.close();
  }
});

it("擂鼓无需目标，赈济银两不足时仅擂鼓可用，发动后自动行军多两步", async () => {
  const drum = { type: "useHeroSkill", heroId: "zhangxingcai", skillId: "leigu" } as const;
  const drumOption = skillOptionId(drum.heroId, drum.skillId);
  const room = await openHeadlessTestRoom([], (engine) => {
    giveJinnang(engine, 0, []);
    armHero(engine, 0, drum.heroId, [drum.skillId]);
    armHero(engine, 0, relief.heroId, [relief.skillId]);
    setCash(engine, 0, 99);
    pinDice(engine, "march", [3]);
  });
  const actor = new HeadlessPlayer(room.id, 0);
  try {
    const socket = await connect(room, actor);
    const handPoint = actor.view.decisionPoint!;
    expect(actor.view.jinnang?.options.find(({ id }) => id === reliefOption)).toMatchObject({
      available: false,
      reason: "银两不足",
    });
    expect(actor.act({ type: "selectSkill", optionId: reliefOption })).toEqual({
      status: "unavailable",
      reason: "银两不足",
    });
    socket.sendRaw(skillSubmission(room, 0, handPoint, "银两不足仍试赈济", relief));
    expect(await actor.readUntil(isReply, "赈济费用拒绝")).toMatchObject({
      type: "submissionResult",
      outcome: "rejected",
      reason: "银两不足",
    });
    expect(actor.view.decisionPoint).toBe(handPoint);

    expect(actor.act({ type: "selectSkill", optionId: drumOption })).toEqual({ status: "draft" });
    expect(actor.view.jinnang).toMatchObject({ confirmAction: "useSkill", targets: null });
    expect(actor.act({ type: "confirm" })).toEqual({ status: "submitted" });
    expect(await actor.readUntil(isReply, "无目标擂鼓回执")).toMatchObject({
      type: "submissionResult",
      outcome: "accepted",
    });
    await room.advance(1);
    await actor.readUntil(
      (message) =>
        message.type === "events" &&
        message.events.some(({ kind }) => kind === "heroSkillActivated"),
      "擂鼓发动事件",
    );
    expect(actor.view.snapshot.turnPhase).toBe("Roll");
    expect(actor.view.jinnang).toBeNull();
    expect(actor.view.decisionOptions?.kind).toBe("heroDismissal");

    await room.advance(AUTO_ROLL_DELAY_MS);
    const march = await actor.readUntil(
      (message) =>
        message.type === "events" && message.events.some(({ kind }) => kind === "marchArrived"),
      "擂鼓行军到达事件",
    );
    expect(march).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ kind: "diceRolled", seat: 0, die: 3 }),
        expect.objectContaining({
          kind: "marchArrived",
          seat: 0,
          path: expect.objectContaining({ traversed: [18, 19, 20, 21, 22] }),
        }),
      ]),
    });
  } finally {
    actor.close();
    await room.close();
  }
});

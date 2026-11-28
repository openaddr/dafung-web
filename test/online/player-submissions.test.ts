import { submitCapitalForSetup } from "./room-capitals";
import { afterEach, expect, it, spyOn } from "bun:test";
import { linkSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armPhase, giveJinnang, pinDice } from "@dafung/core/engine/planter";
import {
  cmdMsg,
  dispatchInbound,
  submissionMsg,
  type PlayerSubmission,
  type ServerMsg,
} from "@dafung/core/protocol/wire";
import { seatDecisionPointOf } from "@dafung/core/room/player-submissions";
import { redactSnapshotForSeat } from "@dafung/core/room/seat-projection";
import { reactionTimingOf } from "@dafung/core/room/reaction-deadline";
import {
  RoomRegistry,
  type RoomClock,
  type RoomLogSink,
  type RoomSession,
} from "@dafung/core/room/room";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { MAP } from "../../scripts/engine-helpers";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registryFor(
  persistence: FileRoomPersistence,
  {
    logSink,
    clock = { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} },
  }: { logSink?: RoomLogSink; clock?: RoomClock } = {},
): RoomRegistry {
  return new RoomRegistry(persistence, undefined, logSink, { clock, reactionWindowMs: 1000 });
}

async function playingRoom(options?: Parameters<typeof registryFor>[1]) {
  const dir = mkdtempSync(join(tmpdir(), "dafung-submission-"));
  directories.push(dir);
  const persistence = new FileRoomPersistence(dir);
  const registry = registryFor(persistence, options);
  const { room, token } = registry.createRoom({
    seatCount: 3,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
  });
  const { roomId } = room;
  registry.joinSeat(roomId);
  registry.joinSeat(roomId);
  registry.setMap(roomId, "guanzhong", token, new Set(["guanzhong"]));
  await registry.startGame(roomId, token, undefined, () => MAP);
  const engine = room.engine!;
  while (engine.phase === "Setup")
    await submitCapitalForSetup(registry, roomId, engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
  giveJinnang(engine, 0, ["连环计", "连环计"]);
  giveJinnang(engine, 1, []);
  giveJinnang(engine, 2, []);
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  return { registry, room, roomId, persistence, engine, dir };
}

function submission(
  room: RoomSession,
  seat: number,
  submissionId: string,
  cmd: PlayerSubmission["cmd"],
): PlayerSubmission {
  const decisionPoint = seatDecisionPointOf(room, seat);
  if (decisionPoint === null) throw new Error(`座位 ${seat} 此时没有决策点`);
  return { roomId: room.roomId, seat, submissionId, decisionPoint, cmd };
}

it("同一提交并发到达、落盘后重启再投均取回首次受理；同号改载荷不能替换原回执", async () => {
  const { registry, room, roomId, persistence, engine } = await playingRoom();
  const first = submission(room, 0, "开选", { type: "useJinnang", cardId: "连环计", handIndex: 1 });
  const [accepted, duplicate] = await Promise.all([
    registry.submitFromSeat(roomId, 0, first),
    registry.submitFromSeat(roomId, 0, first),
  ]);
  expect(accepted.outcome).toBe("accepted");
  expect(duplicate).toEqual(accepted);
  expect(engine.pendingJinnang?.stage).toBe("two-a");
  const oldPoint = first.decisionPoint;
  const nextPoint = seatDecisionPointOf(room, 0);
  expect(nextPoint).not.toBe(oldPoint);
  const rebooted = registryFor(persistence);
  expect(rebooted.restoreAll(() => MAP)).toBe(1);
  const restored = rebooted.get(roomId)!;
  expect(seatDecisionPointOf(restored, 0)).toBe(nextPoint);
  const differentPayload: PlayerSubmission = {
    ...first,
    cmd: { type: "useJinnang", cardId: "连环计", handIndex: 0 },
  };
  expect(await rebooted.submitFromSeat(roomId, 0, differentPayload)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("提交编号"),
  });
  expect(await rebooted.submitFromSeat(roomId, 0, first)).toEqual(accepted);
  expect(restored.engine!.log).toHaveLength(engine.log.length);
});

it("上行把回执只发给连接座位，诊断请求号可换；旧命令不能替代原决策点", async () => {
  const { registry, room, roomId, engine } = await playingRoom();
  const open = submission(room, 0, "选牌", { type: "useJinnang", cardId: "连环计", handIndex: 1 });
  const replies: ServerMsg[] = [];
  const send = (raw: string, seat: number) =>
    dispatchInbound(
      raw,
      {
        submit: (input) => registry.submitFromSeat(roomId, seat, input),
        cmd: (cmd) => registry.applyCommandFromSeat(roomId, seat, cmd),

        setAutoPilot: (on) => registry.setAutoPilot(roomId, seat, on),
      },
      { sendCommandResult: (frame) => replies.push(JSON.parse(frame)) },
    );
  await send(submissionMsg(open, 1), 1);
  expect(replies.pop()).toMatchObject({
    type: "submissionResult",
    outcome: "rejected",
    submissionId: "选牌",
    requestId: 1,
  });
  expect(engine.pendingJinnang).toBeNull();
  await send(submissionMsg(open, 5), 0);
  const accepted = replies.pop();
  if (accepted?.type !== "submissionResult") throw new Error("缺少选牌回执");
  expect(accepted).toMatchObject({
    type: "submissionResult",
    outcome: "accepted",
    submissionId: "选牌",
    requestId: 5,
  });
  expect(await send(cmdMsg({ type: "useJinnang", cardId: null, cancel: true }), 0)).toMatchObject({
    ok: false,
  });
  expect(engine.pendingJinnang?.stage).toBe("two-a");
  await send(submissionMsg(open, 9), 0);
  expect(replies.pop()).toEqual({ ...accepted, requestId: 9 });
});

it("内存入座和提交后的校准各自只拿本席手牌", async () => {
  const { registry, room, roomId } = await playingRoom();
  const messages = [[], []] as ServerMsg[][];
  for (const seat of [0, 1]) {
    registry.connectSeat(roomId, seat, room.seats[seat].token!, {
      seat,
      open: true,
      send: (frame) => messages[seat].push(JSON.parse(frame)),
    });
  }
  function ownHands() {
    return messages.map(
      (stream) => stream.filter((msg) => msg.type === "snapshot").at(-1)!.players[0].jinnangHand,
    );
  }
  expect(ownHands()).toEqual([["连环计", "连环计"], []]);
  for (const stream of messages) stream.length = 0;
  const open = submission(room, 0, "选牌", { type: "useJinnang", cardId: "连环计", handIndex: 1 });
  await registry.submitFromSeat(roomId, 0, open, () => registry.transportBroadcast(roomId));
  registry.flushTransportNow(roomId);
  expect(ownHands()).toEqual([["连环计", "连环计"], []]);
});

it("写盘失败可原样重试，原房间文件在下次原子替换前保持完整", async () => {
  const { registry, room, roomId, persistence, engine, dir } = await playingRoom();
  const pick = submission(room, 0, "选择连环计", {
    type: "useJinnang",
    cardId: "连环计",
    handIndex: 1,
  });
  // 硬链保留当前已提交文件；就地截断重写会破坏这份旧版本。
  const previous = join(dir, "上一版本");
  linkSync(join(dir, `${roomId}.json`), previous);
  const oldFile = readFileSync(previous, "utf8");
  const fail = spyOn(persistence, "save").mockImplementationOnce(() => {
    throw new Error("磁盘已满");
  });
  try {
    await expect(registry.submitFromSeat(roomId, 0, pick)).rejects.toThrow("磁盘已满");
  } finally {
    fail.mockRestore();
  }
  expect(engine.pendingJinnang).toBeNull();
  expect(seatDecisionPointOf(room, 0)).toBe(pick.decisionPoint);
  expect((await registry.submitFromSeat(roomId, 0, pick)).outcome).toBe("accepted");
  expect(engine.pendingJinnang?.stage).toBe("two-a");
  expect(readFileSync(previous, "utf8")).toBe(oldFile);
});

it("连环计拼点保存失败后重试使用同一对钉骰，成功才消费", async () => {
  const { registry, room, roomId, persistence, engine } = await playingRoom();
  pinDice(engine, "duel", [6, 1, 2, 3]);
  const card = { type: "useJinnang", cardId: "连环计", handIndex: 1 } as const;
  await registry.submitFromSeat(roomId, 0, submission(room, 0, "选牌", card));
  await registry.submitFromSeat(roomId, 0, submission(room, 0, "首选", { ...card, targets: [1] }));
  const second = submission(room, 0, "出牌", { ...card, targets: [2] });
  const fail = spyOn(persistence, "save").mockImplementationOnce(() => {
    throw new Error("保存拼点失败");
  });
  try {
    await expect(registry.submitFromSeat(roomId, 0, second)).rejects.toThrow("保存拼点失败");
  } finally {
    fail.mockRestore();
  }
  expect(engine.players[0].jinnangHand).toHaveLength(2);
  expect(await registry.submitFromSeat(roomId, 0, second)).toMatchObject({ outcome: "accepted" });
  expect(engine.gameEvents).toContainEqual(
    expect.objectContaining({
      kind: "duelResolved",
      sides: [
        { seat: 1, roll: 6 },
        { seat: 2, roll: 1 },
      ],
      winnerSeat: 1,
    }),
  );
  expect(engine.players[0].jinnangHand).toHaveLength(1);
  expect(engine.dice.rollDie()).toBe(2);
});

it("已保存的出牌仍在日志写入失败时下行并启动反应窗", async () => {
  let failLog = false;
  const { room, roomId, registry, engine } = await playingRoom({
    logSink() {
      if (failLog) throw new Error("日志追加失败");
    },
  });
  giveJinnang(engine, 1, ["识破诡计"]);
  const card = { type: "useJinnang", cardId: "连环计", handIndex: 1 } as const;
  await registry.submitFromSeat(roomId, 0, submission(room, 0, "起手", card));
  await registry.submitFromSeat(
    roomId,
    0,
    submission(room, 0, "第一位", { ...card, targets: [1] }),
  );
  failLog = true;
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    const opened: number[] = [];
    const result = await registry.submitFromSeat(
      roomId,
      0,
      submission(room, 0, "第二位", { ...card, targets: [2] }),
      () => {
        opened.push(engine.pendingReaction!.seq);
        expect(reactionTimingOf(room).remainingMs).toBeGreaterThan(0);
      },
    );
    expect(result.outcome).toBe("accepted");
    expect(opened).toEqual([engine.pendingReaction!.seq]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(roomId), expect.any(Error));
  } finally {
    errors.mockRestore();
  }
});

it("权威时钟到期但回调未执行时拒绝首次应答，原回执不变并由看门狗代答", async () => {
  let now = 0;
  let next = 0;
  const callbacks = new Map<unknown, () => void>();
  const clock: RoomClock = {
    now: () => now,
    setTimeout(callback) {
      callbacks.set(++next, callback);
      return next;
    },
    clearTimeout: (handle) => {
      callbacks.delete(handle);
    },
  };
  const { registry, room, roomId, engine } = await playingRoom({ clock });
  giveJinnang(engine, 0, ["横征暴敛"]);
  giveJinnang(engine, 1, ["识破诡计"]);
  giveJinnang(engine, 2, ["识破诡计"]);
  await registry.applyCommand(roomId, { type: "useJinnang", cardId: "横征暴敛" });
  const acceptedBefore = submission(room, 1, "截止前不用", {
    type: "respondReaction",
    seat: 1,
    use: false,
  });
  const latePass = submission(room, 2, "到期不用", {
    type: "respondReaction",
    seat: 2,
    use: false,
  });
  const lateUse = submission(room, 2, "到期识破", {
    type: "respondReaction",
    seat: 2,
    use: true,
    cardId: "识破诡计",
    target: { kind: "seat", id: 2 },
  });
  now = 999;
  const accepted = await registry.submitFromSeat(roomId, 1, acceptedBefore);
  expect(accepted.outcome).toBe("accepted");

  now = 1000;
  expect(callbacks.size).toBe(1);
  expect(await registry.submitFromSeat(roomId, 1, acceptedBefore)).toEqual(accepted);
  for (const cmd of [latePass, lateUse]) {
    expect(await registry.submitFromSeat(roomId, 2, cmd)).toMatchObject({
      outcome: "rejected",
      reason: expect.stringContaining("原反应窗已结束"),
    });
  }
  expect(engine.pendingReaction?.answers).toEqual([{ seat: 1, use: false }]);
  expect(engine.players[2].jinnangHand).toEqual(["识破诡计"]);
  const [watchdog] = callbacks.values();
  if (watchdog === undefined) throw new Error("缺少反应窗看门狗回调");
  watchdog();
  expect(engine.pendingReaction).toBeNull();
  expect(engine.gameEvents).toContainEqual(
    expect.objectContaining({ kind: "reactionAnswered", seat: 2, use: false }),
  );
});

it("返回再选后的第二步拒收旧指令；重启能取回首次非法目标的原因和已扣牌的原回执", async () => {
  const { room, roomId, registry, persistence, engine } = await playingRoom();
  const card = { type: "useJinnang", cardId: "连环计", handIndex: 1 } as const;
  const act = (id: string, fields: { targets?: number[]; back?: boolean } = {}) =>
    registry.submitFromSeat(roomId, 0, submission(room, 0, id, { ...card, ...fields }));
  await act("选牌");
  await act("首选", { targets: [1] });
  const late = submission(room, 0, "旧第二步", { ...card, targets: [2] });
  await act("返回", { back: true });
  await act("重选", { targets: [1] });
  expect(await registry.submitFromSeat(roomId, 0, late)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("决策点已结束"),
  });
  const illegal = submission(room, 0, "两次同一目标", { ...card, targets: [1] });
  const rejected = await registry.submitFromSeat(roomId, 0, illegal);
  expect(rejected).toMatchObject({ outcome: "rejected", reason: expect.stringContaining("目标") });
  expect(engine.players[0].jinnangHand).toHaveLength(2);
  const complete = submission(room, 0, "最终出牌", { ...card, targets: [2] });
  expect(complete.decisionPoint).toBe(illegal.decisionPoint);
  const logOffset = redactSnapshotForSeat(engine.snapshot(), 0).log.length;
  await expect(
    registry.submitFromSeat(roomId, 0, complete, () => {
      throw new Error("保存后连接中断");
    }),
  ).rejects.toThrow("保存后连接中断");
  const rebooted = registryFor(persistence);
  expect(rebooted.restoreAll(() => MAP)).toBe(1);
  expect(await rebooted.submitFromSeat(roomId, 0, illegal)).toEqual(rejected);
  expect(await rebooted.submitFromSeat(roomId, 0, complete)).toEqual({
    outcome: "accepted",
    logOffset,
  });
  expect(rebooted.get(roomId)!.engine!.players[0].jinnangHand).toEqual(["连环计"]);
});

it("受问席收回托管时经内存端点取回原反应窗授权", async () => {
  const { room, roomId, registry, persistence, engine } = await playingRoom();
  giveJinnang(engine, 0, ["横征暴敛"]);
  for (const seat of [1, 2]) giveJinnang(engine, seat, ["识破诡计"]);
  await registry.applyCommand(roomId, { type: "useJinnang", cardId: "横征暴敛" });
  const original = submission(room, 1, "收回后不用", {
    type: "respondReaction",
    seat: 1,
    use: false,
  });
  const saved = persistence.load(roomId)!;
  // 模拟进程在托管保存后、授权交给驱动链前退出。
  persistence.save({ ...saved, autoPilot: [1] });
  const rebooted = registryFor(persistence);
  expect(rebooted.restoreAll(() => MAP)).toBe(1);
  const messages: ServerMsg[][] = [[], [], []];
  let resolveLobby!: () => void;
  const lobby = new Promise<void>((resolve) => {
    resolveLobby = resolve;
  });
  try {
    for (const seat of [0, 1, 2]) {
      rebooted.connectSeat(roomId, seat, room.seats[seat].token!, {
        seat,
        open: true,
        send(frame) {
          const message = JSON.parse(frame) as ServerMsg;
          messages[seat].push(message);
          if (seat === 1 && message.type === "lobby") resolveLobby();
        },
      });
    }
    expect(messages[1][0]).toMatchObject({ type: "snapshot", decisionPoint: null });
    const broadcast = () => rebooted.transportBroadcast(roomId);
    await rebooted.setAutoPilot(roomId, 1, false, broadcast);
    await lobby;
    const update = messages[1].find((message) => message.type === "events");
    expect(update).toMatchObject({
      type: "events",
      events: [],
      decisionPoint: original.decisionPoint,
      reactionTiming: { seq: engine.pendingReaction!.seq, remainingMs: 1000 },
    });
    for (const seat of [0, 2])
      expect(messages[seat].slice(1).map(({ type }) => type)).toEqual(["lobby"]);
    if (update?.decisionPoint == null) throw new Error("未收到原反应窗授权");
    expect(
      await rebooted.submitFromSeat(roomId, 1, {
        ...original,
        decisionPoint: update.decisionPoint,
      }),
    ).toMatchObject({
      outcome: "accepted",
    });
    expect(rebooted.get(roomId)!.engine!.pendingReaction?.answers).toEqual([
      { seat: 1, use: false },
    ]);
  } finally {
    rebooted.dismissRoom(roomId, room.seats[0].token!);
  }
});

it("各受问席独立作答；同席进入下一轮识破后首次迟到的原应答保留牌和新窗机会", async () => {
  const { room, roomId, registry, engine } = await playingRoom();
  giveJinnang(engine, 1, ["识破诡计"]);
  giveJinnang(engine, 2, ["识破诡计"]);
  const card = { type: "useJinnang", cardId: "连环计", handIndex: 1 } as const;
  for (const [step, targets] of [undefined, [1], [2]].entries())
    await registry.submitFromSeat(
      roomId,
      0,
      submission(room, 0, `出牌步骤${step}`, { ...card, targets }),
    );
  const counter = submission(room, 1, "识破", {
    type: "respondReaction",
    seat: 1,
    use: true,
    cardId: "识破诡计",
  });
  const decline = submission(room, 2, "第一轮不用", {
    type: "respondReaction",
    seat: 2,
    use: false,
  });
  const late = submission(room, 2, "第一轮迟到", {
    type: "respondReaction",
    seat: 2,
    use: true,
    cardId: "识破诡计",
  });
  const malformed = submission(room, 2, "带牌面弃权", {
    type: "respondReaction",
    seat: 2,
    use: false,
    cardId: "识破诡计",
  });
  const logBefore = engine.log.length;
  expect(await registry.submitFromSeat(roomId, 2, malformed)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("不用"),
  });
  expect(engine.log).toHaveLength(logBefore);
  expect((await registry.submitFromSeat(roomId, 1, counter)).outcome).toBe("accepted");
  expect(seatDecisionPointOf(room, 1)).toBeNull();
  expect(seatDecisionPointOf(room, 2)).toBe(decline.decisionPoint);
  expect((await registry.submitFromSeat(roomId, 2, decline)).outcome).toBe("accepted");
  const next = submission(room, 2, "新窗不用", { type: "respondReaction", seat: 2, use: false });
  expect(next.decisionPoint).not.toBe(late.decisionPoint);
  expect(await registry.submitFromSeat(roomId, 2, late)).toMatchObject({
    outcome: "rejected",
    reason: expect.stringContaining("原反应窗已结束"),
  });
  expect(engine.players[2].jinnangHand).toEqual(["识破诡计"]);
  expect(seatDecisionPointOf(room, 2)).toBe(next.decisionPoint);
  expect((await registry.submitFromSeat(roomId, 2, next)).outcome).toBe("accepted");
});

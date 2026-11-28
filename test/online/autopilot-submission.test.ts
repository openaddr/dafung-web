import { expect, it } from "bun:test";
import { giveJinnang } from "@dafung/core/engine/planter";
import type { ServerMsg, SubmissionResultMsg } from "@dafung/core/protocol/wire";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { openHeadlessTestRoom } from "./headless-player-room";

const receipt = (message: ServerMsg): message is SubmissionResultMsg =>
  message.type === "submissionResult";
const WAIT_MS = 2000;

async function waitForAutopilot(player: HeadlessPlayer, on: boolean): Promise<void> {
  let accepted = false;
  await player.readUntil(
    (message) => {
      if (receipt(message)) {
        expect(message.outcome).toBe("accepted");
        accepted = true;
      }
      return accepted && player.view.autopilot?.on === on;
    },
    "本席托管回执与新状态",
    WAIT_MS,
  );
}

it("非行动席经认证连接切换托管，其他座位只观察公开变化且不会重收上一批事件", async () => {
  const room = await openHeadlessTestRoom();
  try {
    const actor = new HeadlessPlayer(room.id, 0);
    const guest = new HeadlessPlayer(room.id, 1);
    const actorWire = await room.socket(0);
    await actor.connect(actorWire);
    const guestWire = await room.socket(1);
    await guest.connect(guestWire);
    const actorPoint = actor.view.decisionPoint;
    expect(actorPoint).not.toBeNull();
    expect(guest.view.decisionPoint).toBeNull();
    const initial = guest.view.autopilot;
    if (initial === undefined) throw new Error("非行动席缺少托管权限");
    expect(actor.view.autopilot?.decisionPoint).not.toBe(initial.decisionPoint);
    const framesBefore = actorWire.frames.length;

    expect(guest.act({ type: "setAutoPilot", on: true })).toEqual({ status: "submitted" });
    await Promise.all([
      waitForAutopilot(guest, true),
      actor.readUntil(
        (message) =>
          (message.type === "snapshot" || message.type === "lobby") && message.seats[1].autoPilot,
        "吴的公开托管状态",
        WAIT_MS,
      ),
    ]);
    expect(guest.view.autopilotOn).toBe(true);
    expect(actor.view.decisionPoint).toBe(actorPoint);
    expect(
      actorWire.frames.slice(framesBefore).filter((m) => m.type === "events" || receipt(m)),
    ).toEqual([]);

    const staleReclaim = {
      roomId: room.id,
      seat: 1,
      submissionId: "旧托管授权",
      decisionPoint: initial.decisionPoint,
      cmd: { type: "setAutoPilot", on: false } as const,
    };
    actorWire.sendSubmission(staleReclaim);
    expect(await actor.readUntil(receipt, "跨席提交拒绝", WAIT_MS)).toMatchObject({
      outcome: "rejected",
      reasonCode: "wrongSeat",
    });
    guestWire.sendSubmission(staleReclaim);
    expect(await guest.readUntil(receipt, "迟到收回拒绝", WAIT_MS)).toMatchObject({
      outcome: "rejected",
      reasonCode: "staleDecisionPoint",
    });
    expect(guest.view.autopilotOn).toBe(true);

    expect(guest.act({ type: "setAutoPilot", on: false })).toEqual({ status: "submitted" });
    await waitForAutopilot(guest, false);
    expect(guest.view.autopilot).toMatchObject({ on: false });
    expect(guest.view.autopilot?.decisionPoint).not.toBe(initial.decisionPoint);
  } finally {
    await room.close();
  }
});

it("切换保存失败不代打，随后回执失联重启后重发只保留一次控制转移与代打动作", async () => {
  const room = await openHeadlessTestRoom([], (engine) => giveJinnang(engine, 0, ["横征暴敛"]));
  try {
    const player = new HeadlessPlayer(room.id, 0);
    const first = await room.socket(0);
    await player.connect(first);
    const initial = player.view;
    if (initial.autopilot === undefined) throw new Error("发起席缺少托管权限");
    const [actorCash, firstTargetCash, secondTargetCash] = initial.snapshot.players.map(
      (p) => p.cash,
    );

    room.failNextSave();
    expect(player.act({ type: "setAutoPilot", on: true })).toEqual({ status: "submitted" });
    await expect(player.readUntil(receipt, "保存失败", WAIT_MS)).rejects.toThrow("磁盘已满");
    const observer = await room.socket(1);
    const unchanged = await observer.waitSnapshot(null, "保存失败后的局面", WAIT_MS);
    expect(unchanged.seats[0].autoPilot).toBe(false);
    expect(unchanged.players.map((p) => p.cash)).toEqual([
      actorCash,
      firstTargetCash,
      secondTargetCash,
    ]);
    expect(unchanged.log.some((line) => line.detail.includes('"type":"autopilot"'))).toBe(false);

    const lostReceipt = room.dropNextReceipt();
    const retry = await room.socket(0);
    await player.connect(retry);
    const saved = await lostReceipt;
    expect(saved.outcome).toBe("accepted");
    await retry.waitClosed(WAIT_MS);
    expect(retry.frames.some(receipt)).toBe(false);
    room.restart();

    const restored = await room.socket(0);
    await player.connect(restored);
    expect(await player.readUntil(receipt, "原提交重发回执", WAIT_MS)).toEqual(saved);
    expect(player.view.autopilotOn).toBe(true);
    expect(player.view.snapshot.players.map((p) => p.cash)).toEqual([
      actorCash + 400,
      firstTargetCash - 200,
      secondTargetCash - 200,
    ]);
    expect(player.view.snapshot.jinnangDiscard.filter((card) => card === "横征暴敛")).toHaveLength(
      1,
    );
    const log = player.view.snapshot.log;
    const transitions = log.filter((line) => line.detail.includes('"type":"autopilot"'));
    expect(transitions).toHaveLength(1);
    if (!("logOffset" in saved)) throw new Error("托管回执缺少日志行号");
    expect(saved.logOffset).toBe(log.indexOf(transitions[0]));
  } finally {
    await room.close();
  }
}, 6000);

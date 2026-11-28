import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armPhase, giveJinnang } from "@dafung/core/engine/planter";
import {
  submissionMsg,
  type EventBatchMsg,
  type PlayerSubmission,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";
import { RoomRegistry } from "@dafung/core/room/room";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { MAP } from "../../scripts/engine-helpers";
import { OnlineClient } from "../../scripts/online-client";
import { submitCapitalForSetup } from "./room-capitals";

const WINDOW_MS = 60_000;
const WAIT_MS = 2_000;
const TEST_MS = 12_000;

// 每次进程启动建立自己的相对时钟原点。IPC 拨绝对时间，定时动作仍由生产原生定时器执行。
const serverEntry = `
  const startedAt = Number(process.env.TEST_REACTION_STARTED_AT);
  let now = startedAt;
  Date.now = () => now;
  performance.now = () => now - startedAt;
  const { engineServer } = await import("./apps/server/src/server.ts");
  process.on("message", (time) => {
    now = time;
    process.send(now);
  });
  process.send(engineServer.port);
`;

async function waitUntil<T>(read: () => T | undefined, desc: string): Promise<T> {
  const expires = performance.now() + WAIT_MS;
  do {
    const result = read();
    if (result !== undefined) return result;
    await Bun.sleep(10);
  } while (performance.now() < expires);
  throw new Error(`等待超时: ${desc}`);
}

function startServer(directory: string, startedAt: number) {
  const messages: number[] = [];
  const proc = Bun.spawn([process.execPath, "--eval", serverEntry], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      ROOMS_DIR: directory,
      LOGS_DIR: directory,
      DECISION_TIMEOUT_MS: "0",
      RETENTION_WINDOW_MS: "0",
      E2E_REACTION_MS: String(WINDOW_MS),
      TEST_REACTION_STARTED_AT: String(startedAt),
    },
    stdout: "ignore",
    stderr: "inherit",
    ipc(message: number) {
      messages.push(message);
    },
  });
  const next = (desc: string) =>
    waitUntil(() => {
      if (proc.exitCode !== null) throw new Error(`等待${desc}时服务端已退出:${proc.exitCode}`);
      return messages.shift();
    }, desc);
  return {
    port: next("服务端监听"),
    async setTime(now: number) {
      proc.send(now);
      expect(await next("时钟确认")).toBe(now);
    },
    async stop() {
      if (proc.exitCode === null) proc.kill();
      await proc.exited;
    },
  };
}

async function seedPlayingRoom(persistence: FileRoomPersistence) {
  const registry = new RoomRegistry(persistence, undefined, undefined, {
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const { room, token } = registry.createRoom({
    seatCount: 3,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
  });
  const { roomId } = room;
  const tokens = [token, registry.joinSeat(roomId).token, registry.joinSeat(roomId).token];
  registry.setMap(roomId, "guanzhong", token, new Set(["guanzhong"]));
  await registry.startGame(roomId, token, undefined, () => MAP);
  const engine = room.engine!;
  while (engine.phase === "Setup")
    await submitCapitalForSetup(
      registry,
      roomId,
      engine.currentSetupPlayerIndex,
      engine.offeredCapitals[0],
    );
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  giveJinnang(engine, 0, ["连环计"]);
  for (const seat of [1, 2]) giveJinnang(engine, seat, ["识破诡计"]);
  persistence.save({ ...persistence.load(roomId)!, snapshot: engine.snapshot() });
  return { roomId, tokens };
}

function decisionPointOf(view: { decisionPoint: string | null }): string {
  if (view.decisionPoint === null) throw new Error("本席缺少决策点");
  return view.decisionPoint;
}

function submit(peer: OnlineClient, intent: PlayerSubmission): Promise<SubmissionResultMsg> {
  peer.sendRaw(submissionMsg(intent));
  return peer.waitFor<SubmissionResultMsg>(
    (message) =>
      message.type === "submissionResult" && message.submissionId === intent.submissionId,
    intent.submissionId,
    WAIT_MS,
  );
}

it.skipIf(!process.env.DAFUNG_SLOW)(
  "真实服务器重启沿用反应窗截止、已答与回执，无人连接时到期推进并独立计时下一窗",
  async () => {
    const openedAt = Date.now();
    const directory = mkdtempSync(join(tmpdir(), "dafung-reaction-recovery-"));
    const persistence = new FileRoomPersistence(directory);
    const peers: OnlineClient[] = [];
    let server: ReturnType<typeof startServer> | undefined;
    try {
      const { roomId, tokens } = await seedPlayingRoom(persistence);
      const restart = async (now: number) => {
        await server?.stop();
        for (const peer of peers.splice(0)) peer.close();
        server = startServer(directory, now);
        const port = await server.port;
        expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
      };
      const connect = async (seat: number) => {
        if (server === undefined) throw new Error("服务端尚未启动");
        const port = await server.port;
        const peer = await OnlineClient.connect(
          `ws://127.0.0.1:${port}/ws?room=${roomId}&seat=${seat}&token=${tokens[seat]}`,
          { openTimeoutMs: WAIT_MS },
        );
        peers.push(peer);
        const snapshot = await peer.waitSnapshot(null, `座位 ${seat} 的原座摘要`, WAIT_MS);
        return { peer, snapshot };
      };

      await restart(openedAt);
      const actor = await connect(0);
      const first = await connect(1);
      const second = await connect(2);
      let point = decisionPointOf(actor.snapshot);
      for (const [step, targets] of [undefined, [1], [2]].entries()) {
        expect(
          await submit(actor.peer, {
            roomId,
            seat: 0,
            decisionPoint: point,
            submissionId: `连环计第 ${step + 1} 步`,
            cmd: { type: "useJinnang", cardId: "连环计", handIndex: 0, targets },
          }),
        ).toMatchObject({ outcome: "accepted" });
        if (step < 2) {
          const next = await actor.peer.waitFor<EventBatchMsg>(
            (message) => message.type === "events" && message.decisionPoint !== point,
            "连环计的下一步授权",
            WAIT_MS,
          );
          point = decisionPointOf(next);
        }
      }
      const opened = (peer: OnlineClient) =>
        peer.waitFor<EventBatchMsg>(
          (message) =>
            message.type === "events" && message.events.some((e) => e.kind === "reactionOpened"),
          "连环计开窗",
          WAIT_MS,
        );
      const firstWindow = await opened(first.peer);
      const secondWindow = await opened(second.peer);
      if (firstWindow.reactionTiming === undefined) throw new Error("开窗缺少计时");
      const { seq } = firstWindow.reactionTiming;
      expect(secondWindow.reactionTiming).toEqual({ seq, remainingMs: WINDOW_MS });

      const counter: PlayerSubmission = {
        roomId,
        seat: 1,
        decisionPoint: decisionPointOf(firstWindow),
        submissionId: "截止前识破",
        cmd: { type: "respondReaction", seat: 1, use: true, cardId: "识破诡计" },
      };
      const late: PlayerSubmission = {
        roomId,
        seat: 2,
        decisionPoint: decisionPointOf(secondWindow),
        submissionId: "原窗到期首次作答",
        cmd: { type: "respondReaction", seat: 2, use: false },
      };
      await server!.setTime(openedAt + 10_000);
      const receipt = await submit(first.peer, counter);
      expect(receipt).toMatchObject({ outcome: "accepted" });
      const answered = await second.peer.waitFor<EventBatchMsg>(
        (message) =>
          message.type === "events" && message.events.some((e) => e.kind === "reactionAnswered"),
        "同窗收到先答席的应答",
        WAIT_MS,
      );
      expect(answered).toMatchObject({
        decisionPoint: late.decisionPoint,
        reactionTiming: { seq, remainingMs: 50_000 },
      });

      await restart(openedAt + 20_000);
      const stillWaiting = await connect(2);
      expect(stillWaiting.snapshot.reactionTiming).toEqual({ seq, remainingMs: 40_000 });
      expect(stillWaiting.snapshot.decisionPoint).toBe(late.decisionPoint);
      expect(stillWaiting.snapshot.pendingReaction).toMatchObject({
        seq,
        answers: [{ seat: 1, use: true, cardId: "识破诡计" }],
      });
      const alreadyAnswered = await connect(1);
      expect(alreadyAnswered.snapshot.decisionPoint).toBeNull();

      // 原生回调仍在 40 秒之后。先把权威时钟拨到原截止，验证首次到达的应答。
      await server!.setTime(openedAt + WINDOW_MS);
      const rejected = await submit(stillWaiting.peer, late);
      expect(rejected).toMatchObject({ outcome: "rejected", reason: "原反应窗已结束" });
      expect(await submit(alreadyAnswered.peer, counter)).toEqual(receipt);

      await restart(openedAt + WINDOW_MS + 5_000);
      await waitUntil(() => {
        const next = persistence.load(roomId)?.snapshot?.pendingReaction;
        return next != null && next.seq !== seq ? next.seq : undefined;
      }, "首次重连前超时处理已保存");

      const next = await connect(2);
      const afterCounter = await connect(1);
      if (next.snapshot.pendingReaction === null) throw new Error("超时后缺少反识破窗");
      const newSeq = next.snapshot.pendingReaction.seq;
      expect(newSeq).not.toBe(seq);
      expect(next.snapshot).toMatchObject({
        reactionTiming: { seq: newSeq, remainingMs: WINDOW_MS },
        pendingReaction: { answers: [], view: { cardId: "识破诡计", userSeat: 1 } },
      });
      expect(decisionPointOf(next.snapshot)).not.toBe(late.decisionPoint);
      expect(next.snapshot.players[2].jinnangHand).toEqual(["识破诡计"]);
      expect(afterCounter.snapshot.players[1].jinnangHand).toEqual([]);
      const responseAudit = next.snapshot.log.filter((line) =>
        line.detail.startsWith("reactionRespond "),
      );
      expect(responseAudit.map((line) => line.detail)).toEqual([
        `reactionRespond seat=${next.snapshot.players[1].id} use=1 card=识破诡计`,
        `reactionRespond seat=${next.snapshot.players[2].id} use=0 card=- share=-`,
      ]);
      expect(await submit(afterCounter.peer, counter)).toEqual(receipt);
      expect(await submit(next.peer, late)).toEqual(rejected);
      expect(
        await submit(next.peer, {
          ...late,
          decisionPoint: decisionPointOf(next.snapshot),
          submissionId: "新窗不用",
        }),
      ).toMatchObject({ outcome: "accepted" });
    } finally {
      await server?.stop();
      for (const peer of peers) peer.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  TEST_MS,
);

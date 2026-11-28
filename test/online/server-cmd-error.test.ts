// 真实 HTTP/WS 经 wire 分发、房间校验和权威引擎，验证带号诊断回执及原有 error 通道。
// 另守住权威日志与事件批、校准摘要的下行次序和重连接续。
// spawn 前预检端口无残孤占位(#594 同主题的 bun:test 版,2026-10-19 实锤:
// 残孤占 4280 → 健康检查打旧进程、新进程 EADDRINUSE 暴毙 → exitCode 假失败)。
// 慢例池(测试管线提速批):真进程真 WS 整例实测 3.4s(2026-10-30)——按「单例实测 ≥3s」
// 判据入慢例池(口径见 docs/how-to/开发与测试.md「把测试跑起来」),DAFUNG_SLOW=1 才跑
// (bun run test:slow),默认池 skip(skip 行可见)。用 describe 级 skipIf:探针实测
// bun:test 下 it 全跳时文件级 beforeAll 照跑(白起一次服务器),describe 级才连钩子
// 一起跳;房间临时目录随之挪进 beforeAll(全跳时不再创建,不泄漏),清理在 afterAll 配对。
// spawn 端口按 workspace 名派生(#1181,单源 scripts/dev-ports.ts,基址 4280 与
// protocol-online 的 4281 保持历史 1 间隔——同 workspace 两测试同跑各占一口):
// 并行 workspace 同跑慢池不撞口;显式 env DAFUNG_CMD_ERROR_PORT 最高优先可覆盖。
import { submitCapitalForSetup } from "./room-capitals";
import { describe, it, expect, afterAll, beforeAll, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { cmdErrorTestPort } from "../../scripts/dev-ports";
import { OnlineClient } from "../../scripts/online-client";
import { FaultProxy } from "../../scripts/fault-proxy";
import { MAP } from "../../scripts/engine-helpers";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { armPhase, giveJinnang } from "@dafung/core/engine/planter";
import { RoomRegistry } from "@dafung/core/room/room";
import { seatDecisionPointOf } from "@dafung/core/room/player-submissions";
import {
  cmdMsg,
  submissionMsg,
  type GameLogMsg,
  type PlayerSubmission,
  type SnapshotMsg,
  type SubmissionResultMsg,
} from "@dafung/core/protocol/wire";

// 慢例池开关:describe 级 skip 连钩子一起跳(默认池不白起服务器);DAFUNG_SLOW=1 才跑,判据见文件头注。
const describeSlow = describe.skipIf(!process.env.DAFUNG_SLOW);

// 派生端口(#1181):workspace 身份 = 仓库根目录名(test/ 的上级);空串 env 兜派生
// 默认(`||` 同 playwright.config #807 口径)。
const PORT =
  process.env.DAFUNG_CMD_ERROR_PORT ||
  String(cmdErrorTestPort(basename(join(import.meta.dir, "..", ".."))));
const BASE = `http://127.0.0.1:${PORT}`;

function capitalSubmission(snapshot: SnapshotMsg): PlayerSubmission {
  const { decisionPoint, decisionOptions, roomId, currentSetupPlayerIndex: seat } = snapshot;
  const candidate = decisionOptions?.options.find((option) => option.available);
  if (decisionPoint === null || candidate === undefined) throw new Error("缺少本席可用选都选项");
  return {
    roomId,
    seat,
    decisionPoint,
    submissionId: `capital-${seat}`,
    cmd: { type: "pickCapital", tileIndex: candidate.tileIndex },
  };
}

async function confirmCapital(peers: OnlineClient[], publicProgress: SnapshotMsg): Promise<void> {
  const peer = peers[publicProgress.currentSetupPlayerIndex];
  const matches = (snapshot: SnapshotMsg) =>
    snapshot.currentDraftIndex === publicProgress.currentDraftIndex &&
    snapshot.decisionOptions?.kind === "pickCapital";
  const privateView =
    peer.snapshot !== null && matches(peer.snapshot)
      ? peer.snapshot
      : await peer.waitSnapshot(matches, "本席选都摘要", 2000);
  const submission = capitalSubmission(privateView);
  peer.sendSubmission(submission);
  expect(
    await peer.waitFor(
      (message) =>
        message.type === "submissionResult" && message.submissionId === submission.submissionId,
      "选都回执",
      2000,
    ),
  ).toMatchObject({ outcome: "accepted" });
}

let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
// 房间临时目录在 beforeAll 里创建(describe 级 skip 时钩子不跑,模块级 mkdtemp 会
// 每轮默认池白漏一个临时目录);清理在 describe 内 afterAll 配对。
let ROOMS_DIR: string;

let live: Awaited<ReturnType<typeof recoveryFixture>>;
let expired: Awaited<ReturnType<typeof recoveryFixture>>;

async function recoveryFixture(roomsDir: string, pendingAutoPilot = false) {
  const persistence = new FileRoomPersistence(roomsDir);
  const registry = new RoomRegistry(persistence, undefined, undefined, {
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
    reactionWindowMs: 60_000,
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
  if (pendingAutoPilot) {
    armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
    giveJinnang(engine, 0, ["横征暴敛"]);
    for (const seat of [1, 2]) giveJinnang(engine, seat, ["识破诡计"]);
    await registry.applyCommand(roomId, { type: "useJinnang", cardId: "横征暴敛" });
    // 模拟托管已保存、下一拍代答前进程中断，归档仍欠最后一行。
    const record = persistence.load(roomId)!;
    persistence.save({ ...record, autoPilot: [1] });
  }
  const point = seatDecisionPointOf(room, 2);
  const log = engine.log.map((line) => JSON.stringify(line));
  const archive = join(roomsDir, `${engine.gameId}.jsonl`);
  return { roomId, tokens, point, log, archive };
}

async function waitHealthy(
  server: Bun.Subprocess<"ignore", "pipe", "pipe">,
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* 未起监听,继续轮询 */
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `服务器 ${timeoutMs}ms 内未就绪;stderr:${await new Response(server.stderr).text()}`,
  );
}

async function startServer(): Promise<void> {
  proc = Bun.spawn([process.execPath, "apps/server/src/server.ts"], {
    cwd: join(import.meta.dir, "..", ".."), // 仓库根:地图清单 ./public/maps 相对 cwd 解析(缺失即抛)
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      ROOMS_DIR,
      LOGS_DIR: ROOMS_DIR, // 对局日志一并落临时目录,不污染仓库 data/
      LOG_TTL_DAYS: "30",
      DECISION_TIMEOUT_MS: "0",
      RETENTION_WINDOW_MS: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitHealthy(proc);
}

function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<Record<string, unknown>>);
}

/** 收一条下行(文本帧),JSON 解出;超时抛错(区分「没有下行」与「下行形状错」)。 */
function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待下行超时")), timeoutMs);
    ws.addEventListener(
      "message",
      (ev) => {
        clearTimeout(timer);
        const data = typeof ev.data === "string" ? ev.data : "无法解析的下行帧";
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          reject(new Error(`下行非 JSON:${data}`));
        }
      },
      { once: true },
    );
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("连接被关闭(未收到下行)——疑似服务器进程已崩"));
    });
  });
}

/** 连收下行直至出现指定类型(开局期 bot 驱动的 events/snapshot 广播与错误回报交织,逐条滤过)。 */
async function nextMessageOfType(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  for (;;) {
    const msg = await nextMessage(ws, timeoutMs);
    if (msg.type === type) return msg;
  }
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("WS 连接失败")), { once: true });
  });
}

describeSlow("server WS 命令回报与对局日志", () => {
  beforeAll(async () => {
    ROOMS_DIR = mkdtempSync(join(tmpdir(), "dafung-428-"));
    let stale = false;
    try {
      stale = (await fetch(`${BASE}/health`)).ok;
    } catch {
      /* 连接失败 = 端口空闲,正常路径 */
    }
    if (stale) {
      throw new Error(
        `端口 ${PORT} 已有 /health 应答:疑似残孤测试服占位(新进程将 EADDRINUSE 假失败)。` +
          `处置:netstat -ano | grep :${PORT} 查 PID → tasklist 验名为 bun.exe → taskkill //PID <pid> //F`,
      );
    }
    live = await recoveryFixture(ROOMS_DIR, true);
    writeFileSync(live.archive, live.log.slice(0, -1).join("\n") + "\n");
    const oldTime = Date.now() - 31 * 86_400_000;
    const age = spyOn(Date, "now").mockReturnValue(oldTime);
    try {
      expired = await recoveryFixture(ROOMS_DIR);
    } finally {
      age.mockRestore();
    }
    writeFileSync(expired.archive, expired.log.join("\n") + "\n");
    const oldDate = new Date(oldTime);
    utimesSync(expired.archive, oldDate, oldDate);
    await startServer();
  });

  afterAll(() => {
    // proc 可能未 spawn(beforeAll 残孤预检已显式抛出完整处置诊断)——此处只清理
    // 已存在的资源;旧写法 proc.kill() 炸 TypeError 反把预检诊断埋成两团噪音,
    // 且抛点在 rmSync 之前,每次预检失败还泄漏一个 tmp 房间目录(#632 实锤)。
    proc?.kill();
    rmSync(ROOMS_DIR, { recursive: true, force: true });
  });

  it("省略建房人数时创建六席房间", async () => {
    const created = await post("/room/new", {});
    expect(created).toMatchObject({ ok: true, seat: 0, seatCount: 6 });
    expect(created.seats).toHaveLength(6);
  });

  it("显式传入非法建房人数时返回 400", async () => {
    for (const seats of [null, 2.5, "2 seats", [2]]) {
      const response = await fetch(`${BASE}/room/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false });
    }
  });

  it("编号回执区分未处理、权威告警、拒绝和成功", async () => {
    const created = await post("/room/new", { seats: 2, bot: "1", seed: 42 });
    const roomId = created.roomId as string;
    const token = created.seatToken as string;
    expect(created.ok).toBe(true);
    await post("/room/map", { roomId, seatToken: token, mapId: "guanzhong" });
    const ws = await openWs(`ws://127.0.0.1:${PORT}/ws?room=${roomId}&seat=0&token=${token}`);

    try {
      expect((await nextMessage(ws)).type).toBe("lobby");
      ws.send(cmdMsg({ type: "rollAndMove" }, 5));
      expect(await nextMessageOfType(ws, "commandResult", 1000)).toEqual({
        type: "commandResult",
        requestId: 5,
        outcome: "unprocessed",
        reason: "对局未开始",
      });

      const firstSnapshot = nextMessageOfType(ws, "snapshot");
      const started = await post("/room/start", { roomId, seatToken: token });
      expect(started).toEqual({ ok: true });
      const first = await firstSnapshot;
      expect(first.currentSetupPlayerIndex).toBe(0);
      const firstLogLength = (first.log as unknown[]).length;

      // 非购买阶段，权威只记告警，回执带安全原因和告警序位。
      ws.send(cmdMsg({ type: "buyProperty" }, 6));
      expect(await nextMessageOfType(ws, "commandResult", 1000)).toEqual({
        type: "commandResult",
        requestId: 6,
        outcome: "warning",
        reason: "阶段不符（需要 AwaitingDecision，当前 Roll）",
        logOffset: firstLogLength + 1,
      });

      // 旧应答不可绕开玩家提交协议。
      ws.send(cmdMsg({ type: "respondReaction", seat: 99, use: false }, 7));
      expect(await nextMessageOfType(ws, "error")).toEqual({
        type: "error",
        requestId: 7,
        error: "请携带原决策点和提交编号提交此操作",
      });

      const late: PlayerSubmission = {
        roomId,
        seat: 0,
        submissionId: "旧识破",
        decisionPoint: "旧窗",
        cmd: { type: "respondReaction", seat: 0, use: false },
      };
      ws.send(submissionMsg(late));
      const rejected = await nextMessageOfType(ws, "submissionResult");
      expect(rejected).toMatchObject({
        submissionId: "旧识破",
        outcome: "rejected",
        reason: expect.stringContaining("原反应窗已结束"),
      });
      ws.send(submissionMsg(late, 10));
      expect(await nextMessageOfType(ws, "submissionResult")).toEqual({
        ...rejected,
        requestId: 10,
      });
      ws.send(
        submissionMsg({
          ...late,
          submissionId: "迟到出牌",
          cmd: { type: "useJinnang", cardId: "连环计", handIndex: 0 },
        }),
      );
      expect(await nextMessageOfType(ws, "submissionResult")).toMatchObject({
        submissionId: "迟到出牌",
        outcome: "rejected",
        reason: expect.stringContaining("原决策点已结束"),
      });
      const pick = capitalSubmission(first as unknown as SnapshotMsg);
      ws.send(submissionMsg(pick, 8));
      expect(await nextMessageOfType(ws, "submissionResult", 1000)).toEqual({
        type: "submissionResult",
        submissionId: pick.submissionId,
        requestId: 8,
        outcome: "accepted",
        logOffset: firstLogLength + 2,
      });

      await Bun.sleep(300); // 给潜在异步崩溃留出暴露时间
      const health = await fetch(`${BASE}/health`);
      expect(health.ok).toBe(true);
      expect(proc!.exitCode).toBeNull();
    } finally {
      ws.close();
    }
  });

  it("启动清扫保持过期日志删除，活局的已保存缺行照常补写", async () => {
    expect(existsSync(expired.archive)).toBe(false);
    const restored = readFileSync(live.archive, "utf8").trimEnd().split("\n");
    expect(restored.slice(0, live.log.length)).toEqual(live.log);
    const peer = await OnlineClient.connect(
      `ws://127.0.0.1:${PORT}/ws?room=${expired.roomId}&seat=1&token=${expired.tokens[1]}`,
    );
    try {
      const snapshot = await peer.waitSnapshot(null, "过期归档对应房间的原座摘要", 2000);
      expect(snapshot.roomId).toBe(expired.roomId);
      expect(existsSync(expired.archive)).toBe(false);
    } finally {
      peer.close();
    }
  });

  it("恢复时在原窗内接续托管，未答原座沿用授权并追加归档", async () => {
    const persistence = new FileRoomPersistence(ROOMS_DIR);
    const pending = () => persistence.load(live.roomId)?.snapshot?.pendingReaction;
    const end = performance.now() + 2000;
    while (pending()?.answers.length === 0 && performance.now() < end) await Bun.sleep(10);
    expect(pending()?.answers).toMatchObject([{ seat: 1, use: true, cardId: "识破诡计" }]);

    const connect = (seat: number) =>
      OnlineClient.connect(
        `ws://127.0.0.1:${PORT}/ws?room=${live.roomId}&seat=${seat}&token=${live.tokens[seat]}`,
      );
    const peer = await connect(1);
    const other = await connect(2);
    try {
      const controlled = await peer.waitSnapshot(null, "已由托管答过的原座摘要", 2000);
      expect(controlled.decisionPoint).toBeNull();
      const restored = await other.waitSnapshot(null, "未答席的原座摘要", 2000);
      expect(restored).toMatchObject({
        turnPhase: "AwaitingReaction",
        decisionPoint: live.point,
        pendingReaction: { answers: [{ seat: 1, use: true, cardId: "识破诡计" }] },
      });
      if (restored.decisionPoint === null) throw new Error("恢复原座缺少决策点");
      other.sendRaw(
        submissionMsg({
          roomId: live.roomId,
          seat: 2,
          submissionId: "恢复后不用",
          decisionPoint: restored.decisionPoint,
          cmd: { type: "respondReaction", seat: 2, use: false },
        }),
      );
      expect(
        await other.waitFor((m) => m.type === "submissionResult", "恢复后的原座回执", 2000),
      ).toMatchObject({ outcome: "accepted" });
      const answered = await peer.waitFor(
        (msg) =>
          msg.type === "events" && msg.events.some((event) => event.kind === "reactionAnswered"),
        "托管席收到本次应答",
        2000,
      );
      expect(answered).toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({ kind: "reactionAnswered", seat: 2, use: false }),
        ]),
      });
      const lines = readFileSync(live.archive, "utf8").trimEnd().split("\n");
      expect(lines.slice(0, live.log.length)).toEqual(live.log);
      expect(lines.filter((line) => line.includes("reactionRespond "))).toHaveLength(2);
    } finally {
      peer.close();
      other.close();
    }
  });

  it("连环计私有步骤不外发，公开出牌在丢回执重启后只结算一次", async () => {
    const created = await post("/room/new", { seats: 3, seed: 96 });
    expect(created.ok).toBe(true);
    const roomId = created.roomId as string;
    const hostAuth = { roomId, seatToken: created.seatToken as string };
    const tokens = [hostAuth.seatToken];
    for (const seat of [1, 2]) {
      const joined = await post("/room/join", { roomId });
      expect(joined).toMatchObject({ ok: true, seat });
      tokens.push(joined.seatToken as string);
    }
    const peers: OnlineClient[] = [];
    let markDrop!: () => void;
    const receiptLost = new Promise<void>((resolve) => {
      markDrop = resolve;
    });
    const proxy = FaultProxy.start({
      targetOrigin: `ws://127.0.0.1:${PORT}`,
      onNotice: (notice) => {
        if (notice.kind === "dropped" && notice.direction === "toClient") markDrop();
      },
    });
    const connect = async (seat: number) => {
      const port = seat === 2 ? proxy.port : PORT;
      const peer = await OnlineClient.connect(
        `ws://127.0.0.1:${port}/ws?room=${roomId}&seat=${seat}&token=${tokens[seat]}`,
      );
      peers.push(peer);
      return peer;
    };
    try {
      for (const seat of [0, 1, 2]) await connect(seat);
      const observer = peers[0];
      const actor = peers[2];
      expect((await post("/room/map", { ...hostAuth, mapId: "guanzhong" })).ok).toBe(true);
      expect((await post("/room/start", hostAuth)).ok).toBe(true);
      for (let index = 0; index < 3; index++) {
        const setup = await actor.waitSnapshot(
          (s) => s.currentDraftIndex === index,
          "当前选都席",
          2000,
        );
        await confirmCapital(peers, setup);
      }
      const playing = (peer: OnlineClient) =>
        peer.waitSnapshot((s) => s.phase === "Playing", "开局后的座位摘要", 2000);
      const publicAnchor = await playing(observer);
      const ready = await playing(actor);
      expect(ready.choices).toContainEqual(
        expect.objectContaining({ id: "连环计", handIndex: 0, available: true }),
      );
      const observerStart = observer.frames.indexOf(publicAnchor) + 1;
      const readDebug = async () => {
        const response = await fetch(`${BASE}/room/debug?room=${roomId}`);
        expect(response.ok).toBe(true);
        return (await response.json()) as { events: unknown[] };
      };
      const publicDebug = await readDebug();
      let point = ready.decisionPoint;
      const card = { type: "useJinnang", cardId: "连环计", handIndex: 0 } as const;
      const encode = (submissionId: string, cmd: PlayerSubmission["cmd"]) => {
        if (point === null) throw new Error("缺少出牌决策点");
        return submissionMsg({ roomId, seat: 2, submissionId, decisionPoint: point, cmd });
      };
      async function privateStep(
        submissionId: string,
        fields: { targets?: number[]; back?: boolean; cancel?: boolean } = {},
      ) {
        actor.sendRaw(encode(submissionId, { ...card, ...fields }));
        const reply = await actor.waitFor<SubmissionResultMsg>(
          (msg) => msg.type === "submissionResult" && msg.submissionId === submissionId,
          "出牌步骤回执",
          2000,
        );
        expect(reply.outcome).toBe("accepted");
        expect(reply).not.toHaveProperty("logOffset");
        const frame = await actor.waitFor(
          (m) =>
            m.type === "events" && m.events.some((ev) => ev.kind === "jinnangTargetStepChanged"),
          "出牌步骤下行",
          2000,
        );
        if (frame.type !== "events") throw new Error("缺少出牌步骤事件批");
        point = frame.decisionPoint;
      }
      await privateStep("选牌");
      await privateStep("首选", { targets: [0] });
      await privateStep("返回", { back: true });
      await privateStep("作罢", { cancel: true });
      await privateStep("重选牌");
      await privateStep("重选首位", { targets: [0] });
      // 同一旁席连接的回执可作收包屏障。权威拒绝旁席提前应答，不产生广播。
      observer.sendRaw(
        submissionMsg({
          roomId,
          seat: 0,
          submissionId: "尚无反应",
          decisionPoint: "尚无反应窗",
          cmd: { type: "respondReaction", seat: 0, use: false },
        }),
      );
      const barrier = await observer.waitFor(
        (msg) => msg.type === "submissionResult" && msg.submissionId === "尚无反应",
        "旁席确认已收齐先前下行",
        2000,
      );
      expect(observer.frames.slice(observerStart, observer.frames.indexOf(barrier))).toEqual([]);
      expect((await readDebug()).events).toEqual(publicDebug.events);

      const resumed = await connect(0);
      const resumeAnchor = await playing(resumed);
      expect(resumeAnchor).toEqual(publicAnchor);
      const finalPlay = encode("出牌", { ...card, targets: [1] });
      proxy.setDropEveryN("toClient", 1);
      actor.sendRaw(finalPlay);
      const announcement = await resumed.waitFor(
        (m) => m.type === "events" && m.events.some((ev) => ev.kind === "jinnangAnnounced"),
        "旁席收到已公开的牌和目标",
        2000,
      );
      if (announcement.type !== "events") throw new Error("缺少出牌公告批");
      expect(announcement.events).toContainEqual(
        expect.objectContaining({
          kind: "jinnangAnnounced",
          cardId: "连环计",
          targetSeats: [0, 1],
        }),
      );
      const opened = await resumed.waitSnapshot(
        (s) => s.turnPhase === "AwaitingReaction",
        "开窗摘要",
        2000,
      );
      expect(opened.log.slice(0, resumeAnchor.log.length)).toEqual(resumeAnchor.log);
      expect(opened.log.slice(resumeAnchor.log.length)).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining("reactionWindow kind=jinnang card=连环计"),
        }),
      ]);
      expect(opened.players[2].jinnangHandCount).toBe(1);
      if (opened.decisionPoint === null) throw new Error("缺少手答决策点");
      resumed.sendRaw(
        submissionMsg({
          roomId,
          seat: 0,
          submissionId: "不用",
          decisionPoint: opened.decisionPoint,
          cmd: { type: "respondReaction", seat: 0, use: false },
        }),
      );
      const log = await resumed.waitFor<GameLogMsg>(
        (m) => m.type === "gameLog",
        "手答日志尾段",
        2000,
      );
      expect(log.offset).toBe(opened.log.length);
      expect(log.lines).toContainEqual(
        expect.objectContaining({
          detail: expect.stringContaining("reactionRespond "),
        }),
      );
      await receiptLost;
      expect(
        actor.frames.some((m) => m.type === "submissionResult" && m.submissionId === "出牌"),
      ).toBe(false);

      const previousProcess = proc!;
      previousProcess.kill();
      await previousProcess.exited;
      await startServer();
      proxy.setDropEveryN("toClient", null);
      const recoveredActor = await connect(2);
      const afterRestart = await recoveredActor.waitSnapshot(null, "重启后的原座摘要", 2000);
      expect(afterRestart.players[2].jinnangHand).toEqual(["窃玉偷香"]);
      expect(afterRestart.jinnangDiscard.filter((cardId) => cardId === "连环计")).toHaveLength(1);
      recoveredActor.sendRaw(finalPlay);
      expect(
        await recoveredActor.waitFor((m) => m.type === "submissionResult", "重发原回执", 2000),
      ).toMatchObject({
        outcome: "accepted",
        submissionId: "出牌",
        logOffset: resumeAnchor.log.length,
      });
      const saved = new FileRoomPersistence(ROOMS_DIR).load(roomId)!.snapshot!;
      expect(saved.players[2].jinnangHand).toEqual(["窃玉偷香"]);
      expect(saved.jinnangDiscard.filter((cardId) => cardId === "连环计")).toHaveLength(1);
    } finally {
      for (const peer of peers) peer.close();
      proxy.stop();
    }
  });

  it("联机日志从校准锚连续下行，重连归座后继续交付至解散", async () => {
    // 客席首动，直接掷骰落在无主城的购地决策。
    const created = await post("/room/new", { seats: 2, seed: 13 });
    expect(created.ok).toBe(true);
    const roomId = created.roomId as string;
    const hostToken = created.seatToken as string;
    const joined = await post("/room/join", { roomId });
    expect(joined.ok).toBe(true);
    const guestToken = joined.seatToken as string;
    const hostAuth = { roomId, seatToken: hostToken };
    expect((await post("/room/map", { ...hostAuth, mapId: "guanzhong" })).ok).toBe(true);
    expect((await post("/room/start", hostAuth)).ok).toBe(true);

    const peers: OnlineClient[] = [];
    const connect = async (seat: number, token: string) => {
      const peer = await OnlineClient.connect(
        `ws://127.0.0.1:${PORT}/ws?room=${roomId}&seat=${seat}&token=${token}`,
      );
      peers.push(peer);
      return peer;
    };
    const waitLog = (peer: OnlineClient, desc: string) =>
      peer.waitFor<GameLogMsg>((m) => m.type === "gameLog", desc, 2000);

    try {
      const host = await connect(0, hostToken);
      const first = await host.next(2000, "首连整房摘要");
      if (first.type !== "snapshot") throw new Error(`首帧不是整房摘要:${first.type}`);
      expect(first.log[0]?.category).toBe("header");
      const guest = await connect(1, guestToken);

      let anchor = first;
      for (let pick = 0; pick < 2; pick++) {
        await confirmCapital(peers, anchor);
        anchor = await host.waitSnapshot(
          (s) => s.currentDraftIndex === pick + 1,
          "选都后的校准",
          2000,
        );
      }
      expect(anchor.phase).toBe("Playing");
      expect(anchor.turnPhase).toBe("Roll");
      expect(anchor.activeIndex).toBe(1);
      const guestAnchor = await guest.waitSnapshot((s) => s.phase === "Playing", "开局校准", 2000);
      expect(guestAnchor.log).toEqual(anchor.log);
      expect(guest.frames.some((m) => m.type === "gameLog")).toBe(false);

      const beforeRoll = guest.frames.length;
      guest.sendCmd({ type: "rollAndMove" });
      await guest.waitFor(
        (m) => m.type === "events" && m.events.some((ev) => ev.kind === "landingResolved"),
        "普通行军事件",
        2000,
      );
      const roll = await waitLog(guest, "普通行军日志增量");
      expect(guest.frames.slice(beforeRoll).map((m) => m.type)).toEqual(["events", "gameLog"]);
      expect(await waitLog(host, "同局行军日志")).toEqual(roll);
      expect(roll.gameId).toBe(first.gameId);
      expect(roll.offset).toBe(anchor.log.length);
      expect(roll.capturedAt).toBeGreaterThan(0);
      expect(roll.lines[0]).toMatchObject({ category: "cmd", detail: '{"type":"rollAndMove"}' });
      expect(roll.lines.some((line) => line.category === "roll")).toBe(true);

      guest.close();
      await guest.waitClosed(2000);
      const offline = await waitLog(host, "座位离线记录");
      expect(offline.offset).toBe(roll.offset + roll.lines.length);
      expect(offline.lines).toEqual([
        expect.objectContaining({ category: "room", detail: '{"type":"offline","seat":1}' }),
      ]);

      const reconnected = await connect(1, guestToken);
      const restored = await reconnected.next(2000, "重连整房摘要");
      if (restored.type !== "snapshot") throw new Error(`重连首帧不是摘要:${restored.type}`);
      expect(restored.gameId).toBe(first.gameId);
      expect(restored.log).toEqual([...anchor.log, ...roll.lines, ...offline.lines]);
      expect(restored.players[0].jinnangHand).toEqual([]);
      expect(restored.players[0].jinnangHandCount).toBeGreaterThan(0);

      // 行军后的购地决策仍由座位 1 持有。重复抽签只会新增命令审计和警告。
      expect(restored.turnPhase).toBe("AwaitingDecision");
      reconnected.sendCmd({ type: "rollAndMove" });
      const audit = await waitLog(reconnected, "仅追加日志的命令");
      expect(audit.offset).toBe(restored.log.length);
      expect(audit.lines.map((line) => line.category)).toEqual(["cmd", "system"]);
      expect(audit.lines[1]).toMatchObject({
        brief: "[警告] 阶段不符（需要 Roll，当前 AwaitingDecision），原文见服务器日志",
        detail: "warn: 阶段不符（需要 Roll，当前 AwaitingDecision），原文见服务器日志",
      });
      expect(audit.lines[1]).not.toHaveProperty("warning");
      expect(await waitLog(host, "同局命令审计")).toEqual(audit);

      expect((await post("/room/dismiss", hostAuth)).ok).toBe(true);
      for (const peer of [host, reconnected]) {
        await peer.waitClosed(2000);
        expect(peer.frames.slice(-2)).toEqual([
          {
            type: "gameLog",
            gameId: first.gameId,
            offset: audit.offset + audit.lines.length,
            lines: [expect.objectContaining({ category: "room", detail: '{"type":"dismiss"}' })],
            capturedAt: expect.any(Number),
          },
          { type: "dismissed", roomId },
        ]);
      }
      expect(reconnected.frames.map((m) => m.type).filter((type) => type !== "lobby")).toEqual([
        "snapshot",
        "gameLog",
        "gameLog",
        "dismissed",
      ]);
    } finally {
      for (const peer of peers) peer.close();
    }
  });
});

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WireRoomFields } from "@dafung/core/protocol/wire";
import { HeadlessLobby } from "../../scripts/headless-lobby";
import { HeadlessPlayer } from "../../scripts/headless-player";
import type { DualClientObservation } from "./dual-client-observation";
import { DualClientProcess } from "./dual-client-process";

const ROOT = join(import.meta.dir, "..", "..");
const WAIT_MS = 5_000;
let serverBase: string;
let stopServer: (() => Promise<void>) | undefined;

async function waitForServer(
  listening: Promise<number>,
  exited: Promise<number>,
  stderr: Promise<string>,
): Promise<string> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error("测试服务未在 5 秒内就绪")), WAIT_MS);
  try {
    const port = await Promise.race([
      listening,
      exited.then(async (code) => {
        throw new Error(`测试服务提前退出(${code})\n${await stderr}`);
      }),
      timeout.promise,
    ]);
    return `http://127.0.0.1:${port}`;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForAndroid(
  client: DualClientProcess,
  matches: (view: DualClientObservation) => boolean,
  expected: string,
): Promise<DualClientObservation> {
  const deadline = performance.now() + WAIT_MS;
  for (;;) {
    const view = await client.observe();
    if (matches(view)) return view;
    if (performance.now() >= deadline)
      throw new Error(`安卓端未收到${expected}，已收下行 ${view.wire.receivedTypes.join(",")}`);
    await Bun.sleep(10);
  }
}

beforeAll(async () => {
  const work = mkdtempSync(join(tmpdir(), "dafung-headless-lobby-"));
  const extensions = join(work, "extensions");
  mkdirSync(extensions);
  const listening = Promise.withResolvers<number>();
  const server = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import { engineServer } from "./apps/server/src/server";
       process.on("disconnect", () => process.exit(0));
       process.send(engineServer.port);`,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        ROOMS_DIR: join(work, "rooms"),
        LOGS_DIR: join(work, "logs"),
        EXTENSIONS_DIR: extensions,
        MAPS_DIR: join(ROOT, "packages", "core", "maps"),
        DECISION_TIMEOUT_MS: "0",
        RETENTION_WINDOW_MS: "0",
      },
      stdout: "ignore",
      stderr: "pipe",
      ipc: (port: number) => listening.resolve(port),
    },
  );
  const stderr = new Response(server.stderr).text();
  stopServer = async () => {
    if (server.exitCode === null) server.kill();
    await Promise.all([server.exited, stderr]);
    rmSync(work, { recursive: true, force: true });
  };
  serverBase = await waitForServer(listening.promise, server.exited, stderr);
});

afterAll(async () => {
  await stopServer?.();
});

test("无界面与安卓经真实房间入座、开局，安卓主动离开后保留原座", async () => {
  let host: HeadlessLobby | undefined;
  let guest: HeadlessLobby | undefined;
  let android: DualClientProcess | undefined;
  try {
    host = await HeadlessLobby.createRoom(serverBase, { seats: 3, seed: 4 });
    const { roomId } = host.room;
    guest = await HeadlessLobby.joinRoom(serverBase, roomId.toLowerCase());
    android = new DualClientProcess("安卓来宾", serverBase, "held");
    const admitted = await android.request({ kind: "joinRoom", roomId });
    expect(host.room).toMatchObject({ seat: 0, host: 0, started: false, mapId: null });
    expect(guest.room).toMatchObject({ roomId, seat: 1, host: 0 });
    expect(admitted.net.mySeat).toBe(2);
    expect(admitted.credentials).toMatchObject({ roomId, seatToken: expect.any(String) });
    expect(
      new Set([host.room.seatToken, guest.room.seatToken, admitted.credentials!.seatToken]).size,
    ).toBe(3);

    const wrongSeat = new URL(host.connection.url);
    wrongSeat.protocol = "http:";
    wrongSeat.searchParams.set("seat", String(guest.room.seat));
    const upgrade = await fetch(wrongSeat, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    expect(upgrade.status).toBe(401);
    await expect(guest.pickMap("zhongyuan")).rejects.toMatchObject({
      status: 403,
      message: "仅 host 可选图",
    });

    const mapId = "guanzhong";
    await host.pickMap(mapId);
    const mapVisible = (room: WireRoomFields) =>
      room.roomId === roomId &&
      room.mapId === mapId &&
      !room.started &&
      room.seats.length === 3 &&
      room.seats.every((seat) => seat.taken && seat.online);
    const seats = [host, guest];
    await Promise.all([
      ...seats.map((member) => member.waitForLobby(mapVisible, WAIT_MS)),
      waitForAndroid(android, (view) => view.sessionReady && mapVisible(view.net), "大厅地图"),
    ]);
    await expect(guest.startGame()).rejects.toMatchObject({
      status: 403,
      message: "仅 host 可开局",
    });
    await host.startGame();

    const opened = await waitForAndroid(
      android,
      (view) => view.sessionReady && view.hydrated && view.net.started,
      "开局摘要",
    );
    expect(opened.net).toMatchObject({ roomId, mapId, mySeat: 2 });
    const setup = { phase: "Setup", setupPhase: "PickCapital" };
    expect(opened.game.snapshot).toMatchObject(setup);
    expect(opened.wire.receivedTypes).toContain("snapshot");
    const { gameId } = opened.game.snapshot!;
    await Promise.all(
      seats.map(async ({ room, connection }) => {
        const player = new HeadlessPlayer(room.roomId, room.seat);
        await player.connect(connection, WAIT_MS);
        expect(connection.frames.find((frame) => frame.type === "snapshot")).toMatchObject({
          ...setup,
          gameId,
          roomId,
          mapId,
          started: true,
        });
        expect(player.view).toMatchObject({
          seat: room.seat,
          snapshot: { ...setup, gameId },
        });
      }),
    );

    // 独立安卓端经生产 destroy 关闭连接，房间内仍保留该座位。
    await android.request({ kind: "reset" });
    const [offline, left] = await Promise.all([
      host.connection.waitSnapshot(
        (snapshot) => !snapshot.seats[2].online,
        "安卓来宾离线摘要",
        WAIT_MS,
      ),
      waitForAndroid(android, (view) => view.wire.readyStates[0] === WebSocket.CLOSED, "主动关闭"),
    ]);
    expect(offline).toMatchObject({ gameId, host: 0 });
    expect(offline.seats[2]).toMatchObject({ taken: true, online: false });
    expect(left.net).toMatchObject({ mySeat: -1, connected: false });
    expect(left.wire).toMatchObject({ retryPending: 0, retryDelays: [] });
  } finally {
    host?.close();
    guest?.close();
    await android?.close();
  }
}, 15_000);

test("安卓与无界面原座恢复已确认选都和托管，移交后的房主解散并通知各席", async () => {
  let host: HeadlessLobby | undefined;
  let guest: HeadlessLobby | undefined;
  let restored: HeadlessLobby | undefined;
  let android: DualClientProcess | undefined;
  try {
    // 固定选都顺序为 2 → 1 → 0，座位 1 留在真人选都处。
    host = await HeadlessLobby.createRoom(serverBase, { seats: 3, seed: 5 });
    const { roomId, seat, seatToken } = host.room;
    guest = await HeadlessLobby.joinRoom(serverBase, roomId);
    android = new DualClientProcess("安卓来宾", serverBase, "held");
    await android.request({ kind: "joinRoom", roomId });

    await host.pickMap("guanzhong");
    await host.startGame();
    const hostPlayer = new HeadlessPlayer(roomId, seat);
    await hostPlayer.connect(host.connection, WAIT_MS);
    const opening = await waitForAndroid(
      android,
      (view) => view.sessionReady && view.hydrated,
      "选都摘要",
    );
    expect(opening.game.snapshot).toMatchObject({ currentSetupPlayerIndex: 2 });
    const capital = opening.game.snapshot!.offeredCapitals[0];
    await android.request({ kind: "pickCapital", tileIndex: capital });

    const confirmed = await host.connection.waitSnapshot(
      (snapshot) => snapshot.currentDraftIndex === 1,
      "座位 2 已确认选都",
      WAIT_MS,
    );
    expect(confirmed.players[2].capitalIndex).toBe(capital);
    expect(hostPlayer.act({ type: "setAutoPilot", on: true })).toEqual({ status: "submitted" });
    expect(
      await hostPlayer.readUntil(
        (message) => message.type === "submissionResult",
        "房主托管回执",
        WAIT_MS,
      ),
    ).toMatchObject({ outcome: "accepted" });
    await android.request({ kind: "setAutoPilot", on: true });
    await host.connection.waitSnapshot(
      (snapshot) => snapshot.seats[seat].autoPilot && snapshot.seats[2].autoPilot,
      "两席开启托管",
      WAIT_MS,
    );

    await android.request({ kind: "closeSocket" });
    await Promise.all([
      host.connection.waitSnapshot(
        (snapshot) => snapshot.seats[2].autoPilot && !snapshot.seats[2].online,
        "安卓原座带托管离线",
        WAIT_MS,
      ),
      waitForAndroid(android, (view) => view.wire.retryPending === 1, "自动重连排期"),
    ]);
    await android.request({ kind: "advanceReconnect" });
    const recovered = await waitForAndroid(
      android,
      (view) => view.sessionReady && view.net.seats[2].online,
      "安卓原座恢复",
    );
    expect(opening.wire.urls).toHaveLength(1);
    const [originalUrl] = opening.wire.urls;
    expect(recovered.wire.urls).toEqual([originalUrl, originalUrl]);
    expect(recovered.net).toMatchObject({ roomId, mySeat: 2 });
    expect(recovered.net.seats[2].autoPilot).toBe(true);
    expect(recovered.game.snapshot).toMatchObject({
      gameId: confirmed.gameId,
      currentDraftIndex: 1,
    });
    expect(recovered.game.snapshot!.players[2].capitalIndex).toBe(capital);
    await android.request({ kind: "setAutoPilot", on: false });
    await waitForAndroid(android, (view) => !view.net.seats[2].autoPilot, "安卓收回原座");

    host.close();
    const transferred = (room: WireRoomFields) => room.host === 1 && !room.seats[seat].online;
    const [newHost] = await Promise.all([
      guest.connection.waitSnapshot(transferred, "原房主离线后向最低在线席移交", WAIT_MS),
      waitForAndroid(android, (view) => transferred(view.net), "安卓收到房主移交"),
    ]);
    expect(newHost.seats[seat]).toMatchObject({ taken: true, autoPilot: true });

    restored = await HeadlessLobby.reconnect(serverBase, { roomId, seat, seatToken });
    const player = new HeadlessPlayer(roomId, seat);
    await player.connect(restored.connection, WAIT_MS);
    expect(player.view).toMatchObject({
      seat,
      autopilotOn: true,
      snapshot: { gameId: confirmed.gameId, currentDraftIndex: 1 },
    });
    expect(player.view.snapshot.players[2].capitalIndex).toBe(capital);
    expect(player.act({ type: "setAutoPilot", on: false })).toEqual({ status: "submitted" });
    expect(
      await player.readUntil(
        (message) => message.type === "submissionResult",
        "无界面收回回执",
        WAIT_MS,
      ),
    ).toMatchObject({ outcome: "accepted" });
    await player.readUntil(
      (message) => message.type === "snapshot" && !message.seats[seat].autoPilot,
      "原座已恢复本人控制",
      WAIT_MS,
    );

    await expect(restored.dismissRoom()).rejects.toMatchObject({
      status: 403,
      message: "仅 host 可解散",
    });
    await guest.dismissRoom();
    const dismissal = { type: "dismissed", roomId } as const;
    const [androidDismissed] = await Promise.all([
      waitForAndroid(
        android,
        (view) =>
          view.wire.receivedTypes.includes("dismissed") &&
          view.wire.readyStates[1] === WebSocket.CLOSED,
        "解散通知与关连",
      ),
      ...[guest, restored].map(async (member) => {
        expect(await member.waitForDismissal(WAIT_MS)).toEqual(dismissal);
        expect(member.connection.frames.filter((frame) => frame.type === "dismissed")).toEqual([
          dismissal,
        ]);
        expect(member.connection.isClosed).toBe(true);
      }),
    ]);
    expect(androidDismissed.net).toMatchObject({ connection: "idle", connected: false });
    expect(androidDismissed.game.screen).toBe("lobby");
    expect(androidDismissed.wire.retryPending).toBe(0);
    expect(androidDismissed.wire.receivedTypes.filter((type) => type === "dismissed")).toEqual([
      "dismissed",
    ]);
    await expect(HeadlessLobby.joinRoom(serverBase, roomId)).rejects.toMatchObject({
      status: 404,
      message: "房间不存在",
    });
  } finally {
    host?.close();
    guest?.close();
    restored?.close();
    await android?.close();
  }
}, 15_000);

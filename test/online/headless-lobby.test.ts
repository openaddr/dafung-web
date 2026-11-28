import { expect, test } from "bun:test";
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

test("无界面与安卓经真实房间入座，房主选图开局后各席收到同一棋局", async () => {
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
  let host: HeadlessLobby | undefined;
  let guest: HeadlessLobby | undefined;
  let android: DualClientProcess | undefined;
  try {
    const serverBase = await waitForServer(listening.promise, server.exited, stderr);
    host = await HeadlessLobby.createRoom(serverBase, { seats: 3, seed: 4 });
    const { roomId } = host.room;
    guest = await HeadlessLobby.joinRoom(serverBase, roomId.toLowerCase());
    android = new DualClientProcess("安卓来宾", serverBase);
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
  } finally {
    try {
      host?.close();
      guest?.close();
      await android?.close();
    } finally {
      if (server.exitCode === null) server.kill();
      await Promise.all([server.exited, stderr]);
      rmSync(work, { recursive: true, force: true });
    }
  }
}, 15_000);

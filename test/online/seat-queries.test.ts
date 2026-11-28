import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  armHero,
  armPhase,
  giveJinnang,
  grantProperty,
  placePlayer,
  setCash,
  setDefense,
  setJinnangPiles,
  setStamina,
} from "@dafung/core/engine/planter";
import type { GameLogMsg, ServerMsg, SnapshotMsg } from "@dafung/core/protocol/wire";
import { RoomRegistry } from "@dafung/core/room/room";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { MAP } from "../../scripts/engine-helpers";
import { HeadlessPlayer } from "../../scripts/headless-player";
import { OnlineClient } from "../../scripts/online-client";
import { submitCapitalForSetup } from "./room-capitals";

const WAIT_MS = 4_000;

async function seedRoom(persistence: FileRoomPersistence) {
  const registry = new RoomRegistry(persistence, undefined, undefined, {
    clock: { setTimeout: () => 1, clearTimeout: () => {} },
  });
  const { room, token } = registry.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
    guohao: "蜀",
  });
  const { roomId } = room;
  const tokens = [token, registry.joinSeat(roomId, "吴").token];
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
  // 固定谱：从幽州行军五步到吴郡，途经己方临淄，收到一张锦囊。
  placePlayer(engine, 0, 2);
  grantProperty(engine, 0, "prop-linzi", 2);
  setDefense(engine, 0, "prop-linzi", 23);
  setCash(engine, 0, 4160);
  setStamina(engine, 0, 71);
  armHero(engine, 0, "huatuo", ["qingnang"]);
  giveJinnang(engine, 0, ["横征暴敛"]);
  giveJinnang(engine, 1, ["识破诡计"]);
  setJinnangPiles(engine, ["求贤令"], []);
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
  persistence.save({ ...persistence.load(roomId)!, snapshot: engine.snapshot() });
  return { registry, roomId, tokens };
}

it("两席从真实首连、行军摸牌和日志尾段读到各自视图，原座重连接回同一战报行号", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dafung-seat-queries-"));
  const sockets: OnlineClient[] = [];
  let server: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const rooms = join(directory, "rooms");
    const logs = join(directory, "logs");
    const extensions = join(directory, "extensions");
    mkdirSync(extensions);
    const { roomId, tokens } = await seedRoom(new FileRoomPersistence(rooms));
    const port = Promise.withResolvers<number>();
    server = Bun.spawn(
      [
        process.execPath,
        "--eval",
        'const { engineServer } = await import("./apps/server/src/server.ts"); process.send(engineServer.port);',
      ],
      {
        cwd: join(import.meta.dir, "..", ".."),
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          ROOMS_DIR: rooms,
          LOGS_DIR: logs,
          EXTENSIONS_DIR: extensions,
          DECISION_TIMEOUT_MS: "0",
          RETENTION_WINDOW_MS: "0",
        },
        stdout: "ignore",
        stderr: "inherit",
        ipc: port.resolve,
      },
    );
    const listenPort = await Promise.race([
      port.promise,
      server.exited.then((code) => {
        throw new Error(`座位查询测试服务提前退出 (${code})`);
      }),
      Bun.sleep(WAIT_MS).then(() => {
        throw new Error("等待座位查询测试服务启动超时");
      }),
    ]);
    const players = [new HeadlessPlayer(roomId, 0), new HeadlessPlayer(roomId, 1)];
    const connect = async (seat: number) => {
      const socket = await OnlineClient.connect(
        `ws://127.0.0.1:${listenPort}/ws?room=${roomId}&seat=${seat}&token=${tokens[seat]}`,
        { openTimeoutMs: WAIT_MS },
      );
      sockets.push(socket);
      await players[seat].connect(socket, WAIT_MS);
      return socket;
    };

    const first = await Promise.all(players.map(({ seat }) => connect(seat)));
    expect(first[0].snapshot!.players.map((row) => row.jinnangHand)).toEqual([["横征暴敛"], []]);
    expect(first[1].snapshot!.players.map((row) => row.jinnangHand)).toEqual([[], ["识破诡计"]]);
    expect(players.map(({ queries }) => queries.hand)).toEqual([["横征暴敛"], ["识破诡计"]]);
    const initialWarlords = players[0].queries.warlords;
    expect(players[1].queries.warlords).toEqual(initialWarlords);
    expect(initialWarlords[0]).toMatchObject({
      guohao: "蜀",
      cash: 4160,
      stamina: 71,
      position: 2,
      jinnangHandCount: 1,
      properties: expect.arrayContaining([
        expect.objectContaining({ propertyId: "prop-linzi", level: 2, defense: 23 }),
      ]),
      heroes: [expect.objectContaining({ heroId: "huatuo", skillIds: ["qingnang"] })],
      treasures: [
        expect.objectContaining({ id: "suanchou-18" }),
        expect.objectContaining({ id: "qingmei-25" }),
      ],
    });
    for (const row of initialWarlords) expect(row).not.toHaveProperty("jinnangHand");
    expect(players[0].act({ type: "pass" })).toEqual({ status: "submitted" });

    const tails = await Promise.all(
      players.map((player) =>
        player.readUntil(
          (message): message is GameLogMsg =>
            message.type === "gameLog" &&
            message.lines.some((line) => line.detail.startsWith("jinnangDraw ")),
          "行军摸牌的普通日志尾段",
          WAIT_MS,
        ),
      ),
    );
    for (const [seat, socket] of first.entries()) {
      const tail = tails[seat];
      const seen = socket.frames.slice(0, socket.frames.indexOf(tail));
      const anchor = seen
        .filter((message): message is SnapshotMsg => message.type === "snapshot")
        .at(-1)!;
      const afterAnchor = seen.slice(seen.indexOf(anchor) + 1);
      const draws = afterAnchor.flatMap((message) =>
        message.type === "events"
          ? message.events.filter((event) => event.kind === "jinnangDrawn")
          : [],
      );
      expect(draws).toHaveLength(1);
      expect(draws[0]).toMatchObject({ count: 1, reason: "cityPassed", tileIndex: 5 });
      if (seat === 0) expect(draws[0]).toHaveProperty("cardIds", ["求贤令"]);
      else expect(draws[0]).not.toHaveProperty("cardIds");
      const deliveredLog = [...anchor.log];
      for (const message of [...afterAnchor, tail]) {
        if (message.type !== "gameLog") continue;
        expect(message.offset).toBe(deliveredLog.length);
        expect(JSON.stringify(message)).not.toContain("求贤令");
        for (const line of message.lines) deliveredLog.push(line);
      }
      expect(players[seat].view.snapshot.log).toEqual(deliveredLog);
      const drawIndex = tail.lines.findIndex(({ detail }) => detail.startsWith("jinnangDraw "));
      const { queries } = players[seat];
      expect(queries.warlords[0]).toMatchObject({ position: 7, cash: 4160, jinnangHandCount: 2 });
      expect(queries.hand).toEqual(seat === 0 ? ["横征暴敛", "求贤令"] : ["识破诡计"]);
      expect(queries.warReport).toContainEqual({
        offset: tail.offset + drawIndex,
        round: 1,
        player: "蜀",
        brief: "蜀 抽了一张锦囊(手牌 2)",
      });
    }

    const beforeReconnect = players.map(({ queries }) => queries);
    await Promise.all(
      first.map((socket) => {
        socket.close();
        return socket.waitClosed(WAIT_MS);
      }),
    );
    const reconnected = await Promise.all(players.map(({ seat }) => connect(seat)));
    for (const [seat, socket] of reconnected.entries()) {
      const snapshot = socket.snapshot!;
      const { offset, lines } = tails[seat];
      expect(snapshot.log.slice(offset, offset + lines.length)).toEqual(lines);
      expect(players[seat].queries).toEqual(beforeReconnect[seat]);
      expect(snapshot.players[0]).toMatchObject({ position: 7, jinnangHandCount: 2 });
      expect(snapshot.players[0].jinnangHand).toEqual(seat === 0 ? ["横征暴敛", "求贤令"] : []);
      expect(snapshot.players[1].jinnangHand).toEqual(seat === 1 ? ["识破诡计"] : []);
    }
  } finally {
    for (const socket of sockets) socket.close();
    if (server?.exitCode === null) server.kill();
    await server?.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

it("单机座位从摘要接续普通拍和解散尾段，公开行号连续", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dafung-seat-log-memory-"));
  try {
    const { registry, roomId, tokens } = await seedRoom(new FileRoomPersistence(directory));
    const frames: ServerMsg[] = [];
    const logArrived = Promise.withResolvers<GameLogMsg>();
    registry.connectSeat(roomId, 0, tokens[0], {
      seat: 0,
      open: true,
      send(frame) {
        const message = JSON.parse(frame) as ServerMsg;
        frames.push(message);
        if (message.type === "gameLog") logArrived.resolve(message);
      },
    });
    const anchor = frames[0];
    if (anchor.type !== "snapshot" || anchor.decisionPoint === null)
      throw new Error("单机座位缺少出牌摘要");
    const result = await registry.submitFromSeat(
      roomId,
      0,
      {
        roomId,
        seat: 0,
        decisionPoint: anchor.decisionPoint,
        submissionId: "单机今不用",
        cmd: { type: "useJinnang", cardId: null },
      },
      () => registry.transportBroadcast(roomId),
    );
    expect(result.outcome).toBe("accepted");
    const tail = await Promise.race([
      logArrived.promise,
      Bun.sleep(WAIT_MS).then(() => {
        throw new Error("单机座位未收到普通日志尾段");
      }),
    ]);
    expect(tail.offset).toBe(anchor.logCount);
    expect(tail.lines).toContainEqual(expect.objectContaining({ brief: "蜀 锦囊今不用" }));
    registry.dismissRoom(roomId, tokens[0]);
    expect(frames.at(-1)).toMatchObject({
      type: "gameLog",
      offset: tail.offset + tail.lines.length,
      lines: [expect.objectContaining({ category: "room", detail: '{"type":"dismiss"}' })],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

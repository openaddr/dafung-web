import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClock } from "@sinonjs/fake-timers";
import { armPhase, giveJinnang, pinDice } from "@dafung/core/engine/planter";
import { dispatchInbound, errorMsg, type SubmissionResultMsg } from "@dafung/core/protocol/wire";
import { RoomRegistry } from "@dafung/core/room/room";
import { lobbyView } from "@dafung/core/room/seat-projection";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { MAP } from "../../scripts/engine-helpers";
import { OnlineClient } from "../../scripts/online-client";

/** 测试房可控制时钟、写盘故障和回执送达，入座、裁决与恢复走房间公共入口。 */
export async function openHeadlessTestRoom(guestHand: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "dafung-headless-"));
  let time = createClock(10_000);
  const now = () => time.now;
  let failSave = false;
  class TestRoomPersistence extends FileRoomPersistence {
    override save(record: Parameters<FileRoomPersistence["save"]>[0]): void {
      if (failSave) {
        failSave = false;
        throw new Error("磁盘已满");
      }
      super.save(record);
    }
  }
  const makeRegistry = () => {
    const scheduler = time;
    return new RoomRegistry(new TestRoomPersistence(directory), undefined, undefined, {
      reactionWindowMs: 1000,
      clock: {
        now: () => scheduler.now,
        setTimeout: scheduler.setTimeout,
        clearTimeout: (id) => scheduler.clearTimeout(id as ReturnType<typeof scheduler.setTimeout>),
      },
    });
  };
  let registry = makeRegistry();
  const { room, token } = registry.createRoom({
    seatCount: 3,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
    guohao: "蜀",
  });
  const id = room.roomId;
  const tokens = [token, registry.joinSeat(id, "吴").token, registry.joinSeat(id, "魏").token];
  registry.setMap(id, "guanzhong", token, new Set(["guanzhong"]));
  await registry.startGame(id, token, undefined, () => MAP);
  const engine = room.engine!;
  while (engine.phase === "Setup")
    await registry.pickCapital(id, engine.currentSetupPlayerIndex, engine.offeredCapitals[0]);
  giveJinnang(engine, 0, ["连环计", "火烧连营", "连环计"]);
  giveJinnang(engine, 1, guestHand);
  giveJinnang(engine, 2, []);
  pinDice(engine, "duel", [6, 1]);
  armPhase(engine, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });

  let holdReceipt: ((result: SubmissionResultMsg) => void) | null = null;
  type Connection = { seat: number; token: string; registry: RoomRegistry };
  const seats = new Map<number, Bun.ServerWebSocket<Connection>>();
  const server = Bun.serve<Connection>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const params = new URL(request.url).searchParams;
      const seat = Number(params.get("seat"));
      const token = params.get("token");
      if (params.get("room") !== id || token === null || !registry.validateSeat(id, seat, token))
        return new Response("Unauthorized", { status: 401 });
      if (!server.upgrade(request, { data: { seat, token, registry } }))
        return new Response("Upgrade failed", { status: 400 });
      return undefined;
    },
    websocket: {
      open(ws) {
        const { registry, seat, token } = ws.data;
        seats.set(seat, ws);
        registry.connectSeat(id, seat, token, {
          seat,
          get open() {
            return ws.readyState === WebSocket.OPEN;
          },
          send: (frame) => ws.send(frame),
        });
      },
      async message(ws, raw) {
        const { registry, seat } = ws.data;
        const broadcast = () => registry.transportBroadcast(id);
        const result = await dispatchInbound(
          String(raw),
          {
            submit: (submission) => registry.submitFromSeat(id, seat, submission, broadcast),
            cmd: (cmd, report) => registry.applyCommandFromSeat(id, seat, cmd, broadcast, report),
            pickCapital: (tile, report) => registry.pickCapital(id, seat, tile, broadcast, report),
            setAutoPilot: (on, report) => registry.setAutoPilot(id, seat, on, broadcast, report),
          },
          {
            sendCommandResult(frame) {
              if (holdReceipt !== null) {
                const receipt = JSON.parse(frame) as SubmissionResultMsg;
                if (receipt.type !== "submissionResult") throw new Error("预期玩家提交回执");
                const held = holdReceipt;
                holdReceipt = null;
                for (const peer of seats.values()) peer.close();
                held(receipt);
                return;
              }
              ws.send(frame);
            },
          },
        );
        if (!result.ok)
          ws.send(errorMsg(result.message, "requestId" in result ? result.requestId : undefined));
      },
      close(ws) {
        if (seats.get(ws.data.seat) === ws) {
          seats.delete(ws.data.seat);
          ws.data.registry.disconnectSeat(id, ws.data.seat);
        }
      },
    },
  });

  const wsUrl = (seat: number) =>
    `ws://127.0.0.1:${server.port}/ws?room=${id}&seat=${seat}&token=${tokens[seat]}`;
  return {
    id,
    now,
    wsUrl,
    joinReply: (seat: number) => ({
      ...lobbyView(registry.get(id)!, new Set(seats.keys())),
      ok: true as const,
      seat,
      seatToken: tokens[seat],
    }),
    advance: (ms: number) => time.tickAsync(ms),
    socket: (seat: number) => OnlineClient.connect(wsUrl(seat), { now }),
    failNextSave() {
      failSave = true;
    },
    /** 房间已经写盘，原连接在回执抵达前断开。 */
    dropNextReceipt: () =>
      new Promise<SubmissionResultMsg>((resolve) => {
        holdReceipt = resolve;
      }),
    restart() {
      for (const peer of seats.values()) peer.close();
      time = createClock(time.now);
      registry = makeRegistry();
      if (registry.restoreAll(() => MAP) !== 1) throw new Error("测试房重启后未恢复原房间");
    },
    async close() {
      await server.stop(true);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

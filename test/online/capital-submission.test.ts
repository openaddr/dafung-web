import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dispatchInbound,
  submissionMsg,
  type PlayerSubmission,
  type ServerMsg,
} from "@dafung/core/protocol/wire";
import { RoomRegistry } from "@dafung/core/room/room";
import { FileRoomPersistence } from "../../apps/server/src/room-persistence";
import { MAP } from "../../scripts/engine-helpers";

it("认证内存房只接收本席有效候选，两席共同观察扣款，恢复后原提交只结算一次", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dafung-capital-"));
  const map = { ...MAP, startingCash: 1000 };
  const persistence = new FileRoomPersistence(dir);
  const makeRegistry = () =>
    new RoomRegistry(persistence, undefined, undefined, {
      clock: { now: () => 0, setTimeout: () => 1, clearTimeout: () => {} },
    });
  let registry = makeRegistry();
  const { room, token } = registry.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 1 },
  });
  const { roomId } = room;
  const tokens = [token, registry.joinSeat(roomId).token];
  const streams: ServerMsg[][] = [[], []];
  const send = (seat: number, frame: string) => streams[seat].push(JSON.parse(frame));
  const broadcast = () => registry.transportBroadcast(roomId);
  const summary = (seat: number) => streams[seat].filter((msg) => msg.type === "snapshot").at(-1)!;
  function connect() {
    for (const [seat, seatToken] of tokens.entries()) {
      registry.connectSeat(roomId, seat, seatToken, {
        seat,
        open: true,
        send: (frame) => send(seat, frame),
      });
    }
  }
  async function submit(seat: number, submission: PlayerSubmission) {
    expect(
      await dispatchInbound(
        submissionMsg(submission),
        {
          cmd: (cmd, report) => registry.applyCommandFromSeat(roomId, seat, cmd, broadcast, report),
          submit: (cmd) => registry.submitFromSeat(roomId, seat, cmd, broadcast),
          setAutoPilot: (on, report) => registry.setAutoPilot(roomId, seat, on, broadcast, report),
        },
        { sendCommandResult: (frame) => send(seat, frame) },
      ),
    ).toEqual({ ok: true });
    registry.flushTransportNow(roomId);
    return streams[seat].filter((msg) => msg.type === "submissionResult").at(-1);
  }

  try {
    registry.setMap(roomId, "guanzhong", token, new Set(["guanzhong"]));
    await registry.startGame(roomId, token, undefined, () => map);
    connect();

    const picked: number[] = [];
    for (let turn = 0; turn < 2; turn++) {
      const seat = summary(0).currentSetupPlayerIndex;
      const actor = summary(seat);
      const peer = summary(1 - seat);
      expect(actor.decisionPoint).toEqual(expect.any(String));
      if (actor.decisionOptions?.kind !== "pickCapital") throw new Error("缺少本席选都候选");
      expect(actor.decisionOptions.options.map((candidate) => candidate.tileIndex)).toEqual(
        actor.offeredCapitals,
      );
      expect(peer.decisionOptions).toBeUndefined();
      expect(peer.decisionPoint).toBeNull();
      expect(peer.offeredCapitals).toEqual(actor.offeredCapitals);
      const candidate = actor.decisionOptions.options.find((option) => option.available)!;
      const tile = MAP.board.at(candidate.tileIndex);
      expect(candidate).toMatchObject({
        propertyId: tile.propertyId,
        cost: MAP.catalog.get(tile.propertyId)!.buildCost,
        available: true,
      });
      const request: PlayerSubmission = {
        roomId,
        seat,
        submissionId: `confirm-${seat}`,
        decisionPoint: actor.decisionPoint!,
        cmd: { type: "pickCapital", tileIndex: candidate.tileIndex },
      };
      if (turn === 0) {
        expect(await submit(1 - seat, request)).toMatchObject({
          outcome: "rejected",
          reasonCode: "wrongSeat",
        });
        expect(await submit(1 - seat, { ...request, seat: 1 - seat })).toMatchObject({
          outcome: "rejected",
          reasonCode: "wrongSeat",
        });
        const unavailable = actor.decisionOptions.options.find((option) => !option.available)!;
        expect(unavailable).toMatchObject({
          reasonCode: "insufficientFunds",
          reason: "建城费不足",
        });
        expect(
          await submit(seat, {
            ...request,
            submissionId: "expensive",
            cmd: { type: "pickCapital", tileIndex: unavailable.tileIndex },
          }),
        ).toMatchObject({ outcome: "rejected", reasonCode: "insufficientFunds" });
        expect(
          await submit(seat, {
            ...request,
            submissionId: "invalid",
            cmd: { type: "pickCapital", tileIndex: candidate.tileIndex + map.board.count },
          }),
        ).toMatchObject({ outcome: "rejected", reasonCode: "invalidCandidate" });
        expect(summary(seat).decisionPoint).toBe(actor.decisionPoint);
        expect(summary(seat).players[seat].cash).toBe(map.startingCash);
      }
      const receipt = await submit(seat, request);
      expect(receipt).toMatchObject({ outcome: "accepted", submissionId: `confirm-${seat}` });
      picked[seat] = candidate.tileIndex;
      for (const [viewer, stream] of streams.entries()) {
        const batch = stream.find(
          (msg) =>
            msg.type === "events" &&
            msg.events.some((event) => event.kind === "capitalSelected" && event.seat === seat),
        );
        if (batch?.type !== "events") throw new Error("缺少建都事件批");
        const event = batch.events.find(
          (event) => event.kind === "capitalSelected" && event.seat === seat,
        );
        expect(event).toMatchObject({
          tileIndex: candidate.tileIndex,
          cost: candidate.cost,
          holding: { propertyId: tile.propertyId, level: 1, defense: 40 },
        });
        expect(summary(viewer).players[seat]).toMatchObject({
          capitalIndex: candidate.tileIndex,
          position: candidate.tileIndex,
          cash: actor.players[seat].cash - candidate.cost,
          properties: [{ propertyId: tile.propertyId, level: 1, defense: 40 }],
        });
        expect(batch.decisionPoint).toBe(summary(viewer).decisionPoint);
        expect(batch.decisionOptions).toEqual(summary(viewer).decisionOptions);
      }
      if (turn === 0) {
        const nextPoint = summary(1 - seat).decisionPoint;
        expect(nextPoint).not.toBe(actor.decisionPoint);
        for (const number of [0, 1]) registry.disconnectSeat(roomId, number);
        registry = makeRegistry();
        expect(registry.restoreAll(() => map)).toBe(1);
        connect();
        expect(summary(1 - seat).decisionPoint).toBe(nextPoint);
        expect(await submit(seat, request)).toEqual(receipt);
        expect(await submit(seat, { ...request, submissionId: "late" })).toMatchObject({
          outcome: "rejected",
          reasonCode: "staleDecisionPoint",
        });
        expect(summary(seat).players[seat].cash).toBe(map.startingCash - candidate.cost);
        expect(summary(1 - seat).decisionPoint).toBe(nextPoint);
      }
    }
    for (const stream of streams) {
      const completed = stream
        .filter((frame) => frame.type === "events")
        .flatMap((frame) => frame.events)
        .filter((event) => event.kind === "capitalSelected");
      expect(completed).toHaveLength(2);
    }

    for (const seat of [0, 1]) {
      const started = summary(seat);
      expect(started.phase).toBe("Playing");
      expect(started.players.map((player) => player.position)).toEqual(picked);
      expect(started.activeIndex).toBe(started.draftOrder[0]);
    }
    expect(new Set(picked).size).toBe(2);
  } finally {
    registry.dismissRoom(roomId, token);
    rmSync(dir, { recursive: true, force: true });
  }
});

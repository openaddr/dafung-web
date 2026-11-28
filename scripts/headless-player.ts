import type { GameEngine } from "@dafung/core/engine/authority";
import type { LoadedMap } from "@dafung/core/engine/board-loader";
import { foldEventBatch } from "@dafung/core/protocol/event-fold";
import { PlayerCommandOutbox } from "@dafung/core/protocol/player-command-outbox";
import { SeatInteraction, type SeatIntent } from "@dafung/core/protocol/seat-interaction";
import {
  readMarchRoutes,
  readSeatBoard,
  readSeatDetails,
  readWarReport,
} from "@dafung/core/protocol/seat-queries";
import {
  appendSeatReplicaLog,
  hydrateSeatReplica,
  readSeatReplica,
} from "@dafung/core/protocol/seat-replica";
import {
  requiresPlayerSubmission,
  type ReactionTiming,
  type SeatDecision,
  type ServerMsg,
  type SnapshotMsg,
} from "@dafung/core/protocol/wire";
import { createEngine } from "@dafung/core/room/room-record";
import type { SeatSnapshot } from "@dafung/core/room/seat-projection";
import { loadBuiltinMapById } from "./engine-helpers";
import type { OnlineClient } from "./online-client";

/** 局内玩家。connect 接受本席认证过的 WebSocket，查询和操作前按到达序应用下行。 */
export class HeadlessPlayer {
  private socket: OnlineClient | null = null;
  private nextFrame = 0;
  private map: LoadedMap | null = null;
  private engine: GameEngine | null = null;
  private snapshot: SeatSnapshot | null = null;
  private ready = false;
  private failure: string | null = null;
  private autoPilotOn = false;
  private decision: SeatDecision = { decisionPoint: null };
  private deadline: { seq: number; at: number } | null = null;
  private readonly outbox = new PlayerCommandOutbox();
  private requestId = 0;
  private pendingRequest: number | null = null;
  private readonly interaction = new SeatInteraction<SeatSnapshot>((command, point) => {
    const socket = this.socket!;
    const requestId = ++this.requestId;
    const frame = this.outbox.encode(command, this.roomId, this.seat, point, requestId);
    if (!requiresPlayerSubmission(command)) this.pendingRequest = requestId;
    socket.sendRaw(frame);
    this.publish();
  });

  constructor(
    readonly roomId: string,
    readonly seat: number,
  ) {}

  get connectionFailure(): string | null {
    this.applyReceived();
    return this.failure;
  }

  get view() {
    this.applyReceived();
    return this.interaction.view;
  }

  get queries() {
    const { snapshot, seat } = this.view;
    if (this.map === null) throw new Error("座位尚未加载本局地图");
    return {
      ...readSeatDetails(snapshot.players, seat),
      board: readSeatBoard(snapshot.players, this.map),
      warReport: readWarReport(snapshot.log),
    };
  }

  /** 当前公开事件批中的路线。重连摘要恢复座位落点，行军事件由新到达的批交付。 */
  get marches() {
    return readMarchRoutes(this.view.snapshot.events);
  }

  act(intent: SeatIntent, observedPoint?: string | null) {
    this.applyReceived();
    return this.interaction.act(intent, observedPoint);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.ready = false;
    this.publish();
  }

  async connect(socket: OnlineClient, timeoutMs = 5000): Promise<void> {
    const params = new URL(socket.url).searchParams;
    if (params.get("room") !== this.roomId || params.get("seat") !== String(this.seat))
      throw new Error("认证连接与玩家所在房间或座位不符");
    this.close();
    this.socket = socket;
    this.nextFrame = 0;
    this.failure = null;
    this.pendingRequest = null;
    this.deadline = null;
    this.publish();
    await this.readUntil((message) => message.type === "snapshot", "入座摘要", timeoutMs);
  }

  /** 匹配到的回执或事件和此前的每一帧都已生效。整个等待共用一个超时预算。 */
  readUntil<T extends ServerMsg>(
    matches: (message: ServerMsg) => message is T,
    description: string,
    timeoutMs?: number,
  ): Promise<T>;
  readUntil(
    matches: (message: ServerMsg) => boolean,
    description: string,
    timeoutMs?: number,
  ): Promise<ServerMsg>;
  async readUntil(
    matches: (message: ServerMsg) => boolean,
    description: string,
    timeoutMs = 5000,
  ): Promise<ServerMsg> {
    const socket = this.socket;
    if (socket === null) throw new Error("无界面玩家尚未连接");
    const end = performance.now() + timeoutMs;
    for (;;) {
      if (this.failure !== null) throw new Error(this.failure);
      const remaining = end - performance.now();
      if (remaining <= 0) throw new Error(`等待${description}超时`);
      const message = await socket.next(remaining, description);
      if (socket !== this.socket) throw new Error("读取中的座位连接已更换");
      this.applyReceived();
      if (matches(message)) return message;
    }
  }

  private applyReceived(): void {
    const socket = this.socket;
    if (socket === null) return;
    while (this.failure === null && this.nextFrame < socket.frames.length) {
      const frame = socket.frames[this.nextFrame++];
      this.receive(frame, socket.receivedAt(frame));
    }
    if (this.ready && !socket.isOpen) {
      this.ready = false;
      this.publish();
    }
  }

  private receive(message: ServerMsg, receivedAt: number): void {
    if (message.type === "snapshot") {
      if (message.roomId !== this.roomId) throw new Error("座位摘要与入座房间不符");
      const reconnect = !this.ready;
      if (this.engine === null || this.engine.gameId !== message.gameId) {
        if (message.mapId === null) throw new Error("座位摘要缺少地图");
        const map = loadBuiltinMapById(message.mapId);
        this.engine = createEngine(
          {
            seats: message.players,
            targetNetWorth: message.targetNetWorth,
            startingCash: message.startingCash,
            startingTreasures: map.startingTreasures,
            mapId: message.mapId,
          },
          false,
          map,
        );
        this.map = map;
      }
      hydrateSeatReplica(this.engine, message);
      this.ready = true;
      this.autoPilotOn = message.seats[this.seat].autoPilot;
      this.updateReplica(message, receivedAt, reconnect);
      if (reconnect && this.socket!.isOpen)
        for (const retry of this.outbox.unacknowledged) this.socket!.sendRaw(retry);
    } else if (message.type === "events" && this.ready) {
      foldEventBatch(this.engine!, message.events);
      this.updateReplica(message, receivedAt, false);
    } else if (message.type === "gameLog") {
      if (this.engine === null || !this.ready) throw new Error("收到未校准的日志增量");
      if (appendSeatReplicaLog(this.engine, message) !== null) {
        this.snapshot = readSeatReplica(this.engine, this.seat);
        this.publish();
      }
    } else if (message.type === "lobby") {
      this.autoPilotOn = message.seats[this.seat].autoPilot;
      this.publish();
    } else if (message.type === "submissionResult") {
      if (this.outbox.acknowledge(message)) this.publish();
    } else if (message.type === "error" && this.outbox.matchesRequest(message.requestId)) {
      this.failure = message.error;
      this.socket!.close();
      this.ready = false;
      this.publish();
    } else if (message.type === "commandResult" || message.type === "error") {
      if (message.requestId === this.pendingRequest) {
        this.pendingRequest = null;
        this.publish();
      }
    }
  }

  private updateReplica(
    {
      decisionPoint,
      decisionOptions,
      autopilot,
      reactionTiming,
    }: SeatDecision & Pick<SnapshotMsg, "reactionTiming">,
    receivedAt: number,
    reconnect: boolean,
  ): void {
    this.snapshot = readSeatReplica(this.engine!, this.seat);
    if (decisionPoint === undefined) throw new Error("座位下行缺少决策点");
    this.decision = { decisionPoint, decisionOptions, autopilot };
    this.updateDeadline(reactionTiming, receivedAt);
    this.publish(reconnect);
  }

  private updateDeadline(timing: ReactionTiming | undefined, receivedAt: number): void {
    if (timing === undefined || timing.seq !== this.snapshot!.pendingReaction?.seq) {
      this.deadline = null;
      return;
    }
    const at = receivedAt + timing.remainingMs;
    this.deadline = {
      seq: timing.seq,
      at: this.deadline?.seq === timing.seq ? Math.min(at, this.deadline.at) : at,
    };
  }

  private publish(reconnect = false): void {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    const { decisionPoint, autopilot } = this.decision;
    const autopilotOn = autopilot === undefined ? this.autoPilotOn : autopilot.on;
    this.interaction.publish(
      {
        snapshot,
        seat: this.seat,
        interactive:
          this.ready &&
          decisionPoint !== null &&
          !snapshot.players[this.seat].isBot &&
          !autopilotOn &&
          this.pendingRequest === null &&
          !this.outbox.waitingFor(decisionPoint),
        autopilotOn,
        autopilotInteractive:
          this.ready &&
          autopilot !== undefined &&
          !this.outbox.waitingFor(autopilot.decisionPoint, "autopilot"),
        ...this.decision,
        reactionDeadlineAt: this.deadline?.at ?? null,
      },
      { reconnect },
    );
  }
}

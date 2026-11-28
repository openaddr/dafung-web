// 双端对跑的控制意图与读数(ADR-0065):IPC 只传数据与测试意图,
// 对局传输仍经 OnlineController → ReconnectingSocket → 真实 WebSocket。
import type { useGameStore } from "@app/store/gameStore";
import type { useNetStore } from "@app/store/netStore";
import type { SeatSnapshot } from "@dafung/core/room/seat-projection";
import type { GameCommand } from "@dafung/core/engine/authority";
import type { GameEvent } from "@dafung/core/engine/game-events";

export type DualClientRetryMode = "automatic" | "held" | "exhausted";

export interface DualClientObservation {
  seat: number;
  hydrated: boolean;
  sessionReady: boolean;
  engine: SeatSnapshot | null;
  game: Pick<ReturnType<typeof useGameStore.getState>, "snapshot" | "viewSeat" | "screen" | "hint">;
  net: Pick<
    ReturnType<typeof useNetStore.getState>,
    | "roomId"
    | "host"
    | "started"
    | "mapId"
    | "seats"
    | "mySeat"
    | "connection"
    | "connected"
    | "connectionFailure"
    | "reconnect"
    | "eventBatchSeq"
    | "lastEvents"
    | "pending"
  >;
  wire: {
    urls: string[];
    readyStates: number[];
    receivedTypes: string[];
    events: GameEvent[];
    errors: string[];
    retryDelays: number[];
    retryPending: number;
  };
  credentials: { roomId: string; seatToken: string } | null;
}

export type DualClientOperation =
  | { kind: "observe" }
  | { kind: "createRoom"; seats: number; seed: number; guohao?: string }
  | { kind: "joinRoom"; roomId: string }
  | { kind: "pickMap"; mapId: string }
  | { kind: "startGame" }
  | { kind: "pickCapital"; tileIndex: number }
  | { kind: "declineJinnang" }
  | { kind: "closeSocket" }
  | { kind: "reconnect" }
  | { kind: "advanceReconnect" }
  | { kind: "setAutoPilot"; on: boolean }
  | { kind: "sendCommand"; command: GameCommand }
  | { kind: "reset" };

export interface DualClientRequest {
  id: number;
  operation: DualClientOperation;
}

export type DualClientResponse =
  | { id: number; ok: true; observation: DualClientObservation }
  | { id: number; ok: false; error: string };

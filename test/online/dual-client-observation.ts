// 双端对跑的具体控制面与读数(ADR-0062 层③):IPC 只搬运数据和测试意图,
// 对局传输仍是 OnlineController → ReconnectingSocket → 真 WebSocket。
import type { useGameStore } from "@app/store/gameStore";
import type { useNetStore } from "@app/store/netStore";
import type { GameSnapshot } from "@core/snapshot";
import type { GameCommand } from "@core/authority";
import type { GameEvent } from "@core/game-events";

export type DualClientRetryMode = "automatic" | "held" | "exhausted";

export interface DualClientObservation {
  seat: number;
  hydrated: boolean;
  sessionReady: boolean;
  engine: GameSnapshot | null;
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

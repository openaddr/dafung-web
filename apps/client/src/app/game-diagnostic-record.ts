import type { LogEvent } from "@dafung/core/engine/model";
import type { ReactionView } from "@dafung/core/engine/reaction-window";
import type { GameSnapshot } from "@dafung/core/engine/snapshot";
import type { FrameDiagDump } from "./frameDiag";
import type { GameDiagnosticTimelineDump } from "./game-diagnostic-timeline";
import type { NetConnection } from "./store/netStore";

export interface GameArchiveIdentity {
  gameId: string;
  mode: "solo" | "online";
  mapId: string | null;
}

export interface GameDiagnosticDecisions {
  capitalChoices: readonly number[] | null;
  reaction: {
    kind: ReactionView["kind"];
    asked: boolean;
    answered: boolean;
    muted: boolean;
    playable: string[];
    canDecline: boolean;
  } | null;
}

export interface GameDiagnosticCapture {
  appVersion: string;
  capturedAt: number;
  device: { ua: string; dpr: number; viewport: { w: number; h: number } };
  client: Pick<
    GameSnapshot,
    | "phase"
    | "setupPhase"
    | "turnPhase"
    | "round"
    | "turnNumber"
    | "activeIndex"
    | "decisionOwner"
    | "pendingLand"
    | "lastLandOutcomeKind"
    | "lastLandOutcomeProperty"
  > &
    GameDiagnosticDecisions & {
      choices: Pick<GameSnapshot["choices"][number], "id" | "available">[];
      seat: number;
      interactive: boolean;
      selfPresenting: boolean;
      pending: boolean;
      fxBusy: boolean;
      autopilotOn: boolean;
    };
  connection: { roomId: string; status: NetConnection; failure: string | null } | null;
  errors: { at: number; message: string }[];
  perf: FrameDiagDump | null;
  /** 旧归档没有采集时间线。 */
  timeline?: GameDiagnosticTimelineDump;
}

export interface ArchivedGameSummary extends GameArchiveIdentity {
  lastPlayedAt: number;
  appVersion: string | null;
  logCount: number;
}

export interface GameArchiveFailure {
  kind: "log" | "capture";
  message: string;
}

export function gameArchiveFailureText({ kind, message }: GameArchiveFailure): string {
  return `${kind === "log" ? "对局日志" : "客户端现场"}归档失败：${message}`;
}

export interface ArchivedGame extends ArchivedGameSummary {
  log: { capturedAt: number; lines: LogEvent[] } | null;
  capture: GameDiagnosticCapture | null;
  archiveFailures: readonly GameArchiveFailure[];
}

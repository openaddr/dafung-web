import type { GameController } from "./controllers/controller";
import { startFrameDiag, type FrameDiagDump } from "./frameDiag";
import type {
  GameArchiveIdentity,
  GameDiagnosticCapture,
  GameDiagnosticDecisions,
} from "./game-diagnostic-record";
import { archiveGameCapture } from "./gameLogArchive";
import { useGameStore, type GameSnapshot } from "./store/gameStore";
import { useNetStore } from "./store/netStore";

const MAX_ERRORS = 20;
const MAX_ERROR_LENGTH = 256;

type ReadDecisions = (
  snapshot: GameSnapshot,
  seat: number,
  interactive: boolean,
) => GameDiagnosticDecisions;

interface MountedDiagnostics {
  controller: GameController;
  identity: GameArchiveIdentity;
  roomId: string;
  appVersion: string;
  frames: ReturnType<typeof startFrameDiag>;
  readDecisions: ReadDecisions;
  removeListeners: () => void;
  mounted: boolean;
}

let active: MountedDiagnostics | null = null;
// 联机日志错误可能先于对局屏挂载。控制器与局 ID 共同约束归属。
const recentErrors = new WeakMap<
  GameController,
  { gameId: string; entries: GameDiagnosticCapture["errors"] }
>();

function diagnosticMessage(controller: GameController, message: string): string {
  return controller
    .redactDiagnosticCredentials(message)
    .split(/\r?\n/u, 1)[0]
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/giu, "[地址已隐去]")
    .replace(
      /\b(seatToken|token|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:bearer\s+)?[^\s,;&}]+)/giu,
      "$1=[凭证已隐去]",
    )
    .slice(0, MAX_ERROR_LENGTH);
}

export function recordGameDiagnosticError(
  controller: GameController,
  gameId: string,
  message: string,
): void {
  if (controller.engine.gameId !== gameId) return;
  let errors = recentErrors.get(controller);
  if (errors?.gameId !== gameId) {
    errors = { gameId, entries: [] };
    recentErrors.set(controller, errors);
  }
  const entry = { at: Date.now(), message: diagnosticMessage(controller, message) };
  if (entry.message === "") return;
  if (errors.entries.at(-1)?.message === entry.message) errors.entries.pop();
  errors.entries.push(entry);
  if (errors.entries.length > MAX_ERRORS) errors.entries.shift();
}

async function saveCapture(session: MountedDiagnostics, perf: FrameDiagDump): Promise<void> {
  const { controller, identity, roomId, appVersion } = session;
  const { snapshot, interactive, selfPresenting } = useGameStore.getState();
  const net = useNetStore.getState();
  if (
    snapshot?.gameId !== identity.gameId ||
    controller.engine.gameId !== identity.gameId ||
    net.roomId !== roomId
  )
    return;

  const { phase, setupPhase, turnPhase, round, turnNumber, activeIndex } = snapshot;
  const decisionOwner =
    phase === "Setup" && setupPhase === "PickCapital"
      ? snapshot.currentSetupPlayerIndex
      : snapshot.decisionOwner;
  const interaction = controller.diagnosticInteraction;
  const errors = recentErrors.get(controller);
  await archiveGameCapture(identity, {
    appVersion,
    capturedAt: Date.now(),
    device: {
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    },
    client: {
      phase,
      setupPhase,
      turnPhase,
      round,
      turnNumber,
      activeIndex,
      decisionOwner,
      pendingLand:
        snapshot.pendingLand === null
          ? null
          : { kind: snapshot.pendingLand.kind, propertyId: snapshot.pendingLand.propertyId },
      lastLandOutcomeKind: snapshot.lastLandOutcomeKind,
      lastLandOutcomeProperty: snapshot.lastLandOutcomeProperty,
      choices:
        interaction.seat === decisionOwner
          ? snapshot.choices.map(({ id, available }) => ({ id, available }))
          : [],
      ...session.readDecisions(snapshot, interaction.seat, interactive),
      interactive,
      selfPresenting,
      ...interaction,
    },
    connection:
      roomId === ""
        ? null
        : {
            roomId,
            status: net.connection,
            failure:
              net.connectionFailure === null
                ? null
                : diagnosticMessage(controller, net.connectionFailure),
          },
    errors: errors?.gameId === identity.gameId ? errors.entries : [],
    perf,
  });
}

/** 局中取用刷新同一局。历史或已离场的局直接读取归档。 */
export async function checkpointGameDiagnostics(gameId: string): Promise<void> {
  const session = active;
  if (session?.identity.gameId === gameId) await saveCapture(session, session.frames.collect());
}

function reportCaptureFailure(error: unknown): void {
  console.error("[gameDiagnostics] 对局现场归档失败:", error);
}

function finish(session: MountedDiagnostics): void {
  active = null;
  session.removeListeners();
  void saveCapture(session, session.frames.stop()).catch(reportCaptureFailure);
}

/** 正常退出时在清理交互和房间字段前同步定格，归档读取等待本次写入。 */
export function finishGameDiagnostics(controller: GameController): void {
  if (active?.controller === controller) finish(active);
}

export function mountGameDiagnostics(
  controller: GameController,
  gameId: string,
  appVersion: string,
  readDecisions: ReadDecisions,
): () => void {
  if (active !== null && (active.controller !== controller || active.identity.gameId !== gameId)) {
    finish(active);
  }
  if (active === null) {
    const net = useNetStore.getState();
    const { roomId } = net;
    const soloMap = controller.engine.mapId;
    const identity: GameArchiveIdentity =
      roomId === ""
        ? { gameId, mode: "solo", mapId: soloMap === "" ? null : soloMap }
        : { gameId, mode: "online", mapId: net.mapId };
    const addError = (message: string) => recordGameDiagnosticError(controller, gameId, message);
    const unsubscribeGame = useGameStore.subscribe((state, previous) => {
      if (
        state.snapshot?.gameId === gameId &&
        state.hintLevel === "error" &&
        state.hint !== null &&
        (state.hint !== previous.hint || previous.hintLevel !== "error")
      )
        addError(state.hint);
    });
    const unsubscribeNet = useNetStore.subscribe((state, previous) => {
      if (roomId === "" || state.roomId !== roomId) return;
      if (
        state.connectionFailure !== null &&
        state.connectionFailure !== previous.connectionFailure
      ) {
        addError(state.connectionFailure);
      }
      if (
        state.hintLevel === "error" &&
        state.hint !== null &&
        (state.hint !== previous.hint || previous.hintLevel !== "error")
      )
        addError(state.hint);
    });
    const onError = (event: ErrorEvent) => addError(event.message);
    const onRejection = ({ reason }: PromiseRejectionEvent) => {
      const error: unknown = reason;
      const message = error instanceof Error ? error.message : error;
      addError(typeof message === "string" ? message : "未处理的 Promise 拒绝");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void checkpointGameDiagnostics(gameId).catch(reportCaptureFailure);
      }
    };
    const frames = startFrameDiag();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    active = {
      controller,
      identity,
      roomId,
      appVersion,
      frames,
      readDecisions,
      mounted: true,
      removeListeners: () => {
        unsubscribeGame();
        unsubscribeNet();
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        document.removeEventListener("visibilitychange", onVisibility);
      },
    };
  }
  const session = active;
  session.readDecisions = readDecisions;
  session.mounted = true;
  return () => {
    session.mounted = false;
    // StrictMode 在同一拍卸载再装订，此时继续同一采样会话。
    queueMicrotask(() => {
      if (active === session && !session.mounted) finish(session);
    });
  };
}

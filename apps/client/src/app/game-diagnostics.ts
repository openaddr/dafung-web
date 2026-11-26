import type { GameController } from "./controllers/controller";
import { startFrameDiag, type FrameDiagDump } from "./frameDiag";
import { subscribeAudioPlayback } from "./fx/audio";
import type {
  GameArchiveIdentity,
  GameDiagnosticCapture,
  GameDiagnosticDecisions,
} from "./game-diagnostic-record";
import {
  GameDiagnosticTimeline,
  type GameDiagnosticControls,
  type GameDiagnosticTimelineState,
} from "./game-diagnostic-timeline";
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

interface DiagnosticScope {
  controller: GameController;
  identity: GameArchiveIdentity;
  roomId: string;
  readDecisions: ReadDecisions;
}

interface DiagnosticScene {
  client: GameDiagnosticCapture["client"];
  state: Omit<GameDiagnosticTimelineState, "controls">;
}

interface MountedDiagnostics extends DiagnosticScope {
  appVersion: string;
  frames: ReturnType<typeof startFrameDiag>;
  timeline: GameDiagnosticTimeline;
  scene: DiagnosticScene;
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
  if (active?.controller === controller && active.identity.gameId === gameId) {
    active.timeline.record({ kind: "error", at: performance.now(), message: entry.message });
  }
}

function readScene({
  controller,
  identity,
  roomId,
  readDecisions,
}: DiagnosticScope): DiagnosticScene | null {
  const { snapshot, interactive, selfPresenting, reactionDeadlineAt } = useGameStore.getState();
  const net = useNetStore.getState();
  if (
    snapshot?.gameId !== identity.gameId ||
    controller.engine.gameId !== identity.gameId ||
    net.roomId !== roomId
  )
    return null;

  const { phase, setupPhase, turnPhase, round, turnNumber, activeIndex } = snapshot;
  const decisionOwner =
    phase === "Setup" && setupPhase === "PickCapital"
      ? snapshot.currentSetupPlayerIndex
      : snapshot.decisionOwner;
  const turn = { phase, setupPhase, turnPhase, round, turnNumber, activeIndex, decisionOwner };
  const interaction = { interactive, selfPresenting, ...controller.diagnosticInteraction };
  const ownsDecision = interaction.seat === decisionOwner;
  const pendingLand =
    snapshot.pendingLand === null
      ? null
      : { kind: snapshot.pendingLand.kind, propertyId: snapshot.pendingLand.propertyId };
  const choices = ownsDecision
    ? snapshot.choices.map(({ id, available }) => ({ id, available }))
    : [];
  const decisions = readDecisions(snapshot, interaction.seat, interactive);
  const connection =
    roomId === ""
      ? null
      : {
          roomId,
          status: net.connection,
          failure:
            net.connectionFailure === null
              ? null
              : diagnosticMessage(controller, net.connectionFailure),
        };
  return {
    client: {
      ...turn,
      ...interaction,
      ...decisions,
      pendingLand,
      choices,
      lastLandOutcomeKind: snapshot.lastLandOutcomeKind,
      lastLandOutcomeProperty: snapshot.lastLandOutcomeProperty,
    },
    state: {
      turn,
      interaction,
      decision: {
        ...decisions,
        pendingLand,
        choices,
        pendingDebt: snapshot.pendingDebt,
        treasureVisitor: snapshot.treasureVisitor,
        pendingJinnang: ownsDecision ? snapshot.pendingJinnang : null,
        pendingSkill: ownsDecision ? snapshot.pendingSkill : null,
        skillChoice: ownsDecision ? (snapshot.pendingSkillChoices?.[0] ?? null) : null,
        reactionSeq: snapshot.pendingReaction === null ? null : snapshot.pendingReaction.seq,
        reactionDeadlineAt,
      },
      connection,
    },
  };
}

function refreshScene(session: MountedDiagnostics): void {
  const scene = readScene(session);
  if (scene === null) return;
  session.scene = scene;
  session.timeline.observe(scene.state);
}

/** 读控制器完整同步后的投影，避免记录 store 依次写入字段时的中间态。 */
export function observeGameDiagnosticState(controller: GameController): void {
  if (active?.controller === controller) refreshScene(active);
}

export function observeGameDiagnosticControls(
  controller: GameController,
  gameId: string,
  controls: Partial<GameDiagnosticControls>,
): void {
  if (active?.controller === controller && active.identity.gameId === gameId) {
    active.timeline.observeControls(controls);
  }
}

async function saveCapture(session: MountedDiagnostics, perf: FrameDiagDump): Promise<void> {
  const { controller, identity, appVersion, scene, timeline } = session;
  const errors = recentErrors.get(controller);
  await archiveGameCapture(identity, {
    appVersion,
    capturedAt: Date.now(),
    device: {
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    },
    client: scene.client,
    connection: scene.state.connection,
    errors: errors?.gameId === identity.gameId ? errors.entries : [],
    perf,
    timeline: timeline.collect(),
  });
}

/** 局中取用刷新同一局。历史或已离场的局直接读取归档。 */
export async function checkpointGameDiagnostics(gameId: string): Promise<void> {
  const session = active;
  if (session?.identity.gameId !== gameId) return;
  refreshScene(session);
  await saveCapture(session, session.frames.collect());
}

function reportCaptureFailure(error: unknown): void {
  console.error("[gameDiagnostics] 对局现场归档失败:", error);
}

function finish(session: MountedDiagnostics, stopPresentation?: () => void): void {
  refreshScene(session);
  active = null;
  // 保留清理前的交互状态，音效退订留到实际收声以后。
  try {
    stopPresentation?.();
  } finally {
    session.removeListeners();
    void saveCapture(session, session.frames.stop()).catch(reportCaptureFailure);
  }
}

/** 正常退出时在清理交互和房间字段前同步定格，归档读取等待本次写入。 */
export function finishGameDiagnostics(
  controller: GameController,
  stopPresentation?: () => void,
): void {
  if (active?.controller === controller) finish(active, stopPresentation);
  else stopPresentation?.();
}

export function mountGameDiagnostics(
  controller: GameController,
  gameId: string,
  appVersion: string,
  readDecisions: ReadDecisions,
  controls: GameDiagnosticControls,
): () => void {
  const net = useNetStore.getState();
  const { roomId } = net;
  const soloMap = controller.engine.mapId;
  const identity: GameArchiveIdentity =
    roomId === ""
      ? { gameId, mode: "solo", mapId: soloMap === "" ? null : soloMap }
      : { gameId, mode: "online", mapId: net.mapId };
  const scope = { controller, identity, roomId, readDecisions };
  const scene = readScene(scope);
  // 联机换局时，React 可能提交已被新局替换的屏幕。
  if (scene === null) return () => {};
  if (
    active !== null &&
    (active.controller !== controller ||
      active.identity.gameId !== gameId ||
      active.roomId !== roomId)
  ) {
    finish(active);
  }
  if (active === null) {
    const frames = startFrameDiag();
    const timeline = new GameDiagnosticTimeline({ ...scene.state, controls });
    let replayingAnchor = true;
    const unsubscribeController = controller.subscribeDiagnostics(
      ({ gameId: observedGameId, ...event }) => {
        if (observedGameId !== gameId) return;
        if ("reason" in event) event.reason = diagnosticMessage(controller, event.reason);
        timeline.record(event, replayingAnchor);
      },
    );
    replayingAnchor = false;
    const unsubscribeAudio = subscribeAudioPlayback((playback) => {
      if (controller.engine.gameId !== gameId) return;
      const { atMs, instanceId, sound } = playback;
      const event = { kind: "audio", at: atMs, instanceId, sound } as const;
      if (playback.kind === "start") timeline.record({ ...event, stage: "start" });
      else timeline.record({ ...event, stage: "end", reason: playback.reason });
    });
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
        // 音效宿主和对局屏同拍停播，全部监听器处理完才定格。
        queueMicrotask(() => {
          if (active?.timeline === timeline) {
            void checkpointGameDiagnostics(gameId).catch(reportCaptureFailure);
          }
        });
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    active = {
      ...scope,
      appVersion,
      frames,
      timeline,
      scene,
      mounted: true,
      removeListeners: () => {
        unsubscribeController();
        unsubscribeAudio();
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
  session.scene = scene;
  session.timeline.observe({ ...scene.state, controls });
  return () => {
    session.mounted = false;
    // StrictMode 在同一拍卸载再装订，此时继续同一采样会话。
    queueMicrotask(() => {
      if (active === session && !session.mounted) finish(session);
    });
  };
}

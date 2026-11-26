import type { GameControllerDiagnosticEvent } from "./controllers/controller";
import type { AudioPlaybackEvent } from "./fx/audio";
import type { GameDiagnosticCapture, GameDiagnosticDecisions } from "./game-diagnostic-record";
import type { GameSnapshot } from "./store/gameStore";

export type GameDiagnosticControl = "hidden" | "locked" | "available";

export interface GameDiagnosticControls {
  capital: GameDiagnosticControl;
  jinnang: GameDiagnosticControl;
  reaction: GameDiagnosticControl;
  skillChoice: GameDiagnosticControl;
  decisionScroll: GameDiagnosticControl;
  target: "seat" | "city" | null;
  peeking: boolean;
  preparing: boolean;
}

export interface GameDiagnosticTimelineState {
  turn: Pick<
    GameDiagnosticCapture["client"],
    "phase" | "setupPhase" | "turnPhase" | "round" | "turnNumber" | "activeIndex" | "decisionOwner"
  >;
  decision: Pick<GameDiagnosticCapture["client"], "pendingLand" | "choices"> &
    GameDiagnosticDecisions &
    Pick<GameSnapshot, "pendingDebt" | "treasureVisitor" | "pendingJinnang" | "pendingSkill"> & {
      skillChoice: NonNullable<GameSnapshot["pendingSkillChoices"]>[number] | null;
      reactionSeq: number | null;
      /** 反应条到点锁定，使用本段的单调毫秒。 */
      reactionDeadlineAt: number | null;
    };
  interaction: Pick<
    GameDiagnosticCapture["client"],
    "seat" | "interactive" | "selfPresenting" | "pending" | "fxBusy" | "autopilotOn"
  >;
  connection: GameDiagnosticCapture["connection"];
  controls: GameDiagnosticControls;
}

type WithoutGameId<Event> = Event extends { gameId: string } ? Omit<Event, "gameId"> : never;
type ControllerObservation = WithoutGameId<GameControllerDiagnosticEvent>;
type AuthorityObservation = Extract<ControllerObservation, { kind: "authorityLog" }>;
type AudioObservation = {
  kind: "audio";
  at: number;
  instanceId: AudioPlaybackEvent["instanceId"];
  sound: AudioPlaybackEvent["sound"];
} & (
  | { stage: "start" }
  | { stage: "end"; reason: Extract<AudioPlaybackEvent, { kind: "end" }>["reason"] }
);
type Observation =
  | ControllerObservation
  | AudioObservation
  | { kind: "error"; at: number; message: string };

export type GameDiagnosticTimelineEvent =
  | Observation
  | { kind: "state"; at: number; changes: Partial<GameDiagnosticTimelineState> };

export interface GameDiagnosticTimelineDump {
  timeOrigin: number;
  /** 与帧诊同用 performance.now() 相对毫秒。 */
  startedAt: number;
  capturedAt: number;
  /** 已包含被淘汰的状态变化，各项 changes 在此基础上按组覆盖。 */
  baseline: { at: number; state: GameDiagnosticTimelineState };
  /** 较早的收包证据没有对应的对局屏观测。 */
  authorityAnchorBeforeStart: AuthorityObservation | null;
  events: GameDiagnosticTimelineEvent[];
  omitted: number;
}

const MAX_EVENTS = 512;

/** 正常追加只改一个槽，迟到的收包序位按实际时间入列。 */
export class GameDiagnosticTimeline {
  readonly startedAt = performance.now();
  private readonly timeOrigin = performance.timeOrigin;
  private readonly events: GameDiagnosticTimelineEvent[] = [];
  private head = 0;
  private omitted = 0;
  private baseline: GameDiagnosticTimelineDump["baseline"];
  private authorityAnchorBeforeStart: AuthorityObservation | null = null;

  constructor(private state: GameDiagnosticTimelineState) {
    this.baseline = { at: this.startedAt, state };
  }

  observe(changes: Partial<GameDiagnosticTimelineState>): void {
    const at = performance.now();
    const delta: Partial<GameDiagnosticTimelineState> = {};
    for (const key of Object.keys(changes) as (keyof GameDiagnosticTimelineState)[]) {
      if (JSON.stringify(changes[key]) !== JSON.stringify(this.state[key])) {
        Object.assign(delta, { [key]: changes[key] });
      }
    }
    if (Object.keys(delta).length === 0) return;
    this.state = { ...this.state, ...delta };
    this.push({ kind: "state", at, changes: delta });
  }

  observeControls(controls: Partial<GameDiagnosticControls>): void {
    this.observe({ controls: { ...this.state.controls, ...controls } });
  }

  record(event: Observation, initialAuthorityAnchor = false): void {
    if (event.kind === "authorityLog" && (initialAuthorityAnchor || event.at < this.startedAt)) {
      if (event.source === "snapshot") this.authorityAnchorBeforeStart = event;
      else this.omitted++;
      return;
    }
    this.push(event);
  }

  private push(event: GameDiagnosticTimelineEvent): void {
    if (event.at < this.baseline.at) {
      this.omitted++;
      return;
    }
    let end = this.events.length;
    if (end === MAX_EVENTS) {
      this.omitted++;
      const oldest = this.events[this.head];
      if (event.at < oldest.at) {
        this.baseline = { ...this.baseline, at: event.at };
        return;
      }
      this.baseline = {
        at: oldest.at,
        state:
          oldest.kind === "state"
            ? { ...this.baseline.state, ...oldest.changes }
            : this.baseline.state,
      };
      this.head = (this.head + 1) % MAX_EVENTS;
      end--;
    }
    while (end > 0) {
      const prior = this.events[(this.head + end - 1) % MAX_EVENTS];
      if (prior.at <= event.at) break;
      this.events[(this.head + end) % MAX_EVENTS] = prior;
      end--;
    }
    this.events[(this.head + end) % MAX_EVENTS] = event;
  }

  collect(): GameDiagnosticTimelineDump {
    return {
      timeOrigin: this.timeOrigin,
      startedAt: this.startedAt,
      capturedAt: performance.now(),
      baseline: this.baseline,
      authorityAnchorBeforeStart: this.authorityAnchorBeforeStart,
      events: [...this.events.slice(this.head), ...this.events.slice(0, this.head)],
      omitted: this.omitted,
    };
  }
}

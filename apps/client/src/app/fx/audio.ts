import { SOUND_CLIPS, soundClipUrl, type SoundEvent } from "./sound-clips";

export type { SoundEvent } from "./sound-clips";

export type AudioPlaybackEndReason =
  | "natural"
  | "beatFade"
  | "replaced"
  | "cancelled"
  | "muted"
  | "background"
  | "failed";

type PlaybackInstance = { readonly instanceId: number; readonly sound: SoundEvent };
type PlaybackChange =
  | { readonly kind: "start" }
  | { readonly kind: "end"; readonly reason: AudioPlaybackEndReason };

export type AudioPlaybackEvent = PlaybackInstance & PlaybackChange & { readonly atMs: number };

const playbackListeners = new Set<(event: AudioPlaybackEvent) => void>();
let nextPlaybackId = 0;

/** 开播由媒体确认。开播前失败或被收回的实例只报告结束。 */
export function subscribeAudioPlayback(listener: (event: AudioPlaybackEvent) => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

function reportPlayback(instance: PlaybackInstance | null, change: PlaybackChange): void {
  if (instance === null || playbackListeners.size === 0) return;
  const event: AudioPlaybackEvent = { ...instance, ...change, atMs: performance.now() };
  for (const listener of playbackListeners) listener(event);
}

type PlaybackScope = "reaction" | "presentation" | "all";
export type PlaybackStopMode = "immediate" | "fade";
type GainRamp = { from: number; to: number; startAt: number; endAt: number; updatedAt: number };
type FadeReason = Exclude<AudioPlaybackEndReason, "natural" | "failed">;
type Timer = ReturnType<typeof setTimeout>;
type ActivePlayback = {
  url: string;
  volume: number;
  scope: Exclude<PlaybackScope, "all">;
  instance: PlaybackInstance | null;
  duck: number | GainRamp;
  fadeStart?: Timer;
  handoff?: Timer;
  release?: GainRamp & { reason: FadeReason };
};

export interface AudioPlayer {
  /** 可选的交棒时限从开播拍起算。主线程恢复后，已响的声音继续渐出。 */
  play(event: SoundEvent, endWithinMs?: number): void;
  /** 捕获当前演出。作废或静音后，延迟发声失效。 */
  defer(event: SoundEvent, endWithinMs?: number): () => void;
  stop(scope: PlaybackScope, mode?: PlaybackStopMode): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

const REACTION_DUCK_GAIN = 0.35;
const REACTION_ATTACK_MS = 32;
const REACTION_RELEASE_MS = 144;
const SOUND_RELEASE_MS = 112;
const MIX_STEP_MS = 16;

function gainAt(ramp: GainRamp, now: number): number {
  const progress = Math.min(1, (now - ramp.startAt) / (ramp.endAt - ramp.startAt));
  return ramp.from + (ramp.to - ramp.from) * progress;
}

function startGainRamp(from: number, to: number, now: number, duration: number): GainRamp {
  return { from, to, startAt: now, endAt: now + duration, updatedAt: now };
}

function advanceGain(ramp: GainRamp, now: number): number {
  // 卡顿期间没有写入音量。恢复后最多补一拍，其余量随后的混音拍逐步应用。
  const skippedMs = Math.max(0, now - ramp.updatedAt - MIX_STEP_MS);
  ramp.startAt += skippedMs;
  ramp.endAt += skippedMs;
  ramp.updatedAt = now;
  return gainAt(ramp, now);
}

function releaseAudio(audio: HTMLAudioElement): void {
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

// 依赖 WebView 的媒体播放链路。卓易通实测 AudioContext 可报告 running 却停在 0 秒
// (#1556)，同一进程内 HTMLAudioElement 仍可出声。
export class MediaAudioPlayer implements AudioPlayer {
  private muted = false;
  private readonly idle = new Map<string, HTMLAudioElement>();
  private readonly active = new Map<HTMLAudioElement, ActivePlayback>();
  private reaction: HTMLAudioElement | null = null;
  private mixTimer: Timer | undefined;
  private generation = 0;
  private lastMarchStart: number | null = null;
  private marchRapidCount = 0;

  constructor({ preload = true } = {}) {
    if (!preload) return;
    for (const clip of Object.values(SOUND_CLIPS)) {
      const url = soundClipUrl(clip);
      if (!this.idle.has(url)) this.idle.set(url, new Audio(url));
    }
  }

  play(event: SoundEvent, endWithinMs?: number): void {
    this.playClip(event, endWithinMs);
  }

  /** 已点选的试听用素材原速，切换时收掉本播放器的上一声。 */
  audition(event: SoundEvent, onComplete: (played: boolean) => void): void {
    this.stop("all");
    this.playClip(event, undefined, onComplete);
  }

  private playClip(
    event: SoundEvent,
    endWithinMs?: number,
    onAuditionComplete?: (played: boolean) => void,
  ): void {
    if (endWithinMs === 0 || this.muted || document.visibilityState === "hidden") return;

    const auditioning = onAuditionComplete !== undefined;
    const clip = SOUND_CLIPS[event];
    let volume = clip.kind === "recording" ? (clip.volume ?? 0.3) : 1;
    if (event === "marchStart" && !auditioning) {
      const now = performance.now();
      const last = this.lastMarchStart;
      if (last !== null && now - last < 50) return;
      this.marchRapidCount = last !== null && now - last < 600 ? this.marchRapidCount + 1 : 0;
      this.lastMarchStart = now;
      volume *= Math.max(0.4, 1 - this.marchRapidCount * 0.2);
    }

    const isReaction = !auditioning && (event === "reactionOpen" || event === "reactionTick");
    if (isReaction && this.reaction !== null) {
      this.fadeOut(this.active.get(this.reaction)!, "replaced");
    }
    const url = soundClipUrl(clip);
    const audio = this.idle.get(url) ?? new Audio(url);
    this.idle.delete(url);
    const duck = isReaction || this.reaction === null ? 1 : REACTION_DUCK_GAIN;
    const playback: ActivePlayback = {
      url,
      volume,
      scope: isReaction ? "reaction" : "presentation",
      instance:
        auditioning || event === "jinnangSelect" || event === "lobbyJoined"
          ? null
          : { instanceId: ++nextPlaybackId, sound: event },
      duck,
    };
    this.active.set(audio, playback);
    audio.volume = volume * duck;
    if (isReaction) {
      this.reaction = audio;
      this.setDuckGain(REACTION_DUCK_GAIN, REACTION_ATTACK_MS);
    }

    audio.currentTime = 0;
    audio.muted = false;
    // 原声拟音轻微变调。预混成品保留已编排的音高关系。
    audio.preservesPitch = false;
    audio.playbackRate =
      clip.kind === "recording" && !auditioning ? 0.92 + Math.random() * 0.16 : 1;

    const fail = (error: unknown) => {
      if (!this.finish(audio, playback, "failed")) return;
      console.warn(`[audio] ${event} 播放失败`, error);
      onAuditionComplete?.(false);
    };
    audio.onended = () => {
      if (this.finish(audio, playback, "natural")) onAuditionComplete?.(true);
    };
    audio.onerror = () => fail(audio.error);
    if (endWithinMs !== undefined) {
      const releaseMs = Math.min(SOUND_RELEASE_MS, endWithinMs / 2);
      playback.fadeStart = setTimeout(
        () => this.fadeOut(playback, "beatFade", releaseMs),
        endWithinMs - releaseMs,
      );
      // 正常节拍在交棒拍写完最后一步。卡住时由后续混音拍写完再释放。
      playback.handoff = setTimeout(() => this.updateMix(), endWithinMs);
    }
    void audio.play().then(() => {
      if (this.active.get(audio) === playback) reportPlayback(playback.instance, { kind: "start" });
    }, fail);
  }

  defer(event: SoundEvent, endWithinMs?: number): () => void {
    const generation = this.generation;
    const enabled = !this.muted && document.visibilityState !== "hidden";
    return () => {
      if (enabled && generation === this.generation) this.play(event, endWithinMs);
    };
  }

  private finish(
    audio: HTMLAudioElement,
    playback: ActivePlayback,
    reason: AudioPlaybackEndReason,
  ): boolean {
    if (this.active.get(audio) !== playback) return false;
    this.active.delete(audio);
    clearTimeout(playback.fadeStart);
    clearTimeout(playback.handoff);
    if (audio === this.reaction) {
      this.reaction = null;
      this.setDuckGain(1, REACTION_RELEASE_MS);
    }
    audio.onended = null;
    audio.onerror = null;
    if (reason === "natural" && !this.idle.has(playback.url)) this.idle.set(playback.url, audio);
    else releaseAudio(audio);
    reportPlayback(playback.instance, { kind: "end", reason });
    return true;
  }

  private fadeOut(playback: ActivePlayback, reason: FadeReason, duration = SOUND_RELEASE_MS): void {
    if (playback.release !== undefined) return;
    playback.release = { ...startGainRamp(1, 0, performance.now(), duration), reason };
    clearTimeout(playback.fadeStart);
    this.updateMix();
  }

  private setDuckGain(target: number, duration: number): void {
    const now = performance.now();
    for (const playback of this.active.values()) {
      if (playback.scope === "reaction") continue;
      const duck = playback.duck;
      if (typeof duck !== "number" && duck.to === target) continue;
      const from = typeof duck === "number" ? duck : gainAt(duck, duck.updatedAt);
      playback.duck = from === target ? target : startGainRamp(from, target, now, duration);
    }
    this.updateMix();
  }

  private updateMix(): void {
    const now = performance.now();
    let changing = false;
    for (const [audio, playback] of this.active) {
      const { duck, release } = playback;
      const duckGain = typeof duck === "number" ? duck : advanceGain(duck, now);
      const releaseGain = release === undefined ? 1 : advanceGain(release, now);
      if (typeof duck !== "number" && now >= duck.endAt) playback.duck = duck.to;
      audio.volume = playback.volume * duckGain * releaseGain;
      if (release !== undefined && now >= release.endAt) {
        this.finish(audio, playback, release.reason);
        continue;
      }
      if (typeof playback.duck !== "number" || release !== undefined) changing = true;
    }
    if (changing && this.mixTimer === undefined) {
      this.mixTimer = setTimeout(() => {
        this.mixTimer = undefined;
        this.updateMix();
      }, MIX_STEP_MS);
    }
  }

  stop(scope: PlaybackScope, mode: PlaybackStopMode = "immediate"): void {
    // 切后台时演出清理和宿主停声都经过这里，以调用时的可见性归因。
    const reason = this.muted
      ? "muted"
      : document.visibilityState === "hidden"
        ? "background"
        : "cancelled";
    if (scope !== "reaction") this.generation++;
    const stopReaction = scope !== "presentation" && this.reaction !== null;
    if (stopReaction) this.reaction = null;
    for (const [audio, playback] of this.active) {
      if (scope !== "all" && scope !== playback.scope) continue;
      if (mode === "fade") this.fadeOut(playback, reason);
      else this.finish(audio, playback, reason);
    }
    if (scope === "all" && mode === "immediate") {
      clearTimeout(this.mixTimer);
      this.mixTimer = undefined;
    } else if (stopReaction) {
      this.setDuckGain(1, REACTION_RELEASE_MS);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop("all");
  }

  dispose(): void {
    this.stop("all");
    for (const audio of this.idle.values()) releaseAudio(audio);
    this.idle.clear();
  }
}

// 控制器与 React 组件共用当前路由宿主的播放器。
const NOOP: AudioPlayer = {
  play: () => {},
  defer: () => () => {},
  stop: () => {},
  setMuted: () => {},
  dispose: () => {},
};

let instance: AudioPlayer | null = null;

export function setAudio(player: AudioPlayer | null): void {
  instance?.dispose();
  instance = player;
}

export function getAudio(): AudioPlayer {
  return instance ?? NOOP;
}

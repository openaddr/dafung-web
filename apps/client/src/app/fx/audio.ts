import { SOUND_CLIPS, soundClipUrl, type SoundEvent } from "./sound-clips";

export type { SoundEvent } from "./sound-clips";

type PlaybackScope = "reaction" | "presentation" | "all";
type ActivePlayback = { volume: number; cutoff?: ReturnType<typeof setTimeout> };

export interface AudioPlayer {
  /** 可选的时限从开播拍起算，只约束这一声。 */
  play(event: SoundEvent, endWithinMs?: number): void;
  /** 捕获当前演出。作废或静音后，延迟发声失效。 */
  defer(event: SoundEvent, endWithinMs?: number): () => void;
  stop(scope: PlaybackScope): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

const REACTION_DUCK_GAIN = 0.35;

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
    if (isReaction) this.stop("reaction");
    const url = soundClipUrl(clip);
    const audio = this.idle.get(url) ?? new Audio(url);
    this.idle.delete(url);
    const playback: ActivePlayback = { volume };
    this.active.set(audio, playback);
    if (isReaction) {
      this.reaction = audio;
      this.applyVolumes();
    } else {
      audio.volume = this.reaction === null ? volume : volume * REACTION_DUCK_GAIN;
    }

    audio.currentTime = 0;
    audio.muted = false;
    // 录音轻微变调避免重复触发听感单调。合成的高低音有固定含义。
    audio.preservesPitch = false;
    audio.playbackRate =
      clip.kind === "recording" && !auditioning ? 0.92 + Math.random() * 0.16 : 1;

    const finish = (reusable: boolean) => {
      if (this.active.get(audio) !== playback) return false;
      this.active.delete(audio);
      clearTimeout(playback.cutoff);
      if (audio === this.reaction) {
        this.reaction = null;
        this.applyVolumes();
      }
      audio.onended = null;
      audio.onerror = null;
      if (reusable && !this.idle.has(url)) this.idle.set(url, audio);
      else releaseAudio(audio);
      return true;
    };
    const fail = (error: unknown) => {
      if (!finish(false)) return;
      console.warn(`[audio] ${event} 播放失败`, error);
      onAuditionComplete?.(false);
    };
    audio.onended = () => {
      if (finish(true)) onAuditionComplete?.(true);
    };
    audio.onerror = () => fail(audio.error);
    if (endWithinMs !== undefined) playback.cutoff = setTimeout(() => finish(false), endWithinMs);
    void audio.play().catch(fail);
  }

  defer(event: SoundEvent, endWithinMs?: number): () => void {
    const generation = this.generation;
    const enabled = !this.muted && document.visibilityState !== "hidden";
    return () => {
      if (enabled && generation === this.generation) this.play(event, endWithinMs);
    };
  }

  private applyVolumes(): void {
    for (const [audio, { volume }] of this.active) {
      audio.volume =
        this.reaction === null || audio === this.reaction ? volume : volume * REACTION_DUCK_GAIN;
    }
  }

  stop(scope: PlaybackScope): void {
    if (scope !== "reaction") this.generation++;
    const wasDucked = this.reaction !== null;
    for (const [audio, { cutoff }] of this.active) {
      const channel = audio === this.reaction ? "reaction" : "presentation";
      if (scope !== "all" && scope !== channel) continue;
      this.active.delete(audio);
      clearTimeout(cutoff);
      if (channel === "reaction") this.reaction = null;
      releaseAudio(audio);
    }
    if (wasDucked && this.reaction === null) this.applyVolumes();
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

import { SOUND_CLIPS, soundClipUrl, type SoundEvent } from "./sound-clips";

export type { SoundEvent } from "./sound-clips";

export interface AudioPlayer {
  play(event: SoundEvent): void;
  setMuted(muted: boolean): void;
  dispose(): void;
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
  private readonly active = new Set<HTMLAudioElement>();
  private lastMarchStart: number | null = null;
  private marchRapidCount = 0;

  constructor() {
    for (const clip of Object.values(SOUND_CLIPS)) {
      const url = soundClipUrl(clip);
      if (!this.idle.has(url)) this.idle.set(url, new Audio(url));
    }
  }

  play(event: SoundEvent): void {
    if (this.muted) return;

    const clip = SOUND_CLIPS[event];
    let volume = clip.kind === "recording" ? (clip.volume ?? 0.3) : 1;
    if (event === "marchStart") {
      const now = performance.now();
      const last = this.lastMarchStart;
      if (last !== null && now - last < 50) return;
      this.marchRapidCount = last !== null && now - last < 600 ? this.marchRapidCount + 1 : 0;
      this.lastMarchStart = now;
      volume *= Math.max(0.4, 1 - this.marchRapidCount * 0.2);
    }

    const url = soundClipUrl(clip);
    const audio = this.idle.get(url) ?? new Audio(url);
    this.idle.delete(url);
    this.active.add(audio);

    audio.currentTime = 0;
    audio.volume = volume;
    audio.muted = false;
    // 录音轻微变调避免重复触发听感单调。合成的高低音有固定含义。
    audio.preservesPitch = false;
    audio.playbackRate = clip.kind === "recording" ? 0.92 + Math.random() * 0.16 : 1;

    const finish = (reusable: boolean) => {
      if (!this.active.delete(audio)) return;
      audio.onended = null;
      audio.onerror = null;
      if (reusable && !this.idle.has(url)) this.idle.set(url, audio);
      else releaseAudio(audio);
    };
    const fail = (error: unknown) => {
      if (!this.active.has(audio)) return;
      console.warn(`[audio] ${event} 播放失败`, error);
      finish(false);
    };
    audio.onended = () => finish(true);
    audio.onerror = () => fail(audio.error);
    void audio.play().catch(fail);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const audio of this.active) audio.muted = muted;
  }

  dispose(): void {
    for (const audio of this.active) releaseAudio(audio);
    for (const audio of this.idle.values()) releaseAudio(audio);
    this.active.clear();
    this.idle.clear();
  }
}

// 控制器与 React 组件共用当前对局的播放器。
const NOOP: AudioPlayer = {
  play: () => {},
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

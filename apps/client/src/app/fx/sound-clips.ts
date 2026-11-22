// 对局音效的素材、响度与收尾。裁剪和合成在打包前生成，播放侧直接读成品。
export type SoundClip =
  | {
      kind: "recording";
      file: string;
      volume?: number;
      trim?: { stopAt: number; releaseMs: number };
    }
  | { kind: "synth"; file: string };

const WOODBLOCK = {
  kind: "recording",
  file: "woodblock-hit.ogg",
  trim: { stopAt: 0.65, releaseMs: 200 },
} as const;

const clips = {
  diceLand: WOODBLOCK,
  marchStart: { kind: "synth", file: "march-start.ogg" },
  coin: { kind: "recording", file: "coin-drop.ogg" },
  pay: { kind: "synth", file: "pay.ogg" },
  stamp: { kind: "recording", file: "stamp-seal.ogg" },
  buy: {
    kind: "recording",
    file: "coins-shake.ogg",
    trim: { stopAt: 1.6, releaseMs: 300 },
  },
  upgrade: WOODBLOCK,
  treasure: { kind: "recording", file: "guqin-note.ogg" },
  bankrupt: { kind: "recording", file: "gong-long.ogg" },
  victory: { kind: "recording", file: "victory-fanfare.ogg" },
  victoryDrum: { kind: "recording", file: "drum-roll.ogg" },
  scrollOpen: {
    kind: "recording",
    file: "scroll-unroll.ogg",
    trim: { stopAt: 1.8, releaseMs: 300 },
  },
  jinnangDraw: WOODBLOCK,
  jinnangSelect: { kind: "synth", file: "jinnang-select.ogg" },
  coinsBox: { kind: "recording", file: "audio-coins-box.ogg" },
  rain: {
    kind: "recording",
    file: "audio-rain.ogg",
    volume: 0.15,
    trim: { stopAt: 3, releaseMs: 600 },
  },
  haltGong: { kind: "recording", file: "audio-halt-horn.ogg" },
  duelClash: { kind: "recording", file: "audio-duel-clash.ogg" },
  verdictChime: {
    kind: "recording",
    file: "audio-verdict-chime.ogg",
    trim: { stopAt: 1.6, releaseMs: 400 },
  },
  verdictChimeWin: { kind: "synth", file: "verdict-chime-win.ogg" },
  verdictChimeLose: { kind: "synth", file: "verdict-chime-lose.ogg" },
  reactionOpen: WOODBLOCK,
  reactionTick: { kind: "synth", file: "reaction-tick.ogg" },
} satisfies Record<string, SoundClip>;

export type SoundEvent = keyof typeof clips;
export const SOUND_CLIPS: Readonly<Record<SoundEvent, SoundClip>> = clips;

export function soundClipUrl(clip: SoundClip): string {
  const directory = clip.kind === "synth" || clip.trim ? "playback/" : "";
  return `/assets/audio/${directory}${clip.file}`;
}

// 用法：bun scripts/build-sound-clips.ts [音效事件 ...]。常规构建直接使用已提交的成品。
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SOUND_CLIPS, type SoundEvent } from "../apps/client/src/app/fx/sound-clips";

const rate = 48_000;
const floor = 0.0001;
const master = 0.5;
const audioDir = resolve(import.meta.dir, "../apps/client/public/assets/audio");
const playbackDir = join(audioDir, "playback");

function exponential(from: number, to: number, progress: number): number {
  return from * (to / from) ** progress;
}

function tone(
  output: Float32Array,
  frequency: number,
  duration: number,
  volume: number,
  offset = 0,
  thump = false,
) {
  const start = Math.round(offset * rate);
  const frames = Math.round(duration * rate);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const time = i / rate;
    const gain = thump
      ? exponential(volume, floor, time / duration)
      : time < 0.01
        ? exponential(floor, volume, time / 0.01)
        : exponential(volume, floor, (time - 0.01) / (duration - 0.01));
    const pitch = thump ? exponential(frequency * 1.6, frequency, time / duration) : frequency;
    output[start + i] += master * gain * Math.sin(phase);
    phase += (2 * Math.PI * pitch) / rate;
  }
}

function tap(output: Float32Array, duration: number, cutoff: number, volume: number, offset = 0) {
  // 原合成轻叩的高通白噪声，固定种子便于重生成。
  const w = (2 * Math.PI * cutoff) / rate;
  const alpha = Math.sin(w) / (2 * 0.7);
  const cos = Math.cos(w);
  const b0 = (1 + cos) / (2 * (1 + alpha));
  const a1 = (-2 * cos) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  let seed = 1234;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const start = Math.round(offset * rate);
  for (let i = 0; i < Math.round(duration * rate); i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed / 0x80000000 - 1;
    const y = b0 * (x - 2 * x1 + x2) - a1 * y1 - a2 * y2;
    output[start + i] += master * exponential(volume, floor, i / (rate * duration)) * y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
}

function render(duration: number, mix: (output: Float32Array) => void) {
  // 预留 10ms 尾部静音，避免编码结束帧切掉余韵。
  const samples = new Float32Array(Math.round((duration + 0.01) * rate));
  mix(samples);
  return samples;
}

function mixRecording(
  output: Float32Array,
  file: string,
  startAt: number,
  duration: number,
  gain: number,
  offset = 0,
  lowPassHz?: number,
) {
  const fades = `afade=t=in:d=0.004,afade=t=out:st=${duration - 0.035}:d=0.035:curve=exp`;
  const filter = lowPassHz === undefined ? fades : `lowpass=f=${lowPassHz},${fades}`;
  const decoded = Bun.spawnSync(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(startAt),
      "-i",
      join(audioDir, file),
      "-t",
      String(duration),
      "-af",
      filter,
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { stdin: "ignore", stderr: "inherit", stdout: "pipe" },
  );
  if (decoded.exitCode !== 0 || decoded.stdout.length === 0)
    throw new Error(`读取录音 ${file} 失败`);
  const samples = new Float32Array(
    decoded.stdout.buffer,
    decoded.stdout.byteOffset,
    decoded.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const first = Math.round(offset * rate);
  for (let i = 0; i < samples.length; i++) output[first + i] += samples[i] * gain;
}

function woodKnock(output: Float32Array, pitch: number, volume: number, offset: number) {
  tap(output, 0.035, 1650, volume * 0.28, offset);
  tone(output, pitch, 0.085, volume, offset, true);
  tone(output, pitch * 1.83, 0.042, volume * 0.23, offset, true);
}

// 沿用同一段古琴录音的两处拨弦起音。
const guqin = { file: "guqin-note.ogg", lowAt: 3.168, highAt: 1.168 };

// 起兵与称帝用同一三个音，终局由落印声引出。
const campaignMotif = [
  { frequency: 293.66, offset: 0, duration: 0.148 },
  { frequency: 349.23, offset: 0.125, duration: 0.16 },
  { frequency: 440, offset: 0.275, duration: 0.318 },
];

function playCampaignMotif(output: Float32Array, offset: number, volume: number) {
  for (const note of campaignMotif) {
    const start = Math.round((offset + note.offset) * rate);
    const frames = Math.round(note.duration * rate);
    let phase = 0;
    for (let i = 0; i < frames; i++) {
      const time = i / rate;
      const attack = Math.sin(Math.min(1, time / 0.027) * (Math.PI / 2));
      const release = Math.min(1, (note.duration - time) / 0.088) ** 1.35;
      const pitch =
        note.frequency * (1 - 0.018 * Math.exp(-time * 62) + 0.003 * Math.sin(29 * time));
      const harmonics =
        Math.sin(phase) +
        0.56 * Math.sin(2 * phase) +
        0.32 * Math.sin(3 * phase) +
        0.17 * attack * Math.sin(4 * phase) +
        0.09 * attack * Math.sin(5 * phase);
      output[start + i] += master * volume * attack * release * harmonics;
      phase += (2 * Math.PI * pitch) / rate;
    }
  }
}

const verdictLow = 830.61;
const verdictHigh = 1108.73;

function verdictChime(pitches: readonly number[], targetRms: number) {
  const samples = render(0.36, (out) => {
    for (const [note, pitch] of pitches.entries()) {
      const offset = note * 0.095;
      tone(out, pitch, 0.249, 0.34, offset);
      tone(out, pitch * 2.71, 0.13, 0.21, offset);
      tone(out, pitch * 4.87, 0.078, 0.095, offset);
      tap(out, 0.027, 2150, 0.036, offset);
    }
  });
  // 等长成品按均方根调增益，单音和双音的目标值由解码后的响度校准。
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  const gain = targetRms / rms;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

const synth: Partial<Record<SoundEvent, () => Float32Array>> = {
  gameStart: () => render(0.6, (out) => playCampaignMotif(out, 0, 0.26)),
  victoryDrum: () =>
    render(0.31, (out) => {
      tone(out, 112, 0.29, 0.85, 0, true);
      tone(out, 207, 0.18, 0.36, 0, true);
      tone(out, 355, 0.095, 0.15, 0, true);
      tap(out, 0.038, 940, 0.23);
    }),
  victory: () =>
    render(0.74, (out) => {
      mixRecording(out, "stamp-seal.ogg", 0.284, 0.178, 0.85);
      playCampaignMotif(out, 0.124, 0.36);
    }),
  marchStart: () =>
    render(0.074, (out) => {
      tap(out, 0.041, 1350, 0.062);
      tone(out, 495, 0.054, 0.16, 0.018, true);
      tone(out, 945, 0.035, 0.045, 0.023, true);
    }),
  haltLatch: () =>
    render(0.155, (out) => {
      tap(out, 0.051, 1000, 0.105);
      tone(out, 465, 0.043, 0.135, 0, true);
      woodKnock(out, 265, 0.41, 0.043);
      tap(out, 0.017, 2700, 0.1, 0.047);
    }),
  staminaHit: () =>
    render(0.103, (out) => {
      tap(out, 0.029, 1100, 0.039);
      tone(out, 208, 0.103, 0.19, 0, true);
      tone(out, 396, 0.055, 0.058, 0, true);
    }),
  staminaRecover: () =>
    render(0.165, (out) => {
      tone(out, 430, 0.118, 0.11);
      tone(out, 645, 0.111, 0.11, 0.046);
      tone(out, 860, 0.087, 0.036, 0.051);
    }),
  exhaustionDrum: () =>
    render(0.27, (out) => {
      tap(out, 0.035, 1220, 0.058);
      tone(out, 156, 0.27, 0.32, 0, true);
      tone(out, 313, 0.172, 0.126, 0, true);
    }),
  pay: () =>
    render(0.2, (out) => {
      tap(out, 0.07, 1150, 0.065, 0.01);
      tone(out, 185, 0.16, 0.26, 0, true);
      tone(out, 112, 0.18, 0.14, 0.02, true);
    }),
  buy: () =>
    render(0.23, (out) => {
      mixRecording(out, "stamp-seal.ogg", 0.281, 0.125, 0.6);
      mixRecording(out, "coins-shake.ogg", 0.392, 0.168, 0.15, 0.062);
    }),
  cashTransfer: () =>
    render(0.17, (out) => {
      mixRecording(out, "coin-drop.ogg", 0.552, 0.15, 0.65);
      mixRecording(out, "coins-shake.ogg", 0.392, 0.125, 0.065, 0.045);
    }),
  upgrade: () =>
    render(0.19, (out) => {
      woodKnock(out, 310, 0.29, 0);
      woodKnock(out, 245, 0.36, 0.105);
    }),
  cityHit: () =>
    render(0.169, (out) => {
      mixRecording(out, "audio-stone-impact.ogg", 0.024, 0.169, 0.15, 0, 4400);
    }),
  cityBreach: () =>
    render(0.63, (out) => {
      mixRecording(out, "audio-stone-crash.ogg", 0.003, 0.63, 0.25, 0, 5200);
      tone(out, 182, 0.159, 0.2, 0.008, true);
    }),
  cityConquest: () =>
    render(0.6, (out) => {
      woodKnock(out, 212, 0.56, 0.004);
      tone(out, 146, 0.19, 0.24, 0.018, true);
      mixRecording(out, "audio-gate-splinter.ogg", 1.643, 0.256, 0.48, 0, 7200);
      mixRecording(out, "audio-flag-flaps.ogg", 1.364, 0.55, 0.51, 0.05, 5400);
    }),
  treasure: () =>
    render(0.345, (out) => {
      mixRecording(out, guqin.file, guqin.lowAt, 0.2, 0.44);
      mixRecording(out, guqin.file, guqin.highAt, 0.23, 0.38, 0.115);
    }),
  treasureStolen: () =>
    render(0.2, (out) => {
      mixRecording(out, guqin.file, guqin.lowAt, 0.11, 0.38, 0, 950);
      mixRecording(out, guqin.file, guqin.highAt, 0.105, 0.34, 0.095, 950);
    }),
  bookSetDown: () =>
    render(0.18, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 2.592, 0.15, 1.25);
      mixRecording(out, "stamp-seal.ogg", 0.277, 0.14, 0.43, 0.04, 1350);
    }),
  heroRecruited: () =>
    render(0.28, (out) => {
      tap(out, 0.043, 2900, 0.14);
      tone(out, 2340, 0.063, 0.18);
      tone(out, 3180, 0.052, 0.11, 0.016);
      mixRecording(out, guqin.file, guqin.lowAt, 0.21, 0.39, 0.07);
    }),
  skillLearned: () =>
    render(0.3, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 1.264, 0.16, 1.5);
      mixRecording(out, guqin.file, guqin.highAt, 0.18, 0.34, 0.12);
    }),
  ledgerClose: () =>
    render(0.23, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 3.044, 0.15, 1.55, 0, 2900);
      mixRecording(out, "stamp-seal.ogg", 0.281, 0.15, 0.48, 0.08, 1700);
      tone(out, 168, 0.105, 0.22, 0.08, true);
    }),
  jinnangDraw: () =>
    render(0.145, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 0.327, 0.145, 1.4);
      tap(out, 0.023, 2300, 0.042, 0.022);
    }),
  jinnangSelect: () =>
    render(0.045, (out) => {
      tap(out, 0.045, 3800, 0.072);
      tone(out, 2700, 0.03, 0.02);
    }),
  jinnangAnnounce: () =>
    render(0.23, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 1.551, 0.23, 1.25);
      tap(out, 0.05, 1900, 0.055, 0.04);
    }),
  jinnangCountered: () =>
    render(0.115, (out) => {
      tap(out, 0.02, 2250, 0.13);
      tone(out, 1450, 0.105, 0.17);
      tone(out, 2370, 0.063, 0.095);
      tone(out, 3190, 0.039, 0.055);
    }),
  jinnangRestored: () =>
    render(0.22, (out) => {
      tap(out, 0.023, 2600, 0.087);
      tone(out, 1450, 0.1, 0.11);
      tone(out, 2370, 0.074, 0.072);
      tone(out, 1840, 0.146, 0.085, 0.073);
      tone(out, 2760, 0.09, 0.044, 0.073);
    }),
  jinnangPeek: () =>
    render(0.24, (out) => {
      mixRecording(out, "scroll-unroll.ogg", 1.236, 0.17, 1.6);
      mixRecording(out, "scroll-unroll.ogg", 0.827, 0.102, 1.65, 0.127);
    }),
  lobbyJoined: () =>
    render(0.11, (out) => {
      tap(out, 0.028, 1450, 0.075);
      tone(out, 225, 0.105, 0.17, 0, true);
      tone(out, 610, 0.065, 0.052, 0, true);
    }),
  reconnectFailure: () =>
    render(0.17, (out) => {
      tone(out, 740, 0.085, 0.095, 0, true);
      tone(out, 495, 0.105, 0.1, 0.065, true);
    }),
  verdictChime: () => verdictChime([960], 0.031),
  verdictChimeWin: () => verdictChime([verdictLow, verdictHigh], 0.036),
  verdictChimeLose: () => verdictChime([verdictHigh, verdictLow], 0.036),
  reactionOpen: () =>
    render(0.075, (out) => {
      tap(out, 0.03, 1900, 0.045);
      tone(out, 980, 0.075, 0.12, 0, true);
    }),
  reactionTick: () => render(0.05, (out) => tone(out, 620, 0.05, 0.12, 0, true)),
};

function encode(file: string, input: string[], pcm?: Float32Array) {
  const result = Bun.spawnSync(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...input,
      "-map_metadata",
      "-1",
      "-c:a",
      "libvorbis",
      "-q:a",
      "4",
      join(playbackDir, file),
    ],
    { stdin: pcm ? new Uint8Array(pcm.buffer) : "ignore", stderr: "inherit" },
  );
  if (result.exitCode !== 0) throw new Error(`生成 ${file} 失败`);
}

const requested = Bun.argv.slice(2);
for (const event of requested) {
  if (!Object.hasOwn(SOUND_CLIPS, event)) throw new Error(`未知音效事件 ${event}`);
}
const events = (requested.length ? requested : Object.keys(SOUND_CLIPS)) as SoundEvent[];
mkdirSync(playbackDir, { recursive: true });
const encoded = new Set<string>();
for (const event of events) {
  const clip = SOUND_CLIPS[event];
  if (encoded.has(clip.file)) continue;
  encoded.add(clip.file);
  if (clip.kind !== "recording") {
    const generate = synth[event];
    if (!generate) throw new Error(`缺少 ${event} 的音效生成配方`);
    encode(clip.file, ["-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"], generate());
  } else if (clip.trim) {
    const { startAt = 0, stopAt, releaseMs } = clip.trim;
    const duration = stopAt - startAt;
    const release = releaseMs / 1000;
    encode(clip.file, [
      "-ss",
      String(startAt),
      "-i",
      join(audioDir, clip.file),
      "-t",
      String(duration),
      "-af",
      `afade=t=out:st=${duration - release}:d=${release}:curve=exp`,
    ]);
  }
}

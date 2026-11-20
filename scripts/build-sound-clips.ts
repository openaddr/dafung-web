// 用法：bun scripts/build-sound-clips.ts。本地需有 ffmpeg，常规构建直接使用已提交的成品。
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SOUND_CLIPS, type SoundEvent } from "../src/app/fx/sound-clips";

const rate = 48_000;
const floor = 0.0001;
const master = 0.5;
const audioDir = resolve(import.meta.dir, "../public/assets/audio");
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

function tap(output: Float32Array, duration: number, cutoff: number, volume: number) {
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
  for (let i = 0; i < Math.round(duration * rate); i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed / 0x80000000 - 1;
    const y = b0 * (x - 2 * x1 + x2) - a1 * y1 - a2 * y2;
    output[i] += master * exponential(volume, floor, i / (rate * duration)) * y;
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

const synth: Partial<Record<SoundEvent, () => Float32Array>> = {
  marchStart: () =>
    render(0.07, (out) => {
      tap(out, 0.07, 3200, 0.09);
      tone(out, 2400, 0.04, 0.03);
    }),
  pay: () =>
    render(0.21, (out) => {
      tone(out, 990, 0.09, 0.16);
      tone(out, 660, 0.14, 0.12, 0.07);
    }),
  jinnangSelect: () =>
    render(0.045, (out) => {
      tap(out, 0.045, 3800, 0.055);
      tone(out, 2700, 0.03, 0.02);
    }),
  verdictChimeWin: () =>
    render(0.77, (out) => {
      tone(out, 1320, 0.35, 0.2);
      tone(out, 1980, 0.65, 0.16, 0.12);
    }),
  verdictChimeLose: () =>
    render(0.84, (out) => {
      tone(out, 880, 0.4, 0.18);
      tone(out, 620, 0.7, 0.14, 0.14);
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

mkdirSync(playbackDir, { recursive: true });
const encoded = new Set<string>();
for (const event of Object.keys(SOUND_CLIPS) as SoundEvent[]) {
  const clip = SOUND_CLIPS[event];
  if (encoded.has(clip.file)) continue;
  encoded.add(clip.file);
  if (clip.kind === "synth") {
    const generate = synth[event];
    if (!generate) throw new Error(`缺少 ${event} 的合成音配方`);
    encode(clip.file, ["-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"], generate());
  } else if (clip.trim) {
    const { stopAt, releaseMs } = clip.trim;
    const release = releaseMs / 1000;
    encode(clip.file, [
      "-i",
      join(audioDir, clip.file),
      "-t",
      String(stopAt),
      "-af",
      `afade=t=out:st=${stopAt - release}:d=${release}:curve=exp`,
    ]);
  }
}

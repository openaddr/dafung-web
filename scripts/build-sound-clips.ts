// 用法：bun scripts/build-sound-clips.ts [音效事件 ...]。常规构建直接使用已提交的成品。
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sources from "../apps/client/public/assets/manifest.json";
import { SOUND_CLIPS, type SoundEvent } from "../apps/client/src/app/fx/sound-clips";

type RecordingId = Extract<keyof typeof sources, `audio:${string}`>;
type Recording = { path: string; source?: string; review_required?: boolean };

const rate = 48_000;
const publicDir = resolve(import.meta.dir, "../apps/client/public");
const playbackDir = join(publicDir, "assets/audio/playback");

function recordingPath(asset: Recording | undefined, label: string): string {
  if (!asset?.source || asset.review_required !== false)
    throw new Error(`录音缺少已核对的来源 ${label}`);
  return join(publicDir, asset.path);
}

function render(duration: number, mix: (output: Float32Array) => void) {
  // 预留 10ms 尾部静音，避免编码结束帧切掉余韵。
  const samples = new Float32Array(Math.round((duration + 0.01) * rate));
  mix(samples);
  return samples;
}

interface RecordingEdit {
  offset?: number;
  lowPassHz?: number;
  speed?: number;
  releaseMs?: number;
}

function mixRecording(
  output: Float32Array,
  id: RecordingId,
  startAt: number,
  duration: number,
  gain: number,
  { offset = 0, lowPassHz, speed = 1, releaseMs = 35 }: RecordingEdit = {},
) {
  const filters: string[] = [];
  if (speed !== 1) {
    filters.push(
      `aformat=sample_rates=${rate}`,
      `asetrate=${Math.round(rate * speed)}`,
      `aresample=${rate}`,
    );
  }
  // 裁剪和渐隐使用片段内的时间，避免录音的原始偏移影响时长。
  filters.push("asetpts=N/SR/TB");
  if (lowPassHz !== undefined) filters.push(`lowpass=f=${lowPassHz}`);
  const release = Math.min(releaseMs / 1000, duration / 2);
  filters.push("afade=t=in:d=0.004", `afade=t=out:st=${duration - release}:d=${release}:curve=exp`);
  const decoded = Bun.spawnSync(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(startAt),
      "-i",
      recordingPath(sources[id], id),
      "-t",
      String(duration),
      "-af",
      filters.join(","),
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
  if (decoded.exitCode !== 0 || decoded.stdout.length === 0) throw new Error(`读取录音 ${id} 失败`);
  const samples = new Float32Array(
    decoded.stdout.buffer,
    decoded.stdout.byteOffset,
    decoded.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const first = Math.round(offset * rate);
  if (first + samples.length > output.length) throw new Error(`录音 ${id} 超出成品时长`);
  for (let i = 0; i < samples.length; i++) output[first + i] += samples[i] * gain;
}

const guqin = { id: "audio:guqin", lowAt: 3.168, highAt: 1.168 } as const;

// C4 实录移调为 D4、F4、A4，起兵与称帝共用短句。
const campaignMotif = [
  { semitones: 2, offset: 0, duration: 0.153, releaseMs: 48 },
  { semitones: 5, offset: 0.125, duration: 0.173, releaseMs: 55 },
  { semitones: 9, offset: 0.275, duration: 0.395, releaseMs: 122 },
];

function playCampaignMotif(output: Float32Array, offset: number, gain: number) {
  for (const note of campaignMotif) {
    mixRecording(output, "audio:horn-note", 0.054, note.duration, gain, {
      offset: offset + note.offset,
      speed: 2 ** (note.semitones / 12),
      lowPassHz: 5300,
      releaseMs: note.releaseMs,
    });
  }
}

function verdictChime(speeds: readonly number[], targetRms: number) {
  const samples = render(0.41, (out) => {
    for (const [note, speed] of speeds.entries()) {
      const hasSecond = speeds.length > 1 && note === 0;
      mixRecording(out, "audio:singing-bowl", 0.036, hasSecond ? 0.19 : 0.285, 1, {
        offset: note * 0.116,
        speed,
        releaseMs: hasSecond ? 66 : 92,
      });
    }
  });
  // 等长成品按均方根配平三种判词响度。
  const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  const gain = targetRms / rms;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

const mixes: Partial<Record<SoundEvent, () => Float32Array>> = {
  gameStart: () => render(0.67, (out) => playCampaignMotif(out, 0, 1.78)),
  victoryDrum: () =>
    render(0.39, (out) => {
      mixRecording(out, "audio:bass-drum", 0.055, 0.39, 0.54, { releaseMs: 100 });
    }),
  victory: () =>
    render(0.794, (out) => {
      mixRecording(out, "audio:stamp-seal", 0.284, 0.178, 0.85);
      playCampaignMotif(out, 0.124, 2.45);
    }),
  marchStart: () =>
    render(0.1, (out) => {
      mixRecording(out, "audio:wood-slide", 0.205, 0.1, 0.46, { lowPassHz: 3700 });
      mixRecording(out, "audio:wood-latch", 0.002, 0.043, 0.08, { offset: 0.04, lowPassHz: 2000 });
    }),
  haltLatch: () =>
    render(0.182, (out) => {
      mixRecording(out, "audio:wood-latch", 0.001, 0.182, 0.22, { lowPassHz: 3000, releaseMs: 50 });
    }),
  staminaHit: () =>
    render(0.118, (out) => {
      mixRecording(out, "audio:bass-drum", 0.065, 0.118, 0.105, { speed: 1.18, lowPassHz: 1240 });
    }),
  staminaRecover: () =>
    render(0.188, (out) => {
      mixRecording(out, "audio:singing-bowl", 0.037, 0.128, 0.31, { speed: 0.84, releaseMs: 50 });
      mixRecording(out, "audio:singing-bowl", 0.037, 0.128, 0.34, {
        speed: 1.13,
        offset: 0.06,
        releaseMs: 60,
      });
    }),
  exhaustionDrum: () =>
    render(0.314, (out) => {
      mixRecording(out, "audio:bass-drum", 0.056, 0.314, 0.19, {
        speed: 0.82,
        lowPassHz: 1300,
        releaseMs: 85,
      });
    }),
  pay: () =>
    render(0.204, (out) => {
      mixRecording(out, "audio:flag-flaps", 0.063, 0.204, 0.37, {
        speed: 0.86,
        lowPassHz: 1580,
        releaseMs: 58,
      });
      mixRecording(out, "audio:coins-shake", 0.408, 0.145, 0.32, {
        offset: 0.041,
        speed: 0.8,
        lowPassHz: 1740,
        releaseMs: 55,
      });
    }),
  buy: () =>
    render(0.23, (out) => {
      mixRecording(out, "audio:stamp-seal", 0.281, 0.125, 0.6);
      mixRecording(out, "audio:coins-shake", 0.392, 0.168, 0.15, { offset: 0.062 });
    }),
  cashTransfer: () =>
    render(0.17, (out) => {
      mixRecording(out, "audio:coin", 0.552, 0.15, 0.65);
      mixRecording(out, "audio:coins-shake", 0.392, 0.125, 0.065, { offset: 0.045 });
    }),
  upgrade: () =>
    render(0.222, (out) => {
      mixRecording(out, "audio:wood-latch", 0.002, 0.076, 0.2, { lowPassHz: 2900 });
      mixRecording(out, "audio:wood-latch", 0.073, 0.127, 0.28, {
        offset: 0.095,
        speed: 0.86,
        lowPassHz: 2600,
        releaseMs: 51,
      });
    }),
  cityHit: () =>
    render(0.169, (out) => {
      mixRecording(out, "audio:stone-impact", 0.024, 0.169, 0.15, { lowPassHz: 4400 });
    }),
  cityBreach: () =>
    render(0.63, (out) => {
      mixRecording(out, "audio:stone-crash", 0.003, 0.63, 0.25, { lowPassHz: 5200 });
      mixRecording(out, "audio:bass-drum", 0.063, 0.183, 0.12, { speed: 0.91, lowPassHz: 810 });
    }),
  cityConquest: () =>
    render(0.6, (out) => {
      mixRecording(out, "audio:wood-latch", 0.002, 0.158, 0.25, { speed: 0.76, lowPassHz: 2100 });
      mixRecording(out, "audio:bass-drum", 0.069, 0.198, 0.25, {
        offset: 0.006,
        speed: 0.83,
        lowPassHz: 860,
      });
      mixRecording(out, "audio:gate-splinter", 1.643, 0.256, 0.48, { lowPassHz: 7200 });
      mixRecording(out, "audio:flag-flaps", 1.364, 0.55, 0.51, { offset: 0.05, lowPassHz: 5400 });
    }),
  treasure: () =>
    render(0.345, (out) => {
      mixRecording(out, guqin.id, guqin.lowAt, 0.2, 0.44);
      mixRecording(out, guqin.id, guqin.highAt, 0.23, 0.38, { offset: 0.115 });
    }),
  treasureStolen: () =>
    render(0.2, (out) => {
      mixRecording(out, guqin.id, guqin.lowAt, 0.11, 0.38, { lowPassHz: 950 });
      mixRecording(out, guqin.id, guqin.highAt, 0.105, 0.34, { offset: 0.095, lowPassHz: 950 });
    }),
  bookSetDown: () =>
    render(0.18, (out) => {
      mixRecording(out, "audio:scroll-unroll", 2.592, 0.15, 1.25);
      mixRecording(out, "audio:stamp-seal", 0.277, 0.14, 0.43, { offset: 0.04, lowPassHz: 1350 });
    }),
  heroRecruited: () =>
    render(0.28, (out) => {
      mixRecording(out, "audio:armor-buckle", 0.132, 0.12, 0.41, { lowPassHz: 5800 });
      mixRecording(out, guqin.id, guqin.lowAt, 0.21, 0.39, { offset: 0.07 });
    }),
  skillLearned: () =>
    render(0.3, (out) => {
      mixRecording(out, "audio:scroll-unroll", 1.264, 0.16, 1.5);
      mixRecording(out, guqin.id, guqin.highAt, 0.18, 0.34, { offset: 0.12 });
    }),
  ledgerClose: () =>
    render(0.23, (out) => {
      mixRecording(out, "audio:scroll-unroll", 3.044, 0.15, 1.55, { lowPassHz: 2900 });
      mixRecording(out, "audio:stamp-seal", 0.281, 0.15, 0.48, { offset: 0.08, lowPassHz: 1700 });
      mixRecording(out, "audio:wood-latch", 0.072, 0.122, 0.15, { offset: 0.073, lowPassHz: 980 });
    }),
  jinnangDraw: () =>
    render(0.145, (out) => {
      mixRecording(out, "audio:scroll-unroll", 0.327, 0.145, 1.53);
    }),
  jinnangSelect: () =>
    render(0.05, (out) => {
      mixRecording(out, "audio:scroll-unroll", 2.385, 0.05, 0.22, { releaseMs: 20 });
      mixRecording(out, "audio:scroll-unroll", 1.588, 0.044, 0.16, {
        offset: 0.006,
        releaseMs: 19,
      });
    }),
  jinnangAnnounce: () =>
    render(0.23, (out) => {
      mixRecording(out, "audio:scroll-unroll", 1.551, 0.23, 1.33);
    }),
  jinnangCountered: () =>
    render(0.127, (out) => {
      mixRecording(out, "audio:metal-clasp", 0.131, 0.06, 0.26, { lowPassHz: 6400, releaseMs: 19 });
      mixRecording(out, "audio:singing-bowl", 0.036, 0.115, 0.35, { offset: 0.012, speed: 1.09 });
    }),
  jinnangRestored: () =>
    render(0.24, (out) => {
      mixRecording(out, "audio:metal-clasp", 0.13, 0.061, 0.155, { releaseMs: 20 });
      mixRecording(out, "audio:singing-bowl", 0.036, 0.12, 0.36, { offset: 0.008, speed: 1.09 });
      mixRecording(out, "audio:singing-bowl", 0.036, 0.154, 0.36, {
        offset: 0.083,
        speed: 1.37,
        releaseMs: 59,
      });
    }),
  jinnangPeek: () =>
    render(0.24, (out) => {
      mixRecording(out, "audio:scroll-unroll", 1.236, 0.17, 1.6);
      mixRecording(out, "audio:scroll-unroll", 0.827, 0.102, 1.65, { offset: 0.127 });
    }),
  lobbyJoined: () =>
    render(0.104, (out) => {
      mixRecording(out, "audio:wood-latch", 0.001, 0.104, 0.145, { speed: 0.82, lowPassHz: 2300 });
    }),
  reconnectFailure: () =>
    render(0.185, (out) => {
      mixRecording(out, "audio:ceramic-tap", 0.018, 0.105, 0.08, { speed: 0.75, lowPassHz: 3100 });
      mixRecording(out, "audio:ceramic-tap", 0.018, 0.115, 0.09, {
        offset: 0.07,
        speed: 0.57,
        lowPassHz: 2700,
        releaseMs: 45,
      });
    }),
  verdictChime: () => verdictChime([1.12], 0.031),
  verdictChimeWin: () => verdictChime([1, 1.26], 0.036),
  verdictChimeLose: () => verdictChime([1.26, 1], 0.036),
  reactionOpen: () =>
    render(0.083, (out) => {
      mixRecording(out, "audio:ceramic-tap", 0.017, 0.083, 0.094, { speed: 1.08, releaseMs: 32 });
    }),
  reactionTick: () =>
    render(0.062, (out) => {
      mixRecording(out, "audio:ceramic-tap", 0.018, 0.062, 0.11, {
        speed: 0.79,
        lowPassHz: 2750,
        releaseMs: 26,
      });
    }),
};

function encode(file: string, input: string[], pcm?: Float32Array) {
  if (pcm?.some((sample) => !Number.isFinite(sample) || Math.abs(sample) > 1))
    throw new Error(`混制音效 ${file} 超出满幅`);
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
  if (clip.kind === "mix") {
    const generate = mixes[event];
    if (!generate) throw new Error(`缺少 ${event} 的录音混制配方`);
    encode(clip.file, ["-f", "f32le", "-ar", String(rate), "-ac", "1", "-i", "pipe:0"], generate());
    continue;
  }

  const asset = Object.values(sources).find(({ path }) => path === `assets/audio/${clip.file}`);
  const sourcePath = recordingPath(asset, clip.file);
  if (!clip.trim) continue;
  const { startAt = 0, stopAt, releaseMs } = clip.trim;
  const duration = stopAt - startAt;
  const release = releaseMs / 1000;
  encode(clip.file, [
    "-ss",
    String(startAt),
    "-i",
    sourcePath,
    "-t",
    String(duration),
    "-af",
    `afade=t=out:st=${duration - release}:d=${release}:curve=exp`,
  ]);
}

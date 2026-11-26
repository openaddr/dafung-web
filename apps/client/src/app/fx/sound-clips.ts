// 对局音效的素材、响度与收尾。裁剪和混制在打包前生成，播放侧直接读成品。
export type SoundClip =
  | {
      kind: "recording";
      file: string;
      volume?: number;
      trim?: { startAt?: number; stopAt: number; releaseMs: number };
    }
  | { kind: "mix"; file: string };

const clips = {
  diceLand: {
    kind: "recording",
    file: "woodblock-hit.ogg",
    trim: { startAt: 0.008, stopAt: 0.13, releaseMs: 32 },
  },
  marchStart: { kind: "mix", file: "march-start.ogg" },
  haltLatch: { kind: "mix", file: "halt-latch.ogg" },
  staminaHit: { kind: "mix", file: "stamina-hit.ogg" },
  staminaRecover: { kind: "mix", file: "stamina-recover.ogg" },
  exhaustionDrum: { kind: "mix", file: "exhaustion-drum.ogg" },
  coin: {
    kind: "recording",
    file: "coin-drop.ogg",
    volume: 0.5,
    trim: { startAt: 0.552, stopAt: 0.734, releaseMs: 40 },
  },
  pay: { kind: "mix", file: "pay.ogg" },
  stamp: {
    kind: "recording",
    file: "stamp-seal.ogg",
    trim: { startAt: 0.284, stopAt: 0.57, releaseMs: 100 },
  },
  buy: { kind: "mix", file: "property-purchase.ogg" },
  cashTransfer: { kind: "mix", file: "cash-transfer.ogg" },
  upgrade: { kind: "mix", file: "property-upgrade.ogg" },
  cityHit: { kind: "mix", file: "city-hit.ogg" },
  cityBreach: { kind: "mix", file: "city-breach.ogg" },
  cityConquest: { kind: "mix", file: "city-conquest.ogg" },
  treasure: { kind: "mix", file: "treasure-pluck.ogg" },
  treasureStolen: { kind: "mix", file: "treasure-muted-pluck.ogg" },
  bookSetDown: { kind: "mix", file: "book-set-down.ogg" },
  heroRecruited: { kind: "mix", file: "hero-recruited.ogg" },
  skillLearned: { kind: "mix", file: "skill-learned.ogg" },
  ledgerClose: { kind: "mix", file: "ledger-close.ogg" },
  bankrupt: {
    kind: "recording",
    file: "gong-long.ogg",
    trim: { stopAt: 2.35, releaseMs: 620 },
  },
  gameStart: { kind: "mix", file: "game-start.ogg" },
  victoryDrum: { kind: "mix", file: "victory-drum.ogg" },
  victory: { kind: "mix", file: "victory-theme.ogg" },
  scrollOpen: {
    kind: "recording",
    file: "scroll-unroll.ogg",
    volume: 0.6,
    trim: { startAt: 1.584, stopAt: 1.88, releaseMs: 120 },
  },
  jinnangDraw: { kind: "mix", file: "jinnang-draw.ogg" },
  jinnangSelect: { kind: "mix", file: "jinnang-select.ogg" },
  jinnangAnnounce: { kind: "mix", file: "jinnang-announce.ogg" },
  jinnangCountered: { kind: "mix", file: "jinnang-countered.ogg" },
  jinnangRestored: { kind: "mix", file: "jinnang-restored.ogg" },
  jinnangPeek: { kind: "mix", file: "jinnang-peek.ogg" },
  lobbyJoined: { kind: "mix", file: "lobby-joined.ogg" },
  reconnectFailure: { kind: "mix", file: "reconnect-failure.ogg" },
  coinsBox: {
    kind: "recording",
    file: "audio-coins-box.ogg",
    volume: 0.26,
    trim: { startAt: 0.695, stopAt: 0.88, releaseMs: 65 },
  },
  rain: {
    kind: "recording",
    file: "audio-rain.ogg",
    volume: 0.08,
    trim: { stopAt: 2.38, releaseMs: 680 },
  },
  duelClash: { kind: "recording", file: "audio-duel-clash.ogg" },
  verdictChime: { kind: "mix", file: "verdict-chime.ogg" },
  verdictChimeWin: { kind: "mix", file: "verdict-chime-win.ogg" },
  verdictChimeLose: { kind: "mix", file: "verdict-chime-lose.ogg" },
  reactionOpen: { kind: "mix", file: "reaction-open.ogg" },
  reactionTick: { kind: "mix", file: "reaction-tick.ogg" },
} satisfies Record<string, SoundClip>;

export type SoundEvent = keyof typeof clips;
export const SOUND_CLIPS: Readonly<Record<SoundEvent, SoundClip>> = clips;

export function soundClipUrl(clip: SoundClip): string {
  const directory = clip.kind !== "recording" || clip.trim ? "playback/" : "";
  return `/assets/audio/${directory}${clip.file}`;
}

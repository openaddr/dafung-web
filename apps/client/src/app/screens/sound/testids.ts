import type { SoundEvent } from "@app/fx/sound-clips";

export const SOUND_TID = {
  dialog: "sound-audition-dialog",
  close: "sound-audition-close",
  play: (event: SoundEvent) => `sound-audition-${event}`,
  error: "sound-audition-error",
} as const;

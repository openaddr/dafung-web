import { setAudio, type SoundEvent } from "@app/fx/audio";

export function recordAudio(): SoundEvent[] {
  const sounds: SoundEvent[] = [];
  const play = (sound: SoundEvent) => {
    sounds.push(sound);
  };
  const player = {
    play,
    defer: (sound: SoundEvent) => () => play(sound),
    stop() {},
    setMuted() {},
    dispose() {},
  };
  setAudio(player);
  return sounds;
}

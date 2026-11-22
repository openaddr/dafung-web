// 组件收口:器物豁免(永久)——器物件,交互收口规则不适用(细则 docs/design/组件收口.md)
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MediaAudioPlayer, setAudio, getAudio } from "./audio";

interface AudioCtxValue {
  muted: boolean;
  toggleMuted: () => void;
}

const AudioCtx = createContext<AudioCtxValue | null>(null);

/** 供组件读取音效开关;控制器直接用 getAudio()。 */
export function useAudio(): AudioCtxValue | null {
  return useContext(AudioCtx);
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setAudio(new MediaAudioPlayer());
    return () => setAudio(null);
  }, []);

  const value = useMemo<AudioCtxValue>(
    () => ({
      muted,
      toggleMuted: () => {
        const nextMuted = !muted;
        getAudio().setMuted(nextMuted);
        setMuted(nextMuted);
      },
    }),
    [muted],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

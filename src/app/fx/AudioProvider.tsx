// 音效的 React 封装:mount 时创建全局 HybridAudioPlayer(真实文件优先/合成回退),
// 并在首次用户手势里 unlock AudioContext(浏览器 autoplay policy:AudioContext 必须
// 在手势内创建/resume 才能出声;旧实现靠 ensureCtx 惰性创建,这里再补手势主动解锁)。
// 播放器经 audio.ts 的模块单例暴露给控制器,组件层也可经 context 拿(如静音开关)。
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HybridAudioPlayer, setAudio, getAudio, type AudioPlayer } from "./audio";

interface AudioCtxValue {
  player: AudioPlayer;
  muted: boolean;
  toggleMuted: () => void;
}

const AudioCtx = createContext<AudioCtxValue | null>(null);

/** 供组件读取(静音开关等);控制器侧请直接用 getAudio()(不依赖 React 树)。 */
export function useAudio(): AudioCtxValue | null {
  return useContext(AudioCtx);
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const player = new HybridAudioPlayer();
    setAudio(player);
    // 手势解锁:一次性 pointerdown 里 ensureCtx+resume(once:解锁后无需再听)
    const unlock = () => player.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      setAudio(null); // 内部会 dispose 播放器
    };
  }, []);

  const value = useMemo<AudioCtxValue>(
    () => ({
      player: getAudio(),
      muted,
      toggleMuted: () => {
        setMuted((m) => {
          getAudio().setMuted(!m);
          return !m;
        });
      },
    }),
    [muted],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

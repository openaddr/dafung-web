// 组件收口:器物豁免(永久)——器物件,交互收口规则不适用(细则 docs/design/组件收口.md)
// 音效的 React 封装:mount 时创建全局 HybridAudioPlayer(真实文件优先/合成回退),
// 在点按完成时主动恢复 AudioContext，首次未恢复时可以随下一次点按重试。
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
    // 触屏通常在抬手时获得用户激活。捕获 click 在按钮自身的音效处理之前恢复，
    // 也能收到无障碍激活。保持监听，直到本局播放器卸载。
    const unlock = () => player.unlock();
    window.addEventListener("click", unlock, { capture: true });
    return () => {
      window.removeEventListener("click", unlock, { capture: true });
      setAudio(null); // 内部会 dispose 播放器
    };
  }, []);

  const value = useMemo<AudioCtxValue>(
    () => ({
      player: getAudio(),
      muted,
      toggleMuted: () => {
        const player = getAudio();
        const nextMuted = !muted;
        player.setMuted(nextMuted);
        if (!nextMuted) player.unlock?.();
        setMuted(nextMuted);
      },
    }),
    [muted],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

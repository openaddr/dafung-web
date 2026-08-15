// React 封装 ThreeDice:mount 创建 / unmount cleanup,生命周期归 React;
// 触发走 diceApi 模块桥——控制器(非 React 世界)直接调 diceApi.roll(die),
// 不必把实例塞进 store(ThreeDice 含 GL 资源,非可序列化数据,同 engine 的理由)。
import { useEffect } from "react";
import { ThreeDice } from "./ThreeDice";
import { getAudio } from "./audio";

/** 骰子命令桥:DiceOverlay 挂载时被填实现,卸载后回退 no-op。
 *  roll(face?) 可传结果面(服务器权威骰子预留,见 ThreeDice.roll 注释)。 */
export const diceApi: {
  available: boolean;
  roll(face?: number): Promise<void>;
} = {
  available: false,
  roll: () => Promise.resolve(),
};

/** 不渲染任何 DOM(ThreeDice 自建全屏 overlay append 到 body)。挂进 Game 屏一次即可。 */
export function DiceOverlay() {
  useEffect(() => {
    // 骰子随机流与引擎种子分离:物理翻滚纯表现,复现对局(?seed=)不受掷骰动画影响。
    const dice = new ThreeDice(Math.random, (intensity) => {
      getAudio().play("diceHit", { intensity });
    });
    diceApi.available = dice.available;
    diceApi.roll = (face?: number) => dice.roll(face);
    return () => {
      // StrictMode 双挂载安全:cleanup 先还原桥再释放 GL 资源
      diceApi.available = false;
      diceApi.roll = () => Promise.resolve();
      dice.cleanup();
    };
  }, []);
  return null;
}

// 掷骰签面演出(#483:three.js 3D 骰退役,签面转正为唯一掷骰表现):
// 全屏 overlay + 96px 大字签面,弹入 → 停留(holdMs;bot 走半速档)→ 渐隐退场,
// 样式与时长见 fx.css .dice-overlay/.dice-sign 与 fx/timings.ts DICE。
// mount/unmount 归 React;触发走 diceApi 模块桥——控制器(非 React 世界)直接调
// diceApi.roll(die),不必把实例塞进 store(非可序列化数据,同 engine 的理由)。
import { useEffect } from "react";
import { SIGN_FACES } from "@core/constants";
import { DICE } from "./timings";

// ── C1 bot 半速掷骰(模块级速度开关)──
// 速度标志由编排层 present() 在掷前调 setDiceFast 设置;roll() 读取后即复位,
// 不残留到下一次掷骰。默认 false(人类全速)。
let diceFast = false;

/** 设置下一次掷骰的速度档(true = bot 档:停留走 botHoldMs,比人类档更短)。 */
export function setDiceFast(fast: boolean): void {
  diceFast = fast;
}
/** 读取并复位速度标志(每次 roll 恰好消费一次)。 */
function consumeDiceFast(): boolean {
  const fast = diceFast;
  diceFast = false;
  return fast;
}

// 在场 overlay 引用(D2 终局提前收场用;present() 串行 await,同时至多一张)。
let activeOverlay: HTMLElement | null = null;

/** D2:骰子演出提前收场(终局切胜利屏时由 VictoryScreen mount 调用)。
 *  这是生命周期规则而非兜底:对局结束 = 骰子表现层使命终结——立即移除在场
 *  overlay,防止 z-45 残留压住胜利屏。hold/渐隐定时器不取消:闭包只触碰自己的
 *  overlay 节点,节点移除后均为无害操作,roll() 的 Promise 照常 resolve,
 *  不会吊死 present() 编排链。overlay 类名由本模块创建且唯一。 */
export function finishDiceOverlay(): void {
  activeOverlay?.remove();
  activeOverlay = null;
}

/** 掷骰签面:全屏 overlay + 大字签面(SIGN_FACES),弹入 → 停留 → 渐隐退场。
 *  返回的 Promise 在渐隐完成后 resolve,present() 据此串行接行军。 */
function rollSign(die: number): Promise<void> {
  const fast = consumeDiceFast();
  const overlay = document.createElement("div");
  overlay.className = "dice-overlay";
  const sign = document.createElement("div");
  sign.className = "dice-sign";
  sign.textContent = SIGN_FACES[die - 1];
  overlay.appendChild(sign);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  return new Promise<void>((resolve) => {
    window.setTimeout(
      () => {
        if (activeOverlay === overlay) activeOverlay = null;
        overlay.classList.add("dice-overlay-out");
        window.setTimeout(() => {
          overlay.remove();
          resolve();
        }, DICE.fadeOutMs);
      },
      fast ? DICE.botHoldMs : DICE.holdMs,
    );
  });
}

/** 骰子命令桥:DiceOverlay 挂载期间绑定真实实现,卸载后回退 no-op
 *  (StrictMode 双挂载安全:cleanup 先还原桥,再由 React 走下一次挂载)。 */
export const diceApi: {
  roll(face: number): Promise<void>;
} = {
  roll: () => Promise.resolve(),
};

/** 不渲染任何 DOM(签面 overlay 掷骰时 append 到 body)。挂进 Game 屏一次即可。 */
export function DiceOverlay() {
  useEffect(() => {
    diceApi.roll = rollSign;
    return () => {
      diceApi.roll = () => Promise.resolve();
    };
  }, []);
  return null;
}

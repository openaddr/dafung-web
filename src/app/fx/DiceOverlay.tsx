// 掷骰签面演出(#483:three.js 3D 骰退役,签面转正为唯一掷骰表现):
// S7 两段式(#513/#492 拍板:标准档摇签 0.6s)——
//   第一段 摇签:墨字虚影 60ms 级轮换(全段恰 10 次换签)带微旋,签卡隐去只余字影;
//   第二段 落定:大字 outBack 钤落(签卡随之现身)+ 落点金圈同拍 + 桌面微震 4px。
// 之后停留(holdMs;bot 走半速档:摇签/停留都压半)→ 渐隐退场。
// 样式与时长见 fx.css .dice-sign/.dice-sign-shaking/.dice-sign-land/.fx-dice-ring 与
// fx/timings.ts DICE。mount/unmount 归 React;触发走 diceApi 模块桥——控制器(非
// React 世界)直接调 diceApi.roll(die),不必把实例塞进 store(非可序列化数据,同
// engine 的理由)。
import { useEffect } from "react";
import { SIGN_FACES } from "@core/constants";
import { getAudio } from "./audio";
import { shakeDesk } from "./desk";
import { DICE } from "./timings";

// ── C1 bot 半速掷骰(模块级速度开关)──
// 速度标志由编排层 present() 在掷前调 setDiceFast 设置;roll() 读取后即复位,
// 不残留到下一次掷骰。默认 false(人类全速)。
let diceFast = false;

/** 设置下一次掷骰的速度档(true = bot 档:摇签/停留都走半速)。 */
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

/** D2:骰子演出提前收场(生产调用口 = orchestrator.finishPresentation,胜利屏
 *  挂载封场整个表现层时连带调用;本函数只管在场这一张)。
 *  这是生命周期规则而非兜底:对局结束 = 骰子表现层使命终结——立即移除在场
 *  overlay,防止 z-45 残留压住胜利屏。摇签轮换/hold/渐隐定时器不取消:闭包只
 *  触碰自己的 overlay 节点,节点移除后均为无害操作(轮换下个 tick 被 clearInterval),
 *  roll() 的 Promise 照常 resolve,不会吊死 present() 编排链。overlay 类名由本模块
 *  创建且唯一。 */
export function finishDiceOverlay(): void {
  activeOverlay?.remove();
  activeOverlay = null;
}

/** 掷骰签面:全屏 overlay + 大字签面(SIGN_FACES),摇签 → 落定 → 停留 → 渐隐退场。
 *  返回的 Promise 在渐隐完成后 resolve,present() 据此串行接行军。 */
function rollSign(die: number): Promise<void> {
  const fast = consumeDiceFast();
  const shakeMs = fast ? DICE.botShakeMs : DICE.shakeMs;
  const overlay = document.createElement("div");
  overlay.className = "dice-overlay";
  const ring = document.createElement("div");
  ring.className = "fx-dice-ring"; // 落点金圈:落定拍才入 DOM(与大字落定同拍绽放)
  const sign = document.createElement("div");
  sign.className = "dice-sign dice-sign-shaking"; // 第一段:签卡隐去,只余墨字虚影
  sign.textContent = SIGN_FACES[die - 1];
  overlay.appendChild(sign);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  // 第一段 摇签:虚影轮换(全段恰 10 次换签,周期随 e2e 倍率缩放)+ 每拍微旋,
  // 字面不落定=悬念;落定拍才亮真面。
  let swaps = 0;
  const shuffler = window.setInterval(
    () => {
      swaps += 1;
      sign.textContent = SIGN_FACES[(die - 1 + swaps) % SIGN_FACES.length];
      sign.style.rotate = `${(Math.random() - 0.5) * 12}deg`;
    },
    Math.max(1, Math.round(shakeMs / 10)),
  );
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      window.clearInterval(shuffler);
      // 第二段 落定:大字 outBack 钤落 + 落点金圈同拍 + 桌面微震;落骰声从起手
      // 挪到本拍(orchestrator.animateDice 只保留起手沙锤),音画同拍。
      sign.textContent = SIGN_FACES[die - 1];
      sign.style.rotate = "";
      sign.classList.remove("dice-sign-shaking");
      sign.classList.add("dice-sign-land");
      overlay.insertBefore(ring, sign);
      getAudio().play("diceLand");
      shakeDesk();
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
    }, shakeMs);
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

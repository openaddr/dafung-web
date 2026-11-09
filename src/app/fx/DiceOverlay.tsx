// 组件收口:器物豁免(永久)——器物件,交互收口规则不适用(细则 docs/design/组件收口.md)
// 掷骰签(#927,ADR-0043:全屏压暗幕签面退役,骰值确认改为顶中回合胶囊侧旁的一次性
// 小签卡——不占屏幕中央、不遮地图;全屏制式仅留给拼点签面等大事件,DESIGN §6):
// 单段式(ADR-0043 修订,2026-11-01 拍板:原「虚位淡签→真字 outBack 钤落」两段式里,
// 钤落弧 from 帧 opacity:0/scale:1.6 让整卡在类切换瞬间全隐一拍,读作「点数闪两下」,
// 用户实报拍板简化)——真字签卡直接淡入现身(readyMs)→ 停留(holdMs)→ 渐隐退场
// (fadeOutMs),无第二段、无换字、无钤落弧。骰落声与芯片揭示同现身拍(音画同拍)。
// 单节拍:人类/bot 同参数(diceFast 半速分档整条退役,统一原则,AGENTS.md)。
// 锚定:读知会槽内的常驻零宽锚点(testid dice-sign-anchor,几何恰在回合胶囊右缘)
// ——不读胶囊节点本身:bot 配速关 0 的批洪流下,横幅演出可能作为过时批被吸附作废
// (ADR-0029),胶囊节点合法地不物化,瞬态节点不可为锚;锚点件随槽挂载与槽同寿,
// 缺席即炸(零兜底)。承认的取舍(ADR-0043):吸附作废横幅批时胶囊不在场,签钤在
// 槽中线右侧的空位旁——合法缺席不炸,掷骰签不受演出作废面牵连。
// 样式与时长见 fx.css .dice-overlay/.dice-sign 与 fx/timings.ts DICE。mount/unmount
// 归 React;触发走 diceApi 模块桥——控制器(非 React 世界)直接调 diceApi.roll(die),
// 不必把实例塞进 store(非可序列化数据,同 engine 的理由)。现身拍广播
// onDiceSignReveal(HUD 签面芯片的揭示锚,HandZone 订阅)。
import { useEffect } from "react";
import { SIGN_FACES } from "@core/constants";
import { getAudio } from "./audio";
import { DICE } from "./timings";
import { TESTIDS } from "@app/screens/game/testids";

// 在场 overlay 引用(D2 终局提前收场用;present() 串行 await,同时至多一张)。
let activeOverlay: HTMLElement | null = null;

// 揭示拍订阅(HUD 签面芯片的揭示锚):revealListeners 仅 HandZone 一类
// React 消费方挂册,Set 语义=StrictMode 双挂载下退订句柄成对增删不重复。
const revealListeners = new Set<(die: number) => void>();

/** 订阅签面揭示拍(参数=本次点数):芯片在揭示拍才揭示新值,演出在途驻留
 *  上一掷点数(结算拍即入库的 lastRoll 不得经芯片提前剧透)。演出块被吸附/断线
 *  作废丢弃时揭示拍不发生——揭示顺延到下一掷的现身拍(跳切语境下芯片少显示一枚
 *  已作废演出,下一掷现身自愈;快照本身照常入库,权威态无损)。返回退订句柄。 */
export function onDiceSignReveal(cb: (die: number) => void): () => void {
  revealListeners.add(cb);
  return () => {
    revealListeners.delete(cb);
  };
}

/** D2:骰子演出提前收场(生产调用口 = orchestrator.finishPresentation,胜利屏
 *  挂载封场整个表现层时连带调用;本函数只管在场这一张)。
 *  这是生命周期规则而非兜底:对局结束 = 骰子表现层使命终结——立即移除在场
 *  overlay,防止 z-45 残留压住胜利屏。停留/渐隐定时器不取消:闭包只
 *  触碰自己的 overlay 节点,节点移除后均为无害操作,roll() 的 Promise 照常
 *  resolve,不会吊死 present() 编排链。overlay 类名由本模块创建且唯一。 */
export function finishDiceOverlay(): void {
  activeOverlay?.remove();
  activeOverlay = null;
}

/** 掷骰签:顶中回合胶囊侧旁的一次性小签卡,真字直接淡入现身 → 停留 → 渐隐退场。
 *  返回的 Promise 在渐隐完成后 resolve,present() 据此串行接行军。 */
function rollSign(die: number): Promise<void> {
  const anchor = document.querySelector<HTMLElement>(`[data-testid="${TESTIDS.diceSignAnchor}"]`);
  if (anchor == null)
    throw new Error("掷骰签锚点缺席:知会槽未挂载(掷骰必发生在对局屏挂载后,缺席=生命周期 bug)");
  const rect = anchor.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = "dice-overlay";
  overlay.style.left = `${rect.left + 10}px`; // 锚点右缘外 10px(水平),竖直对齐槽中线(CSS 半高上提)
  overlay.style.top = `${rect.top + rect.height / 2}px`;
  overlay.style.animationDuration = `${DICE.readyMs}ms`; // 入场渐显(keyframe 只管形,时长消费点内联,#849 棒3)
  const sign = document.createElement("div");
  sign.className = "dice-sign"; // 单段式:真字签卡直接现身,无虚位/钤落两段
  sign.textContent = SIGN_FACES[die - 1];
  overlay.appendChild(sign);
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  // 揭示拍=现身拍:骰落声与芯片揭示同签卡淡入同拍(音画同拍)。
  getAudio().play("diceLand");
  for (const cb of revealListeners) cb(die);
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      if (activeOverlay === overlay) activeOverlay = null;
      overlay.classList.add("dice-overlay-out");
      overlay.style.animationDuration = `${DICE.fadeOutMs}ms`; // 渐隐全长与清理窗同源单值
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, DICE.fadeOutMs);
    }, DICE.readyMs + DICE.holdMs);
  });
}

/** 骰子命令桥:DiceOverlay 挂载期间绑定真实实现,卸载后回退 no-op
 *  (StrictMode 双挂载安全:cleanup 先还原桥,再由 React 走下一次挂载)。 */
export const diceApi: {
  roll(face: number): Promise<void>;
} = {
  roll: () => Promise.resolve(),
};

/** 不渲染任何 DOM(掷骰签 overlay 掷骰时 append 到 body)。挂进 Game 屏一次即可。 */
export function DiceOverlay() {
  useEffect(() => {
    diceApi.roll = rollSign;
    return () => {
      diceApi.roll = () => Promise.resolve();
    };
  }, []);
  return null;
}

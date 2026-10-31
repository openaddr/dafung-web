// 桌面级命令式演出钩子(S7 #513):直接作用于对局屏 DOM 的两类一次性演出——
// 震屏(#board-wrap 整体位移)与旌旗缓倒(破产玩家的棋子旗面)。不走 fxStore:
// 目标节点分别归 GameScreen(#board-wrap)与 TokenLayer([data-token-player])所有,
// 表现是「对既有节点的一次性 class/animation 注入」,无坐标无数据,store 中转只会
// 多一跳。样式与 keyframe 单源 fx.css(.fx-desk-shake / .fx-token-fall)。
import { scStage } from "./timings";

/** 震屏全长(fx.css fx-desk-shake 0.4s 硬同步,特例字面量同 seal/骰签口径)。
 *  演出编排族(吃 scStage,F4 作用域拆分):调用时取数保运行时活投影(模块加载
 *  烤定常量会漏掉追帧倍率的播放期变化)。 */
const deskShakeMs = (): number => scStage(400);

/** 震屏·大胜档全长(#849 棒1:拼点大胜负判词拍专用,fx.css
 *  fx-desk-shake-blowout 0.45s 硬同步,特例字面量同上口径)。 */
const deskBlowoutMs = (): number => scStage(450);

/** 桌面微震(#492 拍板 4px 档,大事件限定;适用事件清单与「常规回合动作不上震屏」
 *  原则单源在 DESIGN §6 动效规范,此处只指路不枚举)。
 *  对 #board-wrap 挂 .fx-desk-shake 播一次 keyframe;重复触发先摘类再强制 reflow
 *  重启动画(破产仪式等连拍场景不吞拍)。reduced-motion 由 app.css 全局兜层压成
 *  0.01ms(位移不可见,与浮字/横幅同兜底通路)。
 *  节点缺席 = 对局屏已卸载(D2 同款生命周期规则,见 DiceOverlay.finishDiceOverlay):
 *  终局切胜利屏时演出链可能仍在途,摘除目标是无害操作,不抛错不补播。 */
function applyDeskShake(shakeClass: string, totalMs: () => number): void {
  const desk = document.getElementById("board-wrap");
  if (!desk) return;
  desk.classList.remove("fx-desk-shake", "fx-desk-shake-blowout");
  void desk.offsetWidth; // 强制 reflow:同类连触时重启 animation
  desk.classList.add(shakeClass);
  window.setTimeout(() => desk.classList.remove(shakeClass), totalMs());
}

/** 普通档震屏(4px/0.4s,#492 定档)。 */
export function shakeDesk(): void {
  applyDeskShake("fx-desk-shake", deskShakeMs);
}

/** 大胜档震屏(#849 棒1,DESIGN §6 拼点大胜负档位加压:6px/0.45s 分档,普通档
 *  口径不动;样式单源 fx.css .fx-desk-shake-blowout)。消费口 = DuelSignsOverlay
 *  判词拍(isBlowout 同源判定)。 */
export function shakeDeskBlowout(): void {
  applyDeskShake("fx-desk-shake-blowout", deskBlowoutMs);
}

/** 旌旗缓倒(破产仪式第一拍):给破产玩家棋子的旗面挂 .fx-token-fall,播
 *  fx-flag-fall(绕旗杆底座倒下+回弹驻倒,forwards 定格倒姿)。
 *  .bv-token-flag 基类自带 transform-origin: 0 0(旗杆底,board.css)与常驻摇曳,
 *  本类以双类选择器提高特异度接管 animation;破产态棋子本体由 React 降至 0.15
 *  透明度,倒旗定格其上=「旗倒人不撤」的静态叙事。类不摘除(倒姿驻留)。
 *  节点缺席 = 对局屏已卸载(同 shakeDesk 的 D2 生命周期规则)。 */
export function fallTokenFlag(playerId: string): void {
  const flag = document.querySelector(`[data-token-player="${playerId}"] .bv-token-flag`);
  if (!flag) return;
  flag.classList.add("fx-token-fall");
}

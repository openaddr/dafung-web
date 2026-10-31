// 桌面级命令式演出钩子(S7 #513):直接作用于对局屏 DOM 的两类一次性演出——
// 震屏(#board-wrap 整体位移)与旌旗缓倒(破产玩家的棋子旗面)。不走 fxStore:
// 目标节点分别归 GameScreen(#board-wrap)与 TokenLayer([data-token-player])所有,
// 表现是「对既有节点的一次性 class/animation 注入」,无坐标无数据,store 中转只会
// 多一跳。样式与 keyframe 单源 fx.css(.fx-desk-shake / .fx-token-fall)。
import { CEREMONY, DESK } from "./timings";

/** 桌面微震(#492 拍板 4px 档,大事件限定;适用事件清单与「常规回合动作不上震屏」
 *  原则单源在 DESIGN §6 动效规范,此处只指路不枚举)。
 *  对 #board-wrap 挂 .fx-desk-shake(-blowout) 播一次 keyframe;#885 时长收口:
 *  keyframe 只管形,挂类拍内联注入 animationDuration=DESK 两档 getter(fx/timings.ts,
 *  随 e2e/追帧通道缩放),类自摘 timeout 读同一 getter——全长与清理窗同源单值,
 *  追帧压缩天然同步(#849 棒3 同法)。重复触发先摘类再强制 reflow 重启动画
 *  (破产仪式等连拍场景不吞拍)。reduced-motion 由 app.css M-4 全局兜层(!important
 *  压过内联)与 fx.css 专条(animation: none)压成瞬时,兜层地位高于内联注入。
 *  节点缺席 = 对局屏已卸载(D2 同款生命周期规则,见 DiceOverlay.finishDiceOverlay):
 *  终局切胜利屏时演出链可能仍在途,摘除目标是无害操作,不抛错不补播。 */
function applyDeskShake(shakeClass: string, totalMs: () => number): void {
  const desk = document.getElementById("board-wrap");
  if (!desk) return;
  desk.classList.remove("fx-desk-shake", "fx-desk-shake-blowout");
  void desk.offsetWidth; // 强制 reflow:同类连触时重启 animation
  const ms = totalMs(); // 播放期活投影:调用时取数,追帧倍率变化即时生效(注入与自摘同值)
  desk.style.animationDuration = `${ms}ms`; // #885:keyframe 只管形,时长随通道缩放
  desk.classList.add(shakeClass);
  window.setTimeout(() => desk.classList.remove(shakeClass), ms);
}

/** 普通档震屏(4px/0.4s,#492 定档)。 */
export function shakeDesk(): void {
  applyDeskShake("fx-desk-shake", () => DESK.shakeMs);
}

/** 大胜档震屏(#849 棒1,DESIGN §6 拼点大胜负档位加压:6px/0.45s 分档,普通档
 *  口径不动;样式单源 fx.css .fx-desk-shake-blowout)。消费口 = DuelSignsOverlay
 *  判词拍(isBlowout 同源判定)。 */
export function shakeDeskBlowout(): void {
  applyDeskShake("fx-desk-shake-blowout", () => DESK.blowoutMs);
}

/** 旌旗缓倒(破产仪式第一拍):给破产玩家棋子的旗面挂 .fx-token-fall,播
 *  fx-flag-fall(绕旗杆底座倒下+回弹驻倒,forwards 定格倒姿)。
 *  #885 时长收口:keyframe 只管形,全长 CEREMONY.fallMs 挂类拍内联注入(类不摘除,
 *  内联时长随类驻留;墨渍起始拍 blotAtMs 落在其尾段,不脱拍由 choreography-invariants 钉)。
 *  .bv-token-flag 基类自带 transform-origin: 0 0(旗杆底,board.css)与常驻摇曳,
 *  本类以双类选择器提高特异度接管 animation;破产态棋子本体由 React 降至 0.15
 *  透明度,倒旗定格其上=「旗倒人不撤」的静态叙事。
 *  节点缺席 = 对局屏已卸载(同 shakeDesk 的 D2 生命周期规则)。 */
export function fallTokenFlag(playerId: string): void {
  const flag = document.querySelector<SVGElement>(
    `[data-token-player="${playerId}"] .bv-token-flag`,
  );
  if (!flag) return;
  flag.style.animationDuration = `${CEREMONY.fallMs}ms`; // #885:时长随通道缩放
  flag.classList.add("fx-token-fall");
}

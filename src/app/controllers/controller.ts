// React 层控制器抽象(替代旧 src/render/client-controller.ts 的骨架,零 DOM):
// 旧基类管 scaffold + fullRender + 卷轴弹层;新基类保留"状态桥"职责——
// 引擎变化后 syncFromEngine 灌 store,由 React 组件声明式渲染。
// 弹层/动画/音效是纯表现,归组件与阶段 6 的动画编排器,不进控制器。
// #433 交互策略上收:「此刻本地玩家能不能点」(canAct)与起签转入沿检测
// (checkRollSeal)公式单源在本基类——两个控制器只供参数(mySeat/hotSeat/引擎),
// 改一条交互规则只动一处,杜绝单机/联机行为分叉(此前 interactive 双写且带
// 「需推理才能确认」的热座省略,恰是本票要消灭的 bug 族)。
import type { GameEngine } from "@core/authority";
import type { GameCommand } from "@core/authority";
import { useGameStore } from "@app/store/gameStore";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { reactionQueriesSeat } from "./reaction";

/**
 * 游戏控制器:桥接「引擎(或网络)」与「gameStore」。
 * - 单机(LocalController):进程内房间编排 + MemorySocket(#398 单机统一 B),
 *   引擎=房间权威引擎直读(内存直连,无 hydrate 副本)。
 * - 联机(OnlineController):持只读引擎,命令发 WS,靠快照广播重 hydrate。
 */
export abstract class GameController {
  // ─── 抽象成员(子类提供;语义与旧 ClientController 对齐)──
  /** 渲染源:单机=权威引擎;联机=快照重 hydrate 的只读引擎。 */
  abstract get engine(): GameEngine;
  /** 视角座位:单机=决策方(热座跟随);联机=自己分到的 seat。 */
  abstract get viewSeat(): number;
  /** 本地玩家座位(交互策略输入):单机恒 0(host 真人);联机=入座分到的 seat
   *  (未入座=-1)。观战不可操作由被询问集公式天然保证——座位集只含真实座位。 */
  protected abstract get mySeat(): number;
  /** 热座语义(#433 显式参数化;单机=true、联机=false):主分支是否豁免
   *  「决策方===本地座位」判定。热座屏前唯一真人座即 mySeat,决策方是 bot 则
   *  本屏无人可操作,isBot 判定即座位匹配;联机各端座位固定,他座决策时不得
   *  解锁本端操作,必须显式判定决策方===自己。 */
  protected abstract readonly hotSeat: boolean;

  /** 统一命令入口(所有玩家操作都走 GameCommand,联机=网络协议消息)。
   *  Wave3(候选2)收窄后的唯一抽象交互通道:roll 之类一行转发不再单设方法,
   *  UI 直接 dispatchCommand({type:"rollAndMove"});Setup 落子走 setupPickCapital。 */
  abstract dispatchCommand(cmd: GameCommand): void;

  /** Setup(PickCapital)期点城=为当前选都玩家定都(候选2 收口:相位路由归 GameScreen,
   *  本方法只承载"落子"这一动作)。仅单机有此交互,故默认 no-op、子类覆写
   *  ——与 setAutoPilot 的接缝风格一致,屏幕组件对两种模式仍无感(不引入 instanceof)。
   *  pickCapital 不是 GameCommand(不经 submitCommand),两侧都包装成
   *  {type:"pickCapital"} 上行(单机=内存双工、联机=WS),校验在房间编排。 */
  setupPickCapital(_tileIndex: number): void {}

  /** 是否支持托管(联机 = true:服务器 bot 代打;单机也支持:本地 bot 代打)。 */
  autopilotSupported = false;
  /** 托管生效态(UI「托管中」回读;基类默认关,子类覆写:联机=seats 广播回读,单机=本地标记)。 */
  get autoPilotOn(): boolean {
    return false;
  }
  /** 切换托管(子类覆写:联机发 WS {type:"autoPilot"};单机本地驱动)。 */
  setAutoPilot(_on: boolean, _speed: "fast" | "slow"): void {}

  /** 释放长生命周期资源(WS 连接等);无资源子类可不覆写。 */
  destroy(): void {}

  // ─── 交互策略状态(#433 上收;子类协议面读写)───
  /** 在途命令锁:命令已发出、下行拍未回(防连点)。子类上行时置位、下行拍解锁。 */
  protected pending = false;
  /** 是否已收首帧整房摘要(入局):起签转入沿检测在此之前不启用。 */
  protected enteredGame = false;
  /** 事件批表现消费器:骰子/行军/浮字等演出串行播放(播放队列与到达序游标封装在
   *  内)。两控制器构造同构(引擎 getter + sync 回灌),收归基类单份。 */
  protected readonly fx = new SnapshotEffects(
    () => this.engine,
    () => this.sync(),
  );
  /** 上一拍是否处于「我的 Roll 等待态」(起签印的转入沿检测基准)。 */
  private prevMyRollWait = false;

  /** 演出锁(公式读数 seam):表现队列仍在播——快照数据已落地,但骰子/行军/横幅
   *  未完,决策卷轴/行军按钮不呈现(L42;WaitingBar/横幅不受影响,它们不吃
   *  interactive)。独立 getter 供公式单测注入,生产读基类持有的消费器。 */
  protected get fxPlaying(): boolean {
    return this.fx.playing;
  }

  /** 此刻本地玩家能否操作(写进 store.interactive,UI 据此启用控件)。
   *  公式单源(#433;表驱动单测 test/controller-policy.test.ts 钉死全输入空间):
   *  - 反应窗例外(ADR-0017 多属主):Playing×AwaitingReaction 时被询问座位可应答
   *    ——决策方仍是出牌者,decisionOwner/hotSeat/托管/演出锁都不适用(倒计时不等
   *    演出,超时兜底在权威侧);命令在途锁仍适用。观战不在被询问集(座位集只含
   *    真实座位),公式天然排除。
   *  - 主分支:Playing × 决策方轮到本地(热座豁免见 hotSeat)× 决策方非 bot
   *    × 无在途命令 × 未托管 × 演出播完。 */
  get interactive(): boolean {
    return this.canAct();
  }

  /** interactive 的公式本体(protected:策略属控制器内部,UI 只读 interactive)。 */
  protected canAct(): boolean {
    const e = this.engine;
    if (e.phase === "Playing" && e.turnPhase === "AwaitingReaction") {
      const pr = e.pendingReaction;
      if (pr == null) return false;
      // 被询问集公式单源 controllers/reaction.ts(#284)。
      return !this.pending && reactionQueriesSeat(pr.view, this.mySeat);
    }
    return (
      e.phase === "Playing" &&
      (this.hotSeat || e.decisionOwner === this.mySeat) &&
      !e.players[e.decisionOwner]?.isBot &&
      !this.pending &&
      !this.autoPilotOn &&
      !this.fxPlaying
    );
  }

  /** 起签转入沿检测(#188 第 1 步):本地人类座位进入「Roll 等待态」(看门狗/
   *  服务器 ~1s 自动起摇)→ 钤「签」印(仅转入沿:上一拍不在态)。托管中座位由
   *  bot 代打(Roll 不经等待态)不播;联机 Roll 等待态经事件折叠到达(#388),
   *  单机经房间编排下行拍——帧来源两样,公式一份(#433 上收)。 */
  protected checkRollSeal(): void {
    const e = this.engine;
    const myRollWait =
      e.phase === "Playing" &&
      e.turnPhase === "Roll" &&
      e.decisionOwner === this.mySeat &&
      !e.players[this.mySeat]?.isBot &&
      !this.autoPilotOn;
    if (this.enteredGame && myRollWait && !this.prevMyRollWait) this.fx.qiqian(this.mySeat);
    this.prevMyRollWait = myRollWait;
  }

  // ─── 状态桥 ───
  /** 引擎变化后的统一出口:快照灌 store(旧 fullRender 的新等价物)。
   *  同时刷新 interactive 派生量,保证 UI 一次重渲拿到一致的状态。 */
  protected sync(): void {
    const store = useGameStore.getState();
    store.syncFromEngine(this.engine);
    // viewSeat 一并刷:单机热座跟随活跃座位,联机恒为本座——均在控制器侧收口,UI 不自行推导。
    store.setViewSeat(this.viewSeat);
    store.setInteractive(this.interactive);
  }
}

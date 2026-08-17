// React 层控制器抽象(替代旧 src/render/client-controller.ts 的骨架,零 DOM):
// 旧基类管 scaffold + fullRender + 卷轴弹层;新基类只保留"状态桥"职责——
// 引擎变化后 syncFromEngine 灌 store,由 React 组件声明式渲染。
// 弹层/动画/音效是纯表现,归组件与阶段 6 的动画编排器,不进控制器。
import type { GameEngine } from "@core/game";
import type { GameCommand } from "@core/types";
import { useGameStore } from "@app/store/gameStore";

/**
 * 游戏控制器:桥接「引擎(或网络)」与「gameStore」。
 * - 单机(LocalController):持有权威引擎,命令直接 submitCommand。
 * - 联机(OnlineController):持只读引擎,命令发 WS,靠 snapshot 广播重 hydrate。
 */
export abstract class GameController {
  // ─── 抽象成员(子类提供;语义与旧 ClientController 对齐)──
  /** 渲染源:单机=权威引擎;联机=快照重 hydrate 的只读引擎。 */
  abstract get engine(): GameEngine;
  /** 视角座位:单机=当前人类座位;联机=自己分到的 seat。 */
  abstract get viewSeat(): number;
  /** 此刻本地玩家能否操作(写进 store.interactive,UI 据此启用控件)。 */
  abstract get interactive(): boolean;

  /** 统一命令入口(所有玩家操作都走 GameCommand,联机=网络协议消息)。
   *  Wave3(候选2)收窄后的唯一抽象交互通道:roll 之类一行转发不再单设方法,
   *  UI 直接 dispatchCommand({type:"rollAndMove"});Setup 落子走 setupPickCapital。 */
  abstract dispatchCommand(cmd: GameCommand): void;

  /** Setup(PickCapital)期点城=为当前选都玩家定都(候选2 收口:相位路由归 GameScreen,
   *  本方法只承载"落子"这一动作)。仅单机有此交互,故默认 no-op、LocalController 覆写
   *  ——与 setAutoPilot 的接缝风格一致,屏幕组件对两种模式仍无感(不引入 instanceof)。
   *  pickCapital 不是 GameCommand(不经 submitCommand),单机侧由 LocalController
   *  包装驱动仲裁/印章表现/bot 接棒,故不并入 dispatchCommand。 */
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

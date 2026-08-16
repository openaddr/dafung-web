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

  /** 统一命令入口(所有玩家操作都走 GameCommand,联机=网络协议消息)。 */
  abstract dispatchCommand(cmd: GameCommand): void;
  /** 行军按钮。 */
  abstract roll(): void;
  /** 城池点击(单机 Setup=选都,Playing=查看详情;联机=只读详情)。 */
  abstract tileClick(index: number): void;

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

  /** interactive 判定的共享骨架(原先 local/online 各写一份,易漂移):
   *  对局 Playing + 决策方(decisionOwner,含珍宝交涉相位)是人类座位。
   *  子类把各自的差异锁作参数传入(单机 busy / 联机 pending、托管),任一为真即锁。 */
  protected canAct(...locks: boolean[]): boolean {
    const e = this.engine;
    return e.phase === "Playing" && !e.players[e.decisionOwner]?.isBot && locks.every((l) => !l);
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

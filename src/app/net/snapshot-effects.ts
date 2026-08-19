// 快照表现提取器(从 controllers/online.ts 拆出,net/ 下独立文件):联机端无本地引擎
// 推进事件,表现全靠相邻快照 diff——本 module 持 diff 基准(上帧位置/现金/破产位)与
// 表现播放队列,把 diff 提取为统一事件数组交给 orchestrator.present(Wave1 语义原样保留,
// 含 Wave1 新增的破产音效对齐)。为什么独立:它是有状态的纯表现逻辑,不碰协议/store,
// 独立后 OnlineController 才能瘦成纯「协议桥」。行为零变化。
import type { GameEngine } from "@core/game";
import { createEngineSink } from "@app/fx/sinks";
import { present, turnBannerEvent } from "@app/fx/orchestrator";
import type { PresentationEvent } from "@app/fx/presentation";

/** 快照级表现(diff → 事件 → present):
 *  - diceRolled/cashDelta/tokenMoved/sound(bankrupt)/turnBanner 事件统一交给 present
 *    播放(与单机同一条播放路径,形状不再漂移)。
 *  - 浮字走 diff(floaters 不序列化);行军经 applyPresentationMove 注入 diff 推导的
 *    轨迹(快照虽含 lastMove,但那是"发令端视角",重放以本地 diff 为准,语义更稳)。
 *  - 骰子:本地无掷骰授权(点数在服务器),diceRolled 事件驱动 ThreeDice.roll——
 *    各端轨迹/初始条件由本地随机流决定,各不相同没关系:**落面 = 服务器权威点数**。 */
export class SnapshotEffects {
  /** 上一帧快照的玩家位置/现金/破产位(diff 基准)。 */
  private prevPos = new Map<string, { position: number; onStep: number | null }>();
  private prevCash = new Map<string, number>();
  private prevBankrupt = new Set<string>();
  /** 表现链串行化:快照可能连续到达,排队播放避免两次行军互踩。 */
  private fxQueue: Promise<void> = Promise.resolve();
  /** 在途表现块计数(>0 = 骰子/行军/横幅仍在播)。L42:联机版单机 busy 锁——
   *  OnlineController.interactive 据此关门,决策卷轴等动画播完才呈现(与单机
   *  LocalController 的 drive 会话锁同口径)。 */
  private pendingChunks = 0;
  /** 表现出口(Wave1):引擎经 getter 绑定(换图会整体替换引擎实例,getter 始终取最新)。 */
  private readonly fxSink = createEngineSink(() => this.getEngine());
  /** 队列排空(忙→闲)回调:OnlineController 用来补一次 sync,放出被锁的 interactive。 */
  private readonly onIdle: (() => void) | null;
  private readonly getEngine: () => GameEngine;

  constructor(getEngine: () => GameEngine, onIdle?: () => void) {
    this.getEngine = getEngine;
    this.onIdle = onIdle ?? null;
  }

  /** 表现队列是否仍在播放(快照数据已落地,但骰子/行军/横幅未完)。 */
  get playing(): boolean {
    return this.pendingChunks > 0;
  }

  /** 每帧 snapshot 后调用:newRoll = 本帧发生了掷骰(阶段迁移判定,见协议桥注释)。 */
  play(newRoll: boolean): void {
    const engine = this.getEngine();
    const board = engine.board;
    const tileCount = board.tiles.length;
    const events: PresentationEvent[] = [];

    // 0) 新掷骰 → diceRolled 事件(排在行军前,时序对齐单机 Roll 步的 骰子→行军 链)。
    if (newRoll) {
      const die = engine.presentation.lastRoll?.die;
      if (die) events.push({ kind: "diceRolled", die });
    }

    // 1) 现金 diff → cashDelta 事件(锚到玩家当前格逻辑坐标)
    for (const p of engine.players) {
      const prev = this.prevCash.get(p.id);
      if (prev != null && p.cash !== prev) {
        const pos = board.positionOf(p.position);
        events.push({ kind: "cashDelta", playerId: p.id, amount: p.cash - prev, x: pos.x, y: pos.y, atTile: p.position });
      }
      this.prevCash.set(p.id, p.cash);
    }

    // 2) 位置 diff → tokenMoved 事件(首帧只记位置,不动画;辅路进出不做主路行军)。
    //    Setup·PickCapital 的落位是「筑城」不是行军:不播 march,改盖「筑」印(单机
    //    runPickCapital 同款表现,避免选都棋子横穿棋盘的伪行军)。
    //    棋子渲染必须立刻让位(否则 React 先画终点再被拽回):提取期同步经
    //    applyPresentationMove(引擎合法表现通道)注入 diff 推导的轨迹锚定旧位置,
    //    present 播放时再沿轨迹补走;表现完清掉注入,避免污染后续判断。
    let marched = false;
    const setupPick = engine.phase === "Setup";
    for (const p of engine.players) {
      const prev = this.prevPos.get(p.id);
      this.prevPos.set(p.id, { position: p.position, onStep: p.onBranch?.step ?? null });
      if (!prev || prev.onStep != null || p.onBranch != null) continue;
      if (p.position === prev.position) continue;
      if (setupPick) {
        events.push({ kind: "sealStamped", tileIndex: p.position, char: "筑" });
        continue;
      }
      const traversed: number[] = [];
      for (let i = 1; i <= tileCount; i++) {
        const t = (prev.position + i) % tileCount;
        traversed.push(t);
        if (t === p.position) break;
      }
      const path = {
        from: prev.position,
        traversed,
        landIndex: p.position,
        passedCapital: false,
        capitalIndex: -1,
        waypoints: [],
        landBranchStep: null,
        branchWaypoints: [],
      };
      engine.applyPresentationMove(path);
      this.fxSink.marchBegin(p.id);
      events.push({ kind: "tokenMoved", playerId: p.id, path });
      marched = true;
    }

    // 2.5) 破产 diff → bankrupt 音效事件(对齐单机 playStepEffects 的破产音;Wave1 修复项)。
    for (const p of engine.players) {
      if (p.isBankrupt && !this.prevBankrupt.has(p.id)) {
        events.push({ kind: "sound", event: "bankrupt" });
      }
      if (p.isBankrupt) this.prevBankrupt.add(p.id);
    }

    // 3) 回合横幅事件(活跃座位变化时,orchestrator 内去重;排在行军后,不打架)
    const banner = turnBannerEvent(engine);
    if (banner) events.push(banner);

    if (events.length === 0) return; // 无表现(首帧/纯等待帧):不占用表现锁
    this.pendingChunks++;
    const settle = () => {
      this.pendingChunks--;
      if (this.pendingChunks === 0) this.onIdle?.(); // 忙→闲:放出被锁的 interactive
    };
    this.fxQueue = this.fxQueue.then(() => present(events, this.fxSink)).then(settle);
    if (marched) {
      // 清掉 diff 推导的 presentation 轨迹:真实引擎态(服务器权威)不被本地表现污染
      this.fxQueue = this.fxQueue.then(() => {
        engine.applyPresentationMove(null);
      });
    }
  }
}

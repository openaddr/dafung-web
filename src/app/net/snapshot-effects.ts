// 事件批表现消费器(联机端,#385,ADR-0020 折叠切换③):联机端无本地引擎推进,
// 演出因果来自服务端事件批下行通道(#390:{type:"events"} 消息 → netStore lastEvents
// 暂存)。本模块持「到达序消费游标 + 表现播放队列」,在每帧快照 hydrate 后把暂存批
// 直译为表现事件(event-extract.extractBatchEvents,与单机同一消费函数)交给
// orchestrator.present 播放。旧版相邻快照 diff 提取(prevPos/prevCash/prevBankrupt/
// prevProps/prevJinnangPlay.seq)已全部退役——动效因果是协议一等公民,不再猜测。
//
// 时序契约:服务端同一 flush 先发 events 消息、后发快照(因果在前、状态在后),WS
// 有序,故快照处理时 netStore 暂存批恰为本 tick 的转移事件;在 hydrate 之后消费,
// 坐标/行军路径解析基于转移后引擎态。空批 flush 无 events 消息,游标不推进即跳过。
// 断线即丢(无排队无补发,ADR-0020 决策 4):断线时游标对齐当前到达序,重连后不补播
// 旧演出(整局状态已由重连快照重建)。
import type { GameEngine } from "@core/authority";
import type { GameEvent } from "@core/game-events";
import { createEngineSink } from "@app/fx/sinks";
import { anchorMarches, extractBatchEvents } from "@app/fx/event-extract";
import { present } from "@app/fx/orchestrator";
import { useNetStore } from "@app/store/netStore";

export class SnapshotEffects {
  /** 表现链串行化:快照可能连续到达,排队播放避免两次行军互踩。 */
  private fxQueue: Promise<void> = Promise.resolve();
  /** 在途表现块计数(>0 = 骰子/行军/横幅仍在播)。L42:联机版单机 busy 锁——
   *  OnlineController.interactive 据此关门,决策卷轴等动画播完才呈现(与单机
   *  LocalController 的 drive 会话锁同口径)。 */
  private pendingChunks = 0;
  /** 已消费的事件批到达序(netStore.eventBatchSeq):一条 events 消息只消费一次。 */
  private consumedBatchSeq = 0;
  /** 表现出口:引擎经 getter 绑定(换图会整体替换引擎实例,getter 始终取最新)。 */
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

  /** 起签印(#188 第 1 步):本端人类座位进入 Roll 等待态时,在行军者脚下钤「签」印——
   *  服务器 ~1s 后自动起摇,骰子/行军经事件批正常播出(单机 autoRoll 同款表现,
   *  复用 sealStamped 印章通道,不新增事件类型)。纯表现,无同步语义。 */
  qiqian(seat: number): void {
    const engine = this.getEngine();
    this.fxSink.stampSeal(engine.players[seat].position, "签");
  }

  /** 断线边界:把当前到达序标记为已消费——断线前收到但未随快照消费的暂存批,
   *  重连后不补播(状态已由重连快照整体重建,旧演出无因果意义)。 */
  dropStalledBatch(): void {
    this.consumedBatchSeq = useNetStore.getState().eventBatchSeq;
  }

  /** 每帧 snapshot(hydrate)后调用:把 netStore 暂存的事件批直译为表现并入队播放。
   *  @param prePositions hydrate 前各座位棋子位置(行军余段截短基准;联机=上一帧
   *  快照的落位,即玩家看到的视觉位置)。 */
  play(prePositions: ReadonlyArray<number | null>): void {
    const net = useNetStore.getState();
    if (net.lastEvents == null || net.eventBatchSeq === this.consumedBatchSeq) return;
    this.consumedBatchSeq = net.eventBatchSeq;
    const engine = this.getEngine();
    const events: GameEvent[] = net.lastEvents;
    // 提取与行军锚定同步完成(anchorMarches 须先于 React 渲染终态,否则棋子闪现终点
    // 再被拽回);#385 起行军路径随表现事件直传 sink,播放不依赖引擎 lastMove——
    // 队列期间引擎被后续快照整体 hydrate 也不影响在途路径,合并批多段行军各播各段。
    const presentation = extractBatchEvents(engine, events, prePositions);
    if (presentation.length === 0) return; // 无表现(纯状态批):不占用表现锁
    anchorMarches(presentation, this.fxSink);
    this.pendingChunks++;
    const settle = () => {
      this.pendingChunks--;
      if (this.pendingChunks === 0) this.onIdle?.(); // 忙→闲:放出被锁的 interactive
    };
    this.fxQueue = this.fxQueue
      .then(async () => {
        await present(presentation, this.fxSink);
      })
      .then(settle)
      .catch((err) => {
        // 表现层异常必须暴露(零兜底):响亮记错并照常收队——任由拒绝传播会毒化队列
        // (后续所有批次不再播放、interactive 永锁),静默吞掉更是掩 bug。
        settle();
        console.error("[SnapshotEffects] 表现播放异常:", err);
      });
  }
}

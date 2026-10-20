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
//
// 落后即校准(#610,ADR-0029 不变量③):产出快于播放时 fxQueue 无界堆积——判档挂
// fxQueue 出队点(present 前),混合尺(主尺=未消费批数,辅尺=批龄)分类:浅积压追帧
// (scStage 时长除法加速,演出仍在),连续 N 批超线吸附(整块跳过未播 +
// abandonAllMarches 清会话,棋子由声明式终态落位)。观感全静默,诊断面 =
// console.debug + __dafung.fxCatchup。
import type { GameEngine } from "@core/authority";
import type { GameEvent } from "@core/game-events";
import type { PresentationEvent } from "@app/fx/presentation";
import { createEngineSink } from "@app/fx/sinks";
import { anchorMarches, extractBatchEvents } from "@app/fx/event-extract";
import { abandonAllMarches } from "@app/fx/useMarch";
import { present } from "@app/fx/orchestrator";
import { setCatchupScale } from "@app/fx/timings";
import { LagCalibrator } from "@app/fx/catchup";
import { useNetStore } from "@app/store/netStore";

/** 待播块:play() 入队的表现单元(一批 = 一块),fxQueue 串行消费。 */
interface QueuedChunk {
  readonly batchSeq: number;
  /** 入队时刻(校准辅尺基准:批龄 = 出队时刻 − 本值)。 */
  readonly enqueuedAt: number;
  readonly events: PresentationEvent[];
  /** 作废标记(边界生命周期语义,非容错):断线/重连边界把「旧演出无因果意义」
   *  (ADR-0020 决策 4)落到待播块上——出队检查即弃,不判档不播放。 */
  voided: boolean;
}

const nowMs = (): number => performance.now();

export class SnapshotEffects {
  /** 表现链串行化:快照可能连续到达,排队播放避免两次行军互踩。 */
  private fxQueue: Promise<void> = Promise.resolve();
  /** 在途表现块计数(>0 = 骰子/行军/横幅仍在播)。曾是 interactive 的演出门
   *  (L42),#611 交互锁解绑后 interactive 改绑本座位行军会话(useMarch.isMarching),
   *  本量降为全局队列观察口(controller.fxBusy,测试/诊断读数)+ onIdle 忙→闲回调。 */
  private pendingChunks = 0;
  /** 到达序入队游标:最近一次入队(或确认纯状态跳过)的批——一条 events 消息只
   *  入队一次的去重锚。 */
  private enqueuedBatchSeq = 0;
  /** 落后即校准判据(#610):出队点观察混合尺定档。 */
  private readonly calibrator = new LagCalibrator();
  /** 待播块集(边界作废标记的靶子;出队处置时移除)。落后度主尺的在队项 =
   *  本集合大小,与「到达未入队 surplus(eventBatchSeq − enqueuedBatchSeq)」
   *  合成未消费批数——纯状态批(无表现档)入队游标照推进、不进集合,不计入落后
   *  (无可播之物,不算积压)。 */
  private readonly queued = new Set<QueuedChunk>();
  /** 表现出口:全坐标化(ADR-0029/#608)后 sink 零引擎依赖,无状态可换——单例形状。 */
  private readonly fxSink = createEngineSink();
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
   *  复用 sealStamped 印章通道,不新增事件类型)。纯表现,无同步语义。
   *  到达同步点换算坐标(ADR-0029/#608):此刻读引擎态换算 x/y 进 sink,sink 侧
   *  零引擎读取。 */
  qiqian(seat: number): void {
    const engine = this.getEngine();
    const pos = engine.board.positionOf(engine.players[seat].position);
    this.fxSink.stampSeal(pos.x, pos.y, "签");
  }

  /** 断线边界:把当前到达序标记为已入队——断线前收到但未随快照消费的暂存批,
   *  重连后不补播(状态已由重连快照整体重建,旧演出无因果意义)。在途行军会话
   *  一并作废(#609 单写者),队列中未开播块全部打作废标记(#610 出队检查即弃);
   *  校准判据态复位、追帧倍率回 1(旧积压已随边界作废,落后度从零重观察)。 */
  dropStalledBatch(): void {
    abandonAllMarches();
    this.voidAllQueued();
    this.enqueuedBatchSeq = useNetStore.getState().eventBatchSeq;
    this.calibrator.reset();
    setCatchupScale(1);
  }

  /** 重连成功边界(#388,ADR-0020 决策 4):整房摘要水合前清空事件面——netStore 暂存批
   *  与到达计数归零,本器入队游标同步归零;断线前的一切批不再参与演出,重连后旧批也
   *  不会因 seq 撞号被跳过或被当新批消费。在途行军会话与待播块一并作废(同
   *  dropStalledBatch)。状态唯一来源 = 紧随其后的整房摘要。
   *  与 dropStalledBatch(断线边界,游标对齐作废)成对使用:closed 时对齐、open 时归零。 */
  resetEventFace(): void {
    abandonAllMarches();
    this.voidAllQueued();
    this.enqueuedBatchSeq = 0;
    this.calibrator.reset();
    setCatchupScale(1);
    useNetStore.getState().resetEventFace();
  }

  /** 换图边界(OnlineController.rebuildForMap 调用,ADR-0029 §2 边界作废同族):
   *  棋盘几何整体更换,已提取未播块烤的是旧板坐标(不变量①提取即定格),出队即弃。
   *  与 dropStalledBatch/resetEventFace 的差别:只作废待播块——入队游标不动(批到达
   *  序连续,新图批照常消费)、判据态与追帧倍率不复位(积压治理与棋盘身份正交)。 */
  voidQueuedForBoardSwap(): void {
    this.voidAllQueued();
  }

  /** 待播块全体作废:出队检查即弃(已开播的在途块不在此列——present 事件边界的
   *  收队语义归终局封场,本作废只覆盖「从未开播」的块)。 */
  private voidAllQueued(): void {
    for (const chunk of this.queued) chunk.voided = true;
  }

  /** 每帧 snapshot(hydrate)后调用:把 netStore 暂存的事件批直译为表现并入队播放。
   *  @param prePositions hydrate 前各座位棋子位置(行军余段截短基准;联机=上一帧
   *  快照的落位,即玩家看到的视觉位置)。 */
  play(prePositions: ReadonlyArray<number | null>): void {
    const net = useNetStore.getState();
    if (net.lastEvents == null || net.eventBatchSeq === this.enqueuedBatchSeq) return;
    this.enqueuedBatchSeq = net.eventBatchSeq;
    const engine = this.getEngine();
    const events: GameEvent[] = net.lastEvents;
    // 提取与行军锚定同步完成(anchorMarches 须先于 React 渲染终态,否则棋子闪现终点
    // 再被拽回);行军 keyframes 随表现事件直传 sink(不变量①提取即定格,播放零引擎
    // 读取)——队列期间引擎被后续快照整体 hydrate 也不影响在途序列,合并批多段行军各播各段。
    const presentation = extractBatchEvents(engine, events, prePositions);
    if (presentation.length === 0) return; // 无表现(纯状态批):不占用表现锁,不计落后
    anchorMarches(presentation, this.fxSink);
    const chunk: QueuedChunk = {
      batchSeq: net.eventBatchSeq,
      enqueuedAt: nowMs(),
      events: presentation,
      voided: false,
    };
    this.queued.add(chunk);
    this.pendingChunks++;
    const settle = () => {
      this.queued.delete(chunk);
      this.pendingChunks--;
      if (this.pendingChunks === 0) this.onIdle?.(); // 忙→闲:放出被锁的 interactive
    };
    this.fxQueue = this.fxQueue
      .then(async () => {
        await this.dequeueChunk(chunk);
      })
      .then(settle)
      .catch((err) => {
        // 表现层异常必须暴露(零兜底):响亮记错并照常收队——任由拒绝传播会毒化队列
        // (后续所有批次不再播放、interactive 永锁),静默吞掉更是掩 bug。
        settle();
        console.error("[SnapshotEffects] 表现播放异常:", err);
      });
  }

  /** 出队点判档(#610 落地挂点,present 前):吸附档整块跳过 + 清会话(棋子直切引擎
   *  终态——快照已 hydrate 批终位置,声明式渲染接管);追帧档经 scStage 时长除法加速
   *  播(演出仍在,只是更快);steady 照常。吸附≠终局封场:这里只封「本批未播」,
   *  orchestrator 的全局 sealed 仍是终局专属,两道正交。 */
  private async dequeueChunk(chunk: QueuedChunk): Promise<void> {
    if (chunk.voided) return; // 边界作废:出队检查即弃(会话已由边界统一收回)
    const net = useNetStore.getState();
    const decision = this.calibrator.observe({
      gapBatches: net.eventBatchSeq - this.enqueuedBatchSeq + this.queued.size,
      waitMs: nowMs() - chunk.enqueuedAt,
    });
    setCatchupScale(decision.runtimeScale);
    if (decision.tier === "snap") {
      // 未播锚定统一作废:此前各批 play() 拍预塞的会话此刻全部属于「未开播」(出队
      // 点上无在途动画——fxQueue 串行),收回后棋子直切声明式终态;后续块若落回线下
      // 照常 present,其行军因会话已亡经单写者规则哑火(旧演出无因果意义,不拽回重走)。
      abandonAllMarches();
      return;
    }
    await present(chunk.events, this.fxSink);
  }
}

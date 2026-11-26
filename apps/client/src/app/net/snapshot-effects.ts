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
import type { GameEngine } from "@dafung/core/engine/authority";
import type { GameEvent } from "@dafung/core/engine/game-events";
import { getAudio, type PlaybackStopMode } from "@app/fx/audio";
import { discardCapitalRecruitment } from "@app/fx/capital-supply-audio";
import type { CashArrivalCue, PresentationEvent } from "@app/fx/presentation";
import { useFxStore } from "@app/fx/fxStore";
import { createEngineSink } from "@app/fx/sinks";
import {
  anchorMarches,
  cityIncomeCueFor,
  discardCityRewardCues,
  extractBatchEvents,
  lastTurnStartIndex,
} from "@app/fx/event-extract";
import { abandonAllMarches } from "@app/fx/useMarch";
import {
  dismissInFlightPresentation,
  finishPresentation,
  present,
  type PendingFireWallRewards,
} from "@app/fx/orchestrator";
import { delay, FX, setCatchupScale } from "@app/fx/timings";
import { isSnapPinned, LagCalibrator } from "@app/fx/catchup";
import { useNetStore } from "@app/store/netStore";

/** 待播块:play() 入队的表现单元(一批 = 一块),fxQueue 串行消费。 */
interface QueuedChunk {
  readonly batchSeq: number;
  /** 入队时刻(校准辅尺基准:批龄 = 出队时刻 − 本值)。 */
  readonly enqueuedAt: number;
  readonly events: PresentationEvent[];
  /** 生命周期边界统一作废旧演出，出队或事件之间检查。 */
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
  private pendingFireWallRewards: PendingFireWallRewards = new WeakMap();
  private victoryPreludeAbort: AbortController | null = null;
  /** 队列排空(忙→闲)回调:OnlineController 用来补一次 sync,放出被锁的 interactive。 */
  private readonly onIdle: (() => void) | null;
  private readonly getEngine: () => GameEngine;

  constructor(
    getEngine: () => GameEngine,
    private readonly getSelfSeat: () => number | null,
    onIdle?: () => void,
  ) {
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

  /** 断线、前后台切换和离局时对齐到达序，收回旧演出并重新观察积压。 */
  dropStalledBatch(): void {
    this.cancelQueuedPlayback();
    abandonAllMarches();
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
    this.cancelQueuedPlayback();
    abandonAllMarches();
    this.enqueuedBatchSeq = 0;
    this.calibrator.reset();
    setCatchupScale(1);
    useNetStore.getState().resetEventFace();
  }

  /** 换图时收回旧棋盘上的演出，保留到达序和追帧判据。 */
  voidQueuedForBoardSwap(): void {
    this.cancelQueuedPlayback();
  }

  private cancelQueuedPlayback(
    keepIncome?: CashArrivalCue,
    soundExit: PlaybackStopMode = "immediate",
  ): void {
    for (const chunk of this.queued) chunk.voided = true;
    this.victoryPreludeAbort?.abort();
    this.victoryPreludeAbort = null;
    this.pendingFireWallRewards = new WeakMap();
    discardCityRewardCues(this.getEngine());
    dismissInFlightPresentation();
    this.fxSink.discardCashFlights(keepIncome);
    getAudio().stop("all", soundExit);
    useFxStore.getState().setVictoryPresentation(null);
  }

  private carryQueuedIncome(income: CashArrivalCue, presentation: PresentationEvent[]): void {
    if (this.fxSink.hasLaunchedCash(income)) return;
    // 技能应答可在下行到达前批尚未开播时结束本轮，只接回第一笔待播的收入。
    for (const chunk of this.queued) {
      if (chunk.voided) continue;
      const payment = chunk.events.find((ev) => ev.kind === "cashDelta" && ev.sound === income);
      if (payment === undefined) continue;
      presentation.unshift(payment);
      return;
    }
  }

  private stageVictory(
    gameId: string,
    presentation: PresentationEvent[],
    income: CashArrivalCue | undefined,
  ) {
    const pending = { phase: "prelude", gameId } as const;
    const audio = getAudio();
    const scroll = {
      phase: "scroll",
      gameId,
      playDrum: audio.defer("victoryDrum"),
      playTheme: audio.defer("victory"),
    } as const;
    const abort = new AbortController();
    this.victoryPreludeAbort = abort;
    const duelStart = presentation.findIndex((ev) => ev.kind === "duelSigns" && ev.forVictory);
    const cutoff = duelStart < 0 ? presentation.length : duelStart;
    const prelude = presentation.slice(0, cutoff);
    const waitForIncome =
      income === undefined
        ? undefined
        : this.fxSink.waitForCashArrival(
            income,
            abort.signal,
            prelude.some((ev) => ev.kind === "cashDelta" && ev.sound === income),
          );
    useFxStore.getState().setVictoryPresentation(pending);
    return { pending, scroll, abort, prelude, duels: presentation.slice(cutoff), waitForIncome };
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
    const gameOver = events.find((event) => event.kind === "gameOver");
    const victory = gameOver?.reason === "aborted" ? undefined : gameOver;
    // 跳座也推进回合编号。同次收尾串过跳座时，从最后实际开始的回合保留演出。
    const lastTurnStart = victory ? lastTurnStartIndex(events) : -1;
    const liveEvents = lastTurnStart > 0 ? events.slice(lastTurnStart) : events;
    // 提取与行军锚定同步完成(anchorMarches 须先于 React 渲染终态,否则棋子闪现终点
    // 再被拽回);行军 keyframes 随表现事件直传 sink(不变量①提取即定格,播放零引擎
    // 读取)——队列期间引擎被后续快照整体 hydrate 也不影响在途序列,合并批多段行军各播各段。
    const presentation = extractBatchEvents(engine, liveEvents, prePositions, this.getSelfSeat());
    const gameId = engine.gameId;
    const income = victory === undefined ? undefined : cityIncomeCueFor(engine, victory.round);
    if (gameOver) {
      if (income !== undefined && lastTurnStart < 0) this.carryQueuedIncome(income, presentation);
      this.cancelQueuedPlayback(income, victory === undefined ? "immediate" : "fade");
      finishPresentation();
      abandonAllMarches();
    }
    if (gameOver?.reason === "aborted" || (victory === undefined && presentation.length === 0))
      return;
    const finale = victory === undefined ? null : this.stageVictory(gameId, presentation, income);
    anchorMarches(presentation, this.fxSink);
    const chunk: QueuedChunk = {
      batchSeq: net.eventBatchSeq,
      enqueuedAt: nowMs(),
      events: presentation,
      voided: false,
    };
    this.queued.add(chunk);
    this.pendingChunks++;
    const settle = (completed: boolean) => {
      this.queued.delete(chunk);
      this.pendingChunks--;
      const fx = useFxStore.getState();
      if (finale !== null) {
        finale.abort.abort();
        if (this.victoryPreludeAbort === finale.abort) this.victoryPreludeAbort = null;
        if (fx.victoryPresentation === finale.pending) {
          fx.setVictoryPresentation(completed && !chunk.voided ? finale.scroll : null);
        }
      }
      if (this.pendingChunks === 0 && !chunk.voided) this.onIdle?.();
    };
    this.fxQueue = this.fxQueue
      .then(async () => {
        if (finale === null) {
          await this.dequeueChunk(chunk);
        } else if (!chunk.voided) {
          // 终局批保留完整演出节奏，第一枚当轮归账铜钱抵达才接判胜拼点。
          setCatchupScale(1);
          const isCurrent = () =>
            !chunk.voided && useFxStore.getState().victoryPresentation === finale.pending;
          const options = {
            isCurrent,
            forVictory: true,
            pendingFireWallRewards: this.pendingFireWallRewards,
          };
          await present(finale.prelude, this.fxSink, options);
          if (isCurrent()) {
            if (finale.waitForIncome !== undefined) await finale.waitForIncome;
            else if (finale.prelude.some((event) => event.kind === "cityBurned")) {
              await delay(FX.burningPulseMs);
            }
          }
          await present(finale.duels, this.fxSink, options);
        }
      })
      .then(
        () => settle(true),
        (err) => {
          // 表现层异常必须暴露(零兜底):响亮记错并照常收队——任由拒绝传播会毒化队列
          // (后续所有批次不再播放、interactive 永锁),静默吞掉更是掩 bug。
          settle(false);
          console.error("[SnapshotEffects] 表现播放异常:", err);
        },
      );
  }

  /** 出队点判档(#610 落地挂点,present 前):瞬空钉住(#1254)一律走吸附档;其余按
   *  落后即校准三档——吸附档整块跳过 + 清会话(棋子直切引擎终态——快照已 hydrate 批终
   *  位置,声明式渲染接管);追帧档经 scStage 时长除法加速播(演出仍在,只是更快);
   *  steady 照常。吸附≠终局封场:这里只封「本批未播」,orchestrator 的全局 sealed 仍是
   *  终局专属,两道正交。 */
  private async dequeueChunk(chunk: QueuedChunk): Promise<void> {
    if (chunk.voided) return; // 边界作废:出队检查即弃(会话已由边界统一收回)
    // 瞬空钉直接走吸附档,不进入产品落后度判据;只弃未播演出、棋子直切声明式终态。
    // 实体与写入口见 catchup.setSnapPin,默认关闭,使用边界见 ADR-0065。
    if (isSnapPinned()) return this.snapChunk(chunk);
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
      return this.snapChunk(chunk);
    }
    await present(chunk.events, this.fxSink, {
      isCurrent: () => !chunk.voided,
      pendingFireWallRewards: this.pendingFireWallRewards,
    });
  }

  private snapChunk(chunk: QueuedChunk): void {
    this.queued.delete(chunk);
    this.pendingFireWallRewards = new WeakMap();
    this.fxSink.discardCashFlights();
    discardCapitalRecruitment();
    getAudio().stop("presentation", "fade");
    abandonAllMarches();
  }
}

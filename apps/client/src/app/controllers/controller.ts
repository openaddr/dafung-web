// React 层控制器抽象(替代旧 src/render/client-controller.ts 的骨架,零 DOM):
// 旧基类管 scaffold + fullRender + 卷轴弹层;新基类保留"状态桥"职责——
// 引擎变化后 一次发布座位视图,由 React 组件声明式渲染。
// 弹层/动画/音效是纯表现,归组件与阶段 6 的动画编排器,不进控制器。
// #433 交互策略上收:「此刻本地玩家能不能点」与起签转入沿检测
// (checkRollSeal)公式单源在本基类——两个控制器只供参数(座位/引擎),
// 改一条交互规则只动一处,杜绝单机/联机行为分叉(此前 interactive 双写且带
// 「需推理才能确认」的本地隐式假设,恰是本票要消灭的 bug 族)。
import type { GameCommand, GameEngine } from "@dafung/core/engine/authority";
import { SeatInteraction, type SeatIntent } from "@dafung/core/protocol/seat-interaction";
import { readSeatReplica, seatReactionOf } from "@dafung/core/protocol/seat-replica";
import type { GameDiagnosticCapture } from "@app/game-diagnostic-record";
import { finishGameDiagnostics, observeGameDiagnosticState } from "@app/game-diagnostics";
import { useGameStore, type GameSnapshot } from "@app/store/gameStore";
import { useFxStore } from "@app/fx/fxStore";
import { SnapshotEffects } from "@app/net/snapshot-effects";
import { isMarching } from "@app/fx/useMarch";
import type {
  CommandProcessing,
  CommandResultMsg,
  ReactionTiming,
  ServerMsg,
} from "@dafung/core/protocol/wire";
import { shallow } from "zustand/shallow";
import { reactionQueriesSeat } from "./reaction";

type DiagnosticCommand = GameCommand["type"] | "pickCapital" | "autoPilot";
type DiagnosticRequest = { gameId: string; id: number; command: DiagnosticCommand };
type AuthorityLogObservation = {
  kind: "authorityLog";
  gameId: string;
  at: number;
  offset: number;
  count: number;
  source: "snapshot" | "tail";
};
type CommandObservation = DiagnosticRequest & { kind: "command"; at: number } & (
    | { stage: "blocked"; reason: string }
    | { stage: "sent" }
    | ({ stage: "result" } & (CommandProcessing | { outcome: "rejected"; reason: string }))
  );

export type GameControllerDiagnosticEvent = CommandObservation | AuthorityLogObservation;

const MAX_COMMAND_REQUESTS = 128;

/** 单机和联机均从座位水合副本发布局面。 */
export abstract class GameController {
  abstract get engine(): GameEngine;
  /** 房间分配的真人座位。联机尚未入座时为 -1。 */
  protected abstract get mySeat(): number;

  get viewSeat(): number {
    return this.mySeat;
  }

  /** 统一命令入口(所有玩家操作都走 GameCommand,联机=网络协议消息)。
   *  Wave3(候选2)收窄后的唯一抽象交互通道:roll 之类一行转发不再单设方法,
   *  UI 直接 dispatchCommand({type:"rollAndMove"});Setup 落子走 setupPickCapital。 */
  abstract dispatchCommand(cmd: GameCommand, decisionPoint?: string): void;

  protected decisionPoint: string | null = null;
  private readonly interaction = new SeatInteraction<GameSnapshot>((command, point) =>
    this.dispatchCommand(command, point),
  );

  get seatView() {
    return this.interaction.view;
  }

  dispatchIntent(intent: SeatIntent, observedPoint = this.seatView.decisionPoint) {
    const result = this.interaction.act(intent, observedPoint);
    if (result.status !== "submitted") useGameStore.setState({ seatView: this.seatView });
    return result;
  }

  protected snapshotForSeat(): GameSnapshot {
    return readSeatReplica(this.engine, this.mySeat);
  }

  protected get seatReaction() {
    return seatReactionOf(this.engine, this.mySeat);
  }

  /** Setup(PickCapital)期点城=为当前选都玩家定都(候选2 收口:相位路由归 GameScreen,
   *  本方法只承载"落子"这一动作)。仅单机有此交互,故默认 no-op、子类覆写
   *  ——与 setAutoPilot 的接缝风格一致,屏幕组件对两种模式仍无感(不引入 instanceof)。
   *  pickCapital 不是 GameCommand(不经 submitCommand),两侧都包装成
   *  {type:"pickCapital"} 上行(单机=内存双工、联机=WS),校验在房间编排。 */
  setupPickCapital(_tileIndex: number): void {}

  /** 是否支持托管:由各模式的房间权威驱动 bot 代打。 */
  autopilotSupported = false;
  /** 托管生效态:子类从房间座位下行状态回读,供 UI 显示「托管中」。 */
  get autoPilotOn(): boolean {
    return false;
  }
  /** 切换托管(子类覆写:联机发 WS {type:"autoPilot"};单机本地驱动)。 */
  setAutoPilot(_on: boolean): void {}

  /** 子类须先调用基类，保留退出前的交互现场。 */
  destroy(): void {
    this.unsubMarching?.();
    finishGameDiagnostics(this, () => this.discardPresentation());
    this.diagnosticListeners.clear();
    this.authorityLogAnchor = null;
    this.forgetCommandRequests();
  }

  /** 离开或恢复前台时，客户端从当前局面继续演出。 */
  discardPresentation(): void {
    this.fx.dropStalledBatch();
  }

  get diagnosticInteraction(): Pick<
    GameDiagnosticCapture["client"],
    "seat" | "pending" | "fxBusy" | "autopilotOn"
  > {
    return {
      seat: this.mySeat,
      pending: this.pending,
      fxBusy: this.fxBusy,
      autopilotOn: this.autoPilotOn,
    };
  }

  /** 子类从诊断错误文本中剔除对应传输的凭证。 */
  redactDiagnosticCredentials(message: string): string {
    return message;
  }

  private readonly diagnosticListeners = new Set<(event: GameControllerDiagnosticEvent) => void>();
  private readonly commandRequests = new Map<number, DiagnosticRequest>();
  private nextRequestId = 0;
  private authorityLogAnchor: AuthorityLogObservation | null = null;

  subscribeDiagnostics(listener: (event: GameControllerDiagnosticEvent) => void): () => void {
    this.diagnosticListeners.add(listener);
    const anchor = this.authorityLogAnchor;
    if (anchor?.gameId === this.engine.gameId) listener(anchor);
    return () => this.diagnosticListeners.delete(listener);
  }

  protected observeAuthorityLog(observation: Omit<AuthorityLogObservation, "kind">): void {
    const event: AuthorityLogObservation = { kind: "authorityLog", ...observation };
    if (event.source === "snapshot") this.authorityLogAnchor = event;
    this.publishDiagnostic(event);
  }

  protected observeBlockedCommand(command: DiagnosticCommand, reason: string): void {
    const request = { gameId: this.engine.gameId, command, id: ++this.nextRequestId };
    this.publishDiagnostic({
      kind: "command",
      stage: "blocked",
      at: performance.now(),
      ...request,
      reason,
    });
  }

  protected sendObservedCommand(command: DiagnosticCommand, send: (id: number) => void): void {
    const request = { gameId: this.engine.gameId, command, id: ++this.nextRequestId };
    const at = performance.now();
    send(request.id);
    if (this.commandRequests.size === MAX_COMMAND_REQUESTS) {
      this.commandRequests.delete(this.commandRequests.keys().next().value!);
    }
    this.commandRequests.set(request.id, request);
    this.publishDiagnostic({ kind: "command", stage: "sent", at, ...request });
  }

  /** 原座重发时保留那一笔的诊断配对，其余记录随连接结束。 */
  protected forgetCommandRequests(keepId?: number): void {
    for (const id of this.commandRequests.keys())
      if (id !== keepId) this.commandRequests.delete(id);
  }

  protected observeCommandResult(
    msg: CommandResultMsg | Extract<ServerMsg, { type: "error" | "submissionResult" }>,
    at: number,
  ): void {
    const { requestId } = msg;
    if (requestId === undefined) return;
    const request = this.commandRequests.get(requestId);
    if (request === undefined) return;
    this.commandRequests.delete(requestId);
    const event = { kind: "command", stage: "result", at, ...request } as const;
    if (msg.type === "error") {
      this.publishDiagnostic({
        ...event,
        outcome: "rejected",
        reason: this.redactDiagnosticCredentials(msg.error),
      });
      return;
    }
    const { outcome } = msg;
    if (outcome === "accepted") {
      this.publishDiagnostic({
        ...event,
        outcome,
        ...("logOffset" in msg ? { logOffset: msg.logOffset } : {}),
      });
      return;
    }
    const reason = this.redactDiagnosticCredentials(msg.reason);
    this.publishDiagnostic(
      outcome === "warning"
        ? { ...event, outcome, reason, logOffset: msg.logOffset }
        : { ...event, outcome, reason },
    );
  }

  private publishDiagnostic(event: GameControllerDiagnosticEvent): void {
    for (const listener of this.diagnosticListeners) listener(event);
  }

  // ─── 交互策略状态(#433 上收;子类协议面读写)───
  /** 在途命令锁:命令已发出、下行拍未回(防连点)。子类上行时置位、下行拍解锁。 */
  protected pending = false;
  /** 是否已收首帧整房摘要(入局):起签转入沿检测在此之前不启用。 */
  protected enteredGame = false;
  /** 事件批表现消费器。两种模式共用本座身份和串行播放通路。 */
  protected readonly fx = new SnapshotEffects(
    () => this.engine,
    () => this.mySeat,
    () => this.sync(),
  );
  /** 上一拍是否处于「我的 Roll 等待态」(起签印的转入沿检测基准)。 */
  private prevMyRollWait = false;
  /** 行军会话集订阅退订器(watchMarching 装订,destroy 退订;探针豁免订阅 → null)。 */
  private unsubMarching: (() => void) | null = null;

  constructor() {
    this.watchMarching();
  }

  /** 本座位演出落定 → 重评 canAct 的接线(#611 解锁拍):订阅 fxStore.marching,
   *  会话集增删即重灌 store——解锁由会话收尾驱动,不再等全局队列排空的 onIdle。
   *  protected 可覆写:策略探针(test/controller-policy)覆写为 no-op,不往公共
   *  store 灌替身引擎态(测试隔离)。 */
  protected watchMarching(): void {
    this.unsubMarching = useFxStore.subscribe(
      (s) => s.marching,
      () => this.sync(),
      { equalityFn: shallow },
    );
  }

  /** 全局表现队列在播(观察口,canAct 已不消费,#611):骰子/浮字/横幅/他座行军等
   *  整队列的排空状态。交互锁改绑本座位演出落定后,本量仅供测试与诊断读数
   *  (local-room「队列最终排空」独立断言)。 */
  get fxBusy(): boolean {
    return this.fx.playing;
  }

  /** 演出锁(公式读数 seam):本座位相关演出未落定——我的行军会话仍在途(#609
   *  会话语义;播完/追帧放完/吸附作废删会话即落定,#611 改绑,ADR-0029 §4)。
   *  全局队列积压不再进门(他座棋子照飞、决策卷轴照弹);独立 getter 供公式单测
   *  注入,生产读 useMarch 的会话查询口。座位 -1 = 未入座(联机入座前瞬态,
   *  非缺数据)。首帧前占位引擎可以比实际房间小，水合后本座必须在座位表内。 */
  protected get fxPlaying(): boolean {
    const seat = this.mySeat;
    if (seat < 0) return false;
    const player = this.engine.players[seat];
    if (player == null) {
      if (!this.enteredGame) return false;
      throw new Error(`fxPlaying:本座位 ${seat} 不在引擎座位表(控制器/引擎错位 bug)`);
    }
    return isMarching(player.id);
  }

  /** 「行军中…」提示源(与按钮同源 canAct 的自我侧输入,#611 提示统一):本座位
   *  动作在途 = 命令已发未回(pending)或本座位行军会话未落定(fxPlaying)。
   *  托管中恒 false(自我侧无动作在途,不与托管指示抢话)。 */
  protected get selfPresenting(): boolean {
    return this.pending || this.fxPlaying;
  }

  /** 普通抉择属于决策座位。反应窗另按本席是否受询判定，可在他人回合应答。 */
  get interactive(): boolean {
    return this.commandBlockReason() === null;
  }

  protected commandBlockReason(): string | null {
    const e = this.engine;
    if (e.phase !== "Playing") return "对局未处于进行阶段";
    if (e.turnPhase === "AwaitingReaction") {
      const pr = this.seatReaction;
      if (pr == null) return "当前反应窗缺失";
      // 联机脱敏批可能包含 -1 匿名占位，先排除未入座，再查被询问集。
      if (this.mySeat < 0) return "尚未入座";
      if (this.pending) return "已有命令在途";
      if (this.autoPilotOn) return "本座托管中";
      if (!reactionQueriesSeat(pr.view, this.mySeat)) return "本座未受询";
      if (pr.answers.some((answer) => answer.seat === this.mySeat)) return "本座已应答";
      return this.decisionPoint === null ? "当前反应窗无可用应答" : null;
    }
    if (e.decisionOwner !== this.mySeat) return "未轮到本座决策";
    if (e.players[e.decisionOwner]?.isBot) return "当前由 bot 决策";
    if (this.pending) return "已有命令在途";
    if (this.autoPilotOn) return "本座托管中";
    if (this.fxPlaying) return "本座行军仍在演出";
    return null;
  }

  protected capitalPickBlockReason(): string | null {
    const e = this.engine;
    if (e.phase !== "Setup" || e.setupPhase !== "PickCapital") return "非选都阶段";
    if (e.currentSetupPlayerIndex !== this.mySeat) return "未轮到本座选都";
    if (this.pending) return "已有命令在途";
    if (this.autoPilotOn) return "本座托管中";
    return null;
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

  private reactionDeadline: { gameId: string; seq: number; deadlineAt: number } | null = null;

  /** 恢复摘要重新登记当前窗时，先清除上一连接观测到的时刻。 */
  protected resetReactionTiming(): void {
    this.reactionDeadline = null;
  }

  /** 到达时投影为本机单调时刻。后续同窗消息只会收紧时限。 */
  protected observeReactionTiming(timing: ReactionTiming | undefined, receivedAt: number): void {
    if (timing == null || timing.seq !== this.seatReaction?.seq) return;
    const { gameId } = this.engine;
    const current = this.reactionDeadline;
    const deadlineAt = receivedAt + timing.remainingMs;
    this.reactionDeadline = {
      gameId,
      seq: timing.seq,
      deadlineAt:
        current?.gameId === gameId && current.seq === timing.seq
          ? Math.min(current.deadlineAt, deadlineAt)
          : deadlineAt,
    };
  }

  // ─── 状态桥 ───
  /** 引擎变化后的统一出口:快照灌 store(旧 fullRender 的新等价物)。
   *  同时刷新 interactive 与 selfPresenting(#611「行军中…」提示源,与按钮同源
   *  canAct 的自我侧输入)两个派生量,保证 UI 一次重渲拿到一致的状态。 */
  sync({ reconnect = false } = {}): void {
    const e = this.engine;
    const deadline = this.reactionDeadline;
    if (
      e.turnPhase !== "AwaitingReaction" ||
      deadline?.gameId !== e.gameId ||
      deadline.seq !== this.seatReaction?.seq
    )
      this.reactionDeadline = null;
    const seatView = this.interaction.publish(
      {
        snapshot: this.snapshotForSeat(),
        seat: this.mySeat,
        decisionPoint: this.decisionPoint,
        autopilotOn: this.autoPilotOn,
        interactive: this.interactive,
        reactionDeadlineAt: this.reactionDeadline?.deadlineAt ?? null,
      },
      { reconnect },
    );
    useGameStore.setState({
      snapshot: seatView.snapshot,
      seatView,
      reactionDeadlineAt: this.reactionDeadline?.deadlineAt ?? null,
      viewSeat: this.mySeat,
      interactive: seatView.interactive,
      selfPresenting: this.selfPresenting,
    });
    observeGameDiagnosticState(this);
  }
}

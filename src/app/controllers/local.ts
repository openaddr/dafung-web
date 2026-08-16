// 单机(热座)控制器:构造权威 GameEngine,命令统一走 engine.submitCommand,
// 每次引擎变化后 sync() 灌 store(渲染交给 React 组件)。
// 阶段 6:接入动画/音效编排(orchestrator.playStepEffects)——
// 命令 → busy 锁交互 → 表现编排(骰子→行军→浮字→印章/横幅)→ bot 异步调度。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine, type EngineConfig } from "@core/game";
import { botAct } from "@core/bot";
import type { GameCommand } from "@core/types";
import { setEngine, useGameStore } from "@app/store/gameStore";
import { getAudio } from "@app/fx/audio";
import {
  beginMarch,
  maybeShowTurnBanner,
  playStepEffects,
  stampSeal,
} from "@app/fx/orchestrator";
import { BOT, delay } from "@app/fx/timings";
import { GameController } from "./controller";

export class LocalController extends GameController {
  private readonly _engine: GameEngine;
  /** 表现编排进行中(掷骰/行军/bot 思考):锁本地交互防连点(旧 busy 的新等价物)。 */
  private busy = false;

  // ─── 托管(spec: autopilot 03 单机等价物):无服务器,本地 bot 代打人类决策 ───
  override readonly autopilotSupported = true;
  private apOn = false;
  private apSpeed: "fast" | "slow" = "fast";
  /** 代打循环单飞标记:防 setAutoPilot 重入/人类步收尾后重复起循环(双驱动)。 */
  private apLoopRunning = false;
  override get autoPilotOn(): boolean {
    return this.apOn;
  }

  /** 开/关托管。开启即启动代打循环(单飞:正忙则循环持锁等待,当前表现链收尾后接手);
   *  关闭由循环自退。speed 对照旧版:fast=瞬间决策(0 延迟),slow=与真 bot 同节奏。 */
  override setAutoPilot(on: boolean, speed: "fast" | "slow"): void {
    this.apSpeed = speed;
    this.apOn = on;
    this.sync();
    if (on) void this.apLoop();
  }

  /** 托管代打循环:轮到本地人类座位时以 botAct 推进一步(引擎 player-agnostic,
   *  botAct 按 decisionOwner 决策,热座下人类座位轮到时即代打),走与真 bot 完全一致的
   *  表现链。与 runBots 的 busy 锁协同:忙则等待,自身步进持锁,不双驱动——真 bot 回合
   *  仍由既有 runBots 接棒,循环只在「决策方是人类」时出手。 */
  private async apLoop(): Promise<void> {
    if (this.apLoopRunning) return; // 已有循环在轮询(开启时正忙的场景),复用即可
    this.apLoopRunning = true;
    try {
      const e = this._engine;
      while (this.apOn && !e.isOver) {
        if (this.busy) {
          await delay(80); // 人类步/真 bot 步进行中:等锁,不抢驱动
          continue;
        }
        if (e.phase !== "Playing" || e.players[e.decisionOwner].isBot) {
          await delay(200); // 无人类决策点(真 bot 轮次由 runBots 驱动/Setup 待手选)
          continue;
        }
        this.busy = true;
        this.sync();
        try {
          if (this.apSpeed === "slow") await delay(BOT.stepDelayMs);
          await this.runAnimatedStep(() => botAct(e));
          maybeShowTurnBanner(e);
          await this.runBots(); // 代打后若轮到真 bot,沿用既有接棒
        } finally {
          this.busy = false;
          this.sync();
        }
        if (this.apSpeed === "slow") await delay(BOT.stepDelayMs);
      }
    } finally {
      this.apLoopRunning = false;
    }
  }

  constructor(map: LoadedMap, config: EngineConfig) {
    super();
    // 权威引擎:骰子种子可注入(?seed= 可复现);物理骰子动画用独立随机流(见 DiceOverlay 注释)。
    this._engine = new GameEngine(map.board, map.catalog, createDice(config.seed), config);
    // 注册为全局引擎(命令入口/调试钩子共用;模块级单例,见 gameStore.ts 注释)
    setEngine(this._engine);
    this.sync();
  }

  get engine(): GameEngine {
    return this._engine;
  }

  // 热座:视角跟随「当前该行动的人类」。默认=活跃玩家;珍宝交涉相位决策方是城主
  // (decisionOwner,可能 ≠ 访客),视角与交互都得跟城主走,否则城主视角永远渲染不出
  // 可点按钮 → 单机遇到该相位死锁(e2e react-editor 巡检发现)。
  get viewSeat(): number {
    const e = this._engine;
    return e.turnPhase === "AwaitingTreasureOwner" ? e.decisionOwner : e.activeIndex;
  }
  get interactive(): boolean {
    // 同理用 decisionOwner 判「轮到人类」:非珍宝相位它就是 activeIndex,语义不变。
    // 共享骨架在基类 canAct(单机/联机判定逻辑收口,防两处漂移),此处补差异锁 busy
    // 与托管(托管中本地不响应,代打循环全权驱动;对照旧 interactive 的 !apOn)。
    return this.canAct(this.busy || this.apOn);
  }

  // ─── 命令入口 ───
  // 单机同样统一走 submitCommand(与联机共用一条命令路径):日后加回放/调试记录时
  // 只需在这一个出口拦截,不必逐方法打点。表现编排异步进行,期间 busy 锁交互。
  dispatchCommand(cmd: GameCommand): void {
    if (!this.interactive) return; // 非本地人类决策时忽略(引擎自身也有相位守卫,双保险)
    void this.runStep(() => this._engine.submitCommand(cmd), commandLabelOf(cmd));
  }

  roll(): void {
    this.dispatchCommand({ type: "rollAndMove" });
  }

  /** 进入 Game 屏后调用一次:若开局即轮到 bot(或 Setup 余下全是 bot),接棒驱动;
   *  轮到人类则只弹首回合横幅。幂等(busy 期间不重复启动)。 */
  onEnterGame(): void {
    if (this.busy) return;
    void (async () => {
      if (this._engine.phase === "Setup" || (this._engine.phase === "Playing" && this._engine.players[this._engine.decisionOwner].isBot)) {
        this.busy = true;
        try {
          await this.runBots();
        } finally {
          this.busy = false;
          this.sync();
        }
      }
      maybeShowTurnBanner(this._engine);
    })();
  }

  tileClick(index: number): void {
    const e = this._engine;
    // Setup 选都阶段:点击=为当前选都玩家定都;对局中点击=查看详情(只读,交 UI 层弹详情)。
    if (e.phase === "Setup" && e.setupPhase === "PickCapital") {
      const playerIndex = e.currentSetupPlayerIndex;
      if (playerIndex >= 0 && !e.players[playerIndex].isBot) {
        void this.runPickCapital(playerIndex, index);
      }
      return;
    }
    // 城池详情卷轴改由 React 组件订阅 store 弹出,此处无需推进引擎。
    void index;
  }

  /** 一次引擎推进的完整链(人类命令与 bot 步骤共用骨架):
   *  引擎推进(run 注入)→ 起点锚定(行军类)→ sync → 表现编排 → bot 接棒 → 回合横幅。
   *  busy 链首置位/链尾释放,期间 interactive=false 防连点。 */
  private async runStep(run: () => void, cmdType: string): Promise<void> {
    this.busy = true;
    this.sync();
    try {
      await this.runAnimatedStep(run, cmdType);
      await this.runBots();
      maybeShowTurnBanner(this._engine);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  /** 「一次引擎推进 + 表现编排」的共享骨架(原 runStep 与 runBots 循环体逐行重复,提取于此):
   *  捕获推进前相位/玩家 → run() 推进 → 行军类先锚定起点 → sync → 播表现 → sync。
   *  表现后的收尾两处顺序不同(人类步:先 bot 接棒再弹回合横幅;bot 步:直接弹横幅),
   *  故 runBots/横幅留在调用方,时序与提取前一致。 */
  private async runAnimatedStep(run: () => void, cmdType?: string): Promise<void> {
    const e = this._engine;
    const prevPhase = e.turnPhase;
    const prePlayer = e.players[e.activeIndex];
    const moverId = e.activePlayer.id;
    run();
    // 行军类推进:先锚定起点再 sync——否则 React 先渲染终态,棋子闪现终点再被拽回
    if (e.lastMove && (prevPhase === "Roll" || prevPhase === "AwaitingCapitalHalt")) {
      beginMarch(e, moverId);
    }
    this.sync();
    await playStepEffects(e, prevPhase, moverId, prePlayer, cmdType);
    this.sync();
  }

  /** 人类选都:引擎落子 + 印章"筑"反馈 + bot 余下选都/进局接棒。 */
  private async runPickCapital(playerIndex: number, index: number): Promise<void> {
    const e = this._engine;
    this.busy = true;
    this.sync();
    try {
      e.pickCapital(playerIndex, index);
      stampSeal(e, index, "筑");
      this.sync();
      await this.runBots();
      maybeShowTurnBanner(e);
    } finally {
      this.busy = false;
      this.sync();
    }
  }

  // ─── bot 调度(异步,播节奏)──
  /** 推进 bot 行动直至轮到人类或对局结束。
   *  对照旧 state.ts 的 scheduleBot/botFlow:每步前 thinking + delay(BOT.stepDelayMs),
   *  每步后按推进前 turnPhase 做同款表现(掷骰动画/行军/浮字/印章),保证 bot 与人类
   *  走完全一致的表现链(e2e 时序也因此可预期)。非 bot 回合立即返回。 */
  private async runBots(): Promise<void> {
    const e = this._engine;
    const store = useGameStore.getState();

    // 选都阶段的 bot 步进要先于 Playing 循环:人类选都后余下 bot 仍处 Setup,
    // 若只在 Playing 循环体内驱动(aiSetupStep),Setup 期的 bot 会永远轮空卡死流程。
    while (e.phase === "Setup" && e.aiSetupStep()) {
      store.setThinking(true);
      this.sync();
      await delay(BOT.stepDelayMs);
      store.setThinking(false);
      this.sync();
    }
    store.setThinking(false);

    let safety = 0;
    // 用 decisionOwner 驱动:珍宝交涉相位决策方是城主而非访客——访客是人类、城主是
    // bot 时若只看 activeIndex,城主 bot 永远不被调度(死锁另一半,见 viewSeat 注释)。
    // 非珍宝相位 decisionOwner === activeIndex,行为不变。botAct 内部按相位自行分发。
    while (e.phase === "Playing" && e.players[e.decisionOwner].isBot && safety++ < 500) {
      store.setThinking(true);
      this.sync();
      await delay(BOT.stepDelayMs);
      // 思考标记与引擎推进在同一同步段内(之间无 await),先关标记再走共享骨架,
      // 与旧顺序(推进后关)对渲染无行为差:两者都赶在本步首次 sync 渲染前完成。
      store.setThinking(false);
      await this.runAnimatedStep(() => botAct(e));
      maybeShowTurnBanner(e);
    }
    if (e.isOver) {
      getAudio().play("victory");
      this.sync();
    }
  }
}

/** 命令 → 表现层标签(交涉"跳过"需要与公道/坐地区分音效,其余同 cmd.type)。 */
function commandLabelOf(cmd: GameCommand): string {
  return cmd.type === "resolveTreasureOwner" && cmd.action.type === "skip"
    ? "resolveTreasureOwner_skip"
    : cmd.type;
}

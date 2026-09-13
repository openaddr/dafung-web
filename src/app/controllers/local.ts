// 单机(热座)控制器:构造权威 GameEngine,命令统一走 engine.submitCommand,
// 每次引擎变化后 sync() 灌 store(渲染交给 React 组件)。
// 阶段 6:接入动画/音效编排(orchestrator.playStepEffects)——
// 命令 → 驱动仲裁锁交互 → 表现编排(骰子→行军→浮字→印章/横幅)→ bot 异步调度。
// Wave 2-A:四路异步流程(人类步/托管/开局接棒/选都)的 busy 布尔争抢收口为
// 驱动仲裁器(drive.ts)——同一时刻仅一个 drive 会话,FIFO 排队互斥,
// apLoop 不再 delay(80) 轮询锁,onEnterGame 幂等改查 isDriving()。
import type { LoadedMap } from "@core/board-loader";
import { createDice } from "@core/dice";
import { GameEngine, type EngineConfig } from "@core/game";
import { botAct } from "@core/bot";
import type { GameCommand } from "@core/types";
import { setEngine } from "@app/store/gameStore";
import { archiveEngineLog } from "@app/gameLogArchive";
import { createEngineSink } from "@app/fx/sinks";
import {
  extractStepEvents,
  maybeShowTurnBanner,
  present,
} from "@app/fx/orchestrator";
import { AUTOPILOT, AUTO_MARCH, BOT, delay } from "@app/fx/timings";
import { GameController } from "./controller";
import { createDriveArbiter } from "./drive";

export class LocalController extends GameController {
  private readonly _engine: GameEngine;
  /** 表现出口(Wave1):提取事件经 present 播放到此 sink;生产实现组装既有单例,
   *  引擎 getter 绑定本控制器的权威引擎。测试可注入 createMemorySink 断言事件流。 */
  private readonly fxSink = createEngineSink(() => this._engine);
  /** 驱动仲裁器(Wave 2-A):busy 布尔的替代——互斥队列私有化"谁在推进引擎",
   *  实例级(与旧 busy 同为控制器实例态,多控制器互不串扰)。 */
  private readonly drive = createDriveArbiter();

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
    // 托管开关入对局日志(ADR-0014 补洞:room 行,重放据此把人类座位并入/移出 bot 驱动集)
    const seat = this._engine.players.findIndex((p) => !p.isBot);
    const guohao = this._engine.players[seat].guohao;
    this._engine.logRoomEvent(
      on
        ? `${guohao} 开启托管(${speed === "slow" ? "慢速" : "快速"}),交由电脑代打`
        : `${guohao} 关闭托管,收回操作`,
      JSON.stringify({ type: "autopilot", seat, on, speed }),
    );
    this.sync();
    if (on) void this.apLoop();
  }

  // ─── 行军自动化(#188 第 1 步):人类回合 Roll 相位定时自动起摇 ───
  /** 自动起摇定时器:sync 撤/布(每次引擎变化后重评估),到点经 autoRoll 起签+起摇。
   *  Roll 相位从此只存在 ~1s(自动起摇把它推进),行军按钮随自动化从 UI 移除。 */
  private rollTimer: ReturnType<typeof setTimeout> | null = null;

  /** 重评估自动起摇定时器(#188):满足「对局中 + Roll 相位 + 轮到人类 + 未托管」即布
   *  rollAtMs 定时器,任一条件不满足即撤。bot 座位由 runBots 驱动、托管中由 apLoop 代打,
   *  都不到这里;破产座位不会进入 Roll 等待态(引擎 advanceToNextActive 跳过),无须判。
   *  表现链推进中(drive 会话占用)不布:链尾 sync 会再评估,防链中状态误触发。 */
  private rearmAutoRoll(): void {
    if (this.rollTimer) {
      clearTimeout(this.rollTimer);
      this.rollTimer = null;
    }
    const e = this._engine;
    if (e.phase !== "Playing" || e.isOver || e.turnPhase !== "Roll" || this.apOn) return;
    if (e.players[e.decisionOwner].isBot || this.drive.isDriving()) return;
    this.rollTimer = setTimeout(() => {
      this.rollTimer = null;
      void this.autoRoll();
    }, AUTO_MARCH.rollAtMs);
  }

  /** 自动起摇(#188 第 1 步):钤「签」印起签(~0.8s)→ rollAndMove 走与手点完全相同的
   *  推进链(引擎零改动,只是触发方式变了;起签须在驱动会话内播,故 runStep 骨架在此
   *  内联:sync → 表现编排 → bot 接棒 → 横幅 → 释放)。定时器到点后状态可能已被调试
   *  钩子/force 直改,入会话后重查一次再出手(与 apLoop「拿到会话重查」同口径——await
   *  引入的重入窗口,非「理论上到不了」防御);不满足则原样退出,链尾 sync 重评估。 */
  private async autoRoll(): Promise<void> {
    const s = await this.drive.requestDrive("human");
    try {
      const e = this._engine;
      if (e.phase !== "Playing" || e.isOver || e.turnPhase !== "Roll" || this.apOn || e.players[e.decisionOwner].isBot) return;
      this.sync(); // 会话已占:interactive 锁定,且 rearm 因 drive 占用不会重复布定时器
      this.fxSink.stampSeal(e.activePlayer.position, "签");
      await delay(AUTO_MARCH.qiqianMs);
      await this.runAnimatedStep(() => e.submitCommand({ type: "rollAndMove" }), "rollAndMove");
      await this.runBots();
      maybeShowTurnBanner(e);
    } finally {
      s.release();
      this.sync();
    }
  }

  /** 托管代打循环:轮到本地人类座位时以 botAct 推进一步(引擎 player-agnostic,
   *  botAct 按 decisionOwner 决策,热座下人类座位轮到时即代打),走与真 bot 完全一致的
   *  表现链。Wave 2-A:旧版轮询 busy(delay 80ms 等锁)改为经驱动仲裁器排队——
   *  当前表现链收尾(会话释放)即被队首唤醒接手,无轮询粒度抖动;真 bot 回合
   *  仍由既有 runBots 接棒,循环只在「决策方是人类」时出手。 */
  private async apLoop(): Promise<void> {
    if (this.apLoopRunning) return; // 已有循环在跑(开启时正忙的场景),复用即可
    this.apLoopRunning = true;
    try {
      const e = this._engine;
      while (this.apOn && !e.isOver) {
        if (e.phase !== "Playing" || e.players[e.decisionOwner].isBot) {
          await delay(AUTOPILOT.idleMs); // #117 收编:无人类决策点(真 bot 轮次由 runBots 驱动/Setup 待手选)
          continue;
        }
        const s = await this.drive.requestDrive("autopilot");
        try {
          // 排队等待期间状态可能已被前一条链推进:拿到会话后重查再出手(旧版每轮
          // 循环头重查 busy/phase 的等价物,防对已失效的决策点代打)。
          if (!this.apOn || e.isOver || e.phase !== "Playing" || e.players[e.decisionOwner].isBot) continue;
          this.sync();
          if (this.apSpeed === "slow") await delay(BOT.stepDelayMs);
          await this.runAnimatedStep(() => botAct(e));
          maybeShowTurnBanner(e);
          await this.runBots(); // 代打后若轮到真 bot,沿用既有接棒
        } finally {
          s.release();
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

  /** 状态桥扩展(ADR-0014 单机落盘):每次引擎变化后把 log 增量归档 IndexedDB
   *  (dafung-logs/games,key=gameId;换局首写顺手清 30 天前旧局,见 gameLogArchive.ts)。
   *  #188:每次引擎变化后同时重评估自动起摇定时器(Roll 相位的唯一驻留出口)。 */
  protected override sync(): void {
    super.sync();
    archiveEngineLog(this._engine);
    this.rearmAutoRoll();
  }

  override destroy(): void {
    // 换局/卸载时撤自动起摇定时器(定时器泄漏 = bug;新控制器自带新定时器)
    if (this.rollTimer) {
      clearTimeout(this.rollTimer);
      this.rollTimer = null;
    }
  }

  // 热座:视角跟随「当前该行动的人类」。decisionOwner 是唯一出处(引擎 getter:珍宝交涉
  // 相位=城主,可能 ≠ 访客;其余相位=activeIndex),视角与交互都得跟决策方走,否则城主
  // 视角永远渲染不出可点按钮 → 单机遇到该相位死锁(e2e react-editor 巡检发现)。
  // spec #107 C1 单源化:旧写法「相位条件 ? decisionOwner : activeIndex」与引擎 getter
  // 逐字同构,是同一公式的第二份手抄——直取单源,删本地复读。
  get viewSeat(): number {
    return this._engine.decisionOwner;
  }
  get interactive(): boolean {
    // 同理用 decisionOwner 判「轮到人类」:非珍宝相位它就是 activeIndex,语义不变。
    // Wave3(候选2):基类 canAct 变参收口删除,公共骨架(Playing + 决策方是人类)在此内联,
    // 差异锁 = 驱动仲裁态(Wave 2-A:旧 busy 改读仲裁器查询,时序等价——会话占用是同步置位)
    // 与托管(托管中本地不响应,代打循环全权驱动;对照旧 interactive 的 !apOn)。
    const e = this._engine;
    return (
      e.phase === "Playing" &&
      !e.players[e.decisionOwner]?.isBot &&
      !this.drive.isDriving() &&
      !this.apOn
    );
  }

  // ─── 命令入口 ───
  // 单机同样统一走 submitCommand(与联机共用一条命令路径):日后加回放/调试记录时
  // 只需在这一个出口拦截,不必逐方法打点。表现编排异步进行,期间仲裁器锁交互。
  dispatchCommand(cmd: GameCommand): void {
    if (!this.interactive) return; // 非本地人类决策时忽略(引擎自身也有相位守卫,双保险)
    void this.runStep(() => this._engine.submitCommand(cmd), commandLabelOf(cmd));
  }

  /** 进入 Game 屏后调用一次:若开局即轮到 bot(或 Setup 余下全是 bot),接棒驱动;
   *  轮到人类则只弹首回合横幅。幂等(驱动会话活跃期间不重复启动,旧 if(busy) 的
   *  仲裁器等价物)。 */
  onEnterGame(): void {
    if (this.drive.isDriving()) return;
    void (async () => {
      // 首条语句前无 await:条件判定与会话占用均在 onEnterGame 同步段内完成,
      // 与旧版 busy=true 的同步置位时序一致。
      if (this._engine.phase === "Setup" || (this._engine.phase === "Playing" && this._engine.players[this._engine.decisionOwner].isBot)) {
        const s = await this.drive.requestDrive("enter");
        try {
          await this.runBots();
        } finally {
          s.release();
          this.sync();
        }
      }
      maybeShowTurnBanner(this._engine);
      // #188:开局即轮到人类时上面不走 runBots 链(无链尾 sync),此处补一次——
      // 首回合 Roll 等待态的自动起摇定时器在此布下。
      this.sync();
    })();
  }

  /** Setup(PickCapital)落子:为当前选都玩家定都(Wave3 候选2:原 tileClick 的
   *  Setup 分支独立成口,相位路由已上移 GameScreen,Playing 详情查看归 UI 不进控制器)。 */
  override setupPickCapital(index: number): void {
    const e = this._engine;
    const playerIndex = e.currentSetupPlayerIndex;
    if (e.setupPhase !== "PickCapital") return;
    if (playerIndex >= 0 && !e.players[playerIndex].isBot) {
      void this.runPickCapital(playerIndex, index);
    }
  }

  /** 一次引擎推进的完整链(人类命令与 bot 步骤共用骨架):
   *  引擎推进(run 注入)→ 起点锚定(行军类)→ sync → 表现编排 → bot 接棒 → 回合横幅。
   *  链首经仲裁器取驱动会话/链尾释放,期间 interactive=false 防连点
   *  (旧 busy 置位/释放的仲裁器等价物)。 */
  private async runStep(run: () => void, cmdType: string): Promise<void> {
    const s = await this.drive.requestDrive("human");
    try {
      this.sync();
      await this.runAnimatedStep(run, cmdType);
      await this.runBots();
      maybeShowTurnBanner(this._engine);
    } finally {
      s.release();
      this.sync();
    }
  }

  /** 「一次引擎推进 + 表现编排」的共享骨架(原 runStep 与 runBots 循环体逐行重复,提取于此):
   *  捕获推进前相位/玩家 → run() 推进 → 行军类先锚定起点 → sync → 提取表现事件 →
   *  present 播放(骰子→行军→浮字,顺序=事件顺序)→ sync。
   *  表现后的收尾两处顺序不同(人类步:先 bot 接棒再弹回合横幅;bot 步:直接弹横幅),
   *  故 runBots/横幅留在调用方,时序与提取前一致。 */
  private async runAnimatedStep(run: () => void, cmdType?: string): Promise<void> {
    const e = this._engine;
    const prevPhase = e.turnPhase;
    const prePlayer = e.players[e.activeIndex];
    const moverId = e.activePlayer.id;
    run();
    // 行军类推进:先锚定起点再 sync——否则 React 先渲染终态,棋子闪现终点再被拽回
    if (e.presentation.lastMove && prevPhase === "Roll") {
      this.fxSink.marchBegin(moverId);
    }
    this.sync();
    // Wave1:提取(读引擎表现态)与播放(FxSink)分离;旧 playStepEffects 内联链
    // 的时序语义完整保留在 extractStepEvents 的分支与事件顺序里。
    const events = extractStepEvents(e, prevPhase, moverId, prePlayer, cmdType);
    await present(events, this.fxSink);
    this.sync();
  }

  /** 人类选都:引擎落子 + 印章"筑"反馈 + bot 余下选都/进局接棒(驱动会话护全程)。 */
  private async runPickCapital(playerIndex: number, index: number): Promise<void> {
    const e = this._engine;
    const s = await this.drive.requestDrive("human");
    try {
      this.sync();
      e.pickCapital(playerIndex, index);
      this.fxSink.stampSeal(index, "筑");
      this.sync();
      await this.runBots();
      maybeShowTurnBanner(e);
    } finally {
      s.release();
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

    // 选都阶段的 bot 步进要先于 Playing 循环:人类选都后余下 bot 仍处 Setup,
    // 若只在 Playing 循环体内驱动(aiSetupStep),Setup 期的 bot 会永远轮空卡死流程。
    while (e.phase === "Setup" && e.aiSetupStep()) {
      this.sync();
      await delay(BOT.stepDelayMs);
      this.sync();
    }

    // 步数上限保留(防单链失控),但不再作为唯一退出依据:每步做显式 stall 检测——
    // 推进前后状态指纹不变 ⇒ botAct 空转,立即 warn + 中断(对照联机 room.ts
    // driveBots 的 no-progress 指纹思路,简化为单步判定:指纹覆盖位置/资源/回合量,
    // 任何真实进展必改变它;正常对局永不触发,故可观察行为不变)。
    let guard = 0;
    // 用 decisionOwner 驱动:珍宝交涉相位决策方是城主而非访客——访客是人类、城主是
    // bot 时若只看 activeIndex,城主 bot 永远不被调度(死锁另一半,见 viewSeat 注释)。
    // 非珍宝相位 decisionOwner === activeIndex,行为不变。botAct 内部按相位自行分发。
    while (e.phase === "Playing" && e.players[e.decisionOwner].isBot && guard++ < 500) {
      this.sync();
      await delay(BOT.stepDelayMs);
      // delay 是异步窗:期间状态可能被调试钩子(e2e force)直改——decisionOwner 换人后
      // 再 botAct 就是越权代打人类决策点。出手前重查一次(与 apLoop「拿到会话重查」同口径),
      // 条件不再满足即交还控制权,链尾 sync 会按新状态重评估(含自动起摇定时器)。
      if (!(e.phase === "Playing" && e.players[e.decisionOwner].isBot)) break;
      const before = botFingerprint(e);
      await this.runAnimatedStep(() => botAct(e));
      maybeShowTurnBanner(e);
      if (botFingerprint(e) === before) {
        // 旧 safety 上限兜的正是这种「驱动循环未收敛」;现在把它变成可断言条件:
        // 空转一步即停并留痕,不再空烧 500 × 750ms 的思考动画。
        console.warn(
          `[LocalController] bot 驱动停滞:状态指纹连续不变(turn=${e.turnNumber} active=${e.activeIndex} phase=${e.turnPhase}),中断本轮接棒`,
        );
        break;
      }
    }
    if (e.isOver) {
      this.fxSink.playSound("victory");
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

/** bot 推进的廉价状态指纹(runBots stall 检测用;room.ts fingerprint 的简化版):
 *  覆盖回合量(turnNumber/activeIndex/turnPhase)与全部玩家的位置/资源量——
 *  任何真实进展(移动/交易/轮空消耗/回合推进)必改变它,指纹不变即 botAct 空转。 */
function botFingerprint(e: GameEngine): string {
  return [
    e.phase,
    e.turnPhase,
    e.turnNumber,
    e.activeIndex,
    e.players
      .map((p) => `${p.cash}:${p.treasures.length}:${p.properties.length}:${p.heroes.length}:${p.position}:${p.skipTurns}:${p.warrants}`)
      .join(","),
  ].join("|");
}

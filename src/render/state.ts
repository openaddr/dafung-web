// 热座控制器(原 App):本地多人轮流操作。引擎权威,动画编排 + AI 调度都在这。
// 共享 scaffold/fullRender/bindEvents/openScroll/showHeroPickScroll/showTreasureOwnerScroll/
// showBankruptcyScroll/showHandDetail/showTileDetail/flashHint/destroy 在 ClientController 基类
// (ADR-0006)。本子类提供四个抽象成员 + 热座特有的开局定序选都、回合动画、AI 调度、卷轴处理。
import type { LoadedMap } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { EngineConfig } from "@core/game";
import { botAct } from "@core/bot";
import { createConfirm, createVictory } from "./ui";
import { delay, BOT } from "./timings";
import { loadAssetManifest } from "./assets";
import { ClientController } from "./client-controller";

const botDelay = (ms: number = BOT.stepDelayMs): Promise<void> => delay(ms);

declare global {
  interface Window {
    __dafung?: unknown;
  }
}

export class App extends ClientController {
  engine: GameEngine;

  constructor(config: EngineConfig & { map: LoadedMap }) {
    const { map, ...rest } = config;
    super(map, typeof rest.seed === "number" ? (rest.seed ^ 0x5eed) >>> 0 : undefined);
    const board = map.board;
    const dice = createDice(rest.seed);
    this.engine = new GameEngine(board, map.catalog, dice, rest);
    window.__dafung = {
      engine: this.engine,
      snapshot: () => this.engine.snapshot(),
      board,
      botAct: () => botAct(this.engine), // 调试用:对当前玩家执行一次 bot 决策
      threeDice: this.threeDice, // 调试用:读 3D 骰子姿态
      render: () => this.fullRender(), // 调试/测试用:手动触发重渲(直接改 engine 后刷 UI)
    };

    this.fullRender();
    // 开局:直接点将定序 → 选都(国号已在 setup screen 填好)
    this.engine.doDraftRoll();
    this.fullRender();
    this.advanceSetup();
    // 素材 manifest 异步加载完后重渲一次(让 hero/treasure 图就位);未就绪期间走 SVG fallback
    void loadAssetManifest().then(() => this.fullRender());
  }

  // ─────────────────────── 抽象成员实现 ───────────────────────
  get viewSeat(): number {
    return this.engine.activeIndex;
  }
  get interactive(): boolean {
    const e = this.engine;
    return e.phase === "Playing" && !e.activePlayer.isBot && !this.busy;
  }

  /** 热座动作分发:逐动作改引擎 + 动画 + 推进回合。action-string 解析与联机对称
   *  (halt/buy/heropick-N/treasure-fair-X/treasure-mode-fair/bk-confirm…),但落到 onHalt/onDecision/…
   *  而非 act→send。返回 Promise<void> 是 OK 的:基类抽象签名是 :void,TS 允许 Promise<void> 覆写 void
   *  (callback-style 放宽);bindEvents 里用 `void this.dispatchAction(...)` fire-and-forget。 */
  async dispatchAction(action: string): Promise<void> {
    if (action.startsWith("heropick-")) {
      const idx = parseInt(action.slice("heropick-".length), 10);
      return this.onHeroPick(idx);
    }
    if (action.startsWith("treasure-")) {
      const sub = action.slice("treasure-".length);
      if (sub === "skip") return this.onTreasureOwner({ type: "skip" });
      if (sub === "back") { this.showTreasureOwnerScroll(); return; }
      if (sub.startsWith("mode-")) {
        const mode = sub.slice("mode-".length);
        if (mode === "fair" || mode === "premium") { this.showTreasurePickerScroll(mode); return; }
        return; // 未知 mode,忽略
      }
      const [verb, ...rest] = sub.split("-");
      const treasureId = rest.join("-");
      if (verb === "fair") return this.onTreasureOwner({ type: "fair", treasureId });
      if (verb === "premium") return this.onTreasureOwner({ type: "premium", treasureId });
    }
    if (action.startsWith("bk-")) {
      const sub = action.slice("bk-".length);
      if (sub === "confirm") return this.onBankruptcy("confirm");
      return this.onBankruptcy(sub); // treasure-${id} / prop-${propId} / hero-${heroId}
    }
    switch (action) {
      case "halt":
        return this.onHalt("halt");
      case "continue":
        return this.onHalt("continue");
      case "main":
        return this.onBranch("Main");
      case "branch":
        return this.onBranch("Branch");
      case "buy":
        return this.onDecision("buy");
      case "upgrade":
        return this.onDecision("upgrade");
      case "skip":
        return this.onDecision("skip");
    }
  }

  onRoll() {
    const e = this.engine;
    if (this.busy || e.phase !== "Playing" || e.activePlayer.isBot) return;
    // P2: AwaitingBranch 改由侧栏内嵌"走大路/入辅路",行军按钮只管 Roll
    if (e.turnPhase !== "Roll") return;
    void this.doRoll();
  }

  onTileClick(idx: number) {
    const e = this.engine;
    if (e.phase === "Setup" && e.setupPhase === "PickCapital") {
      this.handlePickCapital(idx);
      return;
    }
    // 对局中:查看城池详情(只读)。有卷轴弹窗时不弹详情,避免覆盖决策/破产卷轴。
    if (e.phase === "Playing" && this.overlay == null) this.showTileDetail(idx);
  }

  // ─────────────────────── 开局:选都 ───────────────────────
  private advanceSetup() {
    const e = this.engine;
    if (e.phase !== "Setup") {
      this.beginPlay();
      return;
    }
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) {
      this.beginPlay();
      return;
    }
    const player = e.players[idx];
    this.showPickHint(`「${player.guohao}」择一空城建都`);
    if (player.isBot) {
      this.setThinking(true);
      setTimeout(() => {
        e.aiSetupStep();
        this.setThinking(false);
        this.fullRender();
        this.advanceSetup();
      }, 800);
    }
    // 人类:等待点击城池(onTileClick)
  }

  private handlePickCapital(idx: number) {
    const e = this.engine;
    const cur = e.currentSetupPlayerIndex;
    if (cur < 0) return;
    const player = e.players[cur];
    if (player.isBot) return;
    const tile = e.board.at(idx);
    // 直接读引擎 Set,免全量 snapshot 分配(finding: efficiency)
    const taken = e.takenCapitalIndices.has(idx);
    if (!tile.isCapitalEligible || taken) {
      this.flashHint("该城不可选或已被据");
      return;
    }
    const def = e.catalog.get(tile.propertyId);
    if (!def) return;
    if (player.cash < def.buildCost) {
      this.flashHint(`建城费 ${formatMoney(def.buildCost)} 不足`);
      return;
    }
    this.hideOverlay();
    this.overlay = createConfirm(
      this.boardWrap,
      `以 ${formatMoney(def.buildCost)} 建「${tile.name}」为都城?`,
      () => {
        const r = e.pickCapital(cur, idx);
        this.hideOverlay();
        if (!r.ok) this.flashHint(r.reason ?? "选都失败");
        else this.animator.stampSeal(idx, "筑");
        this.fullRender();
        this.advanceSetup();
      },
      () => this.hideOverlay(),
    );
  }

  private beginPlay() {
    this.hideHint();
    this.fullRender();
    this.animator.showTurnBanner(this.engine.activePlayer.guohao, this.engine.activePlayer.colorIndex);
    if (this.engine.activePlayer.isBot) this.scheduleBot();
  }

  // ─────────────────────── 回合:抽签 ───────────────────────
  private async doRoll() {
    const e = this.engine;
    this.busy = true;
    this.fullRender();
    const moverId = e.activePlayer.id;
    e.rollAndMove();
    this.fullRender(moverId); // 跳过行军玩家的棋子,交给 animateMove 从起点沿弧线推进
    if (!e.lastRoll) {
      // 防御:rollAndMove 未抽签(非 Roll 阶段被误调)——直接收尾,避免 animateDice 读 null 崩
      await this.afterLand();
      return;
    }
    await this.animator.animateDice(e.lastRoll.die);

    if (e.turnPhase === "AwaitingCapitalHalt") {
      // 驻跸抉择:令牌未动。P2:人类改侧栏内嵌(按钮由 renderActionInline 渲染)
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e); // haltAtCapital / continueMove
        await this.animator.animateMove(e, moverId);
        this.animator.spawnFloaters(e);
        await this.afterLand();
      } else {
        this.busy = false;
        this.fullRender();
      }
      return;
    }

    await this.animator.animateMove(e, moverId);
    this.animator.spawnFloaters(e);
    await this.afterLand();
  }

  /** 落格后:辅路入口抉择 / 决策 / 回合结束。统一处理 bot 与人类。 */
  private async afterLand(): Promise<void> {
    const e = this.engine;
    if (e.turnPhase === "AwaitingBranch") {
      // 落到辅路起点:bot 直接决策;人类改侧栏内嵌(P2)
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e); // AwaitingBranch → selectBranch(Main|Branch)
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.afterLand();
      }
      this.busy = false;
      this.fullRender();
      return;
    }
    if (e.turnPhase === "AwaitingDecision") {
      if (e.activePlayer.isBot) return this.runBotResolve();
      // P2: 买/扩军/跳过改侧栏内嵌(由 renderActionInline 渲染)
      this.busy = false;
      this.fullRender();
      return;
    }
    if (e.turnPhase === "AwaitingHeroPick") {
      if (e.activePlayer.isBot) return this.runBotResolve();
      this.showHeroPickScroll();
      this.busy = false;
      return;
    }
    if (e.turnPhase === "AwaitingTreasureOwner") {
      // 城主抉择(公道买卖/坐地起价/跳过);城主可能是 bot 或人类
      const owner = e.players[e.treasureVisitor?.ownerIdx ?? 0];
      if (owner.isBot) return this.runBotResolve();
      this.showTreasureOwnerScroll();
      this.busy = false;
      return;
    }
    if (e.turnPhase === "AwaitingBankruptcySettle") {
      if (e.activePlayer.isBot) return this.runBotResolve();
      this.showBankruptcyScroll();
      this.busy = false;
      return;
    }
    // 已 endTurn
    this.fullRender();
    return this.onTurnAdvanced();
  }

  /** bot 抉择通用流程:延迟 → botAct → 浮动金额 → 渲染 → 推进回合(isOver 由 onTurnAdvanced 统一拦截)。 */
  private async runBotResolve(): Promise<void> {
    const e = this.engine;
    await botDelay();
    botAct(e);
    this.animator.spawnFloaters(e);
    this.fullRender();
    // bot 城主贸易可能致人类访客破产 → turnPhase=AwaitingBankruptcySettle(人类要清算)。
    // 此时不能 onTurnAdvanced(rollBtn 禁用 + 无破产卷轴 = 软锁),改弹破产清算卷轴给人类。
    if (e.turnPhase === "AwaitingBankruptcySettle") {
      this.showBankruptcyScroll();
      this.busy = false;
      return;
    }
    return this.onTurnAdvanced();
  }

  private onTurnAdvanced() {
    const e = this.engine;
    if (e.isOver) return this.showVictory();
    // 人类回合:先释放 busy 再渲染
    if (!e.activePlayer.isBot) this.busy = false;
    this.fullRender();
    this.animator.showTurnBanner(e.activePlayer.guohao, e.activePlayer.colorIndex);
    if (e.activePlayer.isBot) {
      this.scheduleBot();
    }
  }

  // ─────────────────────── 抉择处理 ───────────────────────
  private async onHalt(action: "halt" | "continue") {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingCapitalHalt") return;
    this.busy = true;
    this.hideOverlay();
    const moverId = e.activePlayer.id;
    if (action === "halt") e.haltAtCapital();
    else e.continueMove();
    this.fullRender();
    await this.animator.animateMove(e, moverId);
    this.animator.spawnFloaters(e);
    await this.afterLand();
  }

  private async onBranch(kind: "Main" | "Branch") {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingBranch") return;
    this.busy = true;
    this.hideOverlay();
    e.selectBranch(kind);
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.isOver) return this.showVictory();
    // 选 Branch 触发辅路首格效果,选 Main 按普通城落格:都可能进入决策/清算/下回合
    await this.afterLand();
  }

  private async onDecision(action: "buy" | "upgrade" | "skip") {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingDecision") return;
    this.busy = true;
    this.hideOverlay();
    if (action === "buy") {
      e.buyProperty();
      if (e.lastTransaction?.status === "Ok") {
        this.animator.stampSeal(e.activePlayer.position, "据");
        this.audio.play("buy");
      }
    } else if (action === "upgrade") {
      e.upgradeProperty();
      if (e.lastTransaction?.status === "Ok") this.audio.play("upgrade");
    } else {
      e.endDecision();
    }
    this.animator.spawnFloaters(e);
    this.fullRender();
    return this.onTurnAdvanced();
  }

  // ─────────────────────── AI 调度 ───────────────────────
  private scheduleBot() {
    this.setThinking(true);
    setTimeout(() => {
      this.setThinking(false);
      void this.botFlow();
    }, 800);
  }

  private async botFlow() {
    this.busy = true;
    await this.doRoll(); // doRoll + afterLand 内部完成 bot 全部子决策
  }

  // ─────────────────────── 抉择卷轴处理 ───────────────────────
  // (P2) 常规决策卷轴方法 showHaltScroll/showBranchScroll/showDecisionScroll/singleDecisionAction
  // 已移除——驻跸/选路/买扩军改由侧栏 renderActionInline 内嵌。复杂抉择(招贤/赠宝/破产)仍用卷轴
  // (showHeroPickScroll/showTreasureOwnerScroll/showBankruptcyScroll 在基类)。

  private async onTreasureOwner(action: { type: "fair"; treasureId: string } | { type: "premium"; treasureId: string } | { type: "skip" }) {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingTreasureOwner") return;
    this.busy = true;
    this.hideOverlay();
    e.resolveTreasureOwner(action);
    // 公道/坐地:访客得宝(无论买入)→ 珍宝音;跳过无声。
    if (action.type !== "skip") this.audio.play("treasure");
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.isOver) return this.showVictory();
    if ((e.turnPhase as string) === "AwaitingBankruptcySettle") {
      // 访客可能破产:bot 自己清算,人类才弹卷轴
      if (e.activePlayer.isBot) return this.runBotResolve();
      this.showBankruptcyScroll();
      this.busy = false;
      return;
    }
    this.onTurnAdvanced();
  }

  private async onBankruptcy(action: string) {
    const e = this.engine;
    if (e.turnPhase !== "AwaitingBankruptcySettle") return;
    this.hideOverlay();
    if (action === "confirm") {
      this.busy = true;
      const settler = e.activePlayer; // confirm 后 endTurn 会推进活跃玩家,先捕获
      e.confirmBankruptcySettle();
      this.animator.spawnFloaters(e);
      this.fullRender();
      // 变卖仍不足 → 破产:播破产音(settler.isBankrupt 在 settleDebt 中置 true)
      if (settler.isBankrupt) this.audio.play("bankrupt");
      return this.onTurnAdvanced();
    }
    const [verb, ...rest] = action.split("-");
    const id = rest.join("-");
    if (verb === "treasure") e.sellTreasureBankruptcy(id);
    else if (verb === "prop") e.sellPropertyBankruptcy(id);
    else if (verb === "hero") e.cashHeroBankruptcy(id);
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.turnPhase === "AwaitingBankruptcySettle") this.showBankruptcyScroll(); // 仍清算 → 重弹
    else this.onTurnAdvanced();
  }

  private async onHeroPick(idx: number) {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingHeroPick") return;
    this.busy = true;
    this.hideOverlay();
    e.resolveHeroPick(idx);
    this.animator.spawnFloaters(e);
    this.fullRender();
    return this.onTurnAdvanced();
  }

  // ─────────────────────── 胜利 / 重开 ───────────────────────
  private showVictory() {
    this.busy = true;
    this.audio.play("victory");
    this.fullRender();
    this.hideOverlay();
    const v = createVictory(this.engine, () => this.restart());
    this.boardWrap.appendChild(v);
    this.overlay = v;
  }

  private restart() {
    this.destroy();
    window.location.reload();
  }
}

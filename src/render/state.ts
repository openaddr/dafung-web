// 应用主控制器:整合引擎 / 棋盘渲染 / 动画 / 事件 / AI 调度。
import type { LoadedMap } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { createDice } from "@core/dice";
import { GameEngine } from "@core/game";
import type { EngineConfig } from "@core/game";
import { botAct } from "@core/bot";
import { createBoardSvg } from "./board";
import type { BoardView } from "./board";
import { createAnimator } from "./animate";
import type { Animator } from "./animate";
import { ThreeDice } from "./dice3d";
import { SynthAudioPlayer } from "./audio";
import type { AudioPlayer } from "./audio";
import {
  createLayout,
  renderActionInline,
  renderHand,
  renderOthers,
  renderStatusBar,
  renderWarlog,
  createScroll,
  createConfirm,
  createVictory,
} from "./ui";
import type { SidebarRefs } from "./ui";
import { el } from "./dom";
import { SIGN_FACES, TAP_MAX_MOVE } from "@core/constants";
import { guidePriceOf } from "@core/treasures";
import { delay, BOT } from "./timings";
import { loadAssetManifest, assetImg, treasureAssetImg } from "./assets";

const botDelay = (ms: number = BOT.stepDelayMs): Promise<void> => delay(ms);

declare global {
  interface Window {
    __dafung?: unknown;
  }
}

export class App {
  engine: GameEngine;
  boardView: BoardView;
  animator: Animator;
  threeDice: ThreeDice;
  audio: AudioPlayer;
  refs: SidebarRefs;
  boardWrap: HTMLElement;

  busy = false;
  warlogMode: "brief" | "detail" = "brief";
  private warlogState = { rendered: 0 };
  private overlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private thinking: HTMLElement | null = null;
  private flashHintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: EngineConfig & { map: LoadedMap }) {
    const { map, ...rest } = config;
    const board = map.board;
    const dice = createDice(rest.seed);
    this.engine = new GameEngine(board, map.catalog, dice, rest);

    const { boardWrap, sidebar } = createLayout();
    this.boardWrap = boardWrap;
    this.refs = sidebar;
    this.boardView = createBoardSvg(board, map.catalog, { panZoom: true });
    boardWrap.appendChild(this.boardView.root);
    const resetBtn = el("button", { class: "btn board-reset", title: "还原总览" }, ["总览"]) as HTMLButtonElement;
    resetBtn.addEventListener("click", () => this.boardView.resetView());
    boardWrap.appendChild(resetBtn);
    // 3D 物理骰子:挂到侧栏骰盘容器。
    // 物理随机用「独立种子流」而非 engine.dice.nextFloat:若共用游戏随机流,每次掷骰
    // 动画都会向前推进游戏 RNG,使同一 seed 在 3D 开/关下产生不同游戏结果——破坏可复现
    // 性,也会让依赖 seed 的 e2e 流程漂移。这里从同一 seed 派生独立流:既种子化可复现,
    // 又完全不影响核心游戏逻辑(core 零改动)。
    const physicsRng = createDice(
      typeof rest.seed === "number" ? (rest.seed ^ 0x5eed) >>> 0 : undefined,
    ).nextFloat;
    // 3D 骰子物理碰撞 → diceHit 音效(按冲击速度归一化强度 0~1)。
    this.threeDice = new ThreeDice(this.refs.dice3d, physicsRng, (intensity) => this.audio.play("diceHit", { intensity }));
    this.audio = new SynthAudioPlayer();
    this.animator = createAnimator(boardWrap, this.boardView.root, board, this.boardView, this.threeDice, this.audio);

    this.bindEvents();
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

  // ─────────────────────── 全量渲染 ───────────────────────
  fullRender(skipToken?: string) {
    const e = this.engine;
    renderStatusBar(e, this.refs.statusEl);
    renderOthers(e, this.refs.playersEl);
    this.boardView.updateTiles(e);
    this.boardView.updateTokens(e, skipToken);

    this.refs.roundInfo.textContent =
      e.phase === "Playing" ? `· 第 ${e.turnNumber} 回合` : e.phase === "GameOver" ? "· 终局" : "";

    // 骰子面
    this.refs.diceFace.textContent = e.lastRoll ? SIGN_FACES[e.lastRoll.die - 1] : "签";

    // P2: 常规决策(驻跸/选路/买扩军)内嵌到侧栏 actionInline;复杂相位仍弹卷轴
    const interactive = e.phase === "Playing" && !e.activePlayer.isBot && !this.busy;
    renderActionInline(e, this.refs.actionInline, interactive);
    // P3: 手牌(热座=活跃玩家;联机见 network-client 用 this.seat)
    renderHand(e, this.refs.handEl, e.activeIndex, (k, id) => this.showHandDetail(k, id));
    // 行军按钮仅 Roll 相位启用(AwaitingBranch 改由内嵌"走大路/入辅路")
    const canRoll = interactive && e.turnPhase === "Roll";
    this.refs.rollBtn.disabled = !canRoll;
    this.refs.rollBtn.classList.toggle("breathe", canRoll);

    renderWarlog(e, this.refs.warlogList, this.warlogMode, this.warlogState);
  }

  // ─────────────────────── 事件绑定 ───────────────────────
  private bindEvents() {
    this.refs.rollBtn.addEventListener("click", () => this.onRoll());

    // 城池选择用 pointerdown→pointerup 的「轻点(tap)」判定,而非浏览器的 click。
    // 原因:城池很小(约 22px),按下后哪怕轻微移动(>~10px)也会让 mouseup 落到相邻城池或
    // 空白,于是 click 的目标变成两者的公共祖先是 tileLayer)→ closest('[data-tile]') 取不到
    // → 点城没反应、要反复点两三下才中。这里记录「按下时的城池」,松手时只要位移不大(仍属
    // 轻点)就按该城池触发,即便指针跨到了邻城也能命中。
    let downTileIdx: number | null = null;
    let downX = 0;
    let downY = 0;
    const onDown = (ev: PointerEvent) => {
      const tileEl = (ev.target as Element | null)?.closest("[data-tile]") ?? null;
      downTileIdx = tileEl ? Number(tileEl.getAttribute("data-tile")) : null;
      downX = ev.clientX;
      downY = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      const idx = downTileIdx;
      downTileIdx = null;
      if (idx == null || Number.isNaN(idx)) return;
      const dx = ev.clientX - downX;
      const dy = ev.clientY - downY;
      if (dx * dx + dy * dy > TAP_MAX_MOVE * TAP_MAX_MOVE) return; // 位移过大=拖动,忽略
      void this.onTileClick(idx);
    };
    this.boardWrap.addEventListener("pointerdown", onDown);
    this.boardWrap.addEventListener("pointerup", onUp);
    this.boardWrap.addEventListener("pointercancel", () => { downTileIdx = null; });

    // 覆盖层里的 HTML 按钮(抉择/破产等,带 data-action)仍走 click
    this.boardWrap.addEventListener("click", (ev) => {
      const action = (ev.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action) void this.dispatchAction(action);
    });
    // P2: 侧栏内嵌动作按钮(常规决策)走同一 dispatchAction
    this.refs.root.addEventListener("click", (ev) => {
      const action = (ev.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action) {
        ev.stopPropagation();
        void this.dispatchAction(action);
      }
    });

    for (const tab of this.refs.tabs) {
      tab.addEventListener("click", () => {
        const mode = tab.getAttribute("data-mode") as "brief" | "detail";
        this.warlogMode = mode;
        this.refs.tabs.forEach((x) => x.classList.toggle("active", x === tab));
        // 切换模式:重置已渲染数,全量重建
        this.warlogState.rendered = 0;
        this.refs.warlogList.innerHTML = "";
        this.fullRender();
      });
    }
  }

  private async dispatchAction(action: string) {
    if (action.startsWith("heropick-")) {
      const idx = parseInt(action.slice("heropick-".length), 10);
      return this.onHeroPick(idx);
    }
    if (action.startsWith("treasure-")) {
      const sub = action.slice("treasure-".length);
      if (sub === "skip") return this.onTreasureOwner({ type: "skip" });
      const [verb, ...rest] = sub.split("-");
      const treasureId = rest.join("-");
      if (verb === "gift") return this.onTreasureOwner({ type: "gift", treasureId });
      if (verb === "trade") return this.onTreasureOwner({ type: "trade", treasureId });
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

  private hideOverlay() {
    this.overlay?.remove();
    this.overlay = null;
  }

  /** 统一卷轴入口:先清旧覆盖层,再 createScroll 并赋值给 this.overlay。 */
  private openScroll(
    title: string,
    desc: string,
    buttons: { label: string | (Node | string)[]; action: string; primary?: boolean }[],
    onClose?: () => void,
  ): void {
    this.hideOverlay();
    this.overlay = createScroll(this.boardWrap, title, desc, buttons, onClose);
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

  private onTileClick(idx: number) {
    const e = this.engine;
    if (e.phase === "Setup" && e.setupPhase === "PickCapital") {
      this.handlePickCapital(idx);
      return;
    }
    // 对局中:查看城池详情(只读)。有卷轴弹窗时不弹详情,避免覆盖决策/破产卷轴。
    if (e.phase === "Playing" && this.overlay == null) this.showTileDetail(idx);
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
  private onRoll() {
    const e = this.engine;
    if (this.busy || e.phase !== "Playing" || e.activePlayer.isBot) return;
    // P2: AwaitingBranch 改由侧栏内嵌"走大路/入辅路",行军按钮只管 Roll
    if (e.turnPhase !== "Roll") return;
    void this.doRoll();
  }

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
      // 城主抉择(赠宝/贸易/跳过);城主可能是 bot 或人类
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

  // ─────────────────────── 弹层 ───────────────────────
  // (P2) 常规决策卷轴方法 showHaltScroll/showBranchScroll/showDecisionScroll/singleDecisionAction
  // 已移除——驻跸/选路/买扩军改由侧栏 renderActionInline 内嵌。复杂抉择(招贤/赠宝/破产)仍用卷轴。

  /** P3: 手牌卡点击 → 详情卷轴(珍宝/名士)。热座读活跃玩家手牌。 */
  private showHandDetail(kind: "treasure" | "hero", id: string) {
    const e = this.engine;
    const p = e.activePlayer;
    if (kind === "treasure") {
      const t = p.treasures.find((x) => x.id === id);
      if (!t) return;
      this.openScroll(t.name, `Lv${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}　${t.desc}`, [], () => this.hideOverlay());
    } else {
      const h = p.heroes.find((x) => x.id === id);
      if (!h) return;
      this.openScroll(`${h.name}·${h.title}`, h.desc, [], () => this.hideOverlay());
    }
  }

  private showTileDetail(idx: number) {
    const e = this.engine;
    const tile = e.board.at(idx);
    const def = e.catalog.get(tile.propertyId);
    if (!def) return;
    const owner = e.findOwner(def.id);
    const isCapital = e.capitalOwnerOf(idx) != null;
    const ownerText = owner ? `持有:${owner.guohao}` : "无主";
    const capText = isCapital ? ` · 都城 Lv.${owner?.properties.find((h) => h.propertyId === def.id)?.level ?? 0}` : "";
    this.openScroll(
      `「${tile.name}」`,
      `${tile.region} · ${ownerText}${capText} · 购入 ${formatMoney(def.purchasePrice)}`,
      [],
      () => this.hideOverlay(),
    );
  }

  private showHeroPickScroll() {
    const e = this.engine;
    const offered = e.offeredHeroes;
    if (!offered.length) return;
    const desc = offered.map((h, i) => `${i + 1}. ${h.name}·${h.title} — ${h.desc}`).join("  ／  ");
    this.openScroll(
      "招贤纳士",
      desc,
      offered.map((h, i) => {
        const label: (Node | string)[] = [];
        const img = assetImg("hero:" + h.id, "hero-portrait");
        if (img) label.push(img);
        label.push(h.name);
        return { label, action: `heropick-${i}`, primary: i === 0 };
      }),
    );
  }

  private showTreasureOwnerScroll() {
    const e = this.engine;
    const tv = e.treasureVisitor!;
    const owner = e.players[tv.ownerIdx];
    const mover = e.activePlayer;
    const tile = e.board.at(mover.position);
    const buttons: { label: string | (Node | string)[]; action: string; primary?: boolean }[] = [];
    for (const t of owner.treasures) {
      const withIcon = (text: string): (Node | string)[] => {
        const c: (Node | string)[] = [];
        const img = treasureAssetImg(t.id, "treasure-icon");
        if (img) c.push(img);
        c.push(text);
        return c;
      };
      const guide = guidePriceOf(t.level);
      buttons.push({ label: withIcon(`赠·${t.name} +${formatMoney(guide)}`), action: `treasure-gift-${t.id}` });
      buttons.push({ label: withIcon(`卖·${t.name}`), action: `treasure-trade-${t.id}` });
    }
    buttons.push({ label: "不赠不卖", action: "treasure-skip", primary: true });
    this.openScroll(
      `${owner.guohao}·珍宝抉择`,
      `${mover.guohao} 落「${tile.name}」。${owner.guohao} 可选一件珍宝:赠宝(访客得宝、城升级、朝廷赏指导价银)或贸易(访客付银得宝,售价=指导价×城池公式×等级倍率)。`,
      buttons,
    );
  }

  private async onTreasureOwner(action: { type: "gift"; treasureId: string } | { type: "trade"; treasureId: string } | { type: "skip" }) {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingTreasureOwner") return;
    this.busy = true;
    this.hideOverlay();
    e.resolveTreasureOwner(action);
    // 赠宝/贸易:访客得宝(无论城主赠予或买入)→ 珍宝音;跳过无声。
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

  /** 破产清算卷轴:列珍宝(指导价)/非都城城(购入价)/名士(200),卖一件重弹,结算→confirm。 */
  private showBankruptcyScroll() {
    const e = this.engine;
    const p = e.activePlayer;
    const debt = e.pendingDebt!;
    const capProp = e.board.at(p.capitalIndex)?.propertyId;
    const buttons: { label: string; action: string; primary?: boolean }[] = [];
    for (const t of p.treasures) {
      buttons.push({ label: `卖·${t.name} +${formatMoney(guidePriceOf(t.level))}`, action: `bk-treasure-${t.id}` });
    }
    for (const h of p.properties) {
      if (h.propertyId === capProp) continue; // 都城不可卖
      const name = e.board.tiles.find((t) => t.propertyId === h.propertyId)?.name ?? h.propertyId;
      buttons.push({ label: `卖城·${name} +${formatMoney(h.purchasePrice)}`, action: `bk-prop-${h.propertyId}` });
    }
    for (const h of p.heroes) {
      buttons.push({ label: `遣·${h.name} +${formatMoney(200)}`, action: `bk-hero-${h.id}` });
    }
    buttons.push({ label: "结算", action: "bk-confirm", primary: true });
    const owe = Math.max(0, debt.amount - p.cash);
    this.openScroll(
      `${p.guohao}·变卖自救`,
      `现金不足,尚欠 ${formatMoney(owe)}。变卖资产凑够即免破产(珍宝按指导价、城按购入价、名士 200 分)。`,
      buttons,
    );
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

  private showVictory() {
    this.busy = true;
    this.audio.play("victory");
    this.fullRender();
    this.hideOverlay();
    const v = createVictory(this.engine, () => this.restart());
    this.boardWrap.appendChild(v);
    this.overlay = v;
  }

  /** 释放 WebGL/Audio 等长生命周期资源。
   *  当前唯一调用方 restart() 紧跟 reload(),同步销毁的成果被整页销毁——看似冗余但无害,
   *  保留是为将来联机重连(network-client 切房间/换地图不刷页)铺路:那时 destroy() 是必需的。 */
  destroy(): void {
    this.threeDice.cleanup();
    this.audio.dispose();
  }

  private restart() {
    this.destroy();
    window.location.reload();
  }

  // ─────────────────────── 提示元素 ───────────────────────
  private showPickHint(text: string) {
    if (!this.hint) {
      this.hint = el("div", { class: "pick-hint" });
      this.boardWrap.appendChild(this.hint);
    }
    this.hint.textContent = text;
  }
  private hideHint() {
    this.hint?.remove();
    this.hint = null;
  }
  private flashHint(text: string) {
    // 清掉上一个 setTimeout,避免 stale prev 竞态(多次 flash 导致旧文本覆盖新文本)
    if (this.flashHintTimer != null) {
      clearTimeout(this.flashHintTimer);
      this.flashHintTimer = null;
    }
    if (!this.hint) {
      this.showPickHint(text);
    } else {
      const prev = this.hint.textContent;
      this.hint.textContent = text;
      this.flashHintTimer = setTimeout(() => {
        this.flashHintTimer = null;
        if (this.hint) this.hint.textContent = prev;
      }, 1500);
    }
  }
  private setThinking(on: boolean) {
    if (on) {
      if (!this.thinking) {
        this.thinking = el("div", { class: "thinking" }, ["运筹中…"]);
        this.boardWrap.appendChild(this.thinking);
      }
    } else {
      this.thinking?.remove();
      this.thinking = null;
    }
  }
}

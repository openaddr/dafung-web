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
import {
  createLayout,
  renderPlayers,
  renderWarlog,
  createScroll,
  createConfirm,
  createDecisionScroll,
  createVictory,
} from "./ui";
import type { SidebarRefs } from "./ui";
import { el } from "./dom";
import { SIGN_FACES, TAP_MAX_MOVE } from "@core/constants";
import { guidePriceOf } from "@core/treasures";
import { supplyFor } from "@core/economy";
import { delay, BOT } from "./timings";

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
  refs: SidebarRefs;
  boardWrap: HTMLElement;

  busy = false;
  warlogMode: "brief" | "detail" = "brief";
  private warlogState = { rendered: 0 };
  private overlay: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private thinking: HTMLElement | null = null;

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
    this.animator = createAnimator(boardWrap, this.boardView.root, board, this.boardView);

    this.bindEvents();
    window.__dafung = {
      engine: this.engine,
      snapshot: () => this.engine.snapshot(),
      board,
      botAct: () => botAct(this.engine), // 调试用:对当前玩家执行一次 bot 决策
    };

    this.fullRender();
    // 开局:直接点将定序 → 选都(国号已在 setup screen 填好)
    this.engine.doDraftRoll();
    this.fullRender();
    this.advanceSetup();
  }

  // ─────────────────────── 全量渲染 ───────────────────────
  fullRender(skipToken?: string) {
    const e = this.engine;
    renderPlayers(e, this.refs.playersEl);
    this.boardView.updateTiles(e);
    this.boardView.updateTokens(e, skipToken);

    this.refs.roundInfo.textContent =
      e.phase === "Playing" ? `· 第 ${e.turnNumber} 回合` : e.phase === "GameOver" ? "· 终局" : "";

    // 骰子面
    this.refs.diceFace.textContent = e.lastRoll ? SIGN_FACES[e.lastRoll.die - 1] : "签";

    // 行军按钮:人类回合掷骰(Roll)或分歧点选路(AwaitingBranch)前都可用。
    // AwaitingBranch 时点行军 → doRoll 入口拦截,弹选路卷轴而非掷骰。
    const humanTurn =
      e.phase === "Playing" &&
      !e.activePlayer.isBot &&
      (e.turnPhase === "Roll" || e.turnPhase === "AwaitingBranch") &&
      !this.busy;
    this.refs.rollBtn.disabled = !humanTurn;
    this.refs.rollBtn.classList.toggle("breathe", humanTurn);

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

    // 覆盖层里的 HTML 按钮(购地/抉择/驻跸等,带 data-action)仍走 click
    this.boardWrap.addEventListener("click", (ev) => {
      const action = (ev.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
      if (action) void this.dispatchAction(action);
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
      if (verb === "gift" || verb === "trade") return this.onTreasureOwner({ type: verb, treasureId });
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
      case "shortcut":
        return this.onBranch("Shortcut");
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
    // 对局中:查看城池详情(只读)
    if (e.phase === "Playing") this.showTileDetail(idx);
  }

  private handlePickCapital(idx: number) {
    const e = this.engine;
    const cur = e.currentSetupPlayerIndex;
    if (cur < 0) return;
    const player = e.players[cur];
    if (player.isBot) return;
    const tile = e.board.at(idx);
    const taken = e.snapshot().takenCapitalIndices.includes(idx);
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
    // AwaitingBranch:掷骰前先选路(doRoll 入口拦截 → 弹选路卷轴,而非 rollAndMove)
    if (e.turnPhase !== "Roll" && e.turnPhase !== "AwaitingBranch") return;
    void this.doRoll();
  }

  private async doRoll() {
    const e = this.engine;
    // 分歧点选路:下回合掷骰前先选大路/小路。选完 selectBranch→endTurn,不进入 rollAndMove。
    if (e.turnPhase === "AwaitingBranch") {
      if (e.activePlayer.isBot) {
        this.busy = true;
        await botDelay();
        botAct(e); // AwaitingBranch → selectBranch → endTurn
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.onTurnAdvanced();
      }
      // 人类:弹选路卷轴,等 onBranch
      this.showBranchScroll();
      this.busy = false;
      return;
    }
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
      // 驻跸抉择:令牌未动,弹卷轴
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e); // haltAtCapital / continueMove
        await this.animator.animateMove(e, moverId);
        this.animator.spawnFloaters(e);
        await this.afterLand();
      } else {
        this.showHaltScroll();
        this.busy = false;
      }
      return;
    }

    await this.animator.animateMove(e, moverId);
    this.animator.spawnFloaters(e);
    await this.afterLand();
  }

  /** 落格后:决策 / 回合结束。统一处理 bot 与人类。(分歧点选路已移到 doRoll 入口) */
  private async afterLand() {
    const e = this.engine;
    if (e.turnPhase === "AwaitingDecision") {
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e); // buy/upgrade/endDecision → endTurn
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.onTurnAdvanced();
      }
      this.showDecisionScroll();
      this.busy = false;
      return;
    }
    if (e.turnPhase === "AwaitingHeroPick") {
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e); // resolveHeroPick → endTurn
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.onTurnAdvanced();
      }
      this.showHeroPickScroll();
      this.busy = false;
      return;
    }
    if (e.turnPhase === "AwaitingTreasureOwner") {
      // 城主抉择(赠宝/贸易/跳过);城主可能是 bot 或人类
      const owner = e.players[e.treasureVisitor?.ownerIdx ?? 0];
      if (owner.isBot) {
        await botDelay();
        botAct(e);
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.onTurnAdvanced();
      }
      this.showTreasureOwnerScroll();
      this.busy = false;
      return;
    }
    if (e.turnPhase === "AwaitingBankruptcySettle") {
      if (e.activePlayer.isBot) {
        await botDelay();
        botAct(e);
        this.animator.spawnFloaters(e);
        this.fullRender();
        if (e.isOver) return this.showVictory();
        return this.onTurnAdvanced();
      }
      this.showBankruptcyScroll();
      this.busy = false;
      return;
    }
    // 已 endTurn
    this.fullRender();
    if (e.isOver) return this.showVictory();
    this.onTurnAdvanced();
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
    } else if (e.turnPhase === "AwaitingBranch") {
      // 人类新回合即站在分歧点:直接弹选路卷轴(行军前先择路)
      this.showBranchScroll();
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

  private async onBranch(kind: "Main" | "Shortcut") {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingBranch") return;
    this.busy = true;
    this.hideOverlay();
    e.selectBranch(kind);
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.isOver) return this.showVictory();
    this.onTurnAdvanced();
  }

  private async onDecision(action: "buy" | "upgrade" | "skip") {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingDecision") return;
    this.busy = true;
    this.hideOverlay();
    if (action === "buy") {
      e.buyProperty();
      if (e.lastTransaction?.status === "Ok") this.animator.stampSeal(e.activePlayer.position, "据");
    } else if (action === "upgrade") e.upgradeProperty();
    else e.endDecision();
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.isOver) return this.showVictory();
    this.onTurnAdvanced();
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
  private showHaltScroll() {
    this.hideOverlay();
    const e = this.engine;
    const cap = e.board.at(e.lastMove!.capitalIndex);
    const dest = e.board.at(e.lastMove!.landIndex);
    const def = e.catalog.get(cap.propertyId);
    const h = e.activePlayer.properties.find((p) => p.propertyId === def?.id);
    const supply = supplyFor(def?.resupplyPerLevel, h?.level);
    this.overlay = createScroll(
      this.boardWrap,
      "军至都城",
      `路过都城「${cap.name}」:驻跸可补给 +${formatMoney(supply)},或继续行军至「${dest.name}」。`,
      [
        { label: `驻跸 +${formatMoney(supply)}`, action: "halt", primary: true },
        { label: `继续行军`, action: "continue" },
      ],
    );
  }

  private showBranchScroll() {
    this.hideOverlay();
    const e = this.engine;
    const sc = e.currentBranchShortcut();
    const tile = e.board.at(e.activePlayer.position);
    const dest = sc ? e.board.at(sc.rejoinNode) : null;
    const preview = sc
      ? `大路:沿主驿道前行。小路:直插「${dest?.name}」(捷径,免通行费)。`
      : "大路:沿主驿道前行";
    this.overlay = createScroll(this.boardWrap, `要隘「${tile.name}」`, preview, [
      { label: "走大路", action: "main", primary: true },
      { label: "抄小路", action: "shortcut" },
    ]);
  }

  private showDecisionScroll() {
    this.hideOverlay();
    const o = createDecisionScroll(this.boardWrap, this.engine);
    if (o) this.overlay = o;
  }

  private showTileDetail(idx: number) {
    const e = this.engine;
    const tile = e.board.at(idx);
    const def = e.catalog.get(tile.propertyId);
    if (!def) return;
    const owner = e.findOwner(def.id);
    const isCapital = e.players.some((p) => p.capitalIndex === idx);
    const rents = def.rentByLevel.map((r, i) => `L${i} ${formatMoney(r)}`).join(" · ");
    const ownerText = owner ? `持有:${owner.guohao}` : "无主";
    const capText = isCapital ? ` · 都城 Lv.${owner?.properties.find((h) => h.propertyId === def.id)?.level ?? 0}` : "";
    this.hideOverlay();
    this.overlay = createScroll(
      this.boardWrap,
      `「${tile.name}」`,
      `${tile.region} · ${ownerText}${capText} · 购入 ${formatMoney(def.purchasePrice)} · 租金 ${rents}`,
      [],
      () => this.hideOverlay(),
    );
  }

  private showHeroPickScroll() {
    const e = this.engine;
    const offered = e.offeredHeroes;
    if (!offered.length) return;
    const desc = offered.map((h, i) => `${i + 1}. ${h.name}·${h.title} — ${h.desc}`).join("  ／  ");
    this.overlay = createScroll(
      this.boardWrap,
      "招贤纳士",
      desc,
      offered.map((h, i) => ({ label: h.name, action: `heropick-${i}`, primary: i === 0 })),
    );
  }

  private showTreasureOwnerScroll() {
    const e = this.engine;
    const tv = e.treasureVisitor!;
    const owner = e.players[tv.ownerIdx];
    const mover = e.activePlayer;
    const tile = e.board.at(mover.position);
    const buttons: { label: string; action: string; primary?: boolean }[] = [];
    for (const t of owner.treasures) {
      const guide = guidePriceOf(t.level);
      buttons.push({ label: `赠·${t.name} +${formatMoney(guide)}`, action: `treasure-gift-${t.id}` });
      buttons.push({ label: `卖·${t.name}`, action: `treasure-trade-${t.id}` });
    }
    buttons.push({ label: "不赠不卖", action: "treasure-skip", primary: true });
    this.overlay = createScroll(
      this.boardWrap,
      `${owner.guohao}·珍宝抉择`,
      `${mover.guohao} 落「${tile.name}」。${owner.guohao} 可选一件珍宝:赠宝(访客得宝、城升级、朝廷赏指导价银)或贸易(访客付银得宝,售价=指导价×城池公式×等级倍率)。`,
      buttons,
    );
  }

  private async onTreasureOwner(action: { type: "gift" | "trade" | "skip"; treasureId?: string }) {
    if (this.busy) return;
    const e = this.engine;
    if (e.turnPhase !== "AwaitingTreasureOwner") return;
    this.busy = true;
    this.hideOverlay();
    e.resolveTreasureOwner(
      action as { type: "gift"; treasureId: string } | { type: "trade"; treasureId: string } | { type: "skip" },
    );
    this.animator.spawnFloaters(e);
    this.fullRender();
    if (e.isOver) return this.showVictory();
    if ((e.turnPhase as string) === "AwaitingBankruptcySettle") { this.showBankruptcyScroll(); this.busy = false; return; }
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
    this.overlay = createScroll(
      this.boardWrap,
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
      e.confirmBankruptcySettle();
      this.animator.spawnFloaters(e);
      this.fullRender();
      if (e.isOver) return this.showVictory();
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
    else { if (e.isOver) return this.showVictory(); this.onTurnAdvanced(); }
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
    if (e.isOver) return this.showVictory();
    this.onTurnAdvanced();
  }

  private showVictory() {
    this.busy = true;
    this.fullRender();
    this.hideOverlay();
    const v = createVictory(this.engine, () => this.restart());
    this.boardWrap.appendChild(v);
    this.overlay = v;
  }

  private restart() {
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
    if (!this.hint) {
      this.showPickHint(text);
    } else {
      const prev = this.hint.textContent;
      this.hint.textContent = text;
      setTimeout(() => {
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

// 客户端控制器基类(ADR-0006):持有热座(HotseatController/App)与联机(NetworkClient)
// 两个客户端控制器的共享 scaffold + fullRender + bindEvents + 4 个 show*Scroll(招贤/珍宝交涉/破产)
// + openScroll/hideOverlay/showHandDetail/showTileDetail/flashHint/setThinking/destroy。
// 子类提供四个抽象成员:engine(渲染源)、viewSeat(视角座位)、interactive(此刻能否操作)、
// dispatchAction(动作执行,各模式自己实现,不强行统一)。
// onRoll / onTileClick 也抽象:热座=动画编排 + 推进引擎,联机=发 WS。
//
// 设计要点:
// - 构造函数只做 scaffold(createLayout / createBoardSvg / ThreeDice / SynthAudioPlayer /
//   createAnimator / bindEvents);**不** new 引擎、**不** fullRender。引擎是抽象成员,由子类
//   在 super() 之后赋值;fullRender 由子类在引擎就位后调。
// - bindEvents 是模板方法:绑 rollBtn / 棋盘 tap / 覆盖层按钮 / 侧栏 action-inline / warlog tabs,
//   所有交互调抽象 onRoll / onTileClick / dispatchAction —— 由子类实现。
// - dispatchAction 不抽到基类:热座要逐动作动画(购地→印章、珍宝交涉→珍宝音)+ 推进回合,
//   联机只发命令等快照;动作执行是真正的差异点(动画味道属热座),塞进基类会污染接缝。
import type { LoadedMap } from "@core/board-loader";
import { formatMoney } from "@core/money";
import { createDice } from "@core/dice";
import type { GameEngine } from "@core/game";
import { createBoardSvg } from "./board";
import type { BoardView } from "./board";
import { createAnimator } from "./animate";
import type { Animator } from "./animate";
import { ThreeDice } from "./dice3d";
import { HybridAudioPlayer } from "./audio";
import type { AudioPlayer } from "./audio";
import {
  createLayout,
  createScroll,
  renderActionInline,
  renderHand,
  renderOthers,
  renderStatusBar,
  renderWarlog,
} from "./ui";
import type { SidebarRefs } from "./ui";
import { el } from "./dom";
import { SIGN_FACES, TAP_MAX_MOVE } from "@core/constants";
import { guidePriceOf, premiumPriceOf } from "@core/treasures";
import { assetImg, treasureAssetImg } from "./assets";

export abstract class ClientController {
  // ─── scaffold(子类共享)──
  boardView: BoardView;
  animator: Animator;
  threeDice: ThreeDice;
  audio: AudioPlayer;
  refs: SidebarRefs;
  boardWrap: HTMLElement;

  // ─── 共享状态 ──
  busy = false;
  warlogMode: "brief" | "detail" = "brief";
  protected warlogState = { rendered: 0 };
  protected overlay: HTMLElement | null = null;
  protected hint: HTMLElement | null = null;
  protected thinking: HTMLElement | null = null;
  protected flashHintTimer: ReturnType<typeof setTimeout> | null = null;
  protected audioMuted = false;

  // ─── 托管 UI(spec: autopilot;单机/联机共用形态)──
  protected autopilotRow: HTMLElement | null = null;
  protected autopilotBtn: HTMLButtonElement | null = null;
  protected autopilotSpeedSel: HTMLSelectElement | null = null;
  protected autopilotStatusEl: HTMLElement | null = null;
  protected autopilotSpeed: "fast" | "slow" = "fast";

  /** 是否支持托管:联机=true;单机由本地驱动实现覆写。 */
  protected get autopilotSupported(): boolean {
    return false;
  }
  /** 我的座位当前是否托管中(子类覆写:联机读最新 seats 广播;单机读本地开关)。 */
  protected get autopilotOn(): boolean {
    return false;
  }
  /** 切换托管(子类覆写:联机发 WS 消息;单机本地驱动)。 */
  protected setAutoPilot(on: boolean, speed: "fast" | "slow"): void {
    void on;
    void speed;
  }

  // ─── 抽象成员(子类提供)──
  /** 渲染源:热座=权威引擎,联机=快照重 hydrate 的只读引擎。 */
  abstract engine: GameEngine;
  /** 视角座位:热座=活跃玩家 activeIndex,联机=自己的 seat。 */
  abstract get viewSeat(): number;
  /** 此刻能否操作:热座=活跃玩家是人类 && !busy,联机=轮到我决策 && !busy。 */
  abstract get interactive(): boolean;
  /** 动作执行:热座=改引擎+动画+推进,联机=发 WS。action 形如 halt/buy/heropick-N/treasure-fair-X/bk-confirm。 */
  abstract dispatchAction(action: string): void;
  /** 行军按钮:热座=doRoll(动画+落格编排),联机=发 rollAndMove 命令。 */
  abstract onRoll(): void;
  /** 城池点击:热座=选都/查看详情,联机=查看详情(只读)。 */
  abstract onTileClick(idx: number): void;

  constructor(map: LoadedMap, physicsSeed?: number) {
    const { boardWrap, sidebar } = createLayout();
    this.boardWrap = boardWrap;
    this.refs = sidebar;
    this.boardView = createBoardSvg(map.board, map.catalog, { panZoom: true });
    boardWrap.appendChild(this.boardView.root);
    const resetBtn = el("button", { class: "btn board-reset", title: "还原总览" }, ["总览"]) as HTMLButtonElement;
    resetBtn.addEventListener("click", () => this.boardView.resetView());
    boardWrap.appendChild(resetBtn);
    // 古风罗盘水印(右上角,缓慢旋转)——纯装饰
    const compass = el("img", { class: "board-compass", src: "/assets/textures/compass-rose.svg", alt: "" }) as HTMLImageElement;
    boardWrap.appendChild(compass);
    // 3D 物理骰子:挂到侧栏骰盘容器。
    // 物理随机用「独立种子流」而非 engine.dice.nextFloat:若共用游戏随机流,每次掷骰
    // 动画都会向前推进游戏 RNG,使同一 seed 在 3D 开/关下产生不同游戏结果——破坏可复现
    // 性,也会让依赖 seed 的 e2e 流程漂移。这里从同一 seed 派生独立流:既种子化可复现,
    // 又完全不影响核心游戏逻辑(core 零改动)。
    const physicsRng = createDice(physicsSeed).nextFloat;
    // 3D 骰子物理碰撞 → diceHit 音效(按冲击速度归一化强度 0~1)。
    this.threeDice = new ThreeDice(physicsRng, (intensity) => this.audio.play("diceHit", { intensity }));
    this.audio = new HybridAudioPlayer();
    this.animator = createAnimator(boardWrap, this.boardView.root, map.board, this.boardView, this.threeDice, this.audio);

    this.bindEvents();
    this.setupAutopilotUi();
  }

  /** 托管控件:侧栏动作区下方一行(托管/收回按钮 + 快慢切换 + 状态)。
   *  随 fullRender 刷新可见性与文案;不支持的模式(默认)整行隐藏。
   *  初始 display:none——构造期子类字段尚未初始化,不调 renderAutopilot。 */
  private setupAutopilotUi(): void {
    const row = el("div", { class: "autopilot-row", style: "display:none;" });
    const btn = el("button", { class: "btn", id: "autopilot-btn" }, ["托管"]) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      this.setAutoPilot(!this.autopilotOn, this.autopilotSpeed);
      this.renderAutopilot();
    });
    const sel = el("select", { id: "autopilot-speed", class: "input", title: "托管速度" }, [
      el("option", { value: "fast" }, ["快速"]),
      el("option", { value: "slow" }, ["慢速"]),
    ]) as HTMLSelectElement;
    sel.addEventListener("change", () => {
      this.autopilotSpeed = sel.value as "fast" | "slow";
      if (this.autopilotOn) this.setAutoPilot(true, this.autopilotSpeed); // 托管中切速:立即生效
      this.renderAutopilot();
    });
    const status = el("span", { class: "autopilot-status", id: "autopilot-status" }, []);
    row.appendChild(btn);
    row.appendChild(sel);
    row.appendChild(status);
    this.refs.actionZone.appendChild(row);
    this.autopilotRow = row;
    this.autopilotBtn = btn;
    this.autopilotSpeedSel = sel;
    this.autopilotStatusEl = status;
  }

  /** 刷新托管控件态(可见性/按钮文案/状态文字)。fullRender 每帧调。 */
  protected renderAutopilot(): void {
    const row = this.autopilotRow;
    if (!row || !this.autopilotBtn) return;
    const inGame = this.engine?.phase === "Playing";
    row.style.display = this.autopilotSupported && inGame ? "" : "none";
    const on = this.autopilotOn;
    this.autopilotBtn.textContent = on ? "收回托管" : "托管";
    this.autopilotBtn.classList.toggle("btn-primary", !on); // 托管中弱化主按钮
    if (this.autopilotStatusEl) {
      this.autopilotStatusEl.textContent = on ? `电脑代打中·${this.autopilotSpeed === "fast" ? "快" : "慢"}` : "";
    }
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
    const interactive = this.interactive;
    renderActionInline(e, this.refs.actionInline, interactive);
    // P3: 手牌(热座=活跃玩家 viewSeat=activeIndex;联机 viewSeat=this.seat)
    renderHand(e, this.refs.handEl, this.viewSeat, (k, id) => this.showHandDetail(k, id));
    // 行军按钮仅 Roll 相位启用(AwaitingBranch 改由内嵌"走大路/入辅路")
    const canRoll = interactive && e.turnPhase === "Roll";
    this.refs.rollBtn.disabled = !canRoll;
    this.refs.rollBtn.classList.toggle("breathe", canRoll);

    renderWarlog(e, this.refs.warlogList, this.warlogMode, this.warlogState);
    this.renderAutopilot();
  }

  // ─────────────────────── 事件绑定(模板方法:调抽象 onRoll/onTileClick/dispatchAction)───────────────────────
  protected bindEvents() {
    this.refs.rollBtn.addEventListener("click", () => this.onRoll());

    // 静音切换:点击切换 audio.setMuted + 切换 volume/mute 图标显示
    this.refs.muteBtn.addEventListener("click", () => {
      this.audioMuted = !this.audioMuted;
      this.audio.setMuted(this.audioMuted);
      const onIcon = this.refs.muteBtn.querySelector(".mute-on") as HTMLElement | null;
      const offIcon = this.refs.muteBtn.querySelector(".mute-off") as HTMLElement | null;
      if (onIcon) onIcon.style.display = this.audioMuted ? "none" : "block";
      if (offIcon) offIcon.style.display = this.audioMuted ? "block" : "none";
    });

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

  // ─────────────────────── 卷轴(覆盖层)───────────────────────────
  hideOverlay() {
    this.overlay?.remove();
    this.overlay = null;
  }

  /** 统一卷轴入口:先清旧覆盖层,再 createScroll 并赋值给 this.overlay。 */
  openScroll(
    title: string,
    desc: string,
    buttons: { label: string | (Node | string)[]; action: string; primary?: boolean }[],
    onClose?: () => void,
  ): void {
    this.hideOverlay();
    this.overlay = createScroll(this.boardWrap, title, desc, buttons, onClose);
  }

  // ─── 招贤/珍宝交涉/破产卷轴(两边一致)───
  protected showHeroPickScroll() {
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

  /** Step 1 模式选择:{owner}·珍宝抉择 — 不交易 / 公道买卖 / 坐地起价 三按钮。 */
  protected showTreasureOwnerScroll() {
    const e = this.engine;
    const tv = e.treasureVisitor!;
    const owner = e.players[tv.ownerIdx];
    const mover = e.activePlayer;
    const tile = e.board.at(mover.position);
    const n = owner.treasures.length;
    this.openScroll(
      `${owner.guohao}·珍宝抉择`,
      `${mover.guohao} 落「${tile.name}」。${owner.guohao} 有 ${n} 件珍宝。`,
      [
        { label: "不交易", action: "treasure-skip", primary: true },
        { label: "公道买卖 · 按指导价", action: "treasure-mode-fair" },
        { label: "坐地起价 · 加价出售", action: "treasure-mode-premium" },
      ],
    );
  }

  /** Step 2 选珍宝:列出当前模式下每件珍宝 + 价格 + 图标,末尾「← 返回」回 Step 1。 */
  protected showTreasurePickerScroll(mode: "fair" | "premium") {
    const e = this.engine;
    const tv = e.treasureVisitor!;
    const owner = e.players[tv.ownerIdx];
    const def = tv.def;
    const holding = owner.properties.find((h) => h.propertyId === def.id);
    const cityLevel = holding?.level ?? 0;
    const buttons: { label: (Node | string)[]; action: string }[] = [];
    for (const t of owner.treasures) {
      const guide = guidePriceOf(t.level);
      const price = mode === "fair" ? guide : premiumPriceOf(guide, def, cityLevel);
      const c: (Node | string)[] = [];
      const img = treasureAssetImg(t.id, "treasure-icon");
      if (img) c.push(img);
      c.push(`${t.name} → ${formatMoney(price)}`);
      buttons.push({ label: c, action: `treasure-${mode}-${t.id}` });
    }
    buttons.push({ label: ["← 返回"], action: "treasure-back" });
    const title = mode === "fair" ? "公道买卖·选珍宝" : "坐地起价·选珍宝";
    this.openScroll(title, "选择要出售的珍宝:", buttons);
  }

  /** 破产清算卷轴:列珍宝(指导价)/非都城城(购入价)/名士(200),卖一件重弹,结算→confirm。 */
  protected showBankruptcyScroll() {
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

  // ─────────────────────── 详情卷轴 ───────────────────────
  /** P3: 手牌卡点击 → 详情卷轴(珍宝/名士)。读 viewSeat 玩家手牌(热座=活跃,联机=自己)。 */
  protected showHandDetail(kind: "treasure" | "hero", id: string) {
    const p = this.engine.players[this.viewSeat];
    if (!p) return;
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

  /** 城池详情(富版:带都城 Lv)。onClose 只 hideOverlay——重弹决策卷轴由各模式自行管
   *  (热座不重弹,联机靠下一次 snapshot 的 refreshDecision)。 */
  protected showTileDetail(idx: number) {
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

  // ─────────────────────── 提示元素 ───────────────────────
  protected showPickHint(text: string) {
    if (!this.hint) {
      this.hint = el("div", { class: "pick-hint" });
      this.boardWrap.appendChild(this.hint);
    }
    this.hint.textContent = text;
  }
  protected hideHint() {
    this.hint?.remove();
    this.hint = null;
  }
  protected flashHint(text: string) {
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
  protected setThinking(on: boolean) {
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

  /** 释放 WebGL/Audio 等长生命周期资源。
   *  当前唯一调用方 hotseat.restart() 紧跟 reload(),同步销毁的成果被整页销毁——看似冗余但无害,
   *  保留是为将来联机重连(network-client 切房间/换地图不刷页)铺路:那时 destroy() 是必需的。 */
  destroy(): void {
    this.threeDice.cleanup();
    this.audio.dispose();
  }
}

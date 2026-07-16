// 游戏引擎:开局三段式(国号→点将定序→选都)+ 回合状态机 + 胜负判定 + 战报日志。
// 对应 C# 版 Flow/(SetupController/TurnFlowController) + Game/(GameRunner/VictoryDetector)。
import type { Board } from "./board";
import type { Dice } from "./dice";
import type {
  AiDifficulty,
  LandOutcome,
  LogEvent,
  MovePath,
  Player,
  PropertyDef,
  RouteKind,
  ShortcutDef,
  TileDef,
  TurnPhase,
  VictoryReason,
} from "./types";
import { netWorth } from "./networth";
import { findHolding } from "./player";
import { buy as buyProp, chargeRent, settleDebt, upgrade as upgradeProp } from "./economy";
import type { MapCatalog } from "./board-loader";
import { GUOHAO_POOL } from "./theme";
import { CHANCE_EVENTS, FATE_EVENTS } from "./events";
import { formatMoney } from "./money";

type Catalog = MapCatalog;

export interface SeatConfig {
  name: string;
  isBot: boolean;
  guohao?: string; // 人类可预设;留空则在 Guohao 阶段填
}

export interface EngineConfig {
  seats: SeatConfig[];
  targetNetWorth?: number; // 默认 8000
  startingCash?: number; // 默认 2500
  difficulty?: AiDifficulty; // 默认 Normal
  seed?: number; // 注入骰子种子,便于确定性测试(?seed= URL 参数)
}

export type EnginePhase = "Setup" | "Playing" | "GameOver";
export type SetupPhase = "Guohao" | "DraftRoll" | "DraftOrder" | "PickCapital" | "Done";

const DEFAULT_TARGET = 8000;
const DEFAULT_CASH = 2500;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameEngine {
  readonly board: Board;
  readonly catalog: Catalog;
  readonly dice: Dice;
  readonly players: Player[];
  readonly targetNetWorth: number;
  readonly startingCash: number;
  readonly difficulty: AiDifficulty;

  phase: EnginePhase = "Setup";
  setupPhase: SetupPhase = "Guohao";
  turnPhase: TurnPhase = "Roll";
  turnNumber = 0;

  private activeIndex = 0;
  private draftOrder: number[] = [];
  private draftRolls: number[] = [];
  private currentDraftIndex = 0;
  private takenCapitalIndices = new Set<number>();
  private usedGuohao = new Set<string>();

  isOver = false;
  winner: Player | null = null;
  winReason: VictoryReason = "None";

  lastRoll: { die: number; sum: number } | null = null;
  lastMove: MovePath | null = null;
  lastLandOutcome: LandOutcome | null = null;
  lastTransaction: { status: string; newLevel?: number } | null = null;

  log: LogEvent[] = [];
  /** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家),渲染层消费后清空。 */
  floaters: {
    playerIndex: number;
    amount: number;
    atTile?: number;
    kind: "income" | "expense" | "supply";
  }[] = [];

  constructor(
    board: Board,
    cat: Catalog,
    dice: Dice,
    config: EngineConfig,
  ) {
    this.board = board;
    this.catalog = cat;
    this.dice = dice;
    this.targetNetWorth = config.targetNetWorth ?? DEFAULT_TARGET;
    this.startingCash = config.startingCash ?? DEFAULT_CASH;
    this.difficulty = config.difficulty ?? "Normal";
    if (config.seats.length < 2 || config.seats.length > 4)
      throw new Error("支持 2–4 个座位。");
    this.players = config.seats.map((s, i) => ({
      id: `p${i}`,
      name: s.name,
      guohao: s.guohao ?? "",
      colorIndex: i,
      isBot: s.isBot,
      cash: this.startingCash,
      isBankrupt: false,
      position: 0,
      capitalIndex: -1,
      pendingBranch: null,
      properties: [],
    }));
    // 人类已填的国号加入 usedGuohao,防止 bot 分配时抽到重复国号(两个魏国 bug)
    for (const p of this.players) {
      if (p.guohao) this.usedGuohao.add(p.guohao);
    }
    this.logEvent("system", null, "开局:群雄逐鹿", `目标身价 ${formatMoney(this.targetNetWorth)} 起手 ${formatMoney(this.startingCash)}`);
  }

  // ──────────────────────────── 基础查询 ────────────────────────────
  get activePlayer(): Player {
    return this.players[this.activeIndex];
  }
  findOwner(propertyId: string): Player | null {
    return this.players.find((p) => findHolding(p, propertyId) != null) ?? null;
  }
  get pendingHaltIsOnPath(): boolean {
    return (
      this.lastMove != null &&
      this.lastMove.passedCapital &&
      this.lastMove.landIndex !== this.lastMove.capitalIndex
    );
  }
  currentBranchShortcut() {
    return this.board.getShortcut(this.activePlayer.position);
  }
  alivePlayers(): Player[] {
    return this.players.filter((p) => !p.isBankrupt);
  }

  // ──────────────────────────── 开局:Setup ────────────────────────────
  get currentSetupPlayerIndex(): number {
    return this.draftOrder[this.currentDraftIndex] ?? -1;
  }

  /** 设置某座位的国号(单汉字);非法/冲突清空拒绝。 */
  setGuohao(seatIndex: number, char: string): boolean {
    if (this.setupPhase !== "Guohao") return false;
    if (seatIndex < 0 || seatIndex >= this.players.length) return false;
    const trimmed = char.trim();
    // 单个 CJK 字
    const isCjk = /^[㐀-鿿]$/.test(trimmed);
    if (!isCjk) return false;
    // 冲突检查(其他座位已用)
    for (let i = 0; i < this.players.length; i++) {
      if (i !== seatIndex && this.players[i].guohao === trimmed) return false;
    }
    this.players[seatIndex].guohao = trimmed;
    this.usedGuohao.add(trimmed);
    return true;
  }

  /** 推进:为国号空的 bot 座位从字池随机分配(避开已用),然后进入点将定序。 */
  doDraftRoll(): void {
    if (this.setupPhase !== "Guohao") return;
    // 给 guohao 为空者分配(bot 或漏填的人类)
    const pool = shuffle(GUOHAO_POOL.filter((c) => !this.usedGuohao.has(c)), this.dice.nextFloat);
    let pi = 0;
    for (const p of this.players) {
      if (!p.guohao) {
        while (pi < pool.length && this.usedGuohao.has(pool[pi])) pi++;
        if (pi < pool.length) {
          p.guohao = pool[pi];
          this.usedGuohao.add(pool[pi]);
          pi++;
        }
      }
    }
    this.setupPhase = "DraftRoll";
    // 摇骰定序,平局重摇
    const n = this.players.length;
    const rolls = new Array(n).fill(0);
    let resolved = false;
    while (!resolved) {
      for (let i = 0; i < n; i++) rolls[i] = this.dice.rollDie();
      resolved = new Set(rolls).size === n; // 无平局
    }
    this.draftRolls = rolls;
    this.draftOrder = this.players
      .map((_, i) => i)
      .sort((a, b) => rolls[b] - rolls[a]);
    this.setupPhase = "DraftOrder";
    this.logEvent(
      "setup",
      null,
      "点将定序:" +
        this.draftOrder
          .map((i) => `${this.players[i].guohao || this.players[i].name}(${rolls[i]})`)
          .join("→"),
      `draftRolls=${JSON.stringify(rolls)} order=${JSON.stringify(this.draftOrder)}`,
    );
    this.setupPhase = "PickCapital";
    this.currentDraftIndex = 0;
  }

  /** 当前选都玩家(bots 自动)。返回是否已完成本轮选都(需 UI 再次驱动)。 */
  aiSetupStep(): boolean {
    if (this.setupPhase !== "PickCapital") return false;
    const idx = this.currentSetupPlayerIndex;
    if (idx < 0) return false;
    if (!this.players[idx].isBot) return false;
    const tileIdx = this.aiChooseCapital();
    if (tileIdx >= 0) this.pickCapital(idx, tileIdx);
    return true;
  }

  /** AI 选都评分:性价比 + 随机扰动,取最高分空城。 */
  private aiChooseCapital(): number {
    const eligible = this.board.tiles.filter(
      (t) => t.isCapitalEligible && !this.takenCapitalIndices.has(t.index),
    );
    if (eligible.length === 0) return -1;
    const score = (t: TileDef): number => {
      const def = this.catalog.get(t.propertyId);
      if (!def) return -Infinity;
      let value = (def.rentByLevel[3] * 4.0) / def.buildCost;
      value +=
        this.difficulty === "Simple"
          ? this.dice.nextFloat() * 2.0
          : this.dice.nextFloat() * 0.3;
      return value;
    };
    return [...eligible].sort((a, b) => score(b) - score(a))[0].index;
  }

  /** 选都(人类需 UI 二次确认后调用;AI 自动)。 */
  pickCapital(playerIndex: number, tileIndex: number): { ok: boolean; reason?: string } {
    if (this.setupPhase !== "PickCapital")
      return { ok: false, reason: "非选都阶段" };
    if (this.draftOrder[this.currentDraftIndex] !== playerIndex)
      return { ok: false, reason: "未轮到该玩家" };
    const tile = this.board.at(tileIndex);
    if (!tile.isCapitalEligible) return { ok: false, reason: "该城不可作都城" };
    if (this.takenCapitalIndices.has(tileIndex))
      return { ok: false, reason: "该城已被选" };
    const def = this.catalog.get(tile.propertyId);
    if (!def) return { ok: false, reason: "无地产定义" };
    const player = this.players[playerIndex];
    if (player.cash < def.buildCost) return { ok: false, reason: "建城费不足" };

    player.cash -= def.buildCost;
    player.properties.push({
      propertyId: def.id,
      group: def.group,
      purchasePrice: def.buildCost,
      totalUpgradeCost: 0,
      level: 0,
      maxLevel: def.maxLevel,
    });
    player.capitalIndex = tileIndex;
    player.position = tileIndex;
    this.takenCapitalIndices.add(tileIndex);
    this.logEvent(
      "setup",
      player.guohao,
      `${player.guohao} 以 ${formatMoney(def.buildCost)} 建「${tile.name}」为都城`,
      `pickCapital player=${player.id} tile=${tileIndex}(${tile.name}) buildCost=${def.buildCost} cashLeft=${player.cash}`,
      -def.buildCost,
    );
    this.currentDraftIndex++;
    if (this.currentDraftIndex >= this.players.length) this.finishSetup();
    return { ok: true };
  }

  private finishSetup(): void {
    this.setupPhase = "Done";
    this.phase = "Playing";
    this.turnPhase = "Roll";
    this.activeIndex = this.draftOrder[0] ?? 0;
    this.turnNumber = 1;
    this.logEvent(
      "setup",
      null,
      "群雄起兵,首战由「" + this.activePlayer.guohao + "」先行",
      `gameStart firstPlayer=${this.activePlayer.id}`,
    );
  }

  // ──────────────────────────── 回合状态机 ────────────────────────────
  /** 掷骰 → 移动 → 若路径含都城(非落点)进入驻跸抉择;否则直接落格。 */
  rollAndMove(): void {
    if (this.turnPhase !== "Roll") {
      this.warn(`RollAndMove 在非 Roll 阶段(${this.turnPhase})被调用`);
      return;
    }
    const mover = this.activePlayer;
    const roll = this.dice.roll();
    this.lastRoll = roll;
    const path = this.board.computePath(
      mover.position,
      roll.sum,
      mover.capitalIndex,
      mover.pendingBranch,
    );
    const fromPos = mover.position;
    const usedBranch = mover.pendingBranch;
    this.lastMove = path;
    this.logEvent(
      "roll",
      mover.guohao,
      `${mover.guohao} 抽签 ${"一二三四五六"[roll.die - 1]} → ${this.board.at(path.landIndex).name}`,
      `roll player=${mover.id} die=${roll.die} from=#${fromPos} land=#${path.landIndex} passedCapital=${path.passedCapital} wps=${path.waypoints.length}`,
    );

    if (path.passedCapital && path.landIndex !== path.capitalIndex) {
      // 驻跸抉择:令牌暂不前进,待 HaltAtCapital / ContinueMove
      this.turnPhase = "AwaitingCapitalHalt";
      this.logEvent(
        "halt",
        mover.guohao,
        `${mover.guohao} 路过都城 ${this.board.at(path.capitalIndex).name},抉择:驻跸 / 行军`,
        `awaitingHalt player=${mover.id} capital=#${path.capitalIndex} dest=#${path.landIndex}`,
      );
      return;
    }
    // 无驻跸:前进至落点并落格
    mover.position = path.landIndex;
    if (usedBranch != null) mover.pendingBranch = null;
    this.turnPhase = "Land";
    this.resolveLanding();
  }

  /** 驻跸都城(放弃剩余步数),结算补给。 */
  haltAtCapital(): void {
    if (this.turnPhase !== "AwaitingCapitalHalt") {
      this.warn(`HaltAtCapital 在非 AwaitingCapitalHalt 阶段(${this.turnPhase})被调用`);
      return;
    }
    const mover = this.activePlayer;
    mover.position = mover.capitalIndex;
    if (mover.pendingBranch != null) mover.pendingBranch = null;
    const supply = this.applyResupply(mover);
    this.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
    this.turnPhase = "Land";
    this.endTurn();
  }

  /** 继续行军到原定落点。 */
  continueMove(): void {
    if (this.turnPhase !== "AwaitingCapitalHalt") {
      this.warn(`ContinueMove 在非 AwaitingCapitalHalt 阶段(${this.turnPhase})被调用`);
      return;
    }
    const mover = this.activePlayer;
    mover.position = this.lastMove!.landIndex;
    if (mover.pendingBranch != null) mover.pendingBranch = null;
    this.turnPhase = "Land";
    this.resolveLanding();
  }

  /** 选大路/小路;小路立即结算后果,设 PendingBranch,EndTurn。 */
  selectBranch(kind: RouteKind): void {
    if (this.turnPhase !== "AwaitingBranch") {
      this.warn(`SelectBranch 在非 AwaitingBranch 阶段(${this.turnPhase})被调用`);
      return;
    }
    const p = this.activePlayer;
    const sc = this.board.getShortcut(p.position);
    p.pendingBranch = null;
    this.logEvent(
      "branch",
      p.guohao,
      `${p.guohao} 于 ${this.board.at(p.position).name} 取${kind === "Shortcut" ? "小路" : "大路"}`,
      `selectBranch player=${p.id} kind=${kind} at=#${p.position} cash=${p.cash}`,
    );
    if (kind === "Shortcut" && sc) {
      // 选小路:立即承受后果并跳到汇入点(同回合移动,不再拖到下回合)
      this.applyShortcutConsequence(p, sc);
      p.position = sc.rejoinNode;
      this.turnPhase = "Land";
      this.resolveLanding(); // rejoin 落格结算 → endTurn
    } else {
      // 大路:留在分歧点(已落),直接 endTurn
      this.lastLandOutcome = { kind: "Noop" };
      this.endTurn();
    }
  }

  private applyShortcutConsequence(p: Player, sc: ShortcutDef): void {
    const c = sc.consequence;
    if (c.kind === "FixedCost") {
      const bankrupt = settleDebt(p, null, c.amount);
      this.pushFloater(p, -c.amount, p.position, "expense");
      this.logEvent(
        "branch",
        p.guohao,
        `${p.guohao} 走小路缴 ${formatMoney(c.amount)}${bankrupt ? " → 破产" : ""}`,
        `branchCost player=${p.id} shortcut=${sc.id} fixed=${c.amount} cash=${p.cash} bankrupt=${bankrupt}`,
        -c.amount,
      );
    } else {
      const roll = this.dice.rollDie();
      if (roll >= 4) {
        p.cash += c.win.cashDelta;
        this.pushFloater(p, c.win.cashDelta, p.position, c.win.cashDelta > 0 ? "income" : "expense");
        this.logEvent(
          "branch",
          p.guohao,
          `${p.guohao} 走小路掷 ${roll} 胜 ${c.win.cashDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(c.win.cashDelta))}`,
          `branchCoinFlip player=${p.id} shortcut=${sc.id} roll=${roll} win delta=${c.win.cashDelta} cash=${p.cash}`,
          c.win.cashDelta,
        );
      } else {
        const cost = Math.max(0, -c.lose.cashDelta);
        const bankrupt = settleDebt(p, null, cost);
        this.pushFloater(p, -cost, p.position, "expense");
        this.logEvent(
          "branch",
          p.guohao,
          `${p.guohao} 走小路掷 ${roll} 败 −${formatMoney(cost)}${bankrupt ? " → 破产" : ""}`,
          `branchCoinFlip player=${p.id} shortcut=${sc.id} roll=${roll} lose cost=${cost} cash=${p.cash} bankrupt=${bankrupt}`,
          -cost,
        );
      }
    }
  }

  buyProperty(): void {
    if (this.turnPhase !== "AwaitingDecision" || this.lastLandOutcome?.property == null) {
      this.warn("BuyProperty 在非决策阶段或无待决策地产被调用");
      return;
    }
    const def = this.lastLandOutcome.property;
    const r = buyProp(this.activePlayer, def);
    this.lastTransaction = r;
    if (r.status === "Ok") {
      this.pushFloater(this.activePlayer, -def.purchasePrice, this.activePlayer.position, "expense");
      this.logEvent(
        "buy",
        this.activePlayer.guohao,
        `${this.activePlayer.guohao} 购「${this.tileName(def)}」${formatMoney(def.purchasePrice)}`,
        `buy player=${this.activePlayer.id} prop=${def.id} price=${def.purchasePrice} cash=${this.activePlayer.cash}`,
        -def.purchasePrice,
      );
    }
    this.endTurn();
  }

  upgradeProperty(): void {
    if (this.turnPhase !== "AwaitingDecision" || this.lastLandOutcome?.property == null) {
      this.warn("UpgradeProperty 在非决策阶段或无待决策地产被调用");
      return;
    }
    const def = this.lastLandOutcome.property;
    const r = upgradeProp(this.activePlayer, def);
    this.lastTransaction = r;
    if (r.status === "Ok") {
      this.pushFloater(this.activePlayer, -def.upgradeCost, this.activePlayer.position, "expense");
      this.logEvent(
        "upgrade",
        this.activePlayer.guohao,
        `${this.activePlayer.guohao} 扩军「${this.tileName(def)}」至 Lv.${r.newLevel} ${formatMoney(def.upgradeCost)}`,
        `upgrade player=${this.activePlayer.id} prop=${def.id} level=${r.newLevel} cost=${def.upgradeCost} cash=${this.activePlayer.cash}`,
        -def.upgradeCost,
      );
    }
    this.endTurn();
  }

  endDecision(): void {
    if (this.turnPhase !== "AwaitingDecision") {
      this.warn(`EndDecision 在非决策阶段(${this.turnPhase})被调用`);
      return;
    }
    this.logEvent("buy", this.activePlayer.guohao, `${this.activePlayer.guohao} 按兵不动`, `skip player=${this.activePlayer.id}`);
    this.endTurn();
  }

  private tileName(def: PropertyDef): string {
    const t = this.board.tiles.find((x) => x.propertyId === def.id);
    return t ? t.name : def.id;
  }

  // ──────────────────────────── 落格处理 ────────────────────────────
  private resolveLanding(): void {
    const mover = this.activePlayer;
    // 落点恰为自己都城:补给而非交租/升级
    if (mover.capitalIndex === mover.position) {
      const supply = this.applyResupply(mover);
      this.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
      this.turnPhase = "Land";
      this.endTurn();
      return;
    }
    const tile = this.board.at(mover.position);
    if (tile.type !== "Property") {
      this.resolveSpecial(mover, tile);
      return;
    }
    this.resolveProperty(mover, tile);
  }

  private resolveSpecial(mover: Player, tile: TileDef): void {
    // 机遇(Chance)/命运(Fate):随机抽事件,温和 ±¥100~250
    if (tile.type === "Chance" || tile.type === "Fate") {
      const pool = tile.type === "Chance" ? CHANCE_EVENTS : FATE_EVENTS;
      const ev = pool[Math.floor(this.dice.nextFloat() * pool.length)];
      let bankrupt = false;
      if (ev.cashDelta >= 0) {
        mover.cash += ev.cashDelta;
      } else {
        bankrupt = settleDebt(mover, null, -ev.cashDelta);
      }
      this.pushFloater(mover, ev.cashDelta, tile.index, ev.cashDelta >= 0 ? "income" : "expense");
      this.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
      this.logEvent(
        "system",
        mover.guohao,
        `${mover.guohao} 落 ${tile.name}:${ev.text} ${ev.cashDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(ev.cashDelta))}${bankrupt ? " → 破产" : ""}`,
        `${tile.type!.toLowerCase()} player=${mover.id} event=${ev.id} delta=${ev.cashDelta} cash=${mover.cash}`,
        ev.cashDelta,
      );
      this.endTurn();
      return;
    }
    // 税关(Tax):固定缴税 ¥200
    if (tile.type === "Tax") {
      const bankrupt = settleDebt(mover, null, 200);
      this.pushFloater(mover, -200, tile.index, "expense");
      this.lastLandOutcome = { kind: "TaxPaid", amount: 200, causedBankruptcy: bankrupt };
      this.logEvent("tax", mover.guohao, `${mover.guohao} 落 ${tile.name} 缴税 ${formatMoney(200)}${bankrupt ? " → 破产" : ""}`, `tax player=${mover.id} tile=#${tile.index} cash=${mover.cash}`, -200);
      this.endTurn();
      return;
    }
    // 商市(Stock):随机行情波动 ±¥100~200(简化版;完整买/卖/持股系统留后续)
    if (tile.type === "Stock") {
      const gain = this.dice.nextFloat() < 0.5;
      const amt = 100 + Math.floor(this.dice.nextFloat() * 100);
      const delta = gain ? amt : -amt;
      let bankrupt = false;
      if (delta >= 0) mover.cash += delta;
      else bankrupt = settleDebt(mover, null, amt);
      this.pushFloater(mover, delta, tile.index, gain ? "income" : "expense");
      this.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
      this.logEvent("system", mover.guohao, `${mover.guohao} 落 ${tile.name}(商市):${gain ? "行情看涨" : "行情看跌"} ${gain ? "+" : "−"}${formatMoney(amt)}${bankrupt ? " → 破产" : ""}`, `stock player=${mover.id} delta=${delta} cash=${mover.cash}`, delta);
      this.endTurn();
      return;
    }
    this.lastLandOutcome = { kind: "Noop" };
    this.endTurn();
  }

  private resolveProperty(mover: Player, tile: TileDef): void {
    const def = this.catalog.get(tile.propertyId);
    if (!def) {
      this.lastLandOutcome = { kind: "Noop" };
      this.endTurn();
      return;
    }
    const owner = this.findOwner(def.id);
    if (owner == null) {
      // 无主且是分歧点:弹支线,不进入购买
      if (this.board.getShortcut(tile.index) != null) {
        this.lastLandOutcome = { kind: "Noop" };
        this.turnPhase = "AwaitingBranch";
        this.logEvent("branch", mover.guohao, `${mover.guohao} 至要隘 ${tile.name},抉择:大路 / 小路`, `awaitingBranch player=${mover.id} tile=#${tile.index}`);
        return;
      }
      this.lastLandOutcome = { kind: "PropertyAvailable", property: def };
      this.turnPhase = "AwaitingDecision";
      this.logEvent("buy", mover.guohao, `${mover.guohao} 至 ${tile.name},可购(${formatMoney(def.purchasePrice)})`, `available player=${mover.id} prop=${def.id} price=${def.purchasePrice}`);
      return;
    }
    if (owner === mover) {
      this.lastLandOutcome = { kind: "OwnProperty", property: def, owner };
      this.turnPhase = "AwaitingDecision";
      this.logEvent("upgrade", mover.guohao, `${mover.guohao} 至己城 ${tile.name},可扩军(${formatMoney(def.upgradeCost)})`, `own player=${mover.id} prop=${def.id}`);
      return;
    }
    const rent = chargeRent(mover, owner, def, this.catalog);
    this.pushFloater(mover, -rent.amount, tile.index, "expense");
    this.pushFloater(owner, rent.amount, tile.index, "income");
    this.lastLandOutcome = {
      kind: "RentPaid",
      property: def,
      owner,
      amount: rent.amount,
      causedBankruptcy: rent.causedBankruptcy,
    };
    this.logEvent(
      "rent",
      mover.guohao,
      `${mover.guohao} 落 ${tile.name},向 ${owner.guohao} 付租 ${formatMoney(rent.amount)}${rent.causedBankruptcy ? " → 破产" : ""}`,
      `rent payer=${mover.id} owner=${owner.id} prop=${def.id} rent=${rent.amount} bankrupt=${rent.causedBankruptcy} cash=${mover.cash}`,
      -rent.amount,
    );
    this.endTurn();
  }

  /** 都城补给 = ResupplyPerLevel × (Level+1)。 */
  private applyResupply(mover: Player): number {
    const tile = this.board.at(mover.capitalIndex);
    const def = this.catalog.get(tile.propertyId);
    const holding = findHolding(mover, def?.id ?? "");
    const lvl = holding?.level ?? 0;
    const supply = (def?.resupplyPerLevel ?? 0) * (lvl + 1);
    if (supply > 0) {
      mover.cash += supply;
      this.pushFloater(mover, supply, mover.capitalIndex, "supply");
      this.logEvent(
        "supply",
        mover.guohao,
        `${mover.guohao} 都城补给 +${formatMoney(supply)}(Lv.${lvl})`,
        `supply player=${mover.id} capital=#${mover.capitalIndex} level=${lvl} amount=${supply} cash=${mover.cash}`,
        supply,
      );
    }
    return supply;
  }

  // ──────────────────────────── 回合结束 / 胜负 ────────────────────────────
  private endTurn(): void {
    this.turnPhase = "EndTurn";
    const result = this.checkVictory();
    if (result.winner) {
      this.isOver = true;
      this.winner = result.winner;
      this.winReason = result.reason;
      this.phase = "GameOver";
      this.turnPhase = "GameOver";
      this.logEvent(
        "victory",
        result.winner.guohao,
        `「天下归一」${result.winner.guohao} 称帝!身价 ${formatMoney(netWorth(result.winner))}`,
        `victory winner=${result.winner.id} reason=${result.reason} netWorth=${netWorth(result.winner)}`,
      );
      return;
    }
    this.advanceToNextActive();
    // 离开分歧点(若上一回合设了 PendingBranch 且已移动):清空
    const p = this.activePlayer;
    if (p.pendingBranch != null && p.position !== p.pendingBranch.fromNode)
      p.pendingBranch = null;
    this.turnPhase = "Roll";
    this.turnNumber += 1;
    // 不重置 lastRoll / lastMove:doRoll 的骰子翻滚与行军动画在 rollAndMove 之后执行,
    // 而落点有主(付租/自己城补给)时 rollAndMove 会内部 endTurn,重置会让 doRoll 读到 null 而崩。
    // 下次 rollAndMove 会覆盖这两个值,故无需手动清空。
    this.lastLandOutcome = null;
    this.lastTransaction = null;
  }

  private checkVictory(): { winner: Player | null; reason: VictoryReason } {
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      return alive.length === 1
        ? { winner: alive[0], reason: "LastStanding" }
        : { winner: null, reason: "None" };
    }
    // 目标身价:主动玩家优先
    if (netWorth(this.activePlayer) >= this.targetNetWorth)
      return { winner: this.activePlayer, reason: "TargetNetWorth" };
    // 其他人达标:身价最高者
    const reached = alive
      .filter((p) => netWorth(p) >= this.targetNetWorth)
      .sort((a, b) => netWorth(b) - netWorth(a));
    if (reached.length > 0)
      return { winner: reached[0], reason: "TargetNetWorth" };
    return { winner: null, reason: "None" };
  }

  private advanceToNextActive(): void {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.activeIndex + step) % n;
      if (!this.players[idx].isBankrupt) {
        this.activeIndex = idx;
        return;
      }
    }
  }

  // ──────────────────────────── 战报 / 浮动反馈 ────────────────────────────
  private logEvent(
    category: LogEvent["category"],
    player: string | null,
    brief: string,
    detail: string,
    amount?: number,
  ): void {
    this.log.push({ turn: this.turnNumber, player, brief, detail, category, amount });
  }
  private warn(msg: string): void {
    this.logEvent("system", null, `[警告] ${msg}`, `warn: ${msg}`);
  }
  private pushFloater(
    p: Player,
    amount: number,
    atTile: number,
    kind: "income" | "expense" | "supply",
  ): void {
    this.floaters.push({ playerIndex: this.players.indexOf(p), amount, atTile, kind });
  }
  /** 渲染层消费浮动反馈后调用清空。 */
  drainFloaters() {
    const f = this.floaters;
    this.floaters = [];
    return f;
  }

  // ──────────────────────────── 调试快照(供 window.__dafung / 测试) ────────────────────────────
  snapshot() {
    return {
      phase: this.phase,
      setupPhase: this.setupPhase,
      turnPhase: this.turnPhase,
      turnNumber: this.turnNumber,
      activeIndex: this.activeIndex,
      targetNetWorth: this.targetNetWorth,
      isOver: this.isOver,
      winner: this.winner ? this.winner.id : null,
      winReason: this.winReason,
      draftOrder: this.draftOrder,
      draftRolls: this.draftRolls,
      currentSetupPlayerIndex: this.currentSetupPlayerIndex,
      takenCapitalIndices: [...this.takenCapitalIndices],
      pendingHaltIsOnPath: this.pendingHaltIsOnPath,
      currentBranchShortcutId: this.currentBranchShortcut()?.id ?? null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.guohao || p.name,
        guohao: p.guohao,
        colorIndex: p.colorIndex,
        isBot: p.isBot,
        cash: p.cash,
        netWorth: netWorth(p),
        isBankrupt: p.isBankrupt,
        position: p.position,
        capitalIndex: p.capitalIndex,
        pendingBranch: p.pendingBranch,
        properties: p.properties.map((h) => ({
          propertyId: h.propertyId,
          level: h.level,
          group: h.group,
        })),
      })),
      lastRoll: this.lastRoll,
      lastMove: this.lastMove
        ? {
            landIndex: this.lastMove.landIndex,
            passedCapital: this.lastMove.passedCapital,
            capitalIndex: this.lastMove.capitalIndex,
            traversed: this.lastMove.traversed,
          }
        : null,
      lastLandOutcomeKind: this.lastLandOutcome?.kind ?? null,
      lastLandOutcomeProperty: this.lastLandOutcome?.property?.id ?? null,
      logCount: this.log.length,
    };
  }
}

// 游戏引擎:开局三段式(国号→点将定序→选都)+ 回合状态机 + 胜负判定 + 战报日志。
// 对应 C# 版 Flow/(SetupController/TurnFlowController) + Game/(GameRunner/VictoryDetector)。
import type { Board } from "./board";
import type { Dice } from "./dice";
import type {
  AiDifficulty,
  HeroDef,
  GameCommand,
  LandOutcome,
  LogEvent,
  MovePath,
  Player,
  PropertyDef,
  RouteKind,
  TileDef,
  TurnPhase,
  VictoryReason,
} from "./types";
import { netWorth } from "./networth";
import { findHolding } from "./player";
import { buy as buyProp, settleDebt, supplyFor, upgrade as upgradeProp } from "./economy";
import { serializeGame } from "./snapshot";
import type { MapCatalog } from "./board-loader";
import { GUOHAO_POOL } from "./theme";
import { CHANCE_EVENTS, FATE_EVENTS } from "./events";
import { formatMoney } from "./money";
import { SIGN_FACES, isSingleCjk, STARTING_WARRANTS, WARRANTS_PER_PASS, BUY_WARRANT_COST, HERO_CAPACITY } from "./constants";
import { HEROES } from "./heroes";
import { CITY_LEVEL_MULTIPLIER, createTreasureDeck, guidePriceOf, tradePriceOf } from "./treasures";
import type { DiceRoll, TreasureDef } from "./types";

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
export type SetupPhase = "Guohao" | "PickCapital" | "Done";

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
  round = 1; // 回合计数:所有人各行动一次 = 1 轮(供名士技能冷却等使用)
  private recruitedHeroIds = new Set<string>(); // 已被招揽的名士(唯一)
  offeredHeroes: HeroDef[] = []; // 当前招贤纳士的候选(三选一)
  treasureDeck: TreasureDef[] = []; // 珍宝牌堆(剩余可抽)
  treasureVisitor: { def: PropertyDef; ownerIdx: number } | null = null; // 赠宝/贸易:当前城主视角
  pendingDebt: { amount: number; creditor: Player | null } | null = null; // 破产清算:待清偿债务(凑够自救,凑不够破产)

  activeIndex = 0; // public:供 snapshot/联机序列化(内部由 advanceToNextActive 维护,外部只读)
  draftOrder: number[] = []; // public:同上
  draftRolls: number[] = []; // public:同上
  private currentDraftIndex = 0;
  takenCapitalIndices = new Set<number>(); // public:同上
  private usedGuohao = new Set<string>();

  isOver = false;
  winner: Player | null = null;
  winReason: VictoryReason = "None";

  lastRoll: DiceRoll | null = null;
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
      warrants: STARTING_WARRANTS,
      isBankrupt: false,
      position: 0,
      capitalIndex: -1,
      pendingBranch: null,
      properties: [],
      heroes: [],
      treasures: [],
      heroLastFired: {},
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
  /** 选 tileIndex 为都城的玩家(无则 null)。供 UI 查询都城归属,集中一处防漂移。 */
  capitalOwnerOf(tileIndex: number): Player | null {
    return this.players.find((p) => p.capitalIndex === tileIndex) ?? null;
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
    const isCjk = isSingleCjk(trimmed);
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
    // 摇骰定序,平局重摇。d6 只有 6 面:n<=6 重摇至无平局(有上限);
    // n>6(DEV 可达 30)不可能全异 → 接受并列、按玩家序破平,确保终止、不死循环。
    const n = this.players.length;
    const rolls = new Array(n).fill(0);
    const canBeAllDistinct = n <= 6;
    for (let attempt = 0; attempt < 50; attempt++) {
      for (let i = 0; i < n; i++) rolls[i] = this.dice.rollDie();
      if (!canBeAllDistinct || new Set(rolls).size === n) break;
    }
    this.draftRolls = rolls;
    this.draftOrder = this.players
      .map((_, i) => i)
      .sort((a, b) => rolls[b] - rolls[a] || a - b);
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
  /** 选都辅助:第一个可作都城且未被占的 tile index(无则 -1)。集中"可选都城"判定,供人类选都 UI/测试/e2e 复用。 */
  firstAvailableCapitalIndex(): number {
    const t = this.board.tiles.find((x) => x.isCapitalEligible && !this.takenCapitalIndices.has(x.index));
    return t ? t.index : -1;
  }

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
    this.treasureDeck = createTreasureDeck(); // 初始化珍宝牌堆
    this.round = 1;
    this.logEvent(
      "setup",
      null,
      "群雄起兵,首战由「" + this.activePlayer.guohao + "」先行",
      `gameStart firstPlayer=${this.activePlayer.id}`,
    );
  }

  // ──────────────────────────── 回合状态机 ────────────────────────────
  /** 抽签 → 移动 → 若路径含都城(非落点)进入驻跸抉择;否则直接落格。 */
  rollAndMove(): void {
    if (this.turnPhase !== "Roll") {
      this.warn(`RollAndMove 在非 Roll 阶段(${this.turnPhase})被调用`);
      return;
    }
    const mover = this.activePlayer;
    const roll = this.dice.roll();
    this.lastRoll = roll;
    this.fireOnAnyRoll(roll.die); // 名士·onAnyRoll:任意人掷出特定点 → 持有者获益(张星彩)
    const moveBonus = this.heroMoveBonus(mover); // 名士·moveBonus:移动步数加成(周瑜)
    const steps = roll.die + moveBonus;
    const path = this.board.computePath(
      mover.position,
      steps,
      mover.capitalIndex,
      mover.pendingBranch,
      false, // 不截断:经过都城时由 rollAndMove 触发 AwaitingCapitalHalt 抉择
    );
    const fromPos = mover.position;
    const usedBranch = mover.pendingBranch;
    this.lastMove = path;
    this.logEvent(
      "roll",
      mover.guohao,
      `${mover.guohao} 抽签 ${SIGN_FACES[roll.die - 1]}${moveBonus ? `(+${moveBonus})` : ""} → ${this.board.at(path.landIndex).name}`,
      `roll player=${mover.id} die=${roll.die} steps=${steps} bonus=${moveBonus} from=#${fromPos} land=#${path.landIndex} passedCapital=${path.passedCapital} wps=${path.waypoints.length}`,
    );

    // 经过自己的都城(起点)→ 颁发委任状,无论后续驻跸或行军。
    // 克制"运气好跑得快、一圈把城全占"——买城需要委任状,数量有限。
    // 经过自己的都城(起点)→ 颁发委任状(无论后续驻跸或行军)。
    // 克制"运气好跑得快、一圈把城全占"——买城需要委任状,数量有限。
    if (path.passedCapital) {
      mover.warrants += WARRANTS_PER_PASS;
      this.logEvent(
        "supply",
        mover.guohao,
        `${mover.guohao} 巡幸都城,获 ${WARRANTS_PER_PASS} 委任状`,
        `warrantGrant player=${mover.id} +${WARRANTS_PER_PASS} warrants=${mover.warrants}`,
      );
    }
    // 经过都城且落点不是都城 → 抉择:驻跸(补给+结束)or 继续行军到落点
    if (path.passedCapital && path.landIndex !== mover.capitalIndex) {
      this.turnPhase = "AwaitingCapitalHalt";
      this.logEvent(
        "system",
        mover.guohao,
        `${mover.guohao} 军至都城「${this.board.at(mover.capitalIndex).name}」:驻跸补给 or 继续行军至「${this.board.at(path.landIndex).name}」?`,
        `awaitingHalt player=${mover.id} capital=#${mover.capitalIndex} dest=#${path.landIndex}`,
      );
      return; // 等 haltAtCapital / continueMove
    }
    // 否则直接到落点(落点=都城 或 路径不经过都城)
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

  /** 选大路/小路:记录路线偏好(pendingBranch)并结束本回合。下回合掷骰时按此行军。
   *  小路免费(纯捷径,不再结算后果/跳 rejoin)。大路也必设 pendingBranch,
   *  否则下回合 endTurn 会因 pendingBranch==null 重入 AwaitingBranch(死循环)。 */
  selectBranch(kind: RouteKind): void {
    if (this.turnPhase !== "AwaitingBranch") {
      this.warn(`SelectBranch 在非 AwaitingBranch 阶段(${this.turnPhase})被调用`);
      return;
    }
    const p = this.activePlayer;
    p.pendingBranch = { fromNode: p.position, kind };
    this.logEvent(
      "branch",
      p.guohao,
      `${p.guohao} 于 ${this.board.at(p.position).name} 取${kind === "Shortcut" ? "小路" : "大路"}`,
      `selectBranch player=${p.id} kind=${kind} at=#${p.position} cash=${p.cash}`,
    );
    this.lastLandOutcome = { kind: "Noop" };
    this.endTurn();
  }

  buyProperty(): void {
    if (this.turnPhase !== "AwaitingDecision" || this.lastLandOutcome?.property == null) {
      this.warn("BuyProperty 在非决策阶段或无待决策地产被调用");
      return;
    }
    const def = this.lastLandOutcome.property;
    const buyer = this.activePlayer;
    // 进驻(买)新城需要委任状;不足则拒绝(NoWarrant),UI 会禁用购买按钮
    if (buyer.warrants < BUY_WARRANT_COST) {
      this.lastTransaction = { status: "NoWarrant" };
      this.endTurn();
      return;
    }
    const r = buyProp(buyer, def);
    this.lastTransaction = r;
    if (r.status === "Ok") {
      buyer.warrants -= BUY_WARRANT_COST; // 消耗委任状
      this.pushFloater(buyer, -def.purchasePrice, buyer.position, "expense");
      this.logEvent(
        "buy",
        buyer.guohao,
        `${buyer.guohao} 购「${this.tileName(def)}」(${BUY_WARRANT_COST}委任 + ${formatMoney(def.purchasePrice)})`,
        `buy player=${buyer.id} prop=${def.id} price=${def.purchasePrice} warrant-${BUY_WARRANT_COST} warrants=${buyer.warrants} cash=${buyer.cash}`,
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
    this.logEvent("system", this.activePlayer.guohao, `${this.activePlayer.guohao} 按兵不动`, `skip player=${this.activePlayer.id}`);
    this.endTurn();
  }

  private tileName(def: PropertyDef): string {
    const t = this.board.tiles.find((x) => x.propertyId === def.id);
    return t ? t.name : def.id;
  }

  // ──────────────────────────── 落格处理 ────────────────────────────
  private resolveLanding(): void {
    const mover = this.activePlayer;
    // 落点恰为自己都城:补给 + 招贤纳士
    if (mover.capitalIndex === mover.position) {
      const supply = this.applyResupply(mover);
      this.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
      this.turnPhase = "Land";
      this.tryRecruitHero(mover); // 招贤纳士:三选一(或无货→直接 endTurn)
      return;
    }
    const tile = this.board.at(mover.position);
    // 卧龙岗:招贤纳士(不可进驻)
    if (tile.type === "Wolong") {
      this.lastLandOutcome = { kind: "Noop" };
      this.turnPhase = "Land";
      this.tryRecruitHero(mover);
      return;
    }
    // 宝物城:掷双骰判定获取珍宝
    if (tile.type === "TreasureCity") {
      this.resolveTreasureCity(mover, tile);
      return;
    }
    if (tile.type !== "Property") {
      this.resolveSpecial(mover, tile);
      return;
    }
    this.resolveProperty(mover, tile);
  }

  private resolveSpecial(mover: Player, tile: TileDef): void {
    // 锦囊(Chance)/天命(Fate):随机抽事件,温和 ±100~250
    if (tile.type === "Chance" || tile.type === "Fate") {
      const pool = tile.type === "Chance" ? CHANCE_EVENTS : FATE_EVENTS;
      const ev = pool[Math.floor(this.dice.nextFloat() * pool.length)];
      let bankrupt = false;
      if (ev.cashDelta >= 0) {
        mover.cash += ev.cashDelta;
      } else {
        const r = this.payOrLiquidate(mover, null, -ev.cashDelta);
        if (r === "liquidating") return; // 进入清算,confirm 后 endTurn
        bankrupt = r === "bankrupt";
      }
      this.pushFloater(mover, ev.cashDelta, tile.index, ev.cashDelta >= 0 ? "income" : "expense");
      if (ev.cashDelta < 0) this.fireOnOtherLoseCash(mover);
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
      const r = this.payOrLiquidate(mover, null, 200);
      if (r === "liquidating") return;
      const bankrupt = r === "bankrupt";
      this.pushFloater(mover, -200, tile.index, "expense");
      this.fireOnOtherLoseCash(mover);
      this.lastLandOutcome = { kind: "TaxPaid", amount: 200, causedBankruptcy: bankrupt };
      this.logEvent("tax", mover.guohao, `${mover.guohao} 落 ${tile.name} 缴税 ${formatMoney(200)}${bankrupt ? " → 破产" : ""}`, `tax player=${mover.id} tile=#${tile.index} cash=${mover.cash}`, -200);
      this.endTurn();
      return;
    }
    // 商市(Stock):随机行情波动 ±100~200(简化版;完整买/卖/持股系统留后续)
    if (tile.type === "Stock") {
      const gain = this.dice.nextFloat() < 0.5;
      const amt = 100 + Math.floor(this.dice.nextFloat() * 100);
      const delta = gain ? amt : -amt;
      let bankrupt = false;
      if (delta >= 0) mover.cash += delta;
      else {
        const r = this.payOrLiquidate(mover, null, amt);
        if (r === "liquidating") return;
        bankrupt = r === "bankrupt";
      }
      this.pushFloater(mover, delta, tile.index, gain ? "income" : "expense");
      if (!gain) this.fireOnOtherLoseCash(mover);
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
      // 无主城(含分歧点城):一律可购买。分歧点选路改到下回合掷骰前(endTurn 触发)。
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
    // 珍宝交涉:城主有珍宝 → 赠宝/贸易;无珍宝 → 无事发生
    if (owner.treasures.length > 0) {
      this.treasureVisitor = { def, ownerIdx: this.players.indexOf(owner) };
      this.turnPhase = "AwaitingTreasureOwner";
      this.lastLandOutcome = { kind: "RentPaid", property: def, owner };
      this.logEvent(
        "rent",
        owner.guohao,
        `${mover.guohao} 落「${tile.name}」,${owner.guohao} 可赠宝/贸易(${owner.treasures.length}件珍宝)`,
        `treasureAwait owner=${owner.id} visitor=${mover.id} treasures=${owner.treasures.length}`,
      );
    } else {
      // 城主无珍宝:无事发生
      this.lastLandOutcome = { kind: "Noop" };
      this.logEvent("system", mover.guohao, `${mover.guohao} 落「${tile.name}」(${owner.guohao} 无珍宝),无事发生`, `noTreasure owner=${owner.id} visitor=${mover.id}`);
      this.endTurn();
    }
  }

  /** 都城补给 = ResupplyPerLevel × (Level+1)。 */
  private applyResupply(mover: Player): number {
    const tile = this.board.at(mover.capitalIndex);
    const def = this.catalog.get(tile.propertyId);
    const holding = findHolding(mover, def?.id ?? "");
    const lvl = holding?.level ?? 0;
    const supply = supplyFor(def?.resupplyPerLevel, lvl);
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
    // 回合计数:当回合循环回到本轮起始玩家(draftOrder 中首个存活者)→ 轮次 +1
    const leader = this.draftOrder.find((i) => !this.players[i].isBankrupt);
    if (leader !== undefined && this.activeIndex === leader) this.round += 1;
    // 离开分歧点(若上一回合设了 PendingBranch 且已移动):清空
    const p = this.activePlayer;
    if (p.pendingBranch != null && p.position !== p.pendingBranch.fromNode)
      p.pendingBranch = null;
    // 抵达分歧点起点:下回合掷骰前先选路(pendingBranch==null 表示尚未选)。
    // 已选(pendingBranch!=null,且仍站在起点)→ 直接 Roll,避免重入 AwaitingBranch 死循环。
    if (p.pendingBranch == null && this.board.getShortcut(p.position) != null) {
      this.turnPhase = "AwaitingBranch";
      this.logEvent(
        "branch",
        p.guohao,
        `${p.guohao} 至要隘 ${this.board.at(p.position).name},抉择:大路 / 小路`,
        `awaitingBranch player=${p.id} tile=#${p.position}`,
      );
    } else {
      this.turnPhase = "Roll";
    }
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

  // ──────────────────────────── 珍宝交涉(赠宝/贸易) ────────────────────────────
  /** 宝物城落格:从牌堆抽 1 件 → 掷双骰(2d6)判定 → ≥ 等级则获得。 */
  private resolveTreasureCity(mover: Player, tile: TileDef): void {
    this.lastLandOutcome = { kind: "Noop" };
    this.turnPhase = "Land";
    if (this.treasureDeck.length === 0) {
      this.logEvent("system", mover.guohao, `${mover.guohao} 至「${tile.name}」,珍宝已被搜刮一空`, `treasureEmpty player=${mover.id}`);
      this.endTurn();
      return;
    }
    // 随机抽 1 件
    const drawIdx = Math.floor(this.dice.nextFloat() * this.treasureDeck.length);
    const treasure = this.treasureDeck.splice(drawIdx, 1)[0];
    const guidePrice = guidePriceOf(treasure.level);
    // 拼点:掷双骰(2–12),roll ≥ 等级 即得宝
    const d1 = 1 + Math.floor(this.dice.nextFloat() * 6);
    const d2 = 1 + Math.floor(this.dice.nextFloat() * 6);
    const roll = d1 + d2;
    if (roll >= treasure.level) {
      // 成功:获得珍宝
      mover.treasures.push(treasure);
      this.pushFloater(mover, guidePrice, mover.position, "income");
      this.logEvent("system", mover.guohao, `${mover.guohao} 在「${tile.name}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} ≥ ${treasure.level},喜得珍宝!`, `treasureGain player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`, guidePrice);
    } else {
      // 失败:珍宝放回牌堆底
      this.treasureDeck.push(treasure);
      this.logEvent("system", mover.guohao, `${mover.guohao} 在「${tile.name}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} < ${treasure.level},失之交臂`, `treasureMiss player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`);
    }
    this.endTurn();
  }

  /** 城主抉择:赠宝(送出珍宝+城升级+朝廷赏银)或 贸易(卖珍宝给访客,不可拒绝)。 */
  resolveTreasureOwner(action: { type: "gift"; treasureId: string } | { type: "trade"; treasureId: string } | { type: "skip" }): void {
    if (this.turnPhase !== "AwaitingTreasureOwner") { this.warn("ResolveTreasureOwner 在非 AwaitingTreasureOwner 阶段被调用"); return; }
    const tv = this.treasureVisitor!;
    const owner = this.players[tv.ownerIdx];
    const mover = this.activePlayer;
    const def = tv.def;

    if (action.type === "skip") {
      this.logEvent("system", owner.guohao, `${owner.guohao} 不赠不卖`, `treasureSkip owner=${owner.id}`);
      this.treasureVisitor = null;
      this.endTurn();
      return;
    }

    const tIdx = owner.treasures.findIndex((t) => t.id === action.treasureId);
    if (tIdx < 0) { this.warn(`珍宝 ${action.treasureId} 不在手中`); return; }
    const treasure = owner.treasures.splice(tIdx, 1)[0];
    const guidePrice = guidePriceOf(treasure.level);
    const holding = findHolding(owner, def.id);
    const cityLevel = holding?.level ?? 0;
    const levelMult = CITY_LEVEL_MULTIPLIER[cityLevel] ?? 1;

    if (action.type === "gift") {
      // 赠宝:访客得宝,城升级,朝廷赏银(银行注入 = 指导价)
      mover.treasures.push(treasure);
      if (holding && holding.level < def.maxLevel) holding.level += 1;
      owner.cash += guidePrice; // 朝廷赏银(银行注入)
      this.pushFloater(owner, guidePrice, owner.position, "income");
      this.lastLandOutcome = { kind: "RentPaid", property: def, owner, amount: guidePrice };
      this.logEvent("rent", owner.guohao, `${owner.guohao} 赠「${treasure.name}」给 ${mover.guohao},城升至 Lv.${holding?.level},朝廷赏 ${formatMoney(guidePrice)}`, `treasureGift owner=${owner.id} visitor=${mover.id} treasure=${treasure.id} level=${treasure.level} reward=${guidePrice} newCityLevel=${holding?.level}`, guidePrice);
    } else {
      // 贸易:访客付钱得宝(不可拒绝)。售价 = 指导价 × 贸易公式 × 等级倍率
      const price = tradePriceOf(guidePrice, def.trade, levelMult); // 贸易售价(集中公式,必高于指导价)
      mover.treasures.push(treasure);
      const r = this.payOrLiquidate(mover, owner, price);
      if (r === "liquidating") return; // 清算自救;访客已得宝,凑不够破产时珍宝经 settleDebt 转回城主
      const bankrupt = r === "bankrupt";
      this.pushFloater(mover, -price, mover.position, "expense");
      this.pushFloater(owner, price, mover.position, "income");
      if (price > 0) this.fireOnOtherLoseCash(mover);
      this.lastLandOutcome = { kind: "RentPaid", property: def, owner, amount: price, causedBankruptcy: bankrupt };
      this.logEvent("rent", owner.guohao, `${owner.guohao} 卖「${treasure.name}」给 ${mover.guohao},售价 ${formatMoney(price)}${bankrupt ? " → 破产" : ""}`, `treasureTrade owner=${owner.id} visitor=${mover.id} treasure=${treasure.id} level=${treasure.level} price=${price} bankrupt=${bankrupt}`, -price);
    }
    this.treasureVisitor = null;
    this.endTurn();
  }

  // ──────────────────────────── 破产清算(变卖资产自救) ────────────────────────────
  /** 付款或触发清算:现金够→扣款("ok");不够但有可变卖资产→AwaitingBankruptcySettle("liquidating");无资产→破产("bankrupt")。 */
  private payOrLiquidate(mover: Player, creditor: Player | null, amount: number): "ok" | "liquidating" | "bankrupt" {
    if (mover.cash >= amount) {
      mover.cash -= amount;
      if (creditor) creditor.cash += amount;
      return "ok";
    }
    if (this.hasMarketableAssets(mover)) {
      this.pendingDebt = { amount, creditor };
      this.turnPhase = "AwaitingBankruptcySettle";
      this.logEvent("system", mover.guohao, `${mover.guohao} 现金不足,变卖资产自救(欠 ${formatMoney(amount - mover.cash)})`, `awaitingBankruptcy player=${mover.id} debt=${amount} cash=${mover.cash}`);
      return "liquidating";
    }
    settleDebt(mover, creditor, amount);
    this.finalizeBankruptcy(mover);
    return "bankrupt";
  }

  private hasMarketableAssets(p: Player): boolean {
    if (p.treasures.length > 0 || p.heroes.length > 0) return true;
    const capProp = this.board.at(p.capitalIndex)?.propertyId;
    return p.properties.some((h) => h.propertyId !== capProp);
  }

  /** 破产善后:名士释放回招贤池(treasures 已由 settleDebt 转债主)。 */
  private finalizeBankruptcy(p: Player): void {
    for (const h of p.heroes) this.recruitedHeroIds.delete(h.id);
    p.heroes = [];
  }

  sellTreasureBankruptcy(treasureId: string): void {
    if (this.turnPhase !== "AwaitingBankruptcySettle") { this.warn("SellTreasureBankruptcy 在非清算阶段被调用"); return; }
    const p = this.activePlayer;
    const idx = p.treasures.findIndex((t) => t.id === treasureId);
    if (idx < 0) { this.warn(`珍宝 ${treasureId} 不在手中`); return; }
    const t = p.treasures.splice(idx, 1)[0];
    const gain = guidePriceOf(t.level);
    p.cash += gain;
    this.pushFloater(p, gain, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 变卖「${t.name}」得 ${formatMoney(gain)}`, `bkSellTreasure player=${p.id} treasure=${t.id} +${gain}`, gain);
  }

  sellPropertyBankruptcy(propId: string): void {
    if (this.turnPhase !== "AwaitingBankruptcySettle") { this.warn("SellPropertyBankruptcy 在非清算阶段被调用"); return; }
    const p = this.activePlayer;
    if (propId === this.board.at(p.capitalIndex)?.propertyId) { this.warn("都城不可变卖"); return; }
    const idx = p.properties.findIndex((h) => h.propertyId === propId);
    if (idx < 0) { this.warn(`城 ${propId} 不在手中`); return; }
    const h = p.properties.splice(idx, 1)[0];
    p.cash += h.purchasePrice;
    this.pushFloater(p, h.purchasePrice, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 变卖城池得 ${formatMoney(h.purchasePrice)}`, `bkSellProp player=${p.id} prop=${propId} +${h.purchasePrice}`, h.purchasePrice);
  }

  cashHeroBankruptcy(heroId: string): void {
    if (this.turnPhase !== "AwaitingBankruptcySettle") { this.warn("CashHeroBankruptcy 在非清算阶段被调用"); return; }
    const p = this.activePlayer;
    const idx = p.heroes.findIndex((h) => h.id === heroId);
    if (idx < 0) { this.warn(`名士 ${heroId} 不在手中`); return; }
    const h = p.heroes.splice(idx, 1)[0];
    this.recruitedHeroIds.delete(heroId);
    p.cash += 200; // 名士换银(2两)
    this.pushFloater(p, 200, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 遣散「${h.name}」得 ${formatMoney(200)}`, `bkCashHero player=${p.id} hero=${heroId} +200`, 200);
  }

  confirmBankruptcySettle(): void {
    if (this.turnPhase !== "AwaitingBankruptcySettle") { this.warn("ConfirmBankruptcySettle 在非清算阶段被调用"); return; }
    const p = this.activePlayer;
    const debt = this.pendingDebt!;
    this.pendingDebt = null;
    if (this.treasureVisitor) this.treasureVisitor = null;
    if (p.cash >= debt.amount) {
      p.cash -= debt.amount;
      if (debt.creditor) debt.creditor.cash += debt.amount;
      this.logEvent("system", p.guohao, `${p.guohao} 清偿债务 ${formatMoney(debt.amount)},转危为安`, `bkConfirm player=${p.id} paid=${debt.amount}`);
    } else {
      settleDebt(p, debt.creditor, debt.amount);
      this.finalizeBankruptcy(p);
      this.logEvent("system", p.guohao, `${p.guohao} 变卖殆尽仍不足,破产出局`, `bkBankrupt player=${p.id} debt=${debt.amount}`);
    }
    this.turnPhase = "Land";
    this.endTurn();
  }

  // ──────────────────────────── 命令接口(联机预留) ────────────────────────────
  // 所有玩家操作通过 submitCommand 统一入口提交;state.ts(热座)和将来的
  // network-client.ts(联机)都调用这一个方法。联机时服务器的消息处理器只需:
  //   socket.on("command", cmd => engine.submitCommand(cmd))
  submitCommand(cmd: GameCommand): void {
    switch (cmd.type) {
      case "rollAndMove": return this.rollAndMove();
      case "haltAtCapital": return this.haltAtCapital();
      case "continueMove": return this.continueMove();
      case "selectBranch": return this.selectBranch(cmd.kind);
      case "buyProperty": return this.buyProperty();
      case "upgradeProperty": return this.upgradeProperty();
      case "endDecision": return this.endDecision();
      case "resolveHeroPick": return this.resolveHeroPick(cmd.index);
      case "resolveTreasureOwner": {
        const a = cmd.action;
        if (a.type === "skip") this.resolveTreasureOwner({ type: "skip" });
        else if (a.treasureId) this.resolveTreasureOwner({ type: a.type as "gift" | "trade", treasureId: a.treasureId });
        return;
      }
      case "sellTreasureBankruptcy": return this.sellTreasureBankruptcy(cmd.treasureId);
      case "sellPropertyBankruptcy": return this.sellPropertyBankruptcy(cmd.propId);
      case "cashHeroBankruptcy": return this.cashHeroBankruptcy(cmd.heroId);
      case "confirmBankruptcySettle": return this.confirmBankruptcySettle();
    }
  }

  // ──────────────────────────── 名士(英雄)系统 ────────────────────────────
  // 框架:数据驱动的被动/触发技能。新增 skill kind 时:① types.HeroSkill 加变体;
  // ② 被动类在对应查询(heroMoveBonus)加分支;触发类在对应 fire 方法加分支。

  /** 被动·移动加成:查询型(移动前计入)。周瑜等。 */
  private heroMoveBonus(player: Player): number {
    let bonus = 0;
    for (const h of player.heroes) {
      if (h.skill.kind === "moveBonus") bonus += h.skill.steps;
    }
    return bonus;
  }

  /** 冷却判定:未设 cooldown → 恒可用;否则距上次触发 ≥ cooldown 轮才可用。 */
  private isHeroReady(player: Player, hero: HeroDef): boolean {
    if (!hero.cooldown) return true;
    const last = player.heroLastFired[hero.id] ?? -Infinity;
    return this.round - last >= hero.cooldown;
  }

  /** 触发型技能生效:加银 + 浮动 + 战报 + 记冷却。 */
  private grantHeroGain(player: Player, hero: HeroDef, gain: number, reason: string): void {
    player.cash += gain;
    player.heroLastFired[hero.id] = this.round;
    this.pushFloater(player, gain, player.position, "income");
    this.logEvent(
      "supply",
      player.guohao,
      `${player.guohao} 名士「${hero.name}」:${reason} +${formatMoney(gain)}`,
      `heroGain player=${player.id} hero=${hero.id} reason=${reason} +${gain} cash=${player.cash}`,
      gain,
    );
  }

  /** 触发·onAnyRoll:每次任意玩家掷骰后调用,匹配 face 的名士生效(张星彩)。 */
  private fireOnAnyRoll(die: number): void {
    for (const p of this.players) {
      if (p.isBankrupt) continue;
      for (const h of p.heroes) {
        if (h.skill.kind === "onAnyRoll" && die === h.skill.face && this.isHeroReady(p, h)) {
          this.grantHeroGain(p, h, h.skill.gain, `掷出${die}`);
        }
      }
    }
  }

  /** 触发·onOtherLoseCash:某玩家被动失财后调用,其余持有者生效(曹丕)。 */
  private fireOnOtherLoseCash(loser: Player): void {
    for (const p of this.players) {
      if (p === loser || p.isBankrupt) continue;
      for (const h of p.heroes) {
        if (h.skill.kind === "onOtherLoseCash" && this.isHeroReady(p, h)) {
          this.grantHeroGain(p, h, h.skill.gain, `他人失财`);
        }
      }
    }
  }

  /** 招揽名士:从剩余(未被招揽)池中随机抽一位;满额或无货则跳过。 */
  /** 招贤纳士:从剩余名士池随机抽 3 张(三选一)。满额/无货→直接 endTurn。 */
  private tryRecruitHero(mover: Player): void {
    if (mover.heroes.length >= HERO_CAPACITY) { this.endTurn(); return; }
    const available = HEROES.filter((h) => !this.recruitedHeroIds.has(h.id));
    if (available.length === 0) { this.endTurn(); return; }
    const shuffled = [...available].sort(() => this.dice.nextFloat() - 0.5);
    this.offeredHeroes = shuffled.slice(0, Math.min(3, shuffled.length));
    this.turnPhase = "AwaitingHeroPick";
    this.logEvent(
      "setup",
      mover.guohao,
      `${mover.guohao} 招贤纳士:三选一`,
      `offerHeroes player=${mover.id} count=${this.offeredHeroes.length}`,
    );
  }

  /** 玩家从招贤纳士候选中选一位(或跳过)。公开(供 UI/bot 调用)。 */
  resolveHeroPick(index: number): void {
    if (this.turnPhase !== "AwaitingHeroPick") {
      this.warn(`ResolveHeroPick 在非 AwaitingHeroPick 阶段被调用`);
      return;
    }
    const hero = this.offeredHeroes[index];
    if (hero) {
      this.activePlayer.heroes.push(hero);
      this.recruitedHeroIds.add(hero.id);
      this.logEvent(
        "setup",
        this.activePlayer.guohao,
        `${this.activePlayer.guohao} 招贤纳士,得「${hero.name}」:${hero.desc}`,
        `pickHero player=${this.activePlayer.id} hero=${hero.id}`,
      );
    }
    this.offeredHeroes = [];
    this.endTurn();
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
    return serializeGame(this);
  }
}

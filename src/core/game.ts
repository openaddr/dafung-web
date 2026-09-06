// 游戏引擎:开局三段式(国号→点将定序→选都)+ 回合状态机 + 胜负判定 + 战报日志。
import type { Board } from "./board";
import type { BranchCell } from "./board";
import type { Dice } from "./dice";
import type {
  AiDifficulty,
  HeroDef,
  GameCommand,
  LandOutcome,
  LogEvent,
  MovePath,
  PendingLand,
  Player,
  PropertyDef,
  RouteKind,
  TileDef,
  TransactionResult,
  TriggerSkill,
  TurnPhase,
  VictoryReason,
} from "./types";
import type { GameMoment, MomentCtx } from "./timing";
import { computeChoices, ENCOUNTER_HERO_TREASURE_COST, type ChoiceOption } from "./choices";
import { EFFECTS, type EffectCtx } from "./effects";
import { netWorth } from "./networth";
import { findHolding } from "./player";
import { buy as buyProp, sellValueOf, settleDebt, supplyFor, upgrade as upgradeProp } from "./economy";
import { serializeGame, restoreGameSnapshot, type GameSnapshot } from "./snapshot";
import type { MapCatalog } from "./board-loader";
import { GUOHAO_POOL } from "./theme";
import { CHANCE_EVENTS } from "./events";
import {
  ENCOUNTERS,
  resolveEncounterConfig,
  pickTier,
  pickWeighted,
  tierShares,
  type EncounterChoiceOption,
  type EncounterConfig,
  type EncounterDef,
  type EncounterEffect,
  type EncounterRuntimeConfig,
} from "./encounters";
import { formatMoney } from "./money";
import { SIGN_FACES, isSingleCjk, STARTING_WARRANTS, WARRANTS_PER_PASS, BUY_WARRANT_COST, HERO_CAPACITY } from "./constants";
import { HEROES } from "./heroes";
import { createTreasureDeck, guidePriceOf, premiumPriceOf } from "./treasures";
import type { DiceRoll, TreasureDef } from "./types";
import { canUpgrade } from "./types";

type Catalog = MapCatalog;

export interface SeatConfig {
  name: string;
  isBot: boolean;
  guohao?: string; // 人类可预设;留空则在 Guohao 阶段填
  reputation?: number; // 初始声望口子(#120:预留,MVP 不接 UI,缺省 0)
}

export interface EngineConfig {
  seats: SeatConfig[];
  targetNetWorth?: number; // 默认 30000
  startingCash?: number; // 默认 10000
  difficulty?: AiDifficulty; // 默认 Normal
  seed?: number; // 注入骰子种子,便于确定性测试(?seed= URL 参数)
  /** 地图 id(ADR-0014 对局日志局头重放要素;编辑器试玩等非清单地图缺省为空串,重放脚本对空 id 显式报错) */
  mapId?: string;
  /** 机遇系统(#123):缺省=关闭(产品默认 40% 在配置文件/设置屏,经此传入) */
  encounter?: EncounterConfig;
}

export type EnginePhase = "Setup" | "Playing" | "GameOver";
export type SetupPhase = "Guohao" | "PickCapital" | "Done";

const DEFAULT_TARGET = 30000;
const DEFAULT_CASH = 10000;

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 对局 id(ADR-0014):毫秒时间戳 + 随机后缀的简版 uuid,作 logs/<gameId>.jsonl 文件名
 *  与 IndexedDB key。不走引擎 rng(不影响确定性,不随快照漂移)。 */
function newGameId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 命令 → 中文动词(cmd 行 brief 用;机读 detail 为完整命令 JSON)。 */
const CMD_BRIEF: Record<GameCommand["type"], string> = {
  rollAndMove: "行军",
  selectBranch: "择路",
  buyProperty: "购地",
  upgradeProperty: "扩军",
  endDecision: "按兵不动",
  resolveHeroPick: "招贤",
  resolveEncounterChoice: "机遇抉择",
  resolveExhaustionChoice: "体力抉择",
  resolveTreasureOwner: "珍宝交涉",
  sellTreasureBankruptcy: "变卖珍宝",
  sellPropertyBankruptcy: "变卖城池",
  cashHeroBankruptcy: "遣散名将",
  confirmBankruptcySettle: "清算确认",
};

/** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家);表现态 floaters 的行类型,
 *  经 engine.presentation.drainFloaters() 消费(破坏性读)。
 *  kind="msg" 为无金额的文案浮字(text 必填,amount 恒 0):ADR-0013 唯一选项自动执行的
 *  轻提示(「银两不足,未能购城」等),1.3s 自消,不打断节奏。 */
export type FloaterEvent =
  | {
      playerIndex: number;
      amount: number;
      atTile?: number;
      kind: "income" | "expense" | "supply";
    }
  | {
      playerIndex: number;
      amount: 0;
      atTile?: number;
      kind: "msg";
      text: string;
    };

/** 城池变更留痕(ADR-0015 宣告动效):buy/upgrade/公道升级成交与破产资产转移的
 *  结算点写入,表现提取器经 engine.presentation.drainPropertyChanges() 一次性取走
 *  (破坏性读,同 drainFloaters 口径)。为什么留痕而不读 lastTransaction:endTurn
 *  随决策载荷清理将其置 null,提取发生在命令完成之后,读到的恒为 null——留痕在
 *  结算点写入,与时序无关。levelChanged/ownerChanged 标明变更维度(扩军 → 印章
 *  重钤 + 楼生长;易主 → 流光),携带的是变更后的完整归属态。 */
export interface PropertyChangeTrace {
  tileIndex: number;
  /** 变更后等级。 */
  level: number;
  /** 变更后归属座位色(null=回无主)。 */
  ownerColorIndex: number | null;
  levelChanged: boolean;
  ownerChanged: boolean;
}

export class GameEngine {
  readonly board: Board;
  readonly catalog: Catalog;
  readonly dice: Dice;
  readonly players: Player[];
  readonly targetNetWorth: number;
  readonly startingCash: number;
  readonly difficulty: AiDifficulty;
  /** 地图 id(ADR-0014 局头要素;来自 EngineConfig,空串=非清单地图如编辑器试玩)。 */
  readonly mapId: string;
  /** 初始骰子种子(构造时的 rng 状态 = 有效种子,无论显式注入还是随机生成);
   *  写入局头行,重放据此 createDice 精确复现。 */
  readonly seed: number;
  /** 对局 id(ADR-0014):构造时生成,随快照序列化/恢复(联机各端一致);
   *  logs/<gameId>.jsonl 文件名与 IndexedDB key。非 readonly 仅为 restoreFromSnapshot 可写。 */
  gameId: string;

  phase: EnginePhase = "Setup";
  setupPhase: SetupPhase = "Guohao";
  turnPhase: TurnPhase = "Roll";
  turnNumber = 0;
  round = 1; // 回合计数:所有人各行动一次 = 1 轮(供名将技能冷却等使用)
  // public:供 snapshot/联机序列化(轮次锚点需跨进程恢复,否则恢复后 round 计数会漂移)。
  roundAnchor = 0; // 固定的轮次锚点(draftOrder[0]),不随破产漂移
  // public:供 snapshot/联机序列化(同 takenCapitalIndices 模式)。内部代码读 Set,不直接改字段。
  recruitedHeroIds = new Set<string>(); // 已被招揽的名将(唯一)
  pendingExhaustionSeat: number | null = null; // 耗竭决策座位(#130;恢复时按 activeIndex 重派生)
  offeredHeroes: HeroDef[] = []; // 当前招贤纳士的候选(三选一)
  treasureDeck: TreasureDef[] = []; // 珍宝牌堆(剩余可抽)
  private encounter: EncounterRuntimeConfig = resolveEncounterConfig(); // 缺省=关闭
  treasureVisitor: { def: PropertyDef; ownerIdx: number } | null = null; // 公道买卖/坐地起价:当前城主视角
  pendingDebt: { amount: number; creditor: Player | null } | null = null; // 破产清算:待清偿债务(凑够自救,凑不够破产)
  // 珍宝交涉交割托管:成交后买家付清价款前,珍宝暂存于此(序列化友好纯数据;买家不可变卖托管物抵债)。
  escrowTreasure: { treasure: TreasureDef; buyerIdx: number; sellerIdx: number; price: number } | null = null;

  activeIndex = 0; // public:供 snapshot/联机序列化(内部由 advanceToNextActive 维护,外部只读)
  draftOrder: number[] = []; // public:同上
  draftRolls: number[] = []; // public:同上
  // public:供 snapshot/联机序列化(选都进度需跨进程恢复,否则恢复后无法继续选都)。
  currentDraftIndex = 0;
  takenCapitalIndices = new Set<number>(); // public:同上
  // 三选一选都(public:供 snapshot/联机序列化):当前选都玩家的 3 候选城(轮到时生成、选定/轮空后滚换);
  // offeredCapitalHistory = 曾进过任何候选集的城(尽量不复用,保证跨玩家候选不重复;剩余不足时退化放行)。
  offeredCapitals: number[] = [];
  offeredCapitalHistory = new Set<number>();
  // public:供 snapshot/联机序列化(已选国号集合,联机重建 Setup 用)。
  usedGuohao = new Set<string>();

  isOver = false;
  winner: Player | null = null;
  winReason: VictoryReason = "None";

  // ─── 表现态(Wave3 候选4 收口;spec #107 C2 决策载荷分离)───
  // 四个字段(私有)语义曾散在注释里:floaters 读即破坏(渲染消费后清空)、
  // lastMove 表现侧可写(applyPresentationMove)、lastRoll/lastTransaction 每帧重建。
  // 现统一经 presentation 视图对外(见 getter),字段本身不再 public:
  //  - 读:engine.presentation.lastRoll / lastMove / lastTransaction(只读);
  //  - 浮字消费:engine.presentation.drainFloaters()(破坏性读,调用即清空);
  //  - 表现写 lastMove 的唯一通道仍是 applyPresentationMove(保留原位)。
  // 视图是方法的集合(非可序列化数据),不进 snapshot;序列化走 snapshot.ts 经视图读。
  private lastRoll: DiceRoll | null = null;
  private lastMove: MovePath | null = null;
  // 纯表现态(spec #107 C2 退役:不再兼任决策载荷):供快照扁平字段(lastLandOutcomeKind/
  // lastLandOutcomeProperty)与战报金额;决策命令/选项集/恢复重建一律改走 pendingLand。
  lastLandOutcome: LandOutcome | null = null;
  private lastTransaction: TransactionResult | null = null;

  /** 待决策落格载荷(spec #107 C2):决策上下文的唯一出处。resolveLanding 落在无主可购/
   *  己城可扩格时置值;决策命令(buyProperty/upgradeProperty/endDecision)消费;
   *  决策完成(endTurn)清除。快照按 pendingLand 自身字段单点序列化/重建,
   *  restore 后决策上下文不再依赖表现态字段。 */
  pendingLand: PendingLand | null = null;

  /** 待抉择机遇载荷(#124):抽中 choices 型机遇时置值(目录定义引用,不可变),
   *  AwaitingEncounter 相位的决策上下文唯一出处;选项集计算(choices.ts)与
   *  resolveEncounterChoice 消费,resolve/endTurn 清除。快照不单列序列化:机遇 id/文段
   *  随派生 choices(选项携带 encounterId/encounterText)过网,restoreFromSnapshot 按
   *  id 回链目录重建——与 pendingLand 的「id 句柄 + 目录现查」同一模式。 */
  pendingEncounter: EncounterDef | null = null;

  log: LogEvent[] = [];
  /** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家),渲染层消费后清空。 */
  private floaters: FloaterEvent[] = [];
  /** 城池变更留痕(ADR-0015,类型注释见 PropertyChangeTrace):结算点写入,
   *  提取器一次性取走;瞬态不序列化(同 floaters,restore 即清)。 */
  private propertyChanges: PropertyChangeTrace[] = [];

  /** 表现态只读视图:四个表现字段的唯一合法读口(字段已私有)。
   *  drainFloaters / drainPropertyChanges 是破坏性读——取走全部并清空,消费方
   *  (表现编排器)应一次取尽。 */
  get presentation(): {
    readonly lastRoll: DiceRoll | null;
    readonly lastMove: MovePath | null;
    readonly lastTransaction: TransactionResult | null;
    /** 破坏性读:返回并清空全部待播浮字。 */
    drainFloaters(): FloaterEvent[];
    /** 破坏性读:返回并清空全部城池变更留痕(ADR-0015)。 */
    drainPropertyChanges(): PropertyChangeTrace[];
  } {
    return {
      lastRoll: this.lastRoll,
      lastMove: this.lastMove,
      lastTransaction: this.lastTransaction,
      drainFloaters: () => {
        const f = this.floaters;
        this.floaters = [];
        return f;
      },
      drainPropertyChanges: () => {
        const c = this.propertyChanges;
        this.propertyChanges = [];
        return c;
      },
    };
  }

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
    this.mapId = config.mapId ?? "";
    this.encounter = resolveEncounterConfig(config.encounter);
    this.seed = this.dice.getRngState(); // mulberry32 未滚前 getState = 种子本身
    this.gameId = newGameId();
    if (config.seats.length < 2 || config.seats.length > 8)
      throw new Error("支持 2–8 个座位。");
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
      onBranch: null,
      skipTurns: 0,
      properties: [],
      heroes: [],
      treasures: [],
      heroLastFired: {},
      reputation: s.reputation ?? 0,
      stamina: 100,
    }));
    // 人类已填的国号加入 usedGuohao,防止 bot 分配时抽到重复国号(两个魏国 bug)
    for (const p of this.players) {
      if (p.guohao) this.usedGuohao.add(p.guohao);
    }
    // 局头行(ADR-0014):日志首行,记全重放要素。座位表记「构造时的原始规格」
    // (bot 国号可空=由 doDraftRoll 分配)——重放必须复刻同一规格,否则 doDraftRoll
    // 的国号洗牌消耗的 rng 次数不同,整局骰流漂移。终局国号见下一行「点将定序」。
    this.logEvent(
      "header",
      null,
      `对局开启:${this.players.length} 座,起手 ${formatMoney(this.startingCash)},目标身价 ${formatMoney(this.targetNetWorth)}`,
      JSON.stringify({
        type: "header",
        gameId: this.gameId,
        mapId: this.mapId,
        seed: this.seed,
        difficulty: this.difficulty,
        targetNetWorth: this.targetNetWorth,
        startingCash: this.startingCash,
        startedAt: Date.now(),
        seats: config.seats.map((s, i) => ({ seat: i, guohao: s.guohao ?? "", isBot: s.isBot, colorIndex: i })),
      }),
    );
    this.logEvent("system", null, "开局:群雄逐鹿", `目标身价 ${formatMoney(this.targetNetWorth)} 起手 ${formatMoney(this.startingCash)}`);
  }

  // ──────────────────────────── 基础查询 ────────────────────────────
  get activePlayer(): Player {
    return this.players[this.activeIndex];
  }
  /** 当前决策归属哪个座位:大部分相位 = activeIndex;
   *  AwaitingTreasureOwner(珍宝交涉)= 城主(treasureVisitor.ownerIdx,可能 ≠ 访客)。
   *  收口此查询,避免各驱动方(network-client / room / engine-helpers / state)各自手抄推导。 */
  get decisionOwner(): number {
    return this.turnPhase === "AwaitingTreasureOwner"
      ? this.treasureVisitor?.ownerIdx ?? this.activeIndex
      : this.activeIndex;
  }
  /** 当前决策相位的选项集(ADR-0013 choice-set 注册表,snapshot.choices 透出供 UI/调试)。
   *  纯派生数据:由相位 + 玩家状态实时计算,不新增序列化状态;未注册相位(Roll/Land/…)返回空数组。 */
  choicesFor(): ChoiceOption[] {
    return computeChoices(this, this.turnPhase);
  }
  findOwner(propertyId: string): Player | null {
    return this.players.find((p) => findHolding(p, propertyId) != null) ?? null;
  }
  /** 选 tileIndex 为都城的玩家(无则 null)。供 UI 查询都城归属,集中一处防漂移。 */
  capitalOwnerOf(tileIndex: number): Player | null {
    return this.players.find((p) => p.capitalIndex === tileIndex) ?? null;
  }
  /** 当前活跃玩家所在主路 tile 是否为辅路起点(供 UI 决定是否弹辅路抉择)。
   *  onBranch={step:-1}(入口待入)不算:已抉择过,不再重复弹。 */
  currentTileIsBranchStart(): boolean {
    return this.activePlayer.onBranch == null && this.board.getBranchStart(this.activePlayer.position);
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
    this.rollOfferedCapitals(); // 为首位选都玩家生成三候选
  }

  /** 当前选都玩家(bots 自动)。返回是否已完成本轮选都(需 UI 再次驱动)。 */
  aiSetupStep(): boolean {
    if (this.setupPhase !== "PickCapital") return false;
    const idx = this.currentSetupPlayerIndex;
    if (idx < 0) return false;
    if (!this.players[idx].isBot) return false;
    return this.aiSetupStepFor(idx);
  }

  /** 服务器代选(L41 联机):为指定座位按 bot 同评分选都,不校验 isBot——
   *  驱动资格(bot 座位 / takeover / 自助托管)由调用方(room.seatControlled)保证,
   *  单机侧真人选都不经此口(UI 手选,aiSetupStep 的 isBot 守卫保护热座)。 */
  aiSetupStepFor(idx: number): boolean {
    if (this.setupPhase !== "PickCapital") return false;
    if (idx < 0) return false;
    const tileIdx = this.aiChooseCapital();
    if (tileIdx >= 0) {
      const r = this.pickCapitalInternal(idx, tileIdx, false);
      if (!r.ok) {
        // 极端地图(buildCost 全 > 现金):pickCapital 失败,推进 draft 防死循环
        this.warn(`AI 选都失败(${r.reason ?? "未知"}),跳过`);
        this.skipCurrentDraftPick();
      }
    } else {
      // 无候选可选(剩余城耗尽):推进 draft 防死循环
      this.warn("AI 无可选都城,跳过");
      this.skipCurrentDraftPick();
    }
    return true;
  }

  /** AI 选都评分:性价比 + 随机扰动,在三候选中取最高分。 */
  private aiChooseCapital(): number {
    const candidates = this.offeredCapitals.map((i) => this.board.at(i));
    if (candidates.length === 0) return -1;
    const score = (t: TileDef): number => {
      const def = this.catalog.get(t.propertyId);
      if (!def) return -Infinity;
      let value = (def.resupplyPerLevel * 8.0) / def.buildCost; // 都城价值=补给性价比(本作不收租,看 resupplyPerLevel)
      value +=
        this.difficulty === "Simple"
          ? this.dice.nextFloat() * 2.0
          : this.dice.nextFloat() * 0.3;
      return value;
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0].index;
  }

  /** 选都辅助:当前三候选首城(无则 -1)。集中"可选都城"判定,供人类选都 UI/测试/e2e 复用。 */
  firstAvailableCapitalIndex(): number {
    return this.offeredCapitals[0] ?? -1;
  }

  /** 公共选都入口:人类落子(单机 UI / 联机 WS)走这里——记 cmd 行(ADR-0014 命令流,
   *  重放的机读层;选都不是 GameCommand,detail 用 {type:"pickCapital",seat,tileIndex})。
   *  bot/接管/托管的代选走 pickCapitalInternal(logCmd=false):确定性,重放自动重算,不记 cmd 行。 */
  pickCapital(playerIndex: number, tileIndex: number): { ok: boolean; reason?: string } {
    return this.pickCapitalInternal(playerIndex, tileIndex, true);
  }

  private pickCapitalInternal(playerIndex: number, tileIndex: number, logCmd: boolean): { ok: boolean; reason?: string } {
    if (this.setupPhase !== "PickCapital")
      return { ok: false, reason: "非选都阶段" };
    if (this.draftOrder[this.currentDraftIndex] !== playerIndex)
      return { ok: false, reason: "未轮到该玩家" };
    const tile = this.board.at(tileIndex);
    if (!tile.isCapitalEligible) return { ok: false, reason: "该城不可作都城" };
    if (this.takenCapitalIndices.has(tileIndex))
      return { ok: false, reason: "该城已被选" };
    if (!this.offeredCapitals.includes(tileIndex))
      return { ok: false, reason: "非本轮候选城" };
    const def = this.catalog.get(tile.propertyId);
    if (!def) return { ok: false, reason: "无地产定义" };
    const player = this.players[playerIndex];
    if (player.cash < def.buildCost) return { ok: false, reason: "建城费不足" };

    if (logCmd) {
      this.logEvent(
        "cmd",
        player.guohao,
        `${player.guohao} 提交命令:选都`,
        JSON.stringify({ type: "pickCapital", seat: playerIndex, tileIndex }),
      );
    }
    player.cash -= def.buildCost;
    player.properties.push({
      propertyId: def.id,
      group: def.group,
      purchasePrice: def.buildCost,
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
    if (this.currentDraftIndex >= this.players.length) {
      this.dispatchMoment("SetupComplete", { subject: playerIndex }); // 时机·SetupComplete:最后一位选都落子成功、finishSetup 收尾前
      this.finishSetup();
    } else this.rollOfferedCapitals(); // 为下一位选都玩家滚换三候选
    return { ok: true };
  }

  /** 选都轮空推进(极端地图 pickCapital 失败 / 无候选时跳过):进下一 draft 位或收尾。 */
  private skipCurrentDraftPick(): void {
    this.currentDraftIndex++;
    if (this.currentDraftIndex >= this.players.length) this.finishSetup();
    else this.rollOfferedCapitals();
  }

  /** 三选一候选生成:剩余可选城(未选都、未进过任何候选集)按建价分低/中/高三档,
   *  每档各取一城(廉价/中档/高价拉开经济路线);档内地理分布用最远点采样——
   *  首城档内随机,后两城取「与已选候选的最小欧氏距离」最大者前 3 名中随机(避免确定性感)。
   *  退化:候选不足 3 时档位合并跨档补;剩余(排除历史候选)不足 3 时放行复用未中选的历史候选
   *  (小地图如 zhongyuan 8 城仍可完成全员选都);剩余为 0 时候选为空(沿用 pickCapital 失败推进路径)。
   *  全程用引擎骰子(rngState 随快照序列化),联机各端/恢复天然一致。 */
  private rollOfferedCapitals(): void {
    const eligible = this.board.tiles.filter(
      (t) => t.isCapitalEligible && !this.takenCapitalIndices.has(t.index),
    );
    const fresh = eligible.filter((t) => !this.offeredCapitalHistory.has(t.index));
    const pool = fresh.length >= 3 ? fresh : eligible;
    const priced = pool
      .map((t) => ({ tile: t, cost: this.catalog.get(t.propertyId)!.buildCost }))
      .sort((a, b) => a.cost - b.cost);
    const tiers: { tile: TileDef; cost: number }[][] = [[], [], []];
    priced.forEach((x, i) => tiers[Math.min(2, Math.floor((i * 3) / Math.max(1, priced.length)))].push(x));
    const dist2 = (a: TileDef, b: TileDef): number => {
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      return dx * dx + dy * dy;
    };
    const chosen: TileDef[] = [];
    for (let k = 0; k < 3; k++) {
      // 本档取过/空档时跨档补齐:从全部未入候选的剩余城中继续选
      const rest = tiers[k].filter((x) => !chosen.includes(x.tile));
      const src = rest.length > 0 ? rest : priced.filter((x) => !chosen.includes(x.tile));
      if (src.length === 0) break;
      if (chosen.length === 0) {
        chosen.push(src[Math.floor(this.dice.nextFloat() * src.length)].tile);
      } else {
        const ranked = src
          .map((x) => ({ x, d: Math.min(...chosen.map((c) => dist2(c, x.tile))) }))
          .sort((a, b) => b.d - a.d);
        const top = ranked.slice(0, Math.min(3, ranked.length));
        chosen.push(top[Math.floor(this.dice.nextFloat() * top.length)].x.tile);
      }
    }
    this.offeredCapitals = chosen.map((t) => t.index);
    for (const i of this.offeredCapitals) this.offeredCapitalHistory.add(i);
    // 三候选生成入日志(ADR-0014 补洞:候选集是 rng 产物,重放/复盘都要可见)
    const pickerIdx = this.currentSetupPlayerIndex;
    const picker = pickerIdx >= 0 ? this.players[pickerIdx] : null;
    this.logEvent(
      "setup",
      picker?.guohao ?? null,
      `${picker?.guohao ?? "待定"} 择都三候选:${chosen.map((t) => `「${t.name}」`).join("")}`,
      `offerCapitals player=${picker?.id ?? "-"} tiles=[${this.offeredCapitals.join(",")}] names=${chosen.map((t) => t.name).join("|")}`,
    );
  }

  private finishSetup(): void {
    this.setupPhase = "Done";
    this.phase = "Playing";
    this.turnPhase = "Roll";
    this.activeIndex = this.draftOrder[0] ?? 0;
    this.roundAnchor = this.activeIndex; // 固定轮次锚点,不随破产漂移
    this.turnNumber = 1;
    this.treasureDeck = createTreasureDeck(); // 初始化珍宝牌堆
    this.round = 1;
    this.logEvent(
      "setup",
      null,
      "群雄起兵,首战由「" + this.activePlayer.guohao + "」先行",
      `gameStart firstPlayer=${this.activePlayer.id}`,
    );
    this.dispatchMoment("GameStart", { subject: this.roundAnchor }); // 时机·GameStart:对局开始(主体=首动者),先于首个 TurnStart
    this.dispatchMoment("TurnStart", { subject: this.activeIndex }); // 时机·TurnStart:开局首个回合(进 Playing 时)
  }

  // ──────────────────────────── 回合状态机 ────────────────────────────
  /** 抽签 → 移动(主路或辅路逐格)→ 经过自己都城必停(补给+结束回合);否则落格结算。
   *  辅路逐格:computePath 按 onBranch 沿 cells 推进,落辅路格触发 resolveBranchCell;
   *  onBranch={step:-1} = 入口待入辅路(上回合选「入辅路」,本回合掷骰起沿辅路格推进)。 */
  rollAndMove(): void {
    if (!this.assertPhase("Roll", "RollAndMove")) return;
    const mover = this.activePlayer;
    const wasOnBranch = mover.onBranch != null; // 行军前是否在辅路(含 step=-1 待入态):BranchExited 派发判定
    this.dispatchMoment("BeforeMarch", { subject: this.activeIndex }); // 时机·BeforeMarch:掷骰前(行军加成挂点,如周瑜 moveBonus)
    this.dispatchMoment("BeforeRoll", { subject: this.activeIndex }); // 时机·BeforeRoll:掷骰前、BeforeMarch 之后(骰子机制系技能挂点,与 BeforeMarch 的语义区分见 timing.ts)
    const roll = this.dice.roll();
    this.lastRoll = roll;
    this.dispatchMoment("DieRolled", { subject: this.activeIndex, die: roll.die }); // 时机·DieRolled:骰面已定(张星彩 gainIfFace 等)
    const moveBonus = this.takeMarchBonus(); // 取走 BeforeMarch 时机累计的行军加成
    const steps = roll.die + moveBonus;
    const path = this.board.computePath(
      mover.position,
      steps,
      mover.capitalIndex,
      mover.onBranch,
    );
    const fromPos = mover.position;
    this.lastMove = path;
    const destName = path.landBranchStep != null && this.board.branch
      ? `辅路第${path.landBranchStep + 1}格`
      : this.board.at(path.landIndex).name;
    this.logEvent(
      "roll",
      mover.guohao,
      `${mover.guohao} 抽签 ${SIGN_FACES[roll.die - 1]}${moveBonus ? `(+${moveBonus})` : ""} → ${destName}`,
      `roll player=${mover.id} die=${roll.die} steps=${steps} bonus=${moveBonus} from=#${fromPos} land=#${path.landIndex} branchStep=${path.landBranchStep ?? -1} passedCapital=${path.passedCapital} wps=${path.waypoints.length}`,
    );

    // 时机·PassedPlayer:途经他人棋子——path 计算后遍历 traversed(不含起点,含落点)上
    // 非破产他人逐个派发(座位序,确定性;主体=行军者,ctx.passedSeat=被途经者)。
    for (const tIdx of path.traversed) {
      for (let seat = 0; seat < this.players.length; seat++) {
        const other = this.players[seat];
        if (other === mover || other.isBankrupt || other.position !== tIdx) continue;
        this.dispatchMoment("PassedPlayer", { subject: this.activeIndex, passedSeat: seat, tileIndex: tIdx });
      }
    }

    // 经过自己的都城(起点)→ 颁发委任状(无论后续必停或恰落都城)。
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
    // 经过自己的都城且落点不是都城 → 必停:放弃剩余步数停在都城,结算补给,结束回合
    // (辅路落格不会触发必停:辅路格不是都城)
    if (path.landBranchStep == null && path.passedCapital && path.landIndex !== mover.capitalIndex) {
      // 路径截断到都城:行军动画只走到都城,不展示被放弃的剩余步数。
      // traversed 必含都城(passedCapital);辅路汇入后路过都城时前缀补上辅路段步数。
      const capIdxInTraversed = path.traversed.indexOf(mover.capitalIndex);
      const branchPrefix =
        mover.onBranch != null && this.board.branch
          ? this.board.branch.cells.length - mover.onBranch.step
          : 0;
      this.lastMove = this.board.computePath(
        fromPos,
        branchPrefix + capIdxInTraversed + 1,
        mover.capitalIndex,
        mover.onBranch,
      );
      mover.onBranch = null; // 辅路汇入主路后路过都城:必停已在主路,清辅路态
      mover.position = mover.capitalIndex;
      if (wasOnBranch) this.dispatchMoment("BranchExited", { subject: this.activeIndex, tileIndex: mover.position }); // 时机·BranchExited:辅路推进汇入主路(汇入后必停都城的截断落点)
      this.dispatchMoment("AfterMarch", { subject: this.activeIndex }); // 时机·AfterMarch:移动完成(必停都城)、驻跸补给结算前
      this.dispatchMoment("CapitalHalt", { subject: this.activeIndex, tileIndex: mover.capitalIndex }); // 时机·CapitalHalt:必停都城(AfterMarch 后、驻跸补给结算处)
      const supply = this.applyResupply(mover, "halt");
      this.lastLandOutcome = { kind: "OwnProperty", resupply: supply };
      this.turnPhase = "Land";
      this.endTurn();
      return;
    }
    // 辅路逐格落点:落辅路第 step 格 → 触发该格效果
    if (path.landBranchStep != null && this.board.branch) {
      mover.onBranch = { step: path.landBranchStep };
      this.dispatchMoment("AfterMarch", { subject: this.activeIndex }); // 时机·AfterMarch:移动完成(落辅路格)、辅路格结算前
      this.turnPhase = "Land";
      const cell = this.board.branch.cells[path.landBranchStep];
      this.resolveBranchCell(mover, cell);
      return;
    }
    // 主路落点(含从辅路汇入:endNode 及之后)
    mover.onBranch = null; // 已在主路(清掉原 onBranch)
    mover.position = path.landIndex;
    if (wasOnBranch) this.dispatchMoment("BranchExited", { subject: this.activeIndex, tileIndex: mover.position }); // 时机·BranchExited:辅路推进汇入主路(落点回主路)
    this.dispatchMoment("AfterMarch", { subject: this.activeIndex }); // 时机·AfterMarch:移动完成(主路落位)、落格结算(辅路入口抉择/resolveLanding)前
    // 落在辅路起点(且未在辅路)→ 弹入口抉择
    if (this.board.getBranchStart(path.landIndex)) {
      this.turnPhase = "AwaitingBranch";
      this.logEvent(
        "branch",
        mover.guohao,
        `${mover.guohao} 至辅路要隘「${this.board.at(path.landIndex).name}」:走大路 or 入辅路`,
        `awaitingBranch player=${mover.id} tile=#${path.landIndex}`,
      );
      return; // 等 selectBranch
    }
    this.turnPhase = "Land";
    // 机遇(#123):早于城池结算;天命格是固定声望泉不参与 roll;清算/破产则中断落格结算
    // (必停都城/辅路格不触发:必停是驻跸补给特化流,辅路即将整体移除)。
    // 抉择机遇(#124)返回 deciding:机遇占用本落格——含 ≤1 可用选项自动执行已收尾的场合,
    // 机遇早于城池结算:即时机遇 settled → 继续本落格结算;抉择机遇 deciding → 待解,
    // 解完在 settleEncounterChoice 内继续落格结算(#120 决策 2);清算/破产已中断。
    const enc = this.maybeApplyEncounter(mover, path.landIndex);
    if (enc === "deciding" || enc === "liquidating" || enc === "bankrupt") return;
    this.resolveLanding();
  }

  /** 辅路入口抉择:"Main"=走大路(起点 tile 按普通城落格,可购买等);
   *  "Branch"=入辅路——本回合结束(棋子留在主路入口格,置「待入辅路」onBranch={step:-1}),
   *  下回合掷骰起沿辅路格推进(掷几点走几格,溢出从辅路终点汇入主路,见 computePath)。
   *  复用 AwaitingBranch 阶段 + selectBranch(改语义,不新加 phase)。 */
  selectBranch(kind: RouteKind): void {
    if (!this.assertPhase("AwaitingBranch", "SelectBranch")) return;
    const p = this.activePlayer;
    const tile = this.board.at(p.position);
    this.logEvent(
      "branch",
      p.guohao,
      `${p.guohao} 于「${tile.name}」取${kind === "Branch" ? "道辅路(下回合掷骰进发)" : "大路"}`,
      `selectBranch player=${p.id} kind=${kind} at=#${p.position} cash=${p.cash}`,
    );
    if (kind === "Branch" && this.board.branch) {
      // 入辅路 = 本回合结束:置「待入辅路」,不结算任何格;下回合 rollAndMove 沿辅路推进
      p.onBranch = { step: -1 };
      this.dispatchMoment("BranchEntered", { subject: this.activeIndex, tileIndex: p.position }); // 时机·BranchEntered:入辅路(置待入辅路态后)
      this.turnPhase = "Land";
      this.endTurn();
      return;
    }
    // 走大路:起点 tile 按普通落格处理(可购买/升级/交涉等)
    this.turnPhase = "Land";
    this.resolveLanding();
  }

  /** 待决策落格的地产定义:价格/等级口径的单一出处(catalog 按 pendingLand.propertyId 现查;
   *  快照恢复只带 id 句柄,定义不序列化)。查无定义 = 数据 bug,显式抛错(零兜底)。 */
  pendingLandDef(): PropertyDef {
    if (this.pendingLand == null)
      throw new Error("pendingLandDef:当前无待决策落格(仅 AwaitingDecision 相位有决策上下文)");
    const def = this.catalog.get(this.pendingLand.propertyId);
    if (def == null)
      throw new Error(`pendingLand:城 ${this.pendingLand.propertyId} 不在 catalog(数据 bug)`);
    return def;
  }

  buyProperty(): void {
    if (!this.assertPhase("AwaitingDecision", "BuyProperty")) return;
    const def = this.pendingLandDef();
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
      // 城池变更留痕(ADR-0015):购入即易主(无主 → 买家),等级维度不变(购入为 Lv.0)
      this.propertyChanges.push({
        tileIndex: buyer.position,
        level: r.newLevel,
        ownerColorIndex: buyer.colorIndex,
        levelChanged: false,
        ownerChanged: true,
      });
      this.logEvent(
        "buy",
        buyer.guohao,
        `${buyer.guohao} 购「${this.tileName(def)}」(${BUY_WARRANT_COST}委任 + ${formatMoney(def.purchasePrice)})`,
        `buy player=${buyer.id} prop=${def.id} price=${def.purchasePrice} warrant-${BUY_WARRANT_COST} warrants=${buyer.warrants} cash=${buyer.cash}`,
        -def.purchasePrice,
      );
      this.dispatchMoment("PropertyBought", { subject: this.activeIndex, propertyId: def.id }); // 时机·PropertyBought:购城成功尾
    }
    this.endTurn();
  }

  upgradeProperty(): void {
    if (!this.assertPhase("AwaitingDecision", "UpgradeProperty")) return;
    const def = this.pendingLandDef();
    const r = upgradeProp(this.activePlayer, def);
    this.lastTransaction = r;
    if (r.status === "Ok") {
      // 城池变更留痕(ADR-0015):扩军 = 等级维度变更(印重钤 + 楼生长),归属不变
      this.propertyChanges.push({
        tileIndex: this.activePlayer.position,
        level: r.newLevel,
        ownerColorIndex: this.activePlayer.colorIndex,
        levelChanged: true,
        ownerChanged: false,
      });
      this.logEvent(
        "upgrade",
        this.activePlayer.guohao,
        `${this.activePlayer.guohao} 扩军「${this.tileName(def)}」至 Lv.${r.newLevel}(免费)`,
        `upgrade player=${this.activePlayer.id} prop=${def.id} level=${r.newLevel} cash=${this.activePlayer.cash}`,
      );
      this.dispatchMoment("PropertyUpgraded", { subject: this.activeIndex, propertyId: def.id }); // 时机·PropertyUpgraded:扩军成功(两挂点之一,另一处在公道买卖成交)
    }
    this.endTurn();
  }

  endDecision(): void {
    if (!this.assertPhase("AwaitingDecision", "EndDecision")) return;
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
    // 天命(Fate):声望泉(#121)——落格固定 +20 声望,取代原随机坏事表(吸收进机遇目录)。
    if (tile.type === "Fate") {
      this.addReputation(this.players.indexOf(mover), 20);
      this.pushFloaterText(mover, "天命眷顾,声望 +20", tile.index);
      this.lastLandOutcome = { kind: "Noop" };
      this.logEvent("system", mover.guohao, `${mover.guohao} 落 ${tile.name}:天命眷顾,声望 +20`, `fate player=${mover.id} reputation=${mover.reputation}`, 0);
      this.endTurn();
      return;
    }
    // 锦囊(Chance)格已退役(#121):按普通格落空结算(不再抽 CHANCE_EVENTS)。
    // 税关(Tax):固定缴税 ¥200
    if (tile.type === "Tax") {
      const r = this.payOrLiquidate(mover, null, 200);
      if (r === "liquidating") return;
      const bankrupt = r === "bankrupt";
      this.pushFloater(mover, -200, tile.index, "expense");
      this.dispatchMoment("CashLost", { subject: this.players.indexOf(mover), amount: 200 }); // 时机·CashLost:被动失银(税)
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
      if (!gain) this.dispatchMoment("CashLost", { subject: this.players.indexOf(mover), amount: amt }); // 时机·CashLost:被动失银(商市行情下跌)
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
      // 无主城(含分歧点城)。ADR-0013:选项集经注册表计算;买不起/无委任状时仅剩默认
      // 行为「不取」→ 自动执行(战报+浮字),不进决策相位(原 L51 内联预检迁入注册表)。
      // 决策上下文置 pendingLand(决策命令消费);lastLandOutcome 仅表现态(UI 卷轴字段)。
      this.pendingLand = { kind: "PropertyAvailable", propertyId: def.id };
      this.lastLandOutcome = { kind: "PropertyAvailable", property: def };
      if (this.enterDecisionPhase()) {
        this.logEvent("buy", mover.guohao, `${mover.guohao} 至 ${tile.name},可购(${formatMoney(def.purchasePrice)})`, `available player=${mover.id} prop=${def.id} price=${def.purchasePrice}`);
      }
      return;
    }
    if (owner === mover) {
      // 己城扩军。ADR-0013:满级时仅剩「按兵不动」假选择 → 自动执行(战报+浮字)。
      this.pendingLand = { kind: "OwnProperty", propertyId: def.id };
      this.lastLandOutcome = { kind: "OwnProperty", property: def, owner };
      if (this.enterDecisionPhase()) {
        this.logEvent("upgrade", mover.guohao, `${mover.guohao} 至己城 ${tile.name},可扩军(免费)`, `own player=${mover.id} prop=${def.id}`);
      }
      return;
    }
    this.dispatchMoment("LandedOnProperty", {
      subject: this.players.indexOf(mover),
      ownerSeat: this.players.indexOf(owner),
      propertyId: def.id,
      tileIndex: tile.index,
    }); // 时机·LandedOnProperty:落他人城(城池有主且非本人,无论后续是否触发珍宝交涉;回合外玩家高频触发点)
    // 他人到达城池不升级:仅当城主对该访客的珍宝交涉选择公道买卖且成交时才 +1 级
    // (见 resolveTreasureOwner 的 fair 分支;坐地起价/不交易均不升级)。
    // 珍宝交涉:城主有珍宝 → 公道买卖/坐地起价;无珍宝 → 无事发生
    if (owner.treasures.length > 0) {
      this.treasureVisitor = { def, ownerIdx: this.players.indexOf(owner) };
      this.turnPhase = "AwaitingTreasureOwner";
      this.lastLandOutcome = { kind: "TreasureTrade", property: def, owner };
      this.logEvent(
        "trade",
        owner.guohao,
        `${mover.guohao} 落「${tile.name}」,${owner.guohao} 可公道买卖/坐地起价(${owner.treasures.length}件珍宝)`,
        `treasureAwait owner=${owner.id} visitor=${mover.id} treasures=${owner.treasures.length}`,
      );
    } else {
      // 城主无珍宝:无事发生
      this.lastLandOutcome = { kind: "Noop" };
      this.logEvent("system", mover.guohao, `${mover.guohao} 落「${tile.name}」(${owner.guohao} 无珍宝),无事发生`, `noTreasure owner=${owner.id} visitor=${mover.id}`);
      this.endTurn();
    }
  }

  /** ADR-0013 决策收口:进入 AwaitingDecision 前先经注册表(choices.ts)计算选项集;
   *  除默认行为(skip)外无可用选项 → 直接自动执行默认行为(战报 + 浮字 + endTurn),
   *  不进决策相位,返回 false;否则进入 AwaitingDecision 等待玩家,返回 true。
   *  调用前须已置 pendingLand(注册表按其分购地/扩军选项)。 */
  private enterDecisionPhase(): boolean {
    const options = computeChoices(this, "AwaitingDecision");
    const hasRealChoice = options.some((o) => o.available && o.id !== "skip");
    if (hasRealChoice) {
      this.turnPhase = "AwaitingDecision";
      return true;
    }
    const p = this.activePlayer;
    const tile = this.board.at(p.position);
    const def = this.pendingLand != null ? this.pendingLandDef() : null;
    this.lastLandOutcome = { kind: "Noop" };
    if (def != null && options.some((o) => o.id === "buy")) {
      // 购地不可行(银两/委任状不足):默认行为=不取(浮字文案口径见 ADR-0013 决议 2)
      const noWarrant = p.warrants < BUY_WARRANT_COST;
      this.logEvent(
        "buy",
        p.guohao,
        `${p.guohao} 至 ${tile.name},${noWarrant ? "无委任状" : "银两不足"},不可购`,
        `skipAvailable player=${p.id} prop=${def.id} price=${def.purchasePrice} cash=${p.cash} warrants=${p.warrants}`,
      );
      this.pushFloaterText(p, noWarrant ? "无委任状,不可购" : "银两不足,未能购城", p.position);
    } else if (def != null) {
      // 扩军不可行(城已满级):默认行为=按兵不动
      this.logEvent(
        "upgrade",
        p.guohao,
        `${p.guohao} 至己城 ${tile.name},城已满级,按兵不动`,
        `skipMaxed player=${p.id} prop=${def.id} cash=${p.cash}`,
      );
      this.pushFloaterText(p, "城已满级,按兵不动", p.position);
    } else {
      // 无待决策地产:默认行为=按兵不动(与 endDecision 同款战报)
      this.logEvent("system", p.guohao, `${p.guohao} 按兵不动`, `skip player=${p.id}`);
    }
    this.endTurn();
    return false;
  }

  /** 都城补给量(供 bot/UI 复用,集中 tile→def→holding→supplyFor 查找链)。
   *  返回 { supply, level }:supply=补给金额,level=都城当前等级。
   *  一并返回 level 是为让 applyResupply 写日志时免再做一次 board.at+findHolding(原重复查找)。 */
  capitalSupplyOf(player: Player): { supply: number; level: number } {
    const tile = this.board.at(player.capitalIndex);
    const def = this.catalog.get(tile.propertyId);
    const h = findHolding(player, def?.id ?? "");
    return { supply: supplyFor(def?.resupplyPerLevel, h?.level), level: h?.level ?? 0 };
  }

  /** 都城补给 = ResupplyPerLevel × (Level+1);结算(+现金/浮动/战报),查找走 capitalSupplyOf(单次)。
   *  cause="halt"(经过必停)战报写「军至都城 X,驻跸补给(+N)」;"land"(落点恰为都城)维持原补给文案。 */
  private applyResupply(mover: Player, cause: "land" | "halt" = "land"): number {
    const { supply, level } = this.capitalSupplyOf(mover);
    if (supply > 0) {
      mover.cash += supply;
      this.pushFloater(mover, supply, mover.capitalIndex, "supply");
      this.dispatchMoment("CashGained", { subject: this.players.indexOf(mover), amount: supply }); // 时机·CashGained:被动得银(都城补给,驻跸/落都城同挂)
    }
    if (cause === "halt") {
      this.logEvent(
        "halt",
        mover.guohao,
        `${mover.guohao} 军至都城「${this.board.at(mover.capitalIndex).name}」,驻跸补给(+${formatMoney(supply)})`,
        `haltSupply player=${mover.id} capital=#${mover.capitalIndex} level=${level} amount=${supply} cash=${mover.cash}`,
        supply,
      );
    } else if (supply > 0) {
      this.logEvent(
        "supply",
        mover.guohao,
        `${mover.guohao} 都城补给 +${formatMoney(supply)}(Lv.${level})`,
        `supply player=${mover.id} capital=#${mover.capitalIndex} level=${level} amount=${supply} cash=${mover.cash}`,
        supply,
      );
    }
    return supply;
  }

  // ──────────────────────────── 回合结束 / 胜负 ────────────────────────────
  private endTurn(): void {
    this.dispatchMoment("TurnEnd", { subject: this.activeIndex }); // 时机·TurnEnd:回合收尾(胜负判定/结算移除前)
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
      this.dispatchMoment("GameOver", { subject: this.players.indexOf(result.winner) }); // 时机·GameOver:胜负判定确定(净资产达标/群雄尽灭两路同挂,主体=胜者)
      this.logFinalState(); // 终局行(ADR-0014):机读终态面板,重放校验的断言锚点
      return;
    }
    this.advanceToNextActive();
    // 中伏跳过:若新活跃玩家 skipTurns>0,扣 1 并继续推进到下一位(直到找到可行动者)
    let safety = 0;
    while (this.activePlayer.skipTurns > 0 && !this.isOver && safety++ < this.players.length + 2) {
      const skipped = this.activePlayer;
      skipped.skipTurns -= 1;
      this.logEvent(
        "branch",
        skipped.guohao,
        `${skipped.guohao} 中伏未消,跳过本回合`,
        `skipTurn player=${skipped.id} remaining=${skipped.skipTurns}`,
      );
      this.advanceToNextActive();
    }
    // 回合计数:当回合循环回到本轮起始玩家(固定锚点)→ 轮次 +1。
    // 锚点不随破产漂移:若锚点玩家破产,用 draftOrder 中首个存活者作为新锚点。
    if (this.players[this.roundAnchor].isBankrupt) {
      const next = this.draftOrder.find((i) => !this.players[i].isBankrupt);
      if (next !== undefined) this.roundAnchor = next;
    }
    if (this.activeIndex === this.roundAnchor) {
      // 时机·RoundEnd → 轮次 +1 → 时机·RoundStart:最后一位玩家 endTurn 且回到轮次锚点时,
      // 先收尾旧轮再开启新轮(均以锚点座位为主体)。
      this.dispatchMoment("RoundEnd", { subject: this.roundAnchor });
      this.round += 1;
      this.dispatchMoment("RoundStart", { subject: this.roundAnchor });
    }
    this.dispatchMoment("TurnStart", { subject: this.activeIndex }); // 时机·TurnStart:新 activeIndex 确定后
    // 辅路入口抉择由 rollAndMove 落格到 startNode 时触发(本回合内 selectBranch 处理);
    // endTurn 不再重复设置 AwaitingBranch,否则选"大路"停在起点的玩家每回合被反复提示。
    this.turnPhase = "Roll";
    this.turnNumber += 1;
    // 不重置 lastRoll / lastMove:doRoll 的骰子翻滚与行军动画在 rollAndMove 之后执行,
    // 而落点有主(珍宝交涉/自己城补给)时 rollAndMove 会内部 endTurn,重置会让 doRoll 读到 null 而崩。
    // 下次 rollAndMove 会覆盖这两个值,故无需手动清空。
    this.lastLandOutcome = null;
    // 决策完成(购/扩/跳过)即清除待决策落格载荷;抉择机遇同理(#124,正常流已在
    // settleEncounterChoice 清除,此处是回合收口的兜底扫除)
    this.pendingLand = null;
    this.pendingEncounter = null;
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

  // ──────────────────────────── 珍宝交涉(公道买卖/坐地起价) ────────────────────────────
  /** 宝物城落格:从牌堆抽 1 件 → 掷双骰(2d6)判定 → ≥ 等级则获得。 */
  private resolveTreasureCity(mover: Player, tile: TileDef): void {
    this.drawTreasureAt(mover, tile.name, tile.index);
  }
  /** 抽珍宝并拼点判定(复用于宝物城落格 + 辅路 treasure 格)。
   *  sourceName=来源名(城名/「辅路探宝」),atTile=浮动金额锚点 tile 索引。 */
  private drawTreasureAt(mover: Player, sourceName: string, atTile: number): void {
    this.lastLandOutcome = { kind: "Noop" };
    this.turnPhase = "Land";
    if (this.treasureDeck.length === 0) {
      this.logEvent("system", mover.guohao, `${mover.guohao} 至「${sourceName}」,珍宝已被搜刮一空`, `treasureEmpty player=${mover.id}`);
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
      this.pushFloater(mover, guidePrice, atTile, "income");
      this.logEvent("system", mover.guohao, `${mover.guohao} 在「${sourceName}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} ≥ ${treasure.level},喜得珍宝!`, `treasureGain player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`, guidePrice);
      this.dispatchMoment("TreasureGained", { subject: this.players.indexOf(mover), treasureId: treasure.id }); // 时机·TreasureGained:拼点得宝(两挂点之一,另一处在 escrow 交割)
    } else {
      // 失败:珍宝放回牌堆底
      this.treasureDeck.push(treasure);
      this.logEvent("system", mover.guohao, `${mover.guohao} 在「${sourceName}」探得「${treasure.name}」(Lv.${treasure.level}),拼点 ${d1}+${d2}=${roll} < ${treasure.level},失之交臂`, `treasureMiss player=${mover.id} treasure=${treasure.id} level=${treasure.level} roll=${roll} d1=${d1} d2=${d2}`);
    }
    this.endTurn();
  }

  /** 随机事件(锦囊/天命 + 辅路 event 格):抽一条事件,结算 cashDelta(经 payOrLiquidate)。 */
  private applyRandomEvent(
    mover: Player,
    sourceName: string,
    atTile: number,
    pool: ReadonlyArray<{ id: string; text: string; cashDelta: number }>,
    logTag: string,
  ): void {
    this.lastLandOutcome = { kind: "Noop" };
    this.turnPhase = "Land";
    const ev = pool[Math.floor(this.dice.nextFloat() * pool.length)];
    let bankrupt = false;
    if (ev.cashDelta >= 0) {
      mover.cash += ev.cashDelta;
    } else {
      const r = this.payOrLiquidate(mover, null, -ev.cashDelta);
      if (r === "liquidating") return; // 进入清算,confirm 后 endTurn
      bankrupt = r === "bankrupt";
    }
    this.pushFloater(mover, ev.cashDelta, atTile, ev.cashDelta >= 0 ? "income" : "expense");
    if (ev.cashDelta < 0) this.dispatchMoment("CashLost", { subject: this.players.indexOf(mover), amount: -ev.cashDelta }); // 时机·CashLost:被动失银(锦囊/天命/辅路事件)
    if (ev.cashDelta > 0) this.dispatchMoment("CashGained", { subject: this.players.indexOf(mover), amount: ev.cashDelta }); // 时机·CashGained:被动得银(随机事件得款)
    this.lastLandOutcome = { kind: "Noop", causedBankruptcy: bankrupt };
    this.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 落 ${sourceName}:${ev.text} ${ev.cashDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(ev.cashDelta))}${bankrupt ? " → 破产" : ""}`,
      `${logTag} player=${mover.id} event=${ev.id} delta=${ev.cashDelta} cash=${mover.cash}`,
      ev.cashDelta,
    );
    this.endTurn();
  }

  /** 辅路格落格:treasure=拼点探宝(复用 drawTreasureAt);event=锦囊(复用 applyRandomEvent);
   *  penalty=中伏,skipTurns=1(下回合跳过)。 */
  private resolveBranchCell(mover: Player, cell: BranchCell): void {
    if (cell.kind === "treasure") {
      this.drawTreasureAt(mover, "辅路探宝", mover.position);
      return;
    }
    if (cell.kind === "event") {
      this.applyRandomEvent(mover, "辅路锦囊", mover.position, CHANCE_EVENTS, "branchChance");
      return;
    }
    // penalty:中伏,下回合跳过
    this.lastLandOutcome = { kind: "Noop" };
    this.turnPhase = "Land";
    mover.skipTurns = 1;
    this.logEvent(
      "branch",
      mover.guohao,
      `${mover.guohao} 在辅路中伏,下回合跳过`,
      `branchPenalty player=${mover.id} skipTurns=1`,
    );
    this.endTurn();
  }

  /** 城主抉择:公道买卖(指导价,玩家间付银)/ 坐地起价(加价出售,玩家间付银)/ 跳过。
   *  公道买卖且成交 → 城池 +1 级(他人到达城池本身不升级,升级只挂在公道买卖上)。
   *  两种交易都是 visitor → owner 玩家间付银(无银行注入);成交后珍宝先进交割托管区(escrowTreasure),
   *  买家付清价款才交货——托管中的珍宝不可被买家变卖抵债(防"得宝后变卖抵债"白嫖套利),买家破产则退回卖家。 */
  resolveTreasureOwner(action: { type: "fair"; treasureId: string } | { type: "premium"; treasureId: string } | { type: "skip" }): void {
    if (!this.assertPhase("AwaitingTreasureOwner", "ResolveTreasureOwner")) return;
    const tv = this.treasureVisitor!;
    const owner = this.players[tv.ownerIdx];
    const mover = this.activePlayer;
    const def = tv.def;

    if (action.type === "skip") {
      this.logEvent("system", owner.guohao, `${owner.guohao} 不交易`, `treasureSkip owner=${owner.id}`);
      this.treasureVisitor = null;
      this.endTurn();
      return;
    }

    const tIdx = owner.treasures.findIndex((t) => t.id === action.treasureId);
    if (tIdx < 0) { this.warn(`珍宝 ${action.treasureId} 不在手中`); return; }
    const guidePrice = guidePriceOf(owner.treasures[tIdx].level);
    const holding = findHolding(owner, def.id);
    const cityLevel = holding?.level ?? 0;

    // 售价:fair=指导价;premium=坐地起价(per-level 加价/乘数)
    const price = action.type === "fair"
      ? guidePrice
      : premiumPriceOf(guidePrice, def, cityLevel);

    const treasure = owner.treasures.splice(tIdx, 1)[0];

    // 公道买卖且交易达成 → 城池 +1 级(满级封顶)。升级是对城主选择公道的奖励:
    // 挂在交易达成时(城主选定 fair 且珍宝已离手入托管),此后买家破产退宝也不回滚。
    if (action.type === "fair" && holding && canUpgrade(holding)) {
      holding.level += 1;
      // 城池变更留痕(ADR-0015):公道买卖成交升级(PropertyUpgraded 另一挂点),
      // 与扩军同维度(等级变更、归属不变)
      this.propertyChanges.push({
        tileIndex: this.tileIndexOfProperty(def.id),
        level: holding.level,
        ownerColorIndex: owner.colorIndex,
        levelChanged: true,
        ownerChanged: false,
      });
      this.logEvent(
        "upgrade",
        owner.guohao,
        `${owner.guohao} 公平交易,城池「${this.tileName(def)}」升 Lv.${holding.level}`,
        `fairUpgrade prop=${def.id} owner=${owner.id} visitor=${mover.id} level=${holding.level}`,
      );
      this.dispatchMoment("PropertyUpgraded", { subject: tv.ownerIdx, propertyId: def.id }); // 时机·PropertyUpgraded:公道买卖成交升级(两挂点之一,另一处在扩军)
    }

    // 先付款后交货:珍宝进交割托管区,买家付清价款(可能经破产清算变卖其他资产自救)后才交割。
    // 托管中的珍宝不在买家 treasures 里 → 不可被 sellTreasureBankruptcy 变卖抵债(封堵套利);
    // 买家最终破产时,托管珍宝退回卖家。
    this.escrowTreasure = {
      treasure,
      buyerIdx: this.players.indexOf(mover),
      sellerIdx: tv.ownerIdx,
      price,
    };
    const r = this.payOrLiquidate(mover, owner, price);
    if (r === "liquidating") return; // 清算自救:escrow 挂起,confirmBankruptcySettle 里交割/退还
    const bankrupt = r === "bankrupt";
    if (bankrupt) this.returnEscrowToSeller(); // 买家破产:珍宝退回卖家
    else this.deliverEscrow(); // 付款到账:交货
    this.pushFloater(mover, -price, mover.position, "expense");
    this.pushFloater(owner, price, mover.position, "income");
    if (price > 0) this.dispatchMoment("CashLost", { subject: this.players.indexOf(mover), amount: price }); // 时机·CashLost:被动失银(珍宝交涉付款,访客不可拒)
    this.lastLandOutcome = { kind: "TreasureTrade", property: def, owner, amount: price, causedBankruptcy: bankrupt };
    const verb = action.type === "fair" ? "公道买卖" : "坐地起价";
    this.logEvent("trade", owner.guohao, `${owner.guohao} ${verb}「${treasure.name}」给 ${mover.guohao},售价 ${formatMoney(price)}${bankrupt ? " → 破产" : ""}`, `treasure${action.type === "fair" ? "Fair" : "Premium"} owner=${owner.id} visitor=${mover.id} treasure=${treasure.id} level=${treasure.level} price=${price} bankrupt=${bankrupt}`, -price);
    this.treasureVisitor = null;
    this.endTurn();
  }

  // ──────────────────────────── 破产清算(变卖资产自救) ────────────────────────────
  /** 交割托管:买家付清价款 → 珍宝交货给买家。买家得宝(TreasureGained)/卖家售出(TreasureSold)/
   *  交易成局(TradeSettled)/卖家收款(CashGained)四个时机都在此派发——无论直接付清还是
   *  清算变卖自救后付清,走到这里 = 交割完成(此时卖家两路都已被付款);买家破产走退宝路径,不触发。 */
  private deliverEscrow(): void {
    const e = this.escrowTreasure;
    if (!e) return;
    this.escrowTreasure = null;
    const buyer = this.players[e.buyerIdx];
    const seller = this.players[e.sellerIdx];
    buyer.treasures.push(e.treasure);
    this.logEvent(
      "trade",
      buyer.guohao,
      `交割:「${e.treasure.name}」由 ${seller.guohao} 付予 ${buyer.guohao}(价款 ${formatMoney(e.price)} 已结)`,
      `escrowDeliver buyer=${buyer.id} seller=${seller.id} treasure=${e.treasure.id} price=${e.price}`,
    );
    this.dispatchMoment("TreasureGained", { subject: e.buyerIdx, treasureId: e.treasure.id }); // 时机·TreasureGained:escrow 交割买家得宝
    this.dispatchMoment("TreasureSold", { subject: e.sellerIdx, treasureId: e.treasure.id, amount: e.price }); // 时机·TreasureSold:交涉成交(卖家视角)
    this.dispatchMoment("TradeSettled", { subject: e.sellerIdx, buyerSeat: e.buyerIdx, sellerSeat: e.sellerIdx, amount: e.price }); // 时机·TradeSettled:买家付清、交割完成(主体=城主/卖家)
    if (e.price > 0) this.dispatchMoment("CashGained", { subject: e.sellerIdx, amount: e.price }); // 时机·CashGained:被动得银(交涉收款,卖家)
  }

  /** 交割托管:买家破产 → 未付款的托管珍宝退回卖家。 */
  private returnEscrowToSeller(): void {
    const e = this.escrowTreasure;
    if (!e) return;
    this.escrowTreasure = null;
    const seller = this.players[e.sellerIdx];
    if (!seller.isBankrupt) {
      seller.treasures.push(e.treasure);
      this.logEvent(
        "trade",
        seller.guohao,
        `买家破产,托管珍宝「${e.treasure.name}」退回 ${seller.guohao}`,
        `escrowReturn seller=${seller.id} buyer=${this.players[e.buyerIdx].id} treasure=${e.treasure.id}`,
      );
    } else {
      this.treasureDeck.push(e.treasure); // 卖家也已被清算出局 → 珍宝回牌堆
      this.logEvent(
        "trade",
        null,
        `买卖双方俱已破产,托管珍宝「${e.treasure.name}」归入牌堆`,
        `escrowReturnToDeck treasure=${e.treasure.id}`,
      );
    }
  }

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
    this.settleDebtTraced(mover, creditor, amount);
    this.finalizeBankruptcy(mover);
    return "bankrupt";
  }

  /** 结算债务并留痕资产转移(ADR-0015):破产即转移/销毁的每处地产写一条 ownerChanged
   *  留痕(债主接管,无债主回无主),表现提取器据此产出易主宣告。等级不因转移改变。
   *  引擎内一切 settleDebt 调用须经此口,防破产易主漏播(与 pushFloater 同一收口思路)。 */
  private settleDebtTraced(player: Player, creditor: Player | null, amount: number): boolean {
    const moved = player.properties.map((h) => ({ propertyId: h.propertyId, level: h.level }));
    const bankrupt = settleDebt(player, creditor, amount);
    if (bankrupt) {
      for (const m of moved) {
        this.propertyChanges.push({
          tileIndex: this.tileIndexOfProperty(m.propertyId),
          level: m.level,
          ownerColorIndex: creditor ? creditor.colorIndex : null,
          levelChanged: false,
          ownerChanged: true,
        });
      }
    }
    return bankrupt;
  }

  /** propertyId → tile 索引(引擎数据不变量:catalog 地产恰在一格;查无 = 数据 bug,当场抛出)。 */
  private tileIndexOfProperty(propertyId: string): number {
    const t = this.board.tiles.find((x) => x.propertyId === propertyId);
    if (t == null) throw new Error(`propertyChange:城 ${propertyId} 不在棋盘(数据 bug)`);
    return t.index;
  }

  private hasMarketableAssets(p: Player): boolean {
    if (p.treasures.length > 0 || p.heroes.length > 0) return true;
    const capProp = this.board.at(p.capitalIndex)?.propertyId;
    return p.properties.some((h) => h.propertyId !== capProp);
  }

  /** 破产善后:名将释放回招贤池(treasures 已由 settleDebt 转债主)。 */
  private finalizeBankruptcy(p: Player): void {
    for (const h of p.heroes) this.recruitedHeroIds.delete(h.id);
    p.heroes = [];
    // 都城已转债主(settleDebt 转移了 properties),玩家不再持有都城。
    // 清 capitalIndex 使 capitalOwnerOf/renderTiles 不再返回破产者。
    p.capitalIndex = -1;
    this.dispatchMoment("PlayerBankrupt", { subject: this.players.indexOf(p) }); // 时机·PlayerBankrupt:破产出局善后完成(名将已释放、资产已转债主)
  }

  /** 凑足即止硬守卫:现金已达自救线(≥债务)后,一切变卖命令直接拒绝(零兜底:引擎硬拒绝,不靠 UI 禁用自觉)。 */
  private assertStillOwing(label: string): boolean {
    if (this.activePlayer.cash >= this.pendingDebt!.amount) {
      this.warn(`${label}:已凑足债务,不可再卖`);
      return false;
    }
    return true;
  }

  sellTreasureBankruptcy(treasureId: string): void {
    if (!this.assertPhase("AwaitingBankruptcySettle", "SellTreasureBankruptcy")) return;
    if (!this.assertStillOwing("SellTreasureBankruptcy")) return;
    const p = this.activePlayer;
    const idx = p.treasures.findIndex((t) => t.id === treasureId);
    if (idx < 0) { this.warn(`珍宝 ${treasureId} 不在手中`); return; }
    const t = p.treasures.splice(idx, 1)[0];
    const gain = guidePriceOf(t.level);
    p.cash += gain;
    this.pushFloater(p, gain, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 变卖「${t.name}」得 ${formatMoney(gain)}`, `bkSellTreasure player=${p.id} treasure=${t.id} +${gain}`, gain);
    this.dispatchMoment("TreasureSold", { subject: this.activeIndex, treasureId: t.id, amount: gain }); // 时机·TreasureSold:破产变卖珍宝(两挂点之一,另一处在交割)
    this.dispatchMoment("BankruptcySettle", { subject: this.activeIndex, amount: gain }); // 时机·BankruptcySettle:变卖珍宝成功(三变卖命令之一)
  }

  sellPropertyBankruptcy(propId: string): void {
    if (!this.assertPhase("AwaitingBankruptcySettle", "SellPropertyBankruptcy")) return;
    if (!this.assertStillOwing("SellPropertyBankruptcy")) return;
    const p = this.activePlayer;
    if (propId === this.board.at(p.capitalIndex)?.propertyId) { this.warn("都城不可变卖"); return; }
    const idx = p.properties.findIndex((h) => h.propertyId === propId);
    if (idx < 0) { this.warn(`城 ${propId} 不在手中`); return; }
    const h = p.properties.splice(idx, 1)[0];
    // 变卖价 = 该等级的城池价值(地图 json valueByLevel 显式定义),非购入价
    const gain = sellValueOf(this.catalog.get(propId)!, h.level);
    p.cash += gain;
    // 城池变更留痕(ADR-0015):变卖给银行即回无主,等级维度不变
    this.propertyChanges.push({
      tileIndex: this.tileIndexOfProperty(propId),
      level: h.level,
      ownerColorIndex: null,
      levelChanged: false,
      ownerChanged: true,
    });
    this.pushFloater(p, gain, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 变卖城池得 ${formatMoney(gain)}`, `bkSellProp player=${p.id} prop=${propId} +${gain}`, gain);
    this.dispatchMoment("BankruptcySettle", { subject: this.activeIndex, amount: gain }); // 时机·BankruptcySettle:变卖城池成功(三变卖命令之一)
  }

  cashHeroBankruptcy(heroId: string): void {
    if (!this.assertPhase("AwaitingBankruptcySettle", "CashHeroBankruptcy")) return;
    if (!this.assertStillOwing("CashHeroBankruptcy")) return;
    const p = this.activePlayer;
    const idx = p.heroes.findIndex((h) => h.id === heroId);
    if (idx < 0) { this.warn(`名将 ${heroId} 不在手中`); return; }
    const h = p.heroes.splice(idx, 1)[0];
    this.recruitedHeroIds.delete(heroId);
    p.cash += 200; // 名将换银(2两)
    this.pushFloater(p, 200, p.position, "income");
    this.logEvent("system", p.guohao, `${p.guohao} 遣散「${h.name}」得 ${formatMoney(200)}`, `bkCashHero player=${p.id} hero=${heroId} +200`, 200);
    this.dispatchMoment("BankruptcySettle", { subject: this.activeIndex, amount: 200 }); // 时机·BankruptcySettle:遣散名将成功(三变卖命令之一)
  }

  confirmBankruptcySettle(): void {
    if (!this.assertPhase("AwaitingBankruptcySettle", "ConfirmBankruptcySettle")) return;
    const p = this.activePlayer;
    const debt = this.pendingDebt!;
    this.pendingDebt = null;
    if (this.treasureVisitor) this.treasureVisitor = null;
    if (p.cash >= debt.amount) {
      p.cash -= debt.amount;
      if (debt.creditor) debt.creditor.cash += debt.amount;
      this.deliverEscrow(); // 清算自救成功:托管珍宝交货给买家
      this.logEvent("system", p.guohao, `${p.guohao} 清偿债务 ${formatMoney(debt.amount)},转危为安`, `bkConfirm player=${p.id} paid=${debt.amount}`);
    } else {
      this.settleDebtTraced(p, debt.creditor, debt.amount);
      this.finalizeBankruptcy(p);
      this.returnEscrowToSeller(); // 破产:未付款的托管珍宝退回卖家
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
    // 命令流(ADR-0014):每条玩家命令在统一入口记一行 cmd(detail=完整命令 JSON,重放的
    // 机读层)。bot 路径(botAct/aiSetupStepFor 直调引擎方法)不经此口 → 不产生 cmd 行:
    // 给定 seed 后 bot 行为确定,重放自动重算(见 docs/logging.md「命令流重放」)。
    const issuer = this.players[this.decisionOwner];
    this.logEvent("cmd", issuer.guohao, `${issuer.guohao} 提交命令:${CMD_BRIEF[cmd.type]}`, JSON.stringify(cmd));
    switch (cmd.type) {
      case "rollAndMove": return this.rollAndMove();
      case "selectBranch": return this.selectBranch(cmd.kind);
      case "buyProperty": return this.buyProperty();
      case "upgradeProperty": return this.upgradeProperty();
      case "endDecision": return this.endDecision();
      case "resolveHeroPick": return this.resolveHeroPick(cmd.index);
      case "resolveEncounterChoice": return this.resolveEncounterChoice(cmd.index);
      case "resolveTreasureOwner":
        return this.resolveTreasureOwner(cmd.action);
      case "sellTreasureBankruptcy": return this.sellTreasureBankruptcy(cmd.treasureId);
      case "sellPropertyBankruptcy": return this.sellPropertyBankruptcy(cmd.propId);
      case "cashHeroBankruptcy": return this.cashHeroBankruptcy(cmd.heroId);
      case "confirmBankruptcySettle": return this.confirmBankruptcySettle();
    }
  }

  // ──────────────────────────── 时机框架(时机总线) ────────────────────────────
  // dispatchMoment(moment, ctx):在时机点派发全场技能(名将技能/将来的珍宝/地块/全局规则同轨)。
  // 确定性:座位序(0..n-1,未破产)× 每人 heroes 序 × skills 数组序,同层派发顺序全确定。
  // 零新增序列化状态:技能从 HEROES 数据派生;冷却复用 heroLastFired(键=skill.id)。
  // 设计与扩展指南(加时机三步/加技能两步/加效果一步)见 docs/timing-framework.md。

  /** 派发深度计数(瞬态,不序列化):每次进入 dispatchMoment +1。>2 层直接抛错——
   *  不变量校验而非兜底:效果内同步再派发时机只能有一层嵌套,递归链是框架 bug,必须崩出来。 */
  private momentDepth = 0;

  /** 行军加成累计(瞬态,不序列化):BeforeMarch·moveBonus 效果写入,rollAndMove 掷骰后
   *  takeMarchBonus 取走并清零——同一次 rollAndMove 内写读平衡,快照永远看不到残值。 */
  private marchBonus = 0;

  /** 效果注册表专用通道(仅 effects.ts 调用;UI/bot 不得使用):累计行军加成。 */
  addMarchBonus(steps: number): void {
    this.marchBonus += steps;
  }

  /** 效果注册表专用通道:取走并清零累计行军加成(rollAndMove 消费)。 */
  takeMarchBonus(): number {
    const b = this.marchBonus;
    this.marchBonus = 0;
    return b;
  }

  /** 效果注册表专用通道:技能得银(+现金 +浮字;skill 战报由派发器统一记录)。
   *  防连锁:此处【不】派发 CashGained——CashGained 仅在经济结算点(补给/事件得款/交涉收款)派发,
   *  效果层收益不递归(技能给钱再触发得银技能会指数放大技能链,框架层禁止;见 docs/timing-framework.md)。 */
  grantSkillCash(seat: number, amount: number): void {
    const p = this.players[seat];
    p.cash += amount;
    this.pushFloater(p, amount, p.position, "income");
  }

  /** 时机派发:遍历所有未破产玩家(座位序)× 技能序;scope 过滤 + cooldown 检查后执行效果。
   *  ctx(MomentCtx):subject=时机主体座位,其余字段(die/amount/passedSeat/ownerSeat/propertyId/
   *  treasureId/heroId/buyerSeat/sellerSeat/tileIndex)按各时机语义携带,原样透传给 EffectCtx。 */
  dispatchMoment(moment: GameMoment, ctx: MomentCtx): void {
    this.momentDepth += 1;
    if (this.momentDepth > 2)
      throw new Error(`时机派发嵌套超过 2 层(${moment}):禁止效果内同步再派发时机(防递归)`);
    try {
      for (let ownerSeat = 0; ownerSeat < this.players.length; ownerSeat++) {
        const owner = this.players[ownerSeat];
        if (owner.isBankrupt) continue; // 破产玩家技能不触发
        for (const hero of owner.heroes) {
          for (const skill of hero.skills ?? []) {
            if (skill.when !== moment) continue;
            if (!this.scopePasses(skill.scope, ctx.subject, ownerSeat)) continue;
            if (!this.skillReady(owner, skill)) continue;
            const effectFn = EFFECTS[skill.effect];
            if (effectFn == null)
              throw new Error(`未知效果 EffectId "${skill.effect}"(技能 ${skill.id}):注册表查不到=数据 bug`);
            const ectx: EffectCtx = { ...ctx, moment, owner: ownerSeat };
            if (!effectFn(this, ectx, skill.params ?? {})) continue; // 条件不满足:静默跳过(不记战报/冷却)
            owner.heroLastFired[skill.id] = this.round; // 记冷却轮次(无 cooldown 的技能记录无害)
            this.logEvent(
              "skill",
              owner.guohao,
              `${owner.guohao} 名将「${hero.name}」触发时机 ${moment}`,
              `skillFire owner=${owner.id} hero=${hero.id} skill=${skill.id} moment=${moment} subject=${this.players[ctx.subject].id} die=${ctx.die ?? "-"} amount=${ctx.amount ?? "-"} params=${JSON.stringify(skill.params ?? {})}`,
            );
          }
        }
      }
    } finally {
      this.momentDepth -= 1;
    }
  }

  /** scope 过滤(语义定案,详见 TriggerSkill.scope 注释):
   *  - "self":属主是时机主体(owner === subject)
   *  - "others":时机主体不是属主(owner !== subject)
   *  - "any":主体不限
   *  - "actor":时机主体恰为当前行动玩家(subject === activeIndex,属主不限)——当前所有派发点
   *    主体即行动者,与 "any" 等价;未来出现「非行动玩家」主体的时机(如回合外失财)时二者分化。
   *  缺省 = "self"。 */
  private scopePasses(scope: TriggerSkill["scope"], subject: number, ownerSeat: number): boolean {
    switch (scope ?? "self") {
      case "self": return ownerSeat === subject;
      case "others": return ownerSeat !== subject;
      case "actor": return subject === this.activeIndex;
      case "any": return true;
    }
  }

  /** 冷却判定:未设 cooldown → 恒可用;否则距上次触发的轮数 ≥ cooldown 才可用。 */
  private skillReady(player: Player, skill: TriggerSkill): boolean {
    if (!skill.cooldown) return true;
    const last = player.heroLastFired[skill.id] ?? -Infinity;
    return this.round - last >= skill.cooldown;
  }

  /** 招贤纳士:从剩余名将池随机抽 3 张(三选一)。满额/无货→直接 endTurn。 */
  private tryRecruitHero(mover: Player): void {
    if (mover.heroes.length >= HERO_CAPACITY) { this.endTurn(); return; }
    const available = HEROES.filter((h) => !this.recruitedHeroIds.has(h.id));
    if (available.length === 0) { this.endTurn(); return; }
    this.offeredHeroes = shuffle(available, this.dice.nextFloat).slice(0, 3);
    this.turnPhase = "AwaitingHeroPick";
    this.logEvent(
      "setup",
      mover.guohao,
      `${mover.guohao} 招贤纳士:三选一`,
      `offerHeroes player=${mover.id} count=${this.offeredHeroes.length} heroes=${this.offeredHeroes.map((h) => h.id).join("|")}`,
    );
  }

  /** 玩家从招贤纳士候选中选一位(或跳过)。公开(供 UI/bot 调用)。 */
  resolveHeroPick(index: number): void {
    if (!this.assertPhase("AwaitingHeroPick", "ResolveHeroPick")) return;
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
      this.dispatchMoment("HeroRecruited", { subject: this.activeIndex, heroId: hero.id }); // 时机·HeroRecruited:招贤成功(选定名将;tryRecruitHero 只出三选一候选)
    }
    this.offeredHeroes = [];
    this.endTurn();
  }

  // ──────────────────────────── 战报 / 浮动反馈 ────────────────────────────
  /** 终局行(ADR-0014):胜利判定与 GameOver 时机之后,记一行机读终态面板
   *  (round/turnNumber/winner/玩家 cash/netWorth/position)。联机落盘、单机 IndexedDB、
   *  导出 jsonl 的最后一根引擎行;scripts/replay-log.ts 重放完与之逐字段比对。 */
  private logFinalState(): void {
    const winner = this.winner!;
    this.logEvent(
      "final",
      winner.guohao,
      `终局:${winner.guohao} 称帝(${this.winReason === "LastStanding" ? "群雄尽灭" : "富甲天下"}),历 ${this.round} 轮 ${this.turnNumber} 回合`,
      JSON.stringify({
        type: "final",
        round: this.round,
        turnNumber: this.turnNumber,
        winner: winner.id,
        winReason: this.winReason,
        players: this.players.map((p) => ({
          id: p.id,
          guohao: p.guohao,
          isBot: p.isBot,
          isBankrupt: p.isBankrupt,
          cash: p.cash,
          netWorth: netWorth(p),
          position: p.position,
        })),
      }),
    );
  }

  /** 房间层日志行(ADR-0014):把房间/控制器层的生命周期事件(托管开关/接管/离线/重连/
   *  解散/开局)写进对局日志(category "room")。brief 中文;detail 为机读 JSON——
   *  重放脚本据此动态调整「bot 驱动座位集」(takeover/autopilot 与 room.seatControlled 同源)。 */
  logRoomEvent(brief: string, detail: string): void {
    this.logEvent("room", null, brief, detail);
  }

  private logEvent(
    category: LogEvent["category"],
    player: string | null,
    brief: string,
    detail: string,
    amount?: number,
  ): void {
    this.log.push({ ts: Date.now(), round: this.round, turn: this.turnNumber, player, brief, detail, category, amount });
  }
  private assertPhase(expected: TurnPhase, label: string): boolean {
    if (this.turnPhase !== expected) {
      this.warn(`${label} 在非 ${expected} 阶段(${this.turnPhase})被调用`);
      return false;
    }
    return true;
  }
  private warn(msg: string): void {
    this.logEvent("system", null, `[警告] ${msg}`, `warn: ${msg}`);
  }
  /** 浮字入队(引擎内部结算时调用;对外消费走 presentation.drainFloaters)。 */
  private pushFloater(
    p: Player,
    amount: number,
    atTile: number,
    kind: "income" | "expense" | "supply",
  ): void {
    this.floaters.push({ playerIndex: this.players.indexOf(p), amount, atTile, kind });
  }
  /** 声望增减(#121):机遇抉择/天命格的唯一写入口,clamp ±100。 */
  addReputation(seat: number, delta: number): void {
    const p = this.players[seat];
    p.reputation = Math.max(-100, Math.min(100, p.reputation + delta));
  }

  /** 体力增减(#130):clamp 0~100,返回落账后的体力值。 */
  addStamina(seat: number, delta: number): number {
    const p = this.players[seat];
    p.stamina = Math.max(0, Math.min(100, p.stamina + delta));
    return p.stamina;
  }

  /** 耗竭入口(#130):体力归 0 的 Seat 调用(机遇结算后)。多房产 → AwaitingExhaustion
   *  相位自选;可用选项 ≤1 → 自动执行;无可处置(无房产/仅 0 级都城) → 纯跳回合。
   *  结算统一:skipTurns+1(跳过下一回合)、体力重置 100、endTurn。 */
  exhaustIfDepleted(seat: number): "none" | "auto" | "phase" {
    const p = this.players[seat];
    if (p.stamina > 0) return "none";
    this.pendingExhaustionSeat = seat;
    const options = computeChoices(this, "AwaitingExhaustion");
    const availableCount = options.filter((o) => o.available).length;
    if (availableCount > 1) {
      this.turnPhase = "AwaitingExhaustion";
      this.logEvent("system", p.guohao, `${p.guohao} 体力耗竭!须弃一座城池苟活`, `exhaustion player=${p.id} options=${availableCount}`);
      return "phase";
    }
    if (availableCount === 1) {
      const idx = options.findIndex((o) => o.available);
      this.settleExhaustionChoice(seat, idx);
      return "auto";
    }
    this.applyExhaustionAftermath(p, "无可处置城池");
    return "auto";
  }

  /** 玩家从耗竭选项中择一(公开,供 UI/bot/联机)。不可用选项硬拒绝(零兜底同机遇)。 */
  resolveExhaustionChoice(index: number): void {
    if (!this.assertPhase("AwaitingExhaustion", "ResolveExhaustionChoice")) return;
    const options = computeChoices(this, "AwaitingExhaustion");
    const opt = options[index];
    if (this.pendingExhaustionSeat == null || !opt) {
      this.warn(`ResolveExhaustionChoice:耗竭上下文缺失或选项越界(index=${index})`);
      return;
    }
    if (!opt.available) {
      this.warn(`ResolveExhaustionChoice:选项不可用(index=${index}${opt.reason ? `,${opt.reason}` : ""})`);
      return;
    }
    this.settleExhaustionChoice(this.pendingExhaustionSeat, index);
  }

  /** 耗竭选项结算(#130):降 1 级 / 失去整座(城回无主)→ skipTurns+1 + 体力重置 → endTurn。 */
  private settleExhaustionChoice(seat: number, index: number): void {
    const p = this.players[seat];
    const options = computeChoices(this, "AwaitingExhaustion");
    const opt = options[index];
    if (!opt?.holdingPropertyId || !opt.exhaustionKind) {
      throw new Error(`耗竭选项结算:选项载荷缺失(index=${index},数据 bug)`); // 零兜底
    }
    const note = opt.label;
    if (opt.exhaustionKind === "downgrade") {
      const holding = findHolding(p, opt.holdingPropertyId);
      if (!holding) throw new Error(`耗竭降级:房产 ${opt.holdingPropertyId} 不在持有列表`);
      holding.level -= 1; // 可用性已保证 level>0
    } else {
      p.properties = p.properties.filter((h) => h.propertyId !== opt.holdingPropertyId); // 城回无主
    }
    this.applyExhaustionAftermath(p, note);
    this.endTurn();
  }

  /** 耗竭善后(#130):跳过下一回合(复用辅路惩罚的 skipTurns 机制)+ 体力重置 100。 */
  private applyExhaustionAftermath(p: Player, note: string): void {
    p.skipTurns += 1;
    p.stamina = 100;
    this.pendingExhaustionSeat = null;
    this.pushFloaterText(p, `体力耗竭:${note},倒地不起(跳过一回合)`, p.position);
    this.logEvent("system", p.guohao, `${p.guohao} 体力耗竭:${note},跳过下一回合,体力回 100`, `exhaustionSettle player=${p.id} skipTurns=${p.skipTurns} stamina=100`);
  }

  /** 机遇触发与抽取(#123)。返回 none/settled(继续落格结算)/deciding(抉择机遇占用本落格,
   *  #124)/liquidating/bankrupt(中断落格结算)。一切随机经 this.dice:触发 roll → 档位
   *  roll → 同档加权抽取,顺序固定保重放。 */
  private maybeApplyEncounter(mover: Player, atTile: number): "none" | "settled" | "deciding" | "liquidating" | "bankrupt" {
    // 天命格是固定声望泉(resolveSpecial +20),不参与机遇 roll(#120 决策 2,评审修正)
    if (this.board.at(atTile).type === "Fate") return "none";
    if (this.encounter.triggerRate <= 0) return "none";
    if (this.dice.nextFloat() * 100 >= this.encounter.triggerRate) {
      // 规格故事 16:每次 roll 与结果都进对局日志(未中也留机读痕)
      this.logEvent("system", mover.guohao, `${mover.guohao} 机遇未降临`, `encounterMiss player=${mover.id} rate=${this.encounter.triggerRate} reputation=${mover.reputation}`);
      return "none";
    }
    const tier = pickTier(this.dice.nextFloat(), tierShares(mover.reputation, this.encounter.shares));
    const def = pickWeighted(ENCOUNTERS.filter((c) => c.tier === tier), this.dice.nextFloat());
    if (def.choices) return this.enterEncounterPhase(mover, atTile, def); // 抉择机遇(#124):不即时结算
    return this.settleEncounter(mover, atTile, def);
  }

  /** 抉择机遇入相(#124):抽中 choices 型机遇后调用。选项集经注册表(choices.ts)计算,
   *  ADR-0013:可用选项 ≤1 → 自动执行唯一可用项(战报+浮字;结盟互市单选项即「自动发生」;
   *  以宝换贤珍宝不足时只剩「婉言相拒」同理),返回 deciding(回合已在收尾中);
   *  ≥2 → 进 AwaitingEncounter 等待 resolveEncounterChoice,返回 deciding。
   *  两种场合机遇都先于城池结算:自动执行已在内部续跑落格结算(返回 deciding),
   *  ≥2 选项由 resolveEncounterChoice 解完后续跑(同在 settleEncounterChoice 内)。 */
  private enterEncounterPhase(mover: Player, atTile: number, def: EncounterDef): "deciding" | "liquidating" | "bankrupt" {
    this.pendingEncounter = def;
    this.lastLandOutcome = { kind: "Noop" };
    this.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」:${def.text}`,
      `encounterAwait player=${mover.id} id=${def.id} tier=${def.tier}`,
    );
    const options = computeChoices(this, "AwaitingEncounter");
    const availableIdx = options.map((o, i) => (o.available ? i : -1)).filter((i) => i >= 0);
    if (availableIdx.length > 1) {
      this.turnPhase = "AwaitingEncounter";
      return "deciding";
    }
    // ≤1 可用选项:自动执行唯一可用项(目录约定必有无门槛选项,availableIdx[0] 恒存在;
    // 空目录=数据 bug,按无事发生收尾并留痕,不卡流程)
    const idx = availableIdx[0];
    if (idx === undefined) throw new Error(`机遇「${def.id}」无可执行选项:choices 与选项注册表不一致(数据 bug)`); // 零兜底:目录数据 bug 应炸出来
    const choice = def.choices![idx];
    this.pushFloaterText(mover, choice.text, atTile);
    const r = this.settleEncounterChoice(mover, atTile, def, choice, idx ?? 0);
    return r === "settled" ? "deciding" : r; // settled=回合已收尾;机遇仍占用本落格
  }

  /** 玩家从抉择机遇选项中择一(公开,供 UI/bot/联机)。index=def.choices 下标(与
   *  snapshot.choices 顺序一致)。不可用选项引擎硬拒绝(可用性唯一口径在注册表,零兜底)。 */
  resolveEncounterChoice(index: number): void {
    if (!this.assertPhase("AwaitingEncounter", "ResolveEncounterChoice")) return;
    const def = this.pendingEncounter;
    const option = def?.choices?.[index];
    if (!def || !option) {
      this.warn(`ResolveEncounterChoice:机遇上下文缺失或选项越界(index=${index})`);
      return;
    }
    const opt = computeChoices(this, "AwaitingEncounter")[index];
    if (!opt?.available) {
      this.warn(`ResolveEncounterChoice:选项不可用(index=${index}${opt?.reason ? `,${opt.reason}` : ""})`);
      return;
    }
    this.settleEncounterChoice(this.activePlayer, this.activePlayer.position, def, option, index);
  }

  /** 抉择选项结算(#124):repDelta 经 addReputation 落账并夹紧 → effect 复用即时机遇结算
   *  (银两支出走支付/清算,与购地同规则)→ 清载荷 → endTurn。对局日志记机遇 id + 所选选项;
   *  liquidating 留给 AwaitingBankruptcySettle 的 confirm 收尾;bankrupt 已在效果内 endTurn;
   *  settled → 继续本落格的城池结算(#120 决策 2,评审修正:原先漏掉购地/过路)。 */
  private settleEncounterChoice(
    mover: Player,
    atTile: number,
    def: EncounterDef,
    option: EncounterChoiceOption,
    index: number,
  ): "settled" | "liquidating" | "bankrupt" {
    const seat = this.players.indexOf(mover);
    // 换贤代价(#124 目录约定):grantHero 型选项先扣 2 件珍宝再得将——代价侧没有对应
    // EncounterEffect,故在选项结算处收口(可用性门槛已保证足量,此处恒扣满)。
    let costDetail = "";
    if (option.effect?.kind === "grantHero") {
      const cost = mover.treasures.splice(0, ENCOUNTER_HERO_TREASURE_COST);
      costDetail = ` costTreasures=${cost.map((t) => t.id).join("+")}`;
    }
    if (option.repDelta !== 0) {
      this.addReputation(seat, option.repDelta);
      this.pushFloaterText(mover, `「${def.id}」声望 ${option.repDelta > 0 ? "+" : ""}${option.repDelta}`, atTile);
    }
    this.logEvent(
      "system",
      mover.guohao,
      `${mover.guohao} 机遇「${def.id}」抉择:${option.text}`,
      `encounterChoice player=${mover.id} id=${def.id} index=${index} repDelta=${option.repDelta} reputation=${mover.reputation} effect=${option.effect?.kind ?? "none"}${costDetail}`,
    );
    this.pendingEncounter = null;
    const r = option.effect
      ? this.applyEncounterEffect(mover, atTile, def, option.effect, option.text)
      : "settled";
    if (r !== "settled") return r; // liquidating=留清算 confirm;bankrupt=效果内已 endTurn
    // 机遇解完 → 继续本落格的城池结算(#120 决策 2,评审修正:原先直接 endTurn 漏掉购地/过路)
    this.turnPhase = "Land";
    this.resolveLanding();
    return r;
  }

  /** 即时机遇结算(#123):效果落账 + 浮字 + 对局日志。机遇自身银两支出走支付/清算(破产与购地同规则)。
   *  玩家间转移(敌营哗变/假道征粮等)为即时动账:上限=付款方现有现金,不触发对方清算
   *  (对方清算会与移动者回合交织——实现取舍,非 #120 豁免,已在 #120 留评说明)。
   *  抉择机遇(#124)无即时效果:结算发生在选项 resolve 阶段(settleEncounterChoice)。 */
  private settleEncounter(mover: Player, atTile: number, def: EncounterDef): "settled" | "liquidating" | "bankrupt" {
    if (!def.effect) return "settled";
    return this.applyEncounterEffect(mover, atTile, def, def.effect, def.text);
  }

  /** 机遇效果结算(即时/抉择两路共用,#123/#124)。narr=战报/浮字叙事段:即时机遇=def.text,
   *  抉择机遇=所选选项文本——机遇 id 保持出自 def,叙事随所选选项走。 */
  private applyEncounterEffect(
    mover: Player,
    atTile: number,
    def: EncounterDef,
    effect: EncounterEffect,
    narr: string,
  ): "settled" | "liquidating" | "bankrupt" {
    const seat = this.players.indexOf(mover);
    const apply = (): "settled" | "liquidating" | "bankrupt" => {
      switch (effect.kind) {
        case "cash": {
          if (effect.delta >= 0) {
            mover.cash += effect.delta;
            this.pushFloater(mover, effect.delta, atTile, "income");
            this.dispatchMoment("CashGained", { subject: seat, amount: effect.delta });
            this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr} +${effect.delta}`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} delta=${effect.delta} cash=${mover.cash}`, effect.delta);
            return "settled";
          }
          const r = this.payOrLiquidate(mover, null, -effect.delta);
          if (r === "liquidating") return "liquidating";
          const bankrupt = r === "bankrupt";
          this.pushFloater(mover, effect.delta, atTile, "expense");
          this.dispatchMoment("CashLost", { subject: seat, amount: -effect.delta });
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr} ${effect.delta}${bankrupt ? " → 破产" : ""}`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} delta=${effect.delta} cash=${mover.cash}`, effect.delta);
          if (bankrupt) this.endTurn();
          return bankrupt ? "bankrupt" : "settled";
        }
        case "grantTreasure": {
          if (this.treasureDeck.length === 0) {
            mover.cash += 100; // 牌堆空 → 转 100 两(探宝的"搜刮一空"口径)
            this.pushFloater(mover, 100, atTile, "income");
            this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:珍宝已被搜刮一空,转得 100 两`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=100 cash=${mover.cash}`, 100);
            return "settled";
          }
          const drawIdx = Math.floor(this.dice.nextFloat() * this.treasureDeck.length);
          const treasure = this.treasureDeck.splice(drawIdx, 1)[0];
          mover.treasures.push(treasure);
          this.pushFloaterText(mover, `机遇「${def.id}」:${narr},得「${treasure.name}」`, atTile);
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},得「${treasure.name}」(Lv.${treasure.level})`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} treasure=${treasure.id}`);
          this.dispatchMoment("TreasureGained", { subject: seat, treasureId: treasure.id });
          return "settled";
        }
        case "grantHero": {
          const candidates = HEROES.filter((h) => !this.recruitedHeroIds.has(h.id));
          if (mover.heroes.length >= HERO_CAPACITY || candidates.length === 0) {
            mover.cash += effect.fallbackCash;
            this.pushFloater(mover, effect.fallbackCash, atTile, "income");
            this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},麾下已满/名将已尽,转得 ${effect.fallbackCash} 两`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=${effect.fallbackCash} cash=${mover.cash}`, effect.fallbackCash);
            return "settled";
          }
          const hero = candidates[Math.floor(this.dice.nextFloat() * candidates.length)];
          mover.heroes.push(hero);
          this.recruitedHeroIds.add(hero.id);
          this.pushFloaterText(mover, `机遇「${def.id}」:${hero.name} 来投`, atTile);
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},得「${hero.name}」:${hero.desc}`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} hero=${hero.id}`);
          this.dispatchMoment("HeroRecruited", { subject: seat, heroId: hero.id });
          return "settled";
        }
        case "grantCity": {
          // 无主城从棋盘 tile 收集(MapCatalog 只暴露 get/groupMembers,不可枚举)
          const unownedCities = this.board.tiles
            .filter((t) => t.type === "Property" && t.propertyId && this.findOwner(t.propertyId) == null)
            .map((t) => ({ tileName: t.name, def: this.catalog.get(t.propertyId) }))
            .filter((c): c is { tileName: string; def: PropertyDef } => c.def != null);
          if (unownedCities.length === 0) {
            mover.cash += effect.fallbackCash;
            this.pushFloater(mover, effect.fallbackCash, atTile, "income");
            this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},已无可归之城,转得 ${effect.fallbackCash} 两`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} fallback=${effect.fallbackCash} cash=${mover.cash}`, effect.fallbackCash);
            return "settled";
          }
          const picked = unownedCities[Math.floor(this.dice.nextFloat() * unownedCities.length)];
          const defCity = picked.def;
          mover.properties.push({
            propertyId: defCity.id,
            group: defCity.group,
            purchasePrice: defCity.buildCost,
            level: 0,
            maxLevel: defCity.maxLevel,
          });
          this.pushFloaterText(mover, `机遇「${def.id}」:${picked.tileName} 归你所有`, atTile);
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},得「${picked.tileName}」`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} city=${defCity.id}`);
          return "settled";
        }
        case "siphon": {
          const target = this.randomOpponentOf(mover);
          if (!target) return "settled";
          const take = Math.min(effect.amount, target.cash);
          target.cash -= take;
          mover.cash += take;
          this.pushFloater(mover, take, atTile, "income");
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},自 ${target.guohao} 得 ${take} 两`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} target=${target.id} take=${take} cash=${mover.cash}`, take);
          return "settled";
        }
        case "levy": {
          const r = this.payOrLiquidate(mover, null, effect.amount);
          if (r === "liquidating") return "liquidating";
          const bankrupt = r === "bankrupt";
          const target = this.randomOpponentOf(mover);
          const paid = bankrupt ? 0 : effect.amount;
          if (target && paid > 0) target.cash += paid;
          this.pushFloater(mover, -paid, atTile, "expense");
          this.dispatchMoment("CashLost", { subject: seat, amount: paid });
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr} −${paid}${bankrupt ? " → 破产" : ""}`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} paid=${paid} target=${target?.id ?? "-"}`, -paid);
          if (bankrupt) this.endTurn();
          return bankrupt ? "bankrupt" : "settled";
        }
        case "trade": {
          const target = this.randomOpponentOf(mover);
          mover.cash += effect.amount;
          if (target) target.cash += effect.amount;
          this.pushFloater(mover, effect.amount, atTile, "income");
          this.logEvent("system", mover.guohao, `${mover.guohao} 机遇「${def.id}」:${narr},你与 ${target?.guohao ?? "诸侯"} 各得 ${effect.amount} 两`, `encounter player=${mover.id} id=${def.id} tier=${def.tier} target=${target?.id ?? "-"} gain=${effect.amount}`, effect.amount);
          return "settled";
        }
      }
    };
    return apply();
  }

  /** 随机存活对手(#123):无可用对手(全部破产/单人)返回 null,调用方静默跳过转移。 */
  private randomOpponentOf(mover: Player): Player | null {
    const others = this.players.filter((p) => p !== mover && !p.isBankrupt);
    if (others.length === 0) return null;
    return others[Math.floor(this.dice.nextFloat() * others.length)];
  }

  /** 文案浮字入队(ADR-0013 唯一选项自动执行的轻提示,无金额):渲染为棋盘一行小字。 */
  private pushFloaterText(p: Player, text: string, atTile: number): void {
    this.floaters.push({ playerIndex: this.players.indexOf(p), amount: 0, atTile, kind: "msg", text });
  }
  // 原 public drainFloaters 已并入 presentation 视图(候选4:破坏性读语义文档化在视图类型上)。

  /** 表现轨迹注入通道(联机快照 diff / 将来观战回放共用):
   *  写入一段外部推导的行军轨迹供动画层读取;null 清除。
   *  唯一允许表现侧设置 lastMove 的合法入口(红线 3:引擎态变更须走公共方法)。 */
  applyPresentationMove(path: MovePath | null): void {
    this.lastMove = path;
  }

  /** 表现掷骰注入通道(与 applyPresentationMove 对偶):序列化单点清单的恢复回写专用
   *  (lastRoll 私有、presentation 视图只读,快照恢复是唯一合法外部写口)。 */
  applyPresentationRoll(roll: DiceRoll | null): void {
    this.lastRoll = roll;
  }

  // ──────────────────────────── 调试快照(供 window.__dafung / 测试) ────────────────────────────
  snapshot() {
    return serializeGame(this);
  }

  // ──────────────────────────── 跨进程重建(CLI 持久化 / 联机快照恢复) ────────────────────────────
  // 用 serialized snapshot 重建引擎状态。前提:构造时 seats/target/startingCash 已匹配快照;
  // 本方法只覆盖可变状态。哪些字段参与序列化、各自怎么读写的单点清单见 snapshot.ts 的
  // SNAPSHOT_FIELDS(serialize 与 restore 共享成对表);无法恢复的瞬时字段(floaters/
  // lastTransaction)在此清空,不参与清单。
  restoreFromSnapshot(s: GameSnapshot): void {
    restoreGameSnapshot(this, s);
    this.lastTransaction = null; // 瞬时不序列化:恢复即清
    this.floaters = [];
    this.propertyChanges = []; // 瞬时不序列化:恢复即清(ADR-0015 留痕同 floaters 口径)
    // 抉择机遇载荷回链(#124):pendingEncounter 不单列序列化,机遇 id 随派生 choices
    // (选项携带 encounterId)过网,此处按 id 从目录重建引用——与 pendingLand 的
    // 「id 句柄 + 目录现查」同模式。查无(目录版本不符/外来快照)→ 显式降级:留痕警告
    // 并退回 Roll(该玩家重掷、机遇作废),不卡死相位。
    if (this.turnPhase === "AwaitingExhaustion") {
      // 耗竭座位 = 行动者本人(#130):耗竭恒发生在本人回合内,恢复按 activeIndex 重派生
      this.pendingExhaustionSeat = this.activeIndex;
    }
    if (this.turnPhase === "AwaitingEncounter") {
      const encId = s.choices.find((o) => o.encounterId != null)?.encounterId;
      const def = encId != null ? ENCOUNTERS.find((c) => c.id === encId) : undefined;
      if (def) {
        this.pendingEncounter = def;
      } else {
        // 零兜底:目录版本不符/外来快照属数据损坏,应崩出来而非静默作废玩家机遇
        throw new Error(`快照恢复:抉择机遇上下文缺失(id=${encId ?? "-"})`);
      }
    }
  }
}

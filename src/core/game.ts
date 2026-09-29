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
import { computeChoices, type ChoiceOption } from "./choices";
import { EFFECTS, type EffectCtx } from "./effects";
import { netWorth } from "./networth";
import { findHolding } from "./player";
import { serializeGame, restoreGameSnapshot, type GameSnapshot } from "./snapshot";
import type { MapCatalog } from "./board-loader";
import { GUOHAO_POOL } from "./theme";
import {
  ENCOUNTERS,
  resolveEncounterConfig,
  type EncounterConfig,
  type EncounterDef,
  type EncounterRuntimeConfig,
} from "./encounters";
import { JINNANG_STARTING_HAND, buildJinnangDeck, jinnangCardOf } from "./jinnang";
import type {
  JinnangPeek,
  PendingJinnang,
  PendingHeroSkill,
  PendingReaction,
} from "./types";
// 反应窗域(#318,ADR-0019):开窗/应答/结算逻辑在 reaction-window.ts,壳内薄委托转发。
// bot 即席应答策略(botReactionDecision)由域模块直接消费——bot 对 game 仅 type 依赖,无运行时环。
// (#323:域外挂点 openReactionWindow 的私有壳委托随移动结算域迁出而删——调用点
// marchTraverse 进了 movement-flow.ts,改直调已导出的自由函数,壳内只留 respondReaction。)
import { respondReaction } from "./reaction-window";
// 锦囊+主动技+效果执行域(#319,ADR-0019):军师幕决策/出牌/效果结算在 jinnang-execution.ts,
// 壳内同名公共方法薄委托转发;reaction-window 续结算经壳上 executeJinnang/settleJinnangExit 回调。
import {
  drawJinnang,
  enterJinnangPhase,
  executeJinnang,
  resolveHeroSkill,
  resolveJinnang,
  settleJinnangExit,
} from "./jinnang-execution";
// 机遇主流程+体力耗竭域(#320,ADR-0019):机遇触发抽取/抉择机遇入相与选项结算/效果
// 结算/体力接线与耗竭善后在 encounter-flow.ts,壳内同名方法薄委托;与数据表 encounters.ts
// 分层(流程≠配置)。
import {
  enterEncounterPhase,
  exhaustIfDepleted,
  maybeApplyEncounter,
  resolveEncounterChoice,
  resolveExhaustionChoice,
  settleEncounter,
} from "./encounter-flow";
// 破产清算+交割托管域(#321,ADR-0019):escrow 交割/退回、付款或清算、债务留痕结算、
// 破产善后与凑足即止硬守卫、三变卖与清算确认在 bankruptcy.ts,壳内同名方法薄委托转发;
// 与 economy.ts 分层(清算流程≠经济交易原语)。
import {
  cashHeroBankruptcy,
  confirmBankruptcySettle,
  deliverEscrow,
  payOrLiquidate,
  returnEscrowToSeller,
  sellPropertyBankruptcy,
  sellTreasureBankruptcy,
} from "./bankruptcy";
// 珍宝+随机事件+城主交涉域(#322,ADR-0019):宝物城/辅路格结算、抽宝拼点、随机事件、
// 城主交涉(escrow 托管)在 treasure-flow.ts,壳内同名方法薄委托转发;与数据表
// treasures.ts 分层(流程≠数据)。
import {
  resolveBranchCell,
  resolveTreasureCity,
  resolveTreasureOwner,
} from "./treasure-flow";
// 移动结算域(#323,ADR-0019):行军三件/辅路抉择/地产决策/落格结算/都城补给在
// movement-flow.ts,壳内同名公共方法薄委托转发;reaction-window 续走经壳上
// marchTraverse/settleMarchLanding 回调,开拦检窗由域模块直调 openReactionWindow。
import {
  buyProperty,
  capitalSupplyOf,
  endDecision,
  marchTraverse,
  pendingLandDef,
  resolveLanding,
  rollAndMove,
  selectBranch,
  settleMarchLanding,
  upgradeProperty,
} from "./movement-flow";
import { formatMoney } from "./money";
import {
  isSingleCjk,
  STARTING_WARRANTS,
  HERO_CAPACITY,
  STAMINA_MAX,
  STARTING_STAMINA,
} from "./constants";
import { HEROES } from "./heroes";
import { createTreasureDeck } from "./treasures";
import type { DiceRoll, TreasureDef } from "./types";

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
  /** 反应窗时长覆盖(#284):联机权威侧 env E2E_REACTION_MS 经 registry 传入;缺省=查
   *  REACTION_WINDOW_MS 常量表。开窗时写入 view.windowMs 随快照下发,客户端横幅投影与
   *  权威侧定时器同读一份(两端同长自动成立)。 */
  reactionWindowMs?: number;
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
  useJinnang: "用锦囊",
  useHeroSkill: "出技",
  respondReaction: "反应窗应答",
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

/** 出牌指示线留痕(#281/P2-E,ADR-0010 表现事件流的 core 侧发射点):锦囊/反应牌生效点
 *  写入「使用者 token → 目标 token」墨线素材,表现提取器经 engine.presentation
 *  .drainJinnangPlays() 一次性取走(破坏性读,同 drainPropertyChanges 口径)。
 *  瞬态不序列化(同 floaters/propertyChanges)——单机本地编排通道;联机信号源是
 *  可序列化的 `lastJinnangPlay`(最近一条留痕,客户端快照 diff 提取),两者由
 *  traceJinnangPlay 同点写入、注释互指。 */
export interface JinnangPlayTrace {
  userSeat: number;
  targetSeats: number[];
  cardId: string;
}

/** 最近出牌留痕(#284,可序列化联机信号源):锦囊/反应牌生效点由 traceJinnangPlay
 *  与瞬态 jinnangPlays 同点写入。**批形状**:seq 是批号(一批=两次封批之间的全部
 *  留痕,同批多条——如 AOE 多人识破循环——聚在同一 plays 里),单调递增防「同参数
 *  牌」diff 去重失效;若只存末条,同批多条留痕在联机只剩一条(2026-09-28 双轴评审
 *  实锤)。出牌是公开事件,redact 不裁(公开信息);入 SNAPSHOT_FIELDS,客户端
 *  SnapshotEffects diff seq 变化即对 plays 逐条产既有 jinnangPlayed 表现事件(禁立
 *  第二 WS 事件通道,ADR-0010)。 */
export interface LastJinnangPlay {
  seq: number;
  plays: JinnangPlayTrace[];
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
  /** 锦囊牌库/弃牌堆(#122):开局 finishSetup 洗序;抽牌从堆顶(pop)出。
   *  公开字段(重放/快照/CLI 可读),可见性由传输层投影裁剪(ADR-0016)。 */
  jinnangDeck: string[] = [];
  jinnangDiscard: string[] = [];
  /** 本回合已占用的锦囊标签(#122/T2):回合开始清空;每类限一张的名额账本。 */
  jinnangUsedTags: string[] = [];
  /** 锦囊目标段载荷(#122/T3):选牌后进入选人子状态;null=卡牌段。随快照走。 */
  pendingJinnang: PendingJinnang | null = null;
  /** 技能目标段载荷(#188 档 3):军师幕内选技后的选人子状态;null=无。与 pendingJinnang
   *  互斥(同一时刻至多一个子状态)。随快照走(目标段中途断线可恢复)。 */
  pendingSkill: PendingHeroSkill | null = null;
  /** 擂鼓步数加成(#188 档 3):军师幕发动 warDrum 技写入,本回合 rollAndMove 掷骰后
   *  取走清零。可序列化——发动与掷骰之间可被快照广播/落盘,与瞬态 marchBonus(同一次
   *  rollAndMove 内写读平衡)不同,必须跨进程保真。 */
  heroDiceBonus = 0;
  /** 进行中的窥探(#122/T4):viewer 至其下回合开始可见 target 手牌内容(投影放行)。 */
  jinnangPeeks: JinnangPeek[] = [];
  /** 锦囊牌库剩余数(公开信息):联机投影裁掉牌序后据此透出(同 jinnangHandCount 口径)。 */
  jinnangDeckCount = 0;
  /** 反应窗挂起态(#281,ADR-0017):null=无窗。挂起点存公告/应答/续结算载荷 →
   *  AwaitingReaction 相位 → 应答齐(或 bot 即席代答齐)→ 续结算。全部随快照走
   *  (SNAPSHOT_FIELDS 单点清单);人类被询问时窗跨命令存续,bot 全被询问时在开窗
   *  同一调用内即席应答并续结算(ADR-0017「bot 持牌即时代答不等满」),相位不外显。 */
  pendingReaction: PendingReaction | null = null;
  /** 窗/留痕共用的单调流水号(#284):开反应窗写 PendingReaction.seq、出牌留痕写
   *  lastJinnangPlay.seq,均取 nextJinnangSeq()。cmd 流派生状态,重放重算天然复现;
   *  快照恢复后在 restoreFromSnapshot 里按「快照内已见的最大 seq」推回(单调不回退)。 */
  jinnangSeq = 0;
  /** 最近出牌留痕(#284,联机信号源,批形状见 LastJinnangPlay):写入见 traceJinnangPlay;
   *  随快照序列化(SNAPSHOT_FIELDS 单点清单)。null=本局尚无出牌。 */
  lastJinnangPlay: LastJinnangPlay | null = null;
  /** 当前留痕批(瞬态不序列化,别名指向 lastJinnangPlay):**批界=快照封批**——
   *  权威侧每次产快照广播前调 sealJinnangPlayBatch() 关批,下一条留痕重新取号成批。
   *  bot 链不经 submitCommand,批界不能挂命令口(否则 bot 连续出牌丢线,#284 评审)。 */
  jinnangPlayBatch: LastJinnangPlay | null = null;
  /** 封批(权威侧产快照前调,server.ts broadcast flush):下一条留痕重新取号。 */
  sealJinnangPlayBatch(): void {
    this.jinnangPlayBatch = null;
  }
  /** 反应窗时长覆盖(#284):EngineConfig.reactionWindowMs(联机权威侧 env 注入);
   *  0 = 无覆盖,开窗时按窗种类查 REACTION_WINDOW_MS 常量表。 */
  readonly reactionWindowMsOverride: number;
  // #320 去私有化(ADR-0019 条款 3):机遇域 encounter-flow.ts 经 g.encounter 直读触发率/档位配比
  encounter: EncounterRuntimeConfig = resolveEncounterConfig(); // 缺省=关闭
  treasureVisitor: { def: PropertyDef; ownerIdx: number } | null = null; // 公道买卖/坐地起价:当前城主视角
  pendingDebt: { amount: number; creditor: Player | null } | null = null; // 破产清算:待清偿债务(凑够自救,凑不够破产)
  // 珍宝交涉交割托管:成交后买家付清价款前,珍宝暂存于此(序列化友好纯数据;买家不可变卖托管物抵债)。
  escrowTreasure: {
    treasure: TreasureDef;
    buyerIdx: number;
    sellerIdx: number;
    price: number;
  } | null = null;

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
  // 四个字段语义曾散在注释里:floaters 读即破坏(渲染消费后清空)、
  // lastMove 表现侧可写(applyPresentationMove)、lastRoll/lastTransaction 每帧重建。
  // 对外统一经 presentation 视图(见 getter):
  //  - 读:engine.presentation.lastRoll / lastMove / lastTransaction(只读);
  //  - 浮字消费:engine.presentation.drainFloaters()(破坏性读,调用即清空);
  //  - 表现写 lastMove 的唯一通道仍是 applyPresentationMove(保留原位)。
  // 视图是方法的集合(非可序列化数据),不进 snapshot;序列化走 snapshot.ts 经视图读。
  // #107 C2「字段本身不再 public」经 ADR-0019 条款 3 取代(2026-09-29,owner 授权):
  // lastMove 随 #318、lastRoll/lastTransaction 随 #323 相应域抽出后,域模块经 g. 直写;
  // 外部消费面不变(仍只走 presentation 视图),字段可见性仅对域模块放开。
  // #323 去私有化(ADR-0019 条款 3 内部状态透明):movement-flow 域 rollAndMove/buyProperty
  // /upgradeProperty 直写;外部消费仍只走 presentation 视图。
  lastRoll: DiceRoll | null = null;
  // #107 C2「字段本身不再 public」经 ADR-0019 条款 3 取代(2026-09-29,owner 授权):
  // 域模块(reaction-window.ts 等)经 g.lastMove 直写;外部消费仍只走 presentation 视图。
  lastMove: MovePath | null = null;
  // 纯表现态(spec #107 C2 退役:不再兼任决策载荷):供快照扁平字段(lastLandOutcomeKind/
  // lastLandOutcomeProperty)与战报金额;决策命令/选项集/恢复重建一律改走 pendingLand。
  lastLandOutcome: LandOutcome | null = null;
  // #323 去私有化(ADR-0019 条款 3 内部状态透明):movement-flow 域 buyProperty
  // /upgradeProperty 直写交易结果;外部消费仍只走 presentation 视图。
  lastTransaction: TransactionResult | null = null;

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
  /** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家),渲染层消费后清空。
   *  #319 去 private(ADR-0019 条款 3 内部状态透明):jinnang-execution 域直写;外部消费仍只走 presentation.drainFloaters。 */
  floaters: FloaterEvent[] = [];
  /** 城池变更留痕(ADR-0015,类型注释见 PropertyChangeTrace):结算点写入,
   *  提取器一次性取走;瞬态不序列化(同 floaters,restore 即清)。
   *  #319 去 private(ADR-0019 条款 3 内部状态透明):jinnang-execution 域直写;外部消费仍只走 presentation.drainPropertyChanges。 */
  propertyChanges: PropertyChangeTrace[] = [];
  /** 出牌指示线留痕(#281,类型注释见 JinnangPlayTrace):生效点写入,提取器一次性取走;
   *  瞬态不序列化(同 floaters,restore 即清)。 */
  jinnangPlays: JinnangPlayTrace[] = [];

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
    /** 破坏性读:返回并清空全部出牌指示线留痕(#281/P2-E)。 */
    drainJinnangPlays(): JinnangPlayTrace[];
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
      drainJinnangPlays: () => {
        const t = this.jinnangPlays;
        this.jinnangPlays = [];
        return t;
      },
    };
  }

  constructor(board: Board, cat: Catalog, dice: Dice, config: EngineConfig) {
    this.board = board;
    this.catalog = cat;
    this.dice = dice;
    this.targetNetWorth = config.targetNetWorth ?? DEFAULT_TARGET;
    this.startingCash = config.startingCash ?? DEFAULT_CASH;
    this.difficulty = config.difficulty ?? "Normal";
    this.mapId = config.mapId ?? "";
    this.reactionWindowMsOverride = config.reactionWindowMs ?? 0;
    this.encounter = resolveEncounterConfig(config.encounter);
    this.seed = this.dice.getRngState(); // mulberry32 未滚前 getState = 种子本身
    this.gameId = newGameId();
    if (config.seats.length < 2 || config.seats.length > 8) throw new Error("支持 2–8 个座位。");
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
      stamina: STARTING_STAMINA,
      jinnangHand: [], // 锦囊手牌(#122):开局发牌在 finishSetup
      jinnangHandCount: 0,
      repMilestones: [],
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
        // 机遇原始配置(#135):触发判定消耗骰流,重放必须复刻同一配置(缺省=null=机遇关,
        // 与历史日志兼容);重放端 replay-log 原样传回构造 config。
        encounter: config.encounter ?? null,
        seats: config.seats.map((s, i) => ({
          seat: i,
          guohao: s.guohao ?? "",
          isBot: s.isBot,
          colorIndex: i,
        })),
      }),
    );
    this.logEvent(
      "system",
      null,
      "开局:群雄逐鹿",
      `目标身价 ${formatMoney(this.targetNetWorth)} 起手 ${formatMoney(this.startingCash)}`,
    );
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
      ? (this.treasureVisitor?.ownerIdx ?? this.activeIndex)
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
    return (
      this.activePlayer.onBranch == null && this.board.getBranchStart(this.activePlayer.position)
    );
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
    const pool = shuffle(
      GUOHAO_POOL.filter((c) => !this.usedGuohao.has(c)),
      this.dice.nextFloat,
    );
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
    const rolls = Array.from({ length: n }, () => 0);
    const canBeAllDistinct = n <= 6;
    for (let attempt = 0; attempt < 50; attempt++) {
      for (let i = 0; i < n; i++) rolls[i] = this.dice.rollDie();
      if (!canBeAllDistinct || new Set(rolls).size === n) break;
    }
    this.draftRolls = rolls;
    this.draftOrder = this.players.map((_, i) => i).sort((a, b) => rolls[b] - rolls[a] || a - b);
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
        this.difficulty === "Simple" ? this.dice.nextFloat() * 2.0 : this.dice.nextFloat() * 0.3;
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

  private pickCapitalInternal(
    playerIndex: number,
    tileIndex: number,
    logCmd: boolean,
  ): { ok: boolean; reason?: string } {
    if (this.setupPhase !== "PickCapital") return { ok: false, reason: "非选都阶段" };
    if (this.draftOrder[this.currentDraftIndex] !== playerIndex)
      return { ok: false, reason: "未轮到该玩家" };
    const tile = this.board.at(tileIndex);
    if (!tile.isCapitalEligible) return { ok: false, reason: "该城不可作都城" };
    if (this.takenCapitalIndices.has(tileIndex)) return { ok: false, reason: "该城已被选" };
    if (!this.offeredCapitals.includes(tileIndex)) return { ok: false, reason: "非本轮候选城" };
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
    priced.forEach((x, i) =>
      tiers[Math.min(2, Math.floor((i * 3) / Math.max(1, priced.length)))].push(x),
    );
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
    // 锦囊发牌(#122):牌库洗序后座位序各发起手张数——先于 GameStart 时机,
    // 骰流消耗固定(洗牌 + n 人各一张),重放可复现。
    this.jinnangDeck = buildJinnangDeck(this.dice);
    this.jinnangDeckCount = this.jinnangDeck.length;
    this.players.forEach((_, seat) => this.drawJinnang(seat, JINNANG_STARTING_HAND));
    this.enterJinnangPhase(); // 首回合掷骰前即可用锦囊(#122/T2)
    this.dispatchMoment("GameStart", { subject: this.roundAnchor }); // 时机·GameStart:对局开始(主体=首动者),先于首个 TurnStart
    this.dispatchMoment("TurnStart", { subject: this.activeIndex }); // 时机·TurnStart:开局首个回合(进 Playing 时)
  }

  // ──────────────────────────── 回合状态机 ────────────────────────────
  // 移动结算域(#323,ADR-0019 委托式拆分):行军三件(rollAndMove/marchTraverse/
  // settleMarchLanding,含伏兵挂点/驻跸必停/辅路入口)、辅路抉择(selectBranch)、
  // 待决策落格定义(pendingLandDef)、地产决策命令(buyProperty/upgradeProperty/
  // endDecision)、落格结算(resolveLanding;resolveSpecial/resolveProperty/
  // enterDecisionPhase 域内自洽不留壳)与都城补给(capitalSupplyOf;applyResupply
  // 域内自洽不留壳)均为自由函数,在 movement-flow.ts,首参接引擎实例。
  // 壳内仅留同名公共方法薄委托(外部 importer 无感):命令口经 submitCommand 分发、
  // bot 直调、testing.ts 白盒窄面触达 resolveLanding。跨域往返与既有票一致走壳上
  // 薄委托:reaction-window 续走经 g.marchTraverse/g.settleMarchLanding 回调;机遇/
  // 宝物城/辅路格/escrow/锦囊抽牌/招贤经各自壳上方法消费;开拦检窗由域模块直调
  // reaction-window.openReactionWindow(已导出自由函数,#318 预留的私有壳委托随本域
  // 迁出而删,见反应窗区段)。

  /** 抽签 → 移动(主路或辅路逐格)→ 落格结算:薄委托 → movement-flow.rollAndMove。 */
  rollAndMove(): void {
    rollAndMove(this);
  }

  /** 主路途经遍历(#281,途经棋子/驻跸必停/伏兵拦检):薄委托 → movement-flow.marchTraverse
   *  (reaction-window 拦检续走经此回调)。 */
  marchTraverse(
    mover: Player,
    remaining: number[],
    totalLen: number,
    landIndex: number,
    wasOnBranch: boolean,
    fromPos: number,
    steps: number,
  ): "landed" | "halted" | "suspended" {
    return marchTraverse(this, mover, remaining, totalLen, landIndex, wasOnBranch, fromPos, steps);
  }

  /** 主路落格收尾(辅路入口抉择/机遇/落格结算):薄委托 → movement-flow.settleMarchLanding
   *  (reaction-window 拦检续走经此回调)。 */
  settleMarchLanding(mover: Player, landIndex: number, wasOnBranch: boolean): void {
    settleMarchLanding(this, mover, landIndex, wasOnBranch);
  }

  // ──────────────────────────── 反应窗(#281,ADR-0017)────────────────────────────
  // 域逻辑在 reaction-window.ts(ADR-0019 委托式拆分,#318):开窗/应答/识破窗结算/
  // 拦检窗结算/拦停止步/续走/拼点均为自由函数,首参接引擎实例。壳内仅留:
  //  - 公共方法 respondReaction 薄委托(外部 importer 无感);
  //  - 域外挂点 openReactionWindow 私有薄委托已随 #323 移动结算域迁出而删:唯一调用点
  //    marchTraverse 进了 movement-flow.ts,与锦囊执行(#319)同款改直调已导出的自由函数。

  /** 反应窗应答(#281 公共入口,UI/bot 驱动器/联机/超时代发同走):薄委托。 */
  respondReaction(seat: number, use: boolean, cardId?: string, shareSeat?: number): void {
    respondReaction(this, seat, use, cardId, shareSeat);
  }

  /** 辅路入口抉择(走大路/入辅路):薄委托 → movement-flow.selectBranch。 */
  selectBranch(kind: RouteKind): void {
    selectBranch(this, kind);
  }

  /** 待决策落格的地产定义(价格/等级口径单一出处):薄委托 → movement-flow.pendingLandDef
   *  (choices.ts/bot 经壳消费)。 */
  pendingLandDef(): PropertyDef {
    return pendingLandDef(this);
  }

  /** 购地(决策命令):薄委托 → movement-flow.buyProperty。 */
  buyProperty(): void {
    buyProperty(this);
  }

  /** 扩军(决策命令):薄委托 → movement-flow.upgradeProperty。 */
  upgradeProperty(): void {
    upgradeProperty(this);
  }

  /** 按兵不动(决策命令):薄委托 → movement-flow.endDecision。 */
  endDecision(): void {
    endDecision(this);
  }

  // #322 去私有化(ADR-0019 条款 3):treasure-flow 交涉 fair 分支留痕经 g.tileName 直调。
  tileName(def: PropertyDef): string {
    const t = this.board.tiles.find((x) => x.propertyId === def.id);
    return t ? t.name : def.id;
  }

  // ──────────────────────────── 落格处理 ────────────────────────────

  /** 落格结算(己都城/卧龙岗/宝物城/特殊格/城池分流):薄委托 → movement-flow.resolveLanding
   *  (testing.ts 白盒窄面、reaction-window 拦停止步与 encounter-flow 机遇解毕续结算经此)。 */
  resolveLanding(): void {
    resolveLanding(this);
  }

  /** 都城补给量查询(tile→def→holding→supplyFor 查找链,测试断言消费):
   *  薄委托 → movement-flow.capitalSupplyOf。 */
  capitalSupplyOf(player: Player): { supply: number; level: number } {
    return capitalSupplyOf(this, player);
  }

  // ──────────────────────────── 回合结束 / 胜负 ────────────────────────────
  // #320 去私有化(ADR-0019 条款 3):机遇/耗竭域 encounter-flow.ts 结算路径直调 g.endTurn 收尾回合
  endTurn(): void {
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
    // 锦囊回合开账(#122/T2):标签名额清零,随后若有可用牌则进锦囊卷轴相位(掷骰前)。
    // (#281:免战盾随免战金牌退役,到期清理一并删除。)
    this.jinnangUsedTags = [];
    this.jinnangPeeks = this.jinnangPeeks.filter((pk) => pk.viewer !== this.activeIndex); // 窥探至 viewer 下回合开始到期
    this.enterJinnangPhase();
    // 不重置 lastRoll / lastMove:doRoll 的骰子翻滚与行军动画在 rollAndMove 之后执行,
    // 而落点有主(珍宝交涉/自己城补给)时 rollAndMove 会内部 endTurn,重置会让 doRoll 读到 null 而崩。
    // 下次 rollAndMove 会覆盖这两个值,故无需手动清空。
    this.lastLandOutcome = null;
    // 决策完成(购/扩/跳过)即清除待决策落格载荷;抉择机遇同理(#124,正常流已在
    // settleEncounterChoice 清除,此处是回合收口的兜底扫除)
    this.pendingLand = null;
    this.pendingEncounter = null;
    this.pendingJinnang = null; // 目标段中途回合被收口(异常/终局):不留悬载荷
    this.pendingReaction = null; // 反应窗同理(#281):回合收口不留悬窗
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
    if (reached.length > 0) return { winner: reached[0], reason: "TargetNetWorth" };
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
  // 域逻辑在 treasure-flow.ts(#322,ADR-0019 委托式拆分):宝物城落格与辅路格结算
  // (resolveTreasureCity/resolveBranchCell)、抽宝拼点(drawTreasureAt)、随机事件结算
  // (applyRandomEvent)与城主交涉(resolveTreasureOwner)均为自由函数,首参接引擎实例;
  // 与数据表 treasures.ts 分层(流程≠数据)。escrow 托管两步经 bankruptcy.ts 的壳上薄委托
  // g.deliverEscrow/g.returnEscrowToSeller 往返消费。壳内仅留同名方法薄委托:公共入口
  // resolveTreasureOwner(UI/bot/联机经 submitCommand 分发)+ 宝物城/辅路两步(壳内
  // resolveLanding/marchTraverse 消费 + testing.ts 白盒窄面);drawTreasureAt/applyRandomEvent
  // 域内自洽,不留壳。

  /** 宝物城落格:薄委托 → treasure-flow.resolveTreasureCity(#323 去私有化 ADR-0019 条款 3:
   *  落格结算 movement-flow.resolveLanding 经 g. 直调)。 */
  resolveTreasureCity(mover: Player, tile: TileDef): void {
    resolveTreasureCity(this, mover, tile);
  }

  /** 辅路格落格:薄委托 → treasure-flow.resolveBranchCell(#323 去私有化:行军途经
   *  marchTraverse 调用点迁 movement-flow 后经 g. 直调;testing.ts 白盒窄面照旧)。 */
  resolveBranchCell(mover: Player, cell: BranchCell): void {
    resolveBranchCell(this, mover, cell);
  }

  /** 城主抉择:公道买卖/坐地起价/跳过(escrow 托管语义见 treasure-flow.resolveTreasureOwner)。薄委托。 */
  resolveTreasureOwner(
    action:
      | { type: "fair"; treasureId: string }
      | { type: "premium"; treasureId: string }
      | { type: "skip" },
  ): void {
    resolveTreasureOwner(this, action);
  }

  // ──────────────── 破产清算(变卖资产自救)+ 交割托管(#321,ADR-0019)────────────────
  // 域逻辑在 bankruptcy.ts(#321):escrow 交割/退回(deliverEscrow/returnEscrowToSeller)、
  // 付款或清算(payOrLiquidate)、债务结算留痕(settleDebtTraced)、可变卖资产判定
  // (hasMarketableAssets)、破产善后(finalizeBankruptcy)、凑足即止硬守卫
  // (assertStillOwing)、三变卖(sellTreasure/sellProperty/cashHero)与清算确认
  // (confirmBankruptcySettle)均为自由函数,首参接引擎实例;与 economy.ts 分层(清算
  // 流程≠经济交易原语)。壳内仅留同名方法薄委托:公共五入口(UI/bot/联机 + testing.ts
  // 白盒窄面 + encounter-flow 经 g.payOrLiquidate 消费)+ escrow 交割/退回两步(去私有化:
  // resolveTreasureOwner 壳内消费、confirmBankruptcySettle 域内直调)。

  /** 交割托管:买家付清价款 → 珍宝交货给买家。薄委托 → bankruptcy.deliverEscrow
   *  (#321 去私有化 ADR-0019 条款 3:escrow 挂起后的交割/退还两步,壳与域双向消费)。 */
  deliverEscrow(): void {
    deliverEscrow(this);
  }

  /** 交割托管:买家破产 → 未付款的托管珍宝退回卖家。薄委托 → bankruptcy.returnEscrowToSeller。 */
  returnEscrowToSeller(): void {
    returnEscrowToSeller(this);
  }

  /** 付款或触发清算:现金够→扣款("ok");不够但有可变卖资产→AwaitingBankruptcySettle("liquidating");无资产→破产("bankrupt")。
   *  薄委托 → bankruptcy.payOrLiquidate(#320/#321 去私有化 ADR-0019 条款 3:机遇域
   *  encounter-flow.ts 效果结算直调;testing.ts 白盒窄面亦经此公共面触达)。 */
  payOrLiquidate(
    mover: Player,
    creditor: Player | null,
    amount: number,
  ): "ok" | "liquidating" | "bankrupt" {
    return payOrLiquidate(this, mover, creditor, amount);
  }

  /** propertyId → tile 索引(引擎数据不变量:catalog 地产恰在一格;查无 = 数据 bug,当场抛出)。
   *  #321 去私有化(ADR-0019 条款 3):破产清算域 bankruptcy.ts 留痕路径经 g.tileIndexOfProperty 直调。 */
  tileIndexOfProperty(propertyId: string): number {
    const t = this.board.tiles.find((x) => x.propertyId === propertyId);
    if (t == null) throw new Error(`propertyChange:城 ${propertyId} 不在棋盘(数据 bug)`);
    return t.index;
  }

  /** 变卖珍宝抵债(命令):薄委托 → bankruptcy.sellTreasureBankruptcy。 */
  sellTreasureBankruptcy(treasureId: string): void {
    sellTreasureBankruptcy(this, treasureId);
  }

  /** 变卖城池抵债(命令):薄委托 → bankruptcy.sellPropertyBankruptcy。 */
  sellPropertyBankruptcy(propId: string): void {
    sellPropertyBankruptcy(this, propId);
  }

  /** 遣散名将换银(命令):薄委托 → bankruptcy.cashHeroBankruptcy。 */
  cashHeroBankruptcy(heroId: string): void {
    cashHeroBankruptcy(this, heroId);
  }

  /** 清算确认(命令):凑足清偿/变卖殆尽破产,薄委托 → bankruptcy.confirmBankruptcySettle。 */
  confirmBankruptcySettle(): void {
    confirmBankruptcySettle(this);
  }

  // ──────────────────────────── 命令接口(联机预留) ────────────────────────────
  // 所有玩家操作通过 submitCommand 统一入口提交;state.ts(热座)和将来的
  // network-client.ts(联机)都调用这一个方法。联机时服务器的消息处理器只需:
  //   socket.on("command", cmd => engine.submitCommand(cmd))
  submitCommand(cmd: GameCommand): void {
    // 命令流(ADR-0014):每条玩家命令在统一入口记一行 cmd(detail=完整命令 JSON,重放的
    // 机读层)。bot 路径(botAct/aiSetupStepFor 直调引擎方法)不经此口 → 不产生 cmd 行:
    // 给定 seed 后 bot 行为确定,重放自动重算(见 docs/reference/对局日志.md「命令流重放」)。
    // 反应窗应答(#281)例外:归属=被询问座位(cmd.seat,非 decisionOwner——反应窗天然
    // 多属主),seat 随命令过网,与 pickCapital 的 seat 随 detail 过网同款。
    if (cmd.type === "respondReaction") {
      const responder = this.players[cmd.seat];
      this.logEvent(
        "cmd",
        responder.guohao,
        `${responder.guohao} 提交命令:${CMD_BRIEF[cmd.type]}`,
        JSON.stringify(cmd),
      );
      return this.respondReaction(cmd.seat, cmd.use, cmd.cardId, cmd.shareSeat);
    }
    const issuer = this.players[this.decisionOwner];
    this.logEvent(
      "cmd",
      issuer.guohao,
      `${issuer.guohao} 提交命令:${CMD_BRIEF[cmd.type]}`,
      JSON.stringify(cmd),
    );
    switch (cmd.type) {
      case "rollAndMove":
        return this.rollAndMove();
      case "selectBranch":
        return this.selectBranch(cmd.kind);
      case "buyProperty":
        return this.buyProperty();
      case "upgradeProperty":
        return this.upgradeProperty();
      case "endDecision":
        return this.endDecision();
      case "resolveHeroPick":
        return this.resolveHeroPick(cmd.index);
      case "resolveEncounterChoice":
        return this.resolveEncounterChoice(cmd.index);
      case "resolveExhaustionChoice":
        return this.resolveExhaustionChoice(cmd.index);
      case "resolveTreasureOwner":
        return this.resolveTreasureOwner(cmd.action);
      case "sellTreasureBankruptcy":
        return this.sellTreasureBankruptcy(cmd.treasureId);
      case "sellPropertyBankruptcy":
        return this.sellPropertyBankruptcy(cmd.propId);
      case "cashHeroBankruptcy":
        return this.cashHeroBankruptcy(cmd.heroId);
      case "confirmBankruptcySettle":
        return this.confirmBankruptcySettle();
      case "useJinnang":
        return this.resolveJinnang(cmd.cardId ?? null, cmd.targets, cmd.cancel);
      case "useHeroSkill":
        return this.resolveHeroSkill(cmd.skillId, cmd.targets, cmd.cancel);
    }
  }

  // ──────────────────────────── 时机框架(时机总线) ────────────────────────────
  // dispatchMoment(moment, ctx):在时机点派发全场技能(名将技能/将来的珍宝/地块/全局规则同轨)。
  // 确定性:座位序(0..n-1,未破产)× 每人 heroes 序 × skills 数组序,同层派发顺序全确定。
  // 零新增序列化状态:技能从 HEROES 数据派生;冷却复用 heroLastFired(键=skill.id)。
  // 设计与扩展指南(加时机三步/加技能两步/加效果一步)见 docs/explanation/时机框架.md。

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
   *  效果层收益不递归(技能给钱再触发得银技能会指数放大技能链,框架层禁止;见 docs/explanation/时机框架.md)。 */
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
              throw new Error(
                `未知效果 EffectId "${skill.effect}"(技能 ${skill.id}):注册表查不到=数据 bug`,
              );
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
      case "self":
        return ownerSeat === subject;
      case "others":
        return ownerSeat !== subject;
      case "actor":
        return subject === this.activeIndex;
      case "any":
        return true;
    }
  }

  /** 冷却判定:未设 cooldown → 恒可用;否则距上次触发的轮数 ≥ cooldown 才可用。 */
  private skillReady(player: Player, skill: TriggerSkill): boolean {
    if (!skill.cooldown) return true;
    const last = player.heroLastFired[skill.id] ?? -Infinity;
    return this.round - last >= skill.cooldown;
  }

  /** 招贤纳士:从剩余名将池随机抽 3 张(三选一)。满额/无货→直接 endTurn。
   *  #323 去私有化(ADR-0019 条款 3):落格结算 movement-flow.resolveLanding 经 g. 直调;
   *  testing.ts 白盒窄面照旧。招贤域本体仍留壳内(后续票迁出)。 */
  tryRecruitHero(mover: Player): void {
    if (mover.heroes.length >= HERO_CAPACITY) {
      this.endTurn();
      return;
    }
    const available = HEROES.filter((h) => !this.recruitedHeroIds.has(h.id));
    if (available.length === 0) {
      this.endTurn();
      return;
    }
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

  logEvent(
    category: LogEvent["category"],
    player: string | null,
    brief: string,
    detail: string,
    amount?: number,
  ): void {
    this.log.push({
      ts: Date.now(),
      round: this.round,
      turn: this.turnNumber,
      player,
      brief,
      detail,
      category,
      amount,
    });
  }
  assertPhase(expected: TurnPhase, label: string): boolean {
    if (this.turnPhase !== expected) {
      this.warn(`${label} 在非 ${expected} 阶段(${this.turnPhase})被调用`);
      return false;
    }
    return true;
  }
  warn(msg: string): void {
    this.logEvent("system", null, `[警告] ${msg}`, `warn: ${msg}`);
  }
  /** 浮字入队(引擎内部结算时调用;对外消费走 presentation.drainFloaters)。
   *  #319 去 private(ADR-0019 条款 3 内部状态透明):jinnang-execution 域同用。 */
  pushFloater(
    p: Player,
    amount: number,
    atTile: number,
    kind: "income" | "expense" | "supply",
  ): void {
    this.floaters.push({ playerIndex: this.players.indexOf(p), amount, atTile, kind });
  }
  /** 声望增减(#121):机遇抉择/天命格的唯一写入口,clamp ±100。
   *  声望献计(#147):首次向上穿越 +30/+60/+90 各献锦囊一张(只在本入口挂钩,
   *  不看来源——把机遇抉择玩好就有实物兑现)。 */
  addReputation(seat: number, delta: number): void {
    const p = this.players[seat];
    const before = p.reputation;
    p.reputation = Math.max(-100, Math.min(100, p.reputation + delta));
    for (const m of [30, 60, 90]) {
      if (before < m && p.reputation >= m && !p.repMilestones.includes(m)) {
        p.repMilestones.push(m);
        this.pushFloaterText(p, `民心所向(声望 ${m}),名将献计`, p.position);
        this.logEvent(
          "system",
          p.guohao,
          `${p.guohao} 声望达 ${m},名将献计一封`,
          `repMilestone player=${p.id} milestone=${m}`,
        );
        this.drawJinnang(seat, 1);
      }
    }
  }

  // ──────────────── 锦囊+主动技+效果执行(#122/#188 档 3,ADR-0019)────────────────
  // 域逻辑在 jinnang-execution.ts(ADR-0019 委托式拆分,#319):抽牌/军师幕用牌与出技
  // 决策/出牌宣布与反应窗挂点/效果执行/主动技结算/demolish 与招贤共享单点均为自由函数,
  // 首参接引擎实例。壳内仅留同名公共方法薄委托(外部 importer 无感)与 enterJinnangPhase
  // 私有薄委托(回合壳 finishSetup/endTurn 调用);reaction-window 续结算经壳上
  // executeJinnang/settleJinnangExit 公共方法回调,维持 reaction ⇄ 执行跨模块往返。

  /** 抽锦囊(#122/T1):薄委托 → jinnang-execution.drawJinnang。 */
  drawJinnang(seat: number, count = 1): void {
    drawJinnang(this, seat, count);
  }

  /** 军师幕入场(#122/T2):薄委托 → jinnang-execution.enterJinnangPhase。 */
  private enterJinnangPhase(): void {
    enterJinnangPhase(this);
  }

  /** 用锦囊(#122/T2):薄委托 → jinnang-execution.resolveJinnang。 */
  resolveJinnang(cardId: string | null, targets?: number[], cancel?: boolean): void {
    resolveJinnang(this, cardId, targets, cancel);
  }

  /** 发动主动技(#188 档 3):薄委托 → jinnang-execution.resolveHeroSkill。 */
  resolveHeroSkill(skillId: string, targets?: number[], cancel?: boolean): void {
    resolveHeroSkill(this, skillId, targets, cancel);
  }

  /** 用牌收尾(#122/T3):薄委托 → jinnang-execution.settleJinnangExit(反应窗续结算亦经此)。 */
  settleJinnangExit(): void {
    settleJinnangExit(this);
  }

  /** 锦囊效果执行(#122):薄委托 → jinnang-execution.executeJinnang(反应窗识破续结算亦经此)。 */
  executeJinnang(
    user: Player,
    userSeat: number,
    def: ReturnType<typeof jinnangCardOf>,
    targets: number[],
    exempt?: ReadonlySet<number>,
  ): void {
    executeJinnang(this, user, userSeat, def, targets, exempt);
  }

  /** 体力增减(#130):clamp 0~100,返回落账后的体力值。 */
  addStamina(seat: number, delta: number): number {
    const p = this.players[seat];
    p.stamina = Math.max(0, Math.min(STAMINA_MAX, p.stamina + delta));
    return p.stamina;
  }

  // ──────────────── 机遇主流程 + 体力耗竭(#123/#124/#130/#132,ADR-0019)────────────────
  // 域逻辑在 encounter-flow.ts(#320):机遇触发/加权抽取、抉择机遇入相与选项结算、效果
  // 结算(八种效果各归小函数)、机遇体力接线与耗竭善后均为自由函数,首参接引擎实例;
  // 与数据表 encounters.ts 分层(流程≠配置)。壳内仅留同名方法薄委托:公共四入口(UI/bot/
  // 联机 + reaction-window 经 g.maybeApplyEncounter 消费)+ 入相/即时结算两步(去私有化:
  // 域内经 g.xxx 往返消费,兼作 testing.ts 白盒窄面 EngineTestInternals 触达点)。

  /** 耗竭入口(#130):薄委托 → encounter-flow.exhaustIfDepleted(机遇体力接线归 0 时域内直调)。 */
  exhaustIfDepleted(seat: number): "none" | "auto" | "phase" {
    return exhaustIfDepleted(this, seat);
  }

  /** 体力耗竭抉择(#130):薄委托 → encounter-flow.resolveExhaustionChoice。 */
  resolveExhaustionChoice(index: number): void {
    resolveExhaustionChoice(this, index);
  }

  /** 机遇触发与抽取(#123):薄委托 → encounter-flow.maybeApplyEncounter(reaction-window 续结算亦经此)。 */
  maybeApplyEncounter(
    mover: Player,
    atTile: number,
  ): "none" | "settled" | "deciding" | "liquidating" | "bankrupt" | "exhausted" {
    return maybeApplyEncounter(this, mover, atTile);
  }

  /** 抉择机遇入相(#124):薄委托 → encounter-flow.enterEncounterPhase(#320 去私有化:
   *  域内经 g.enterEncounterPhase 往返 + testing.ts 白盒窄面)。 */
  enterEncounterPhase(
    mover: Player,
    atTile: number,
    def: EncounterDef,
  ): "deciding" | "liquidating" | "bankrupt" | "exhausted" {
    return enterEncounterPhase(this, mover, atTile, def);
  }

  /** 抉择机遇选项(#124):薄委托 → encounter-flow.resolveEncounterChoice。 */
  resolveEncounterChoice(index: number): void {
    resolveEncounterChoice(this, index);
  }

  /** 即时机遇结算(#123):薄委托 → encounter-flow.settleEncounter(#320 去私有化:
   *  域内经 g.settleEncounter 往返 + testing.ts 白盒窄面)。 */
  settleEncounter(
    mover: Player,
    atTile: number,
    def: EncounterDef,
  ): "settled" | "liquidating" | "bankrupt" | "exhausted" {
    return settleEncounter(this, mover, atTile, def);
  }

  /** 文案浮字入队(ADR-0013 唯一选项自动执行的轻提示,无金额):渲染为棋盘一行小字。 */
  pushFloaterText(p: Player, text: string, atTile: number): void {
    this.floaters.push({
      playerIndex: this.players.indexOf(p),
      amount: 0,
      atTile,
      kind: "msg",
      text,
    });
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
    this.jinnangPlays = []; // 瞬时不序列化:恢复即清(单机本地编排通道;联机信号源=lastJinnangPlay,随快照恢复)
    // seq 计数器恢复推回(#284):计数器本身不序列化,按快照内已见的最大 seq 推回,
    // 保证单调不回退——恢复后开新窗/出新牌的号必然大于恢复前任何已广播的号,
    // 传输层同窗判据与客户端 diff 去重不因恢复串号。快照无窗无留痕时保持当前值。
    this.jinnangSeq = Math.max(
      this.jinnangSeq,
      s.pendingReaction?.seq ?? 0,
      s.lastJinnangPlay?.seq ?? 0,
    );
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

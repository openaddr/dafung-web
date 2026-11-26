// 引擎权威壳(#325 定形,原 game.ts):ADR-0019 委托式拆分收口后,壳 = 状态字段区 +
// 构造器 + 公共薄委托 + submitCommand + 快照通道 + presentation getter;引擎自留职责
// 仅回合状态机入口、时机派发器(dispatchMoment)与
// 战报/落账底座(logEvent/pushFloater 级)。机制域流程在各域模块(reaction-window/
// jinnang-execution/stamina-damage/bankruptcy/treasure-flow/movement-flow/setup-flow/recruitment(见下各 import 区段注释),壳内同名公共方法薄委托。#326 types.ts 解散(ADR-0019 类型随域走):回合状态机类型归本壳,其余各归域模块。
import { tileIndexOfProperty, type Board, type MovePath } from "./board";
import type { Dice, DiceRoll } from "./dice";
import { LOG_WARNING_PREFIX, type CommandWarningCode, type Player, type LogEvent } from "./model";
import type { PropertyDef, TransactionResult } from "./economy";
import type { TreasureDef } from "./treasures";
import type { LandOutcome, PendingLand } from "./movement-flow";
import type { GameMoment, MomentCtx } from "./timing";
import { startMoment, type MomentContinuation, type PendingMoment } from "./moment-stages";
import {
  computeChoices,
  respondSkillChoice,
  type ChoiceOption,
  type PendingSkillChoice,
} from "./choices";
import { endTurn } from "./turn-end";
import { findHolding } from "./player";
import { serializeGame, restoreGameSnapshot, type GameSnapshot } from "./snapshot";
import type { MapCatalog } from "./board-loader";
import { jinnangCardOf } from "./jinnang";
// 反应窗域(#318,ADR-0019):开窗/应答/结算逻辑在 reaction-window.ts,壳内薄委托转发。
// bot 即席应答策略(botReactionDecision)由域模块直接消费——bot 对 game 仅 type 依赖,无运行时环。
// (#323:域外挂点 openReactionWindow 的私有壳委托随移动结算域迁出而删——调用点
// marchTraverse 进了 movement-flow.ts,改直调已导出的自由函数,壳内只留 respondReaction。)
import {
  respondReaction,
  type PendingReaction,
  type ReactionAnswer,
  type ReactionTarget,
} from "./reaction-window";
// 锦囊+主动技+效果执行域(#319,ADR-0019):出牌阶段决策/出牌/效果结算在 jinnang-execution.ts,
// 壳内同名公共方法薄委托转发;reaction-window 续结算经壳上 executeJinnang/settleJinnangExit 回调;
// 载荷类型(PendingJinnang/PendingHeroSkill)随域走(#326,ADR-0019)。
import {
  drawJinnang,
  executeJinnang,
  resolveBookSkill,
  resolveHeroSkill,
  resolveJinnang,
  settleJinnangExit,
  type PendingJinnang,
  type PendingHeroSkill,
} from "./jinnang-execution";
import { damageStamina } from "./stamina-damage";
// 破产清算+交割托管域(#321,ADR-0019):escrow 交割/退回、付款或清算、债务留痕结算、
// 破产善后、整批出售并清偿与认破产在 bankruptcy.ts,壳内同名方法薄委托转发;
// 与 economy.ts 分层(清算流程≠经济交易原语)。
import {
  declareBankruptcy,
  confirmBankruptcySettle,
  type BankruptcyAsset,
  deliverEscrow,
  payOrLiquidate,
  returnEscrowToSeller,
} from "./bankruptcy";
// 珍宝+城主交涉域(#322,ADR-0019):抽宝拼点(珍宝城落格固定事件位,#825)、
// 城主交涉(escrow 托管)在 treasure-flow.ts,壳内同名方法薄委托转发;与数据表
// treasures.ts 分层(流程≠数据)。
import { drawTreasureAt, resolveTreasureOwner } from "./treasure-flow";
// 移动结算域(#323,ADR-0019):行军三件/地产决策/落格结算/都城补给在
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
  settleMarchLanding,
  upgradeProperty,
} from "./movement-flow";
// 开局域(#324,ADR-0019):国号设定/抽签排选都顺序/AI 与服务器代选都/选都落子/
// 候选滚换/入局收尾在 setup-flow.ts,壳内同名公共方法薄委托转发;setup 期骰流顺序
// 敏感(offeredCapitals 随 rngState 序列化,联机/恢复必须一致),域内逐字保留。
// (#326:shuffle 洗牌辅助的消费方招贤随之迁 recruitment.ts,域侧反向 import,壳不再经手。)
import {
  aiSetupStep,
  aiSetupStepFor,
  beginCapitalSelection,
  firstAvailableCapitalIndex,
  pickCapital,
  setGuohao,
} from "./setup-flow";
// 招贤机会及选将、求书和跳过结算由 recruitment.ts 负责。
import { tryRecruitHero, resolveHeroPick, type HeroOffer, type HeroPick } from "./recruitment";
// 遣散域(#1147,ADR-0019 委托式拆分):免费主动遣散(槽移除/回池划名/已学技折书)在
// hero-dismiss.ts,壳内薄委托;清算期间禁用。
import { dismissHero } from "./hero-dismiss";
import {
  beginGameEventBatch,
  emitGameEvent,
  abortGame,
  CMD_BRIEF,
  type GameEvent,
} from "./game-events";
import { formatMoney } from "./money";
import { MAX_SEAT_COUNT, MIN_SEAT_COUNT, STAMINA_MAX, STARTING_STAMINA } from "./constants";

type Catalog = MapCatalog;

export interface SeatConfig {
  name: string;
  isBot: boolean;
  guohao?: string; // 人类可预设;留空则在 Guohao 阶段填
}

export interface EngineConfig {
  seats: SeatConfig[];
  /** 胜利线(纯现金口径,netWorth):地图顶层必配(loadMap 校验),装配层旗标可显式覆盖 */
  targetNetWorth: number;
  /** 起手现金:地图顶层必配(loadMap 校验),装配层旗标可显式覆盖(ADR-0041 删引擎缺省) */
  startingCash: number;
  /** 起手珍宝(件/人):地图顶层必配(loadMap 校验),装配层恒随地图无旋钮;0=不发(#1100) */
  startingTreasures: number;
  seed?: number; // 注入骰子种子,便于确定性测试(?seed= URL 参数)
  /** 地图 id(ADR-0014 对局日志局头重放要素;编辑器试玩等非清单地图缺省为空串,重放脚本对空 id 显式报错) */
  mapId?: string;
  /** 反应窗时长覆盖(#284):联机权威侧 env E2E_REACTION_MS 经 registry 传入;缺省=查
   *  REACTION_WINDOW_MS 常量表。开窗时写入 view.windowMs 随快照下发,客户端横幅投影与
   *  权威侧定时器同读一份(两端同长自动成立)。 */
  reactionWindowMs?: number;
}

export type EnginePhase = "Setup" | "Playing" | "GameOver";
export type SetupPhase = "Guohao" | "PickCapital" | "Done";

// ── 回合状态机与命令协议类型(#326 types.ts 解散:壳 = 回合状态机之家,本文件拥有并导出)──
/** 回合阶段。AwaitingReaction(#281,ADR-0017)= 反应窗:结算中段停相位(先例 AwaitingTreasureOwner),等被询问座位的 respondReaction 应答;全部应答后引擎续结算。 */
export type TurnPhase =
  | "Roll"
  | "AwaitingDecision"
  | "AwaitingHeroPick"
  | "AwaitingJinnang" // 出牌阶段(#122/T2 立,#256 正名):回合开始掷骰前,主动用牌或今不用
  | "AwaitingTreasureOwner"
  | "AwaitingBankruptcySettle"
  | "AwaitingReaction" // 反应窗(#281):锦囊宣布/行军途经城池的识破、拦检询问
  | "AwaitingSkillChoice" // 「你可」选择待决，应答后继续所在时机
  | "Land"
  | "EndTurn"
  | "GameOver";

/** "aborted" = 异常终局(#642 响亮终局):对局因驱动链死亡作废,winner 恒 null;
 *  终局行/gameOver 事件以本值判别(域本体见 game-events.abortGame)。 */
export type VictoryReason = "None" | "TargetNetWorth" | "LastStanding" | "aborted";

/** 玩家可提交的游戏命令(联机时 = 网络协议的消息类型)。 */
export type GameCommand =
  | { type: "rollAndMove" }
  | { type: "buyProperty" }
  | { type: "upgradeProperty" }
  | { type: "endDecision" }
  | ({ type: "resolveHeroPick" } & HeroPick)
  | {
      type: "resolveTreasureOwner";
      action:
        | { type: "fair"; treasureId: string }
        | { type: "premium"; treasureId: string }
        | { type: "skip" };
    }
  | { type: "declareBankruptcy" }
  | { type: "confirmBankruptcySettle"; assets: BankruptcyAsset[] }
  | {
      type: "useJinnang";
      cardId: string | null;
      targets?: number[];
      cancel?: boolean;
      back?: boolean;
    }
  | { type: "useHeroSkill"; heroId: string; skillId: string; targets?: number[]; cancel?: boolean } // 名将主动技(#188 档 3;#817 携实例):heroId+skillId=麾下实例定位对(选项 id 拼接单源 choices.skillOptionId),发动直落本实例;targets=目标座位(目标段);cancel=作罢(回卡牌段)
  | { type: "useBookSkill"; treasureId: string; heroId: string } // 用书学技(#1146):treasureId=珍宝位技能书实例,heroId=可学者(skillBookLearners 槽位序单源);技 id 随书派生不另行携带,书用后消耗
  | { type: "dismissHero"; heroId: string } // 遣散(#1147):免费主动遣散——槽移除+回池划名+已学技逐册折书;自己回合随时可点(他座决策窗除外),清算期间禁用
  // 反应窗应答(#281,ADR-0017):被询问座位对当前反应窗表态。seat 必须显式携带——反应窗
  // 天然多属主,decisionOwner 归属不适用(pickCapital 同款:seat 随命令过网/进日志,
  // 重放据此复现)。use=false=「不用」(超时兜底在权威侧代发的也是这条普通命令);
  // use=true 时 cardId 是打出的反应锦囊。须选份时携带 target，种类和编号均须与公告相符。
  | ({ type: "respondReaction" } & ReactionAnswer)
  // 「你可」应答(#1377):seat 必须等于挂问属主(seat 随命令过网/进日志,重放据此复现);
  // use=false=暂不发(标记保留);use=true 放逐必带 targetSeat,行殇目标既定(载荷自带)。
  | { type: "respondSkillChoice"; seat: number; use: boolean; targetSeat?: number };

/** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家);表现态 floaters 的行类型,
 *  经 engine.presentation.drainFloaters() 消费(破坏性读)。
 *  kind="msg" 为文案浮字(text 必填,amount 恒 0)。 */
type FloaterEvent =
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
  /** 变更后持有等级，回无主为 null。 */
  level: number | null;
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
  /** 起手珍宝(件/人,#1100):finishSetup 从统一珍宝牌堆抽 1 级实例发放;0=不发。 */
  readonly startingTreasures: number;
  /** 地图 id(ADR-0014 局头要素;来自 EngineConfig,空串=非清单地图如编辑器试玩)。 */
  readonly mapId: string;
  /** 初始骰子种子(构造时的 rng 状态 = 有效种子,无论显式注入还是随机生成);
   *  写入局头行,重放据此 createDice 精确复现。 */
  readonly seed: number;
  /** 对局 id(ADR-0014):构造时生成,随快照序列化/恢复(联机各端一致);
   *  data/logs/<gameId>.jsonl 文件名与 IndexedDB key。非 readonly 仅为 restoreFromSnapshot 可写。 */
  gameId: string;

  phase: EnginePhase = "Setup";
  setupPhase: SetupPhase = "Guohao";
  turnPhase: TurnPhase = "Roll";
  turnNumber = 0; // 开始实际回合或消费一次跳过时，全桌回合编号加 1。
  round = 1; // 全桌按固定座次走一圈才进入下一轮。名将技能冷却以轮计。
  // public:供 snapshot/联机序列化(轮次锚点需跨进程恢复,否则恢复后 round 计数会漂移)。
  roundAnchor = 0; // 固定的轮次锚点(draftOrder[0]),不随破产漂移
  // 当前活跃诸侯的额外回合，等待本回合收尾，仅随权威快照保存。
  pendingExtraTurn?: true;
  // public:供 snapshot/联机序列化(同 takenCapitalIndices 模式)。内部代码读 Set,不直接改字段。
  recruitedHeroIds = new Set<string>(); // 已被招揽的名将(唯一)
  offeredHeroes: HeroOffer[] = []; // 待选名将可为空，候选携带预掷的实授技能。
  treasureDeck: TreasureDef[] = []; // 珍宝牌堆(剩余可抽)
  /** 锦囊牌库/弃牌堆(#122):开局 finishSetup 洗序;抽牌从堆顶(pop)出。
   *  公开字段(重放/快照/CLI 可读),可见性由传输层投影裁剪(ADR-0016)。 */
  jinnangDeck: string[] = [];
  jinnangDiscard: string[] = [];
  /** 锦囊目标段载荷(#122/T3):选牌后进入选人子状态;null=卡牌段。随快照走。 */
  pendingJinnang: PendingJinnang | null = null;
  /** 技能目标段载荷(#188 档 3):出牌阶段内选技后的选人子状态;null=无。与 pendingJinnang
   *  互斥(同一时刻至多一个子状态)。随快照走(目标段中途断线可恢复)。 */
  pendingSkill: PendingHeroSkill | null = null;
  /** 当前打开的「你可」选择，至多一条。 */
  pendingSkillChoices: PendingSkillChoice[] = [];
  pendingMoment: PendingMoment | null = null;
  /** 时机同步嵌套守卫，恢复命令从新调用栈继续。 */
  momentDispatchDepth = 0;
  /** 擂鼓步数加成(#188 档 3):出牌阶段发动 warDrum 技写入,本回合 rollAndMove 掷骰后
   *  取走清零。可序列化——发动与掷骰之间可被快照广播/落盘,与瞬态 marchBonus(同一次
   *  rollAndMove 内写读平衡)不同,必须跨进程保真。 */
  heroDiceBonus = 0;
  /** 锦囊牌库剩余数(公开信息):联机投影裁掉牌序后据此透出(同 jinnangHandCount 口径)。 */
  jinnangDeckCount = 0;
  /** 反应窗挂起态(#281,ADR-0017):null=无窗。挂起点存公告/应答/续结算载荷 →
   *  AwaitingReaction 相位 → 应答齐(或 bot 即席代答齐)→ 续结算。全部随快照走
   *  (SNAPSHOT_FIELDS 单点清单);人类被询问时窗跨命令存续,bot 全被询问时在开窗
   *  同一调用内即席应答并续结算(ADR-0017「bot 持牌即时代答不等满」),相位不外显。 */
  pendingReaction: PendingReaction | null = null;
  /** 窗实例单调流水号(#284):开反应窗写 PendingReaction.seq(取 nextJinnangSeq)。
   *  由命令流派生，随 SNAPSHOT_FIELDS 序列化。 */
  jinnangSeq = 0;
  /** 最近一次实际执行的火烧连营编号，首次执行前为空。 */
  fireWallSeq: number | undefined;
  /** 反应窗时长覆盖(#284):EngineConfig.reactionWindowMs(联机权威侧 env 注入);
   *  0 = 无覆盖,开窗时按窗种类查 REACTION_WINDOW_MS 常量表。 */
  readonly reactionWindowMsOverride: number;
  treasureVisitor: { def: PropertyDef; ownerIdx: number } | null = null; // 公道买卖/坐地起价:当前城主视角
  pendingDebt: { amount: number; creditor: Player | null } | null = null; // 破产清算:待清偿债务(凑够自救,凑不够破产)
  // 珍宝交涉交割托管:成交后买家付清价款前,珍宝暂存于此(序列化友好纯数据;买家不可变卖托管物抵债)。
  escrowTreasure: {
    treasure: TreasureDef;
    buyerIdx: number;
    sellerIdx: number;
    price: number;
  } | null = null;

  activeIndex = 0; // public:供 snapshot/联机序列化(由开局和回合推进维护,外部只读)
  draftOrder: number[] = []; // public:同上
  // public:供 snapshot/联机序列化(选都进度需跨进程恢复,否则恢复后无法继续选都)。
  currentDraftIndex = 0;
  takenCapitalIndices = new Set<number>(); // public:同上
  // 选都(public:供 snapshot/联机序列化):当前选都者的候选城(轮到时生成、选定/轮空后滚换);
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

  /** 固定事件待续跑：招贤跨命令持有，商市和探宝在同一命令内消费。
   *  续跑 resolveLanding 时直入交易链，标记随快照保存。 */
  pendingCityEvent = false;

  log: LogEvent[] = [];
  /** 浮动金额反馈事件(+收入/-支出,位置=tile 索引或玩家),渲染层消费后清空。
   *  #319 去 private(ADR-0019 条款 3 内部状态透明):jinnang-execution 域直写;外部消费仍只走 presentation.drainFloaters。 */
  floaters: FloaterEvent[] = [];
  /** 城池变更留痕(ADR-0015,类型注释见 PropertyChangeTrace):结算点写入,
   *  提取器一次性取走;瞬态不序列化(同 floaters,restore 即清)。
   *  #319 去 private(ADR-0019 条款 3 内部状态透明):jinnang-execution 域直写;外部消费仍只走 presentation.drainPropertyChanges。 */
  propertyChanges: PropertyChangeTrace[] = [];
  gameEvents: GameEvent[] = []; // 事件流当前批(#375,ADR-0020):批界=编排入口开批,词汇表见 game-events.ts

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

  constructor(board: Board, cat: Catalog, dice: Dice, config: EngineConfig) {
    this.board = board;
    this.catalog = cat;
    this.dice = dice;
    this.targetNetWorth = config.targetNetWorth;
    this.startingCash = config.startingCash;
    this.startingTreasures = config.startingTreasures;
    this.mapId = config.mapId ?? "";
    this.reactionWindowMsOverride = config.reactionWindowMs ?? 0;
    this.seed = this.dice.getRngState(); // mulberry32 未滚前 getState = 种子本身
    // 对局 id(ADR-0014):毫秒时间戳 + 随机后缀的简版 uuid,作 data/logs/<gameId>.jsonl 文件名
    // 与 IndexedDB key;不走引擎 rng(不影响确定性,不随快照漂移)。内联于构造器
    // (#325 壳纪律:自由函数定义只许来自 import,壳内不落地函数声明)。
    this.gameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (config.seats.length < MIN_SEAT_COUNT || config.seats.length > MAX_SEAT_COUNT)
      throw new Error(`支持 ${MIN_SEAT_COUNT}–${MAX_SEAT_COUNT} 个座位。`);
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
      skipTurns: 0,
      resting: false,
      properties: [],
      heroes: [],
      treasures: [],
      stamina: STARTING_STAMINA,
      jinnangHand: [], // 锦囊手牌(#122):开局发牌在 finishSetup
      jinnangHandCount: 0,
    }));
    // 人类已填的国号加入 usedGuohao,防止 bot 分配时抽到重复国号(两个魏国 bug)
    for (const p of this.players) {
      if (p.guohao) this.usedGuohao.add(p.guohao);
    }
    // 局头行(ADR-0014):日志首行,记全重放要素。座位表记「构造时的原始规格」
    // (未填国号由 beginCapitalSelection 分配)。重放须复刻同一规格,保持国号分配与后续骰流一致。
    // 分配后的国号见「选都顺序」。
    this.logEvent(
      "header",
      null,
      `对局开启:${this.players.length} 座,起手 ${formatMoney(this.startingCash)},珍宝 ${this.startingTreasures} 件/人,目标身价 ${formatMoney(this.targetNetWorth)}`,
      JSON.stringify({
        type: "header",
        gameId: this.gameId,
        mapId: this.mapId,
        seed: this.seed,
        targetNetWorth: this.targetNetWorth,
        startingCash: this.startingCash,
        startingTreasures: this.startingTreasures,
        startedAt: Date.now(),
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
    if (this.turnPhase === "AwaitingSkillChoice") {
      const pending = this.pendingSkillChoices[0];
      if (pending == null) throw new Error("AwaitingSkillChoice 相位无待决选择(状态机 bug)"); // 零兜底
      return pending.ownerSeat;
    }
    return this.turnPhase === "AwaitingTreasureOwner"
      ? (this.treasureVisitor?.ownerIdx ?? this.activeIndex)
      : this.activeIndex;
  }
  /** 当前决策相位的选项集(ADR-0013 choice-set 注册表,snapshot.choices 透出供 UI/调试)。
   *  纯派生数据:由相位 + 玩家状态实时计算,不新增序列化状态;已注册相位返回计算器结果,
   *  未注册相位(Roll/Land/EndTurn/GameOver 等无决策相位)返回空数组。 */
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
  alivePlayers(): Player[] {
    return this.players.filter((p) => !p.isBankrupt);
  }

  // ──────────────────────────── 开局:Setup ────────────────────────────
  // 开局域(#324,ADR-0019 委托式拆分):国号设定(setGuohao)、抽签排选都顺序
  // (beginCapitalSelection)、AI/服务器代选都步进(aiSetupStep/aiSetupStepFor)、选都
  // (pickCapital)、滚换候选(rollOfferedCapitals)与入局收尾(finishSetup)均为
  // 自由函数,在 setup-flow.ts,首参接引擎实例;aiChooseCapital/pickCapitalInternal/
  // skipCurrentDraftPick 域内自洽不留壳。setup 期骰流顺序敏感(offeredCapitals 候选
  // 随 rngState 序列化,联机/恢复必须一致),域内逐字保留消耗顺序;起手发牌经
  // g.drawJinnang，首回合摸牌及出牌阶段入场复用 jinnang-execution.beginTurnJinnang。
  // 壳内仅留本 getter(选都进度派生查询)与同名
  // 公共方法薄委托(外部 importer 无感)。

  get currentSetupPlayerIndex(): number {
    return this.draftOrder[this.currentDraftIndex] ?? -1;
  }

  /** 设置某座位的国号(单汉字);非法/冲突清空拒绝:薄委托 → setup-flow.setGuohao。 */
  setGuohao(seatIndex: number, char: string): boolean {
    return setGuohao(this, seatIndex, char);
  }

  /** 补齐空国号，抽签排定选都顺序并开始选都。
   *  薄委托 → setup-flow.beginCapitalSelection。 */
  beginCapitalSelection(): void {
    beginCapitalSelection(this);
  }

  /** 当前选都玩家(bots 自动)。返回是否已完成本轮选都(需 UI 再次驱动):
   *  薄委托 → setup-flow.aiSetupStep。 */
  aiSetupStep(): boolean {
    return aiSetupStep(this);
  }

  /** 服务器代选(L41 联机,bot 同评分、不校验 isBot,驱动资格由调用方保证):
   *  薄委托 → setup-flow.aiSetupStepFor。 */
  aiSetupStepFor(idx: number): boolean {
    return aiSetupStepFor(this, idx);
  }

  /** 选都辅助:当前候选首城(无则 -1)。集中"可选都城"判定,供人类选都 UI/测试/e2e 复用:
   *  薄委托 → setup-flow.firstAvailableCapitalIndex。 */
  firstAvailableCapitalIndex(): number {
    return firstAvailableCapitalIndex(this);
  }

  /** 公共选都入口:人类落子(单机 UI / 联机 WS)走这里——记 cmd 行(ADR-0014 命令流,
   *  重放的机读层);bot/托管的代选域内走 pickCapitalInternal(logCmd=false)。
   *  薄委托 → setup-flow.pickCapital。 */
  pickCapital(playerIndex: number, tileIndex: number): { ok: boolean; reason?: string } {
    return pickCapital(this, playerIndex, tileIndex);
  }

  // ──────────────────────────── 回合状态机 ────────────────────────────
  // 移动结算域(#323,ADR-0019 委托式拆分):行军三件(rollAndMove/marchTraverse/
  // settleMarchLanding,含拦检挂点/驻跸必停)、
  // 待决策落格定义(pendingLandDef)、地产决策命令(buyProperty/upgradeProperty/
  // endDecision)、落格结算(resolveLanding;resolveCityEvent/resolveProperty/
  // enterDecisionPhase 域内自洽不留壳)与都城补给(capitalSupplyOf;applyResupply
  // 域内自洽不留壳)均为自由函数,在 movement-flow.ts,首参接引擎实例。
  // 壳内仅留同名公共方法薄委托:命令口经 submitCommand 分发、bot 直调;跨域往返走壳上
  // 薄委托:reaction-window 续走经 g.marchTraverse/g.settleMarchLanding 回调；
  // 探宝(珍宝城固定事件位)/escrow/锦囊抽牌/招贤经各自壳上方法消费;开拦检窗由域模块直调
  // reaction-window.openReactionWindow(已导出自由函数,#318 预留的私有壳委托随本域
  // 迁出而删,见反应窗区段)。

  /** 抽签 → 移动 → 落格结算:薄委托 → movement-flow.rollAndMove。 */
  rollAndMove(): void {
    rollAndMove(this);
  }

  /** 途经遍历(#281,途经棋子/驻跸必停/半路杀出拦检):薄委托 → movement-flow.marchTraverse
   *  (reaction-window 拦检续走经此回调)。 */
  marchTraverse(
    mover: Player,
    remaining: number[],
    totalLen: number,
    landIndex: number,
    fromPos: number,
    steps: number,
  ): "landed" | "halted" | "suspended" {
    return marchTraverse(this, mover, remaining, totalLen, landIndex, fromPos, steps);
  }

  /** 行军落格收尾:薄委托 → movement-flow.settleMarchLanding
   *  (reaction-window 拦检续走经此回调)。 */
  settleMarchLanding(mover: Player, landIndex: number): void {
    settleMarchLanding(this, mover, landIndex);
  }

  // ──────────────────────────── 反应窗(#281,ADR-0017)────────────────────────────
  // 域逻辑在 reaction-window.ts(ADR-0019 委托式拆分,#318):开窗/应答/识破窗结算/
  // 拦检窗结算/拦停止步/续走/拼点均为自由函数,首参接引擎实例。壳内仅留:
  //  - 公共方法 respondReaction 薄委托(外部 importer 无感);
  //  - 域外挂点 openReactionWindow 私有薄委托已随 #323 移动结算域迁出而删:唯一调用点
  //    marchTraverse 进了 movement-flow.ts,与锦囊执行(#319)同款改直调已导出的自由函数。

  /** 反应窗应答(#281 公共入口,UI/bot 驱动器/联机/超时代发同走):薄委托。 */
  respondReaction(
    seat: number,
    use: boolean,
    cardId?: string,
    target?: ReactionTarget,
  ): string | void {
    return respondReaction(this, seat, use, cardId, target);
  }

  /** 「你可」应答(#1377 公共入口,UI/bot 驱动器/托管代驾同走):薄委托 → choices.respondSkillChoice。 */
  respondSkillChoice(seat: number, use: boolean, targetSeat?: number): void {
    respondSkillChoice(this, seat, use, targetSeat);
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
    return this.board.at(tileIndexOfProperty(this.board, def.id)).name;
  }

  // ──────────────────────────── 落格处理 ────────────────────────────

  /** 落格结算(己都城/城池三分/事件城固定事件,#826 全城池制):薄委托 → movement-flow.resolveLanding
   *  (招贤与拦停止步续接经此)。 */
  resolveLanding(): void {
    resolveLanding(this);
  }

  /** 都城补给量查询(tile→def 查找链,测试断言消费):
   *  薄委托 → movement-flow.capitalSupplyOf。 */
  capitalSupplyOf(player: Player): { supply: number; level: number } {
    return capitalSupplyOf(this, player);
  }

  // ──────────────────────────── 回合结束 / 胜负 ────────────────────────────
  // #320 去私有化(ADR-0019 条款 3):体力耗竭结算直调 g.endTurn 收尾回合
  endTurn(): void {
    endTurn(this);
  }

  // ──────────────────────────── 异常终局(#642 响亮终局)────────────────────────────
  /** 驱动链死亡出口的唯一引擎语义(链内抛异常/驱动链停摆/时钟挂死三出口共用):
   *  对局作废、无胜者,终局行与 gameOver 事件(reason="aborted")照常产出,幂等。
   *  薄委托 → game-events.abortGame(壳行数锁,域本体与语义详注在该处)。 */
  abortGame(reason: string): void {
    abortGame(this, reason);
  }

  // ──────────────────────────── 珍宝交涉(公道买卖/坐地起价) ────────────────────────────
  // 域逻辑在 treasure-flow.ts(#322,ADR-0019 委托式拆分):抽宝拼点(drawTreasureAt)
  // 与城主交涉(resolveTreasureOwner)均为自由函数,首参接引擎实例;
  // 与数据表 treasures.ts 分层(流程≠数据)。escrow 托管两步经 bankruptcy.ts 的壳上薄委托
  // g.deliverEscrow/g.returnEscrowToSeller 往返消费。壳内仅留同名方法薄委托:公共入口
  // resolveTreasureOwner(UI/bot/联机经 submitCommand 分发)+ 抽宝拼点(落格固定事件位,
  // movement-flow resolveCityEvent 消费,#825);交易链终端一律 endTurn,链尾探宝钩子
  // 已随 #825 迁移拆除(finishTradeChain 退役)。

  /** 抽宝拼点(珍宝城落格固定事件位,#825):结算留痕即返,不收口回合——续跑交易链
   *  归 movement-flow resolveCityEvent。薄委托 → treasure-flow.drawTreasureAt。 */
  drawTreasureAt(mover: Player, sourceName: string): void {
    drawTreasureAt(this, mover, sourceName);
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
  // 付款或清算(payOrLiquidate)、破产资产留痕(seizeBankruptAssetsTraced)、
  // 破产善后(finalizeBankruptcy)、整批出售并清偿(confirmBankruptcySettle)与认破产
  // (declareBankruptcy)均为自由函数,首参接引擎实例;与 economy.ts 分层(清算
  // 流程≠经济交易原语)。壳内仅留同名方法薄委托。

  /** 交割托管:买家付清价款 → 珍宝交货给买家。薄委托 → bankruptcy.deliverEscrow
   *  (#321 去私有化 ADR-0019 条款 3:escrow 挂起后的交割/退还两步,壳与域双向消费)。 */
  deliverEscrow(): void {
    deliverEscrow(this);
  }

  /** 交割托管:买家破产 → 未付款的托管珍宝退回卖家。薄委托 → bankruptcy.returnEscrowToSeller。 */
  returnEscrowToSeller(): void {
    returnEscrowToSeller(this);
  }

  /** 付款或触发清算:现金够即扣款("ok"),不足统一进入 AwaitingBankruptcySettle("liquidating")。
   *  薄委托 → bankruptcy.payOrLiquidate。 */
  payOrLiquidate(mover: Player, creditor: Player | null, amount: number): "ok" | "liquidating" {
    return payOrLiquidate(this, mover, creditor, amount);
  }

  /** propertyId → tile 索引(引擎数据不变量:catalog 地产恰在一格;查无 = 数据 bug,当场抛出)。
   *  #321 去私有化(ADR-0019 条款 3):破产清算域 bankruptcy.ts 留痕路径经 g.tileIndexOfProperty 直调;
   *  本体单源 core/board 同名自由函数(app 侧五消费面同源)。 */
  tileIndexOfProperty(propertyId: string): number {
    return tileIndexOfProperty(this.board, propertyId);
  }

  /** 明确认破产(命令):薄委托 → bankruptcy.declareBankruptcy。 */
  declareBankruptcy(): void {
    declareBankruptcy(this);
  }

  /** 整批变卖并清偿(命令):完整校验后执行,薄委托 → bankruptcy.confirmBankruptcySettle。 */
  confirmBankruptcySettle(assets: BankruptcyAsset[]): void {
    confirmBankruptcySettle(this, assets);
  }

  // ──────────────────────────── 命令接口(联机预留) ────────────────────────────
  // 所有玩家操作通过 submitCommand 统一入口提交;state.ts(热座)和将来的
  // network-client.ts(联机)都调用这一个方法。联机时服务器的消息处理器只需:
  //   socket.on("command", cmd => engine.submitCommand(cmd))
  /** 被拒的反应窗应答返回原因，供房间编排回执。 */
  submitCommand(cmd: GameCommand): string | void {
    if (!Object.hasOwn(CMD_BRIEF, cmd.type)) throw new Error(`未知对局命令：${cmd.type}`);
    beginGameEventBatch(this); // 事件流(#375):命令=一次转移,入口开新批(弃上一命令的批)
    // 命令流(ADR-0014):每条玩家命令在统一入口记一行 cmd(detail=完整命令 JSON,重放的
    // 机读层)。bot 路径(botAct/aiSetupStepFor 直调引擎方法)不经此口 → 不产生 cmd 行:
    // 给定 seed 后 bot 行为确定,重放自动重算(见 docs/reference/对局日志.md「命令流重放」)。
    // 反应窗应答(#281)例外:归属=被询问座位(cmd.seat,非 decisionOwner——反应窗天然
    // 多属主),seat 随命令过网,与 pickCapital 的 seat 随 detail 过网同款。
    // 「你可」应答(#1377)不设例外:决策者唯一=挂问属主,恰为本相位 decisionOwner,通用
    // 命令行归属一致;非法座位的替答在 respondSkillChoice 内警告拒绝(真实 seat 随 detail JSON 留痕)。
    if (cmd.type === "respondReaction") {
      const responder = this.players[cmd.seat];
      this.logEvent(
        "cmd",
        responder.guohao,
        `${responder.guohao} 提交命令:${CMD_BRIEF[cmd.type]}`,
        JSON.stringify(cmd),
      );
      return this.respondReaction(cmd.seat, cmd.use, cmd.cardId, cmd.target);
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
      case "buyProperty":
        return this.buyProperty();
      case "upgradeProperty":
        return this.upgradeProperty();
      case "endDecision":
        return this.endDecision();
      case "resolveHeroPick":
        return this.resolveHeroPick(cmd);
      case "resolveTreasureOwner":
        return this.resolveTreasureOwner(cmd.action);
      case "declareBankruptcy":
        return this.declareBankruptcy();
      case "confirmBankruptcySettle":
        return this.confirmBankruptcySettle(cmd.assets);
      case "respondSkillChoice": // 「你可」应答(#1377):决策者=挂问属主=本相位 decisionOwner
        return this.respondSkillChoice(cmd.seat, cmd.use, cmd.targetSeat);
      case "useJinnang":
        return this.resolveJinnang(cmd.cardId, cmd.targets, cmd.cancel, cmd.back);
      case "useHeroSkill":
        return this.resolveHeroSkill(cmd.heroId, cmd.skillId, cmd.targets, cmd.cancel);
      case "useBookSkill":
        return this.resolveBookSkill(cmd.treasureId, cmd.heroId);
      case "dismissHero":
        return this.dismissHero(cmd.heroId);
    }
  }

  // ──────────────────────────── 时机框架(时机总线) ────────────────────────────
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

  /** 效果注册表专用通道:技能得银(+现金;skill 战报由派发器统一记录)。
   *  防连锁:此处【不】派发 CashGained——CashGained 仅在经济结算点(补给/事件得款/交涉收款)派发,
   *  效果层收益不递归(技能给钱再触发得银技能会指数放大技能链,框架层禁止;见 docs/explanation/时机框架.md)。
   *  浮字由 cashChanged(reason=skill) 事件在 fx 面派生(#719 死写删除)。 */
  grantSkillCash(seat: number, amount: number): void {
    const p = this.players[seat];
    p.cash += amount;
    emitGameEvent(this, seat, { kind: "cashChanged", delta: amount, reason: "skill" }); // 事件流(#385):技能得银(被动技击发口;不派发 CashGained 的防连锁口径不变)
  }

  /** 在所在规则节点派发前、时、后三阶段。可暂停的规则点须声明续接操作。 */
  dispatchMoment(moment: GameMoment, ctx: MomentCtx, continuation?: MomentContinuation): void {
    startMoment(this, moment, ctx, continuation);
  }

  // ──────────────────────────── 招贤纳士(#326,ADR-0019)────────────────────────────
  /** 开启招贤机会,有空位时预掷至多三名候选的授技。 */
  tryRecruitHero(mover: Player): void {
    tryRecruitHero(this, mover);
  }

  /** 结算招贤机会:选将、求书或跳过。 */
  resolveHeroPick(pick: number | HeroPick): void {
    resolveHeroPick(this, typeof pick === "number" ? { index: pick } : pick);
  }

  // ──────────────────────────── 战报 / 浮动反馈 ────────────────────────────
  /** 房间层日志行(ADR-0014):把房间/控制器层的生命周期事件(托管开关/离线/解散/
   *  开局)写进对局日志(category "room")。brief 中文;detail 为机读 JSON——
   *  重放脚本据此动态调整「bot 驱动座位集」(autopilot 行与 room.seatControlled 同源)。 */
  logRoomEvent(brief: string, detail: string): void {
    this.logEvent("room", null, brief, detail);
  }

  logEvent(
    category: LogEvent["category"],
    player: string | null,
    brief: string,
    detail: string,
    amount?: number,
    warning?: LogEvent["warning"],
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
      ...(warning === undefined ? {} : { warning }),
    });
  }
  assertPhase(expected: TurnPhase, label: string): boolean {
    if (this.turnPhase !== expected) {
      this.warn(`${label} 在非 ${expected} 阶段(${this.turnPhase})被调用`, {
        kind: "phaseMismatch",
        expected,
        actual: this.turnPhase,
      });
      return false;
    }
    return true;
  }
  /** 命令守卫选用固定的公开理由，并保留权威日志的原文。 */
  warnCommand(code: CommandWarningCode, msg: string): void {
    this.warn(msg, { kind: "commandGuard", code });
  }
  warn(msg: string, warning?: LogEvent["warning"]): void {
    this.logEvent(
      "system",
      null,
      `[警告] ${msg}`,
      `${LOG_WARNING_PREFIX}${msg}`,
      undefined,
      warning,
    );
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
  // ──────────────── 锦囊+主动技+效果执行(#122/#188 档 3,ADR-0019)────────────────
  // 域逻辑在 jinnang-execution.ts(ADR-0019 委托式拆分,#319):抽牌/出牌阶段用牌与出技
  // 决策/出牌宣布与反应窗挂点/效果执行/主动技结算/招贤共享单点均为自由函数,
  // 首参接引擎实例。壳内仅留同名公共方法薄委托(外部 importer 无感);reaction-window 续结算经壳上
  // executeJinnang/settleJinnangExit 公共方法回调,维持 reaction ⇄ 执行跨模块往返。

  /** 抽锦囊(#122/T1):薄委托 → jinnang-execution.drawJinnang;返回实际入手张数(#384)。 */
  drawJinnang(seat: number, count = 1): number {
    return drawJinnang(this, seat, count);
  }

  /** 用锦囊(#122/T2):薄委托 → jinnang-execution.resolveJinnang。 */
  resolveJinnang(
    cardId: string | null,
    targets?: number[],
    cancel?: boolean,
    back?: boolean,
  ): void {
    resolveJinnang(this, cardId, targets, cancel, back);
  }

  /** 发动主动技(#188 档 3;#817 实例定位):薄委托 → jinnang-execution.resolveHeroSkill。 */
  resolveHeroSkill(heroId: string, skillId: string, targets?: number[], cancel?: boolean): void {
    resolveHeroSkill(this, heroId, skillId, targets, cancel);
  }

  /** 用书学技(#1146):薄委托 → jinnang-execution.resolveBookSkill。 */
  resolveBookSkill(treasureId: string, heroId: string): void {
    resolveBookSkill(this, treasureId, heroId);
  }

  /** 遣散名将(#1147,免费主动遣散,清算期间不可用):薄委托 →
   *  hero-dismiss.dismissHero(校验/槽移除/回池划名/折书机制详注在该处)。 */
  dismissHero(heroId: string): void {
    dismissHero(this, heroId);
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

  /** 体力夹紧至 0~100，返回落账值。实际损耗派发 StaminaLoss，包括归零一击。 */
  addStamina(
    seat: number,
    delta: number,
    continuation?: Extract<MomentContinuation, { kind: "staminaDamage" }>,
  ): number {
    const p = this.players[seat];
    const before = p.stamina;
    p.stamina = Math.max(0, Math.min(STAMINA_MAX, before + delta));
    const change = p.stamina - before;
    if (continuation != null)
      emitGameEvent(this, seat, {
        kind: "staminaChanged",
        delta: change,
        reason: "damage",
        ...(continuation.depletes && { depletes: true }),
      });
    if (change < 0)
      this.dispatchMoment(
        "StaminaLoss",
        { subject: seat, delta: change },
        continuation ?? { kind: "staminaUpdated" },
      );
    return p.stamina;
  }

  damageStamina(seat: number, amount: number, sourceSeat: number | null): number {
    return damageStamina(this, seat, amount, sourceSeat);
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

  /** 表现轨迹回写通道(快照恢复专用,与 applyPresentationRoll 对偶):
   *  序列化单点清单的恢复回写口(lastMove 私有、presentation 视图只读,恢复是唯一
   *  合法外部写口);lastMove 本身是行军事件的产出契约输入(requireMovePath),动画
   *  取径已随事件批走(#385),联机快照 diff 消费方已退役。
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
  }
}

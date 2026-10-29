// 事件流词汇表与产出通道(#375,ADR-0020):引擎每次状态转移产出类型化 GameEvent
// (行动者座位 / 对象 / 原因),随快照 `events` 字段输出。**批语义**:批界 = 编排入口
// (submitCommand / botAct / 开局驱动,经 beginGameEventBatch 开批)——引擎缓冲持当前
// 批,快照非破坏性透出(同一转移的多次快照看到同一批,批语义幂等),新转移开批即弃
// 旧批:数组按转移产出,非全史。恢复随批走(写入侧回灌)。
// 本模块只管「词汇 + 产出」:折叠/动效等消费归后续工单。纯数据、序列化友好
// (架构红线 1/5):事件无函数、无循环引用、无 DOM 引用;全桌公开信息,redact 不裁
// (ADR-0016 投影 spread 透传)。
//
// 产出两口:
//  1. 时机映射(MOMENT_EVENT_FACTORIES):时机总线 dispatchMoment 是引擎的「转移宣告
//     总线」——回合相位/掷骰/驻跸/购地/升级/招贤/得宝/售宝/破产/出牌宣布在派发点同步
//     产出事件。词汇表未登记的时机(BeforeMarch/PassedPlayer 等前置钩子与高频途经点)
//     不产出;新增事件种类优先在此表加一行(加时机三步的最后一步顺带落地)。
//  2. 显式产出(emitGameEvent):无时机挂点的转移(行军落格/反应窗开合与识破/机遇
//     触发/选都建城/三变卖/交割/金钱结算,以及 #384 的名将被动技击发/主动技发动/
//     抽锦囊进手/声望变更/体力变更/跳过回合、#719 的声望献计里程碑/问询自动执行)在各域
//     模块结算点直呼,reason 用领域词
//     短横 slug(供应/税/行情/机遇/横征/连环/献计/天命/耗竭……开放词表,新来源即新 slug)。
import type { GameEngine, VictoryReason } from "./authority";
import type { GameMoment, MomentCtx } from "./timing";
import type { EncounterTier } from "./encounters";
import type { MovePath } from "./board";
import { findHolding } from "./player";
import { netWorth } from "./networth";

// ── 事件公共首部 ──
/** 每条事件都携带:行动者座位(谁做的;null=系统/国库等无主行为)+ 发生时刻
 *  (轮/回,engine.round / engine.turnNumber 摸照,供折叠器锚定时序)。 */
export interface GameEventBase {
  /** 行动者座位。 */
  seat: number | null;
  /** 事件发生时的轮次。 */
  round: number;
  /** 事件发生时的回次。 */
  turn: number;
}

// ── 事件体(kind 判别 + 领域字段;不含首部,盖章时统一补)──
/** 对局开始(finishSetup 进入 Playing,subject=首动者)。 */
export interface GameStartedBody {
  kind: "gameStarted";
}
/** 开局收尾(最后一位选都落子、finishSetup 前,subject=最后落子者)。 */
export interface SetupCompletedBody {
  kind: "setupCompleted";
}
/** 回合结束(endTurn 入口,subject=将收尾者)。 */
export interface TurnEndedBody {
  kind: "turnEnded";
}
/** 回合开始(新 activeIndex 确定后,subject=新活跃玩家)。 */
export interface TurnStartedBody {
  kind: "turnStarted";
}
/** 一轮结束(回到轮次锚点,subject=锚点座位)。 */
export interface RoundEndedBody {
  kind: "roundEnded";
}
/** 一轮开始(round +1 后,subject=锚点座位)。 */
export interface RoundStartedBody {
  kind: "roundStarted";
}
/** 终局(胜负判定确定;subject=胜者,reason=判定依据)。异常终局(#642,winReason=
 *  "aborted")同 kind 走本词汇:无胜者(winner=null),subject=派发主体(activeIndex)
 *  而非胜者,消费方以 reason="aborted" 判别(见 event-fold / fx 提取器的显式分支)。 */
export interface GameOverBody {
  kind: "gameOver";
  reason: VictoryReason;
}
/** 掷骰(DieRolled:骰面已定、行军未算;移动步数=骰面+技能加成,加成不在此列)。 */
export interface DiceRolledBody {
  kind: "diceRolled";
  die: number;
}
/** 行军落格(落位/拦停止步;驻跸走 capitalHalt)。path=本次行军的
 *  MovePath 摘要(#385:纯数据序列化友好,随事件走——fx 按事件内路径播动画,合并
 *  批多段行军各播各段,不再依赖引擎 lastMove 单槽)。 */
export interface MarchArrivedBody {
  kind: "marchArrived";
  tileIndex: number;
  path: MovePath;
}
/** 都城驻跸(经过己都城必停;补给金额随后以 cashChanged reason="supply" 跟进)。
 *  path=截断到都城的行军路径(#385 同 marchArrived 口径)。 */
export interface CapitalHaltBody {
  kind: "capitalHalt";
  tileIndex: number;
  path: MovePath;
}
/** 选都建城(开局三段式落子:建都即获城 Lv.0,扣建城费)。 */
export interface CapitalSelectedBody {
  kind: "capitalSelected";
  tileIndex: number;
  propertyId: string;
  cost: number;
}
/** 购地(决策命令成交;price=购入价,委任状消耗见战报)。 */
export interface PropertyBoughtBody {
  kind: "propertyBought";
  propertyId: string;
  price: number;
}
/** 城池升级(扩军/公道买卖成交两路;newLevel=变更后等级)。 */
export interface PropertyUpgradedBody {
  kind: "propertyUpgraded";
  propertyId: string;
  newLevel: number;
}
/** 购地被拒/按兵不动(#385 缺口 1):ADR-0013 唯一默认行为自动执行的宣告——
 *  reason=no-warrant(委任状不足)/insufficient-cash(银两不足)/maxed(城已满级),
 *  文案由 fx 按 reason 派生(与引擎浮字同口径)。 */
export interface PropertyRejectedBody {
  kind: "propertyRejected";
  propertyId: string;
  reason: "no-warrant" | "insufficient-cash" | "maxed";
}
/** 机遇赐城(#719,传檄而定):无主城随机赐予的易主宣告——PropertyGained 时机派发点
 *  同步产出(与 PropertyBought 同表模式);效果名与「购」语义区分(#457)。折面=得城者
 *  Lv.0 入册(机遇赐城此前是折叠器已知无事件转移的级联缺口,本事件将其闭合);
 *  表现=城池易主宣告(fx 面派生,与购地/破产易主同通路)。 */
export interface PropertyGrantedBody {
  kind: "propertyGranted";
  propertyId: string;
}
/** 金钱变更(被动经济结算点;delta 带符号,reason=领域词 slug,counterpartSeat=
 *  玩家间转移的对手座)。主动支出(购地/交涉付款)不产本事件——金额已在
 *  propertyBought/treasureTraded 等领域事件内。 */
export interface CashChangedBody {
  kind: "cashChanged";
  delta: number;
  reason: string;
  counterpartSeat?: number;
}
/** 得宝(拼点探宝/交割收货)。 */
export interface TreasureGainedBody {
  kind: "treasureGained";
  treasureId: string;
}
/** 售宝(交涉成交卖家视角/破产变卖;amount=售价)。 */
export interface TreasureSoldBody {
  kind: "treasureSold";
  treasureId: string;
  amount: number;
}
/** 珍宝交割(escrow 托管完成:买家付清、珍宝交货——交易的最终事实)。 */
export interface TreasureTradedBody {
  kind: "treasureTraded";
  buyerSeat: number;
  sellerSeat: number;
  treasureId: string;
  price: number;
}
/** 窃宝(#385 缺口 5,窃玉偷香):seat=窃方,victimSeat=失主;treasureName 随事件走
 *  (牌堆实例 id 带流水号后缀,名字不属可查表静态目录——成品字段比字符串手术干净)。 */
export interface TreasureStolenBody {
  kind: "treasureStolen";
  victimSeat: number;
  treasureId: string;
  treasureName: string;
}
/** 破产变卖自救(三变卖命令成交尾;asset=变卖物,amount=所得)。 */
export interface AssetLiquidatedBody {
  kind: "assetLiquidated";
  asset: { kind: "treasure" | "property" | "hero"; id: string };
  amount: number;
}
/** 破产清算资产逐城易主(#385 缺口 2):settleDebt 破产转移的每处城池一条——
 *  toSeat=承让方座位(债主接管),null=无债主回无主/销毁;易主宣告由 fx 据此产出。 */
export interface AssetTransferredBody {
  kind: "assetTransferred";
  propertyId: string;
  toSeat: number | null;
}
/** 招贤得将(三选一选定/机遇·锦囊送将;heroId=名将 id)。 */
export interface HeroRecruitedBody {
  kind: "heroRecruited";
  heroId: string;
}
/** 玩家破产出局(善后完成:名将已释放、资产已转债主;creditorSeat=债主座位,
 *  null=无债主归银行/销毁——#384 随派发点 finalizeBankruptcy 传参接线)。 */
export interface PlayerBankruptBody {
  kind: "playerBankrupt";
  creditorSeat: number | null;
}
/** 名将被动技击发(#384):时机技能经 scope/冷却/条件过滤后效果落账成功的瞬间;
 *  seat=技属主,技参数(步数/金额等)由技表 skills.ts 按 skillId 现查,不入事件。 */
export interface SkillFiredBody {
  kind: "skillFired";
  heroId: string;
  skillId: string;
  moment: GameMoment;
}
/** 名将主动技发动(#384,#188 档 3 四类:demolish/relief/patronage/warDrum);
 *  seat=发动者,targetSeat=目标座位(none 域=擂鼓无目标,字段缺席);费用/加成等
 *  技参数由技表 skills.ts 按 skillId 现查。 */
export interface HeroSkillActivatedBody {
  kind: "heroSkillActivated";
  skillId: string;
  skillKind: "demolish" | "relief" | "patronage" | "warDrum";
  targetSeat?: number;
}
/** 抽锦囊进手(#384):座位+张数口径,不写牌名——暗牌内容不过事件,与对局日志
 *  「抽了一张锦囊」同隐私口径(ADR-0016)。开局发牌不发(开局校准点覆盖,与初始
 *  现金/体力同口径);游戏时进手(献计/机遇/锦囊格)经 drawJinnangTraced 产出,
 *  count=实际入手张数(牌库空落空无转移,不产事件)。 */
export interface JinnangDrawnBody {
  kind: "jinnangDrawn";
  count: number;
  reason: string;
}
/** 弃牌堆洗回牌库:抽牌遇牌库空且弃牌非空,弃牌堆骰序洗成新牌库(正式机制,非防御
 *  逻辑)。count=洗回张数(=洗回前弃堆全量);洗后牌序是暗信息,严禁携带牌 id
 *  (ADR-0016,与 jinnangDrawn 同口径且只少不多)。牌库与弃堆双空不产本事件
 *  (落空=无转移,#384 口径),改产 jinnangExhausted 落空宣告。 */
export interface JinnangReshuffledBody {
  kind: "jinnangReshuffled";
  count: number;
}
/** 牌库已空(#588):抽牌遇牌库与弃堆双空,落空宣告——零状态转移(无牌可抽即无转移,
 *  #384 口径),fold 面忽略;表现=「锦囊已空」文案浮字(fx 面消费派生,单机/联机同见,
 *  与 jinnangReshuffled 同通路;每次 drawJinnang 调用至多宣告一次)。 */
export interface JinnangExhaustedBody {
  kind: "jinnangExhausted";
}
/** 声望变更(#384):delta=夹紧 ±100 后的实际增减,reason=领域词 slug(机遇抉择=
 *  encounter/天命格=fate,开放词表);里程碑献计的进手随后自产 jinnangDrawn
 *  (reason=repMilestone)。 */
export interface ReputationChangedBody {
  kind: "reputationChanged";
  delta: number;
  reason: string;
}
/** 声望献计里程碑穿越(#719):首次向上越过 +30/+60/+90 的宣告——零新增转移的纯宣告
 *  (repMilestones 记账由折面按 reputationChanged 穿越重算对齐,献计进手随 jinnangDrawn
 *  折),折面声明性;表现=「民心所向,名将献计」文案浮字(fx 面派生,单机/联机同见,
 *  #719 自引擎浮字死通道迁事件面)。 */
export interface RepMilestoneCrossedBody {
  kind: "repMilestoneCrossed";
  milestone: number;
}
/** 体力变更(#384):delta=夹紧 0~100 后的实际增减,reason=领域词 slug(机遇=
 *  encounter/被动技=skill/主动技赈济=heroRelief/耗竭重置=exhaustion,开放词表)。 */
export interface StaminaChangedBody {
  kind: "staminaChanged";
  delta: number;
  reason: string;
}
/** 跳过回合(#384):skipTurns 消费点(endTurn 推进环)产出,seat=被跳过者——
 *  体力耗竭/缓兵之计共用 skipTurns 机制,标记侧由各自因果事件相邻覆盖
 *  (jinnangAnnounced/staminaChanged/marchArrived),此处宣告「本回合被跳过」。 */
export interface TurnSkippedBody {
  kind: "turnSkipped";
}
/** 机遇触发(掷骰命中且已抽中具体机遇;encounterId/tier=目录条目)。 */
export interface EncounterTriggeredBody {
  kind: "encounterTriggered";
  encounterId: string;
  tier: EncounterTier;
}
/** 机遇抉择落定(#385 缺口 6):auto 执行与 resolve 两路共用的结算点产出——
 *  choiceIndex=def.choices 下标,文案属静态目录(fx 按 encounterId+choiceIndex
 *  查 ENCOUNTERS 表派生,事件不带成品文案)。 */
export interface EncounterChosenBody {
  kind: "encounterChoice";
  encounterId: string;
  choiceIndex: number;
}
/** 耗竭处置落定(#385 缺口 6):降级/失城两路共用;propertyId+exhaustionKind 足以
 *  派生目录文案(城名按棋盘查得,fx 拼装),随后 staminaChanged(reason=exhaustion)
 *  携带耗竭重置——fx 检测批内前置本事件时把跳过文案升级为带处置明细的完整版。 */
export interface ExhaustionChosenBody {
  kind: "exhaustionChoice";
  propertyId: string;
  exhaustionKind: "downgrade" | "lose";
}
/** 锦囊宣布(出牌扣账后、识破窗开窗前;targetSeats=受影响份清单)。 */
export interface JinnangAnnouncedBody {
  kind: "jinnangAnnounced";
  cardId: string;
  targetSeats: number[];
}
/** 反应窗开启(识破窗/拦检窗;queriedSeats=被询问座位集,god-view 明传,ADR-0020)。 */
export interface ReactionOpenedBody {
  kind: "reactionOpened";
  windowKind: "jinnang" | "march";
  cardId: string;
  queriedSeats: number[];
}
/** 反应窗应答(use=false=「不用」;cardId=打出的反应牌,仅 use 时携带)。 */
export interface ReactionAnsweredBody {
  kind: "reactionAnswered";
  use: boolean;
  cardId?: string;
}
/** 拦检失败(#385 缺口 5):拼点平/负,【半路杀出】白耗,行人照常续走——seat=城主
 *  (出牌方),aRoll/bRoll=拼点点数(全桌公开,签面演出与战报同源),tileIndex=拦检城(浮字锚格)。 */
export interface ReactionFailedBody {
  kind: "reactionFailed";
  windowKind: "march";
  tileIndex: number;
  aRoll: number;
  bRoll: number;
}
/** 拼点结算(#636,ADR-0030):公共拼点 resolveDuel 单点产出,拦检(半路杀出)与
 *  连环计(二虎竞食)两调用点天然全覆盖——两方座位(aSeat/bSeat)、两枚点数
 *  (aRoll/bRoll)、胜者座位(平局 winnerSeat=null)。探宝拼点是单人 2d6 判定、不走
 *  resolveDuel,不产本事件;拼点骰是独立词汇:不派 diceRolled、不触发掷骰时机
 *  (张星彩掷金边界不变,rules 08)。 */
export interface DuelResolvedBody {
  kind: "duelResolved";
  aSeat: number;
  bSeat: number;
  aRoll: number;
  bRoll: number;
  winnerSeat: number | null;
}
/** 识破生效(锦囊被拆:shareSeat=被保住的份(AOE 按份拆),缺省=整计作废/落空)。 */
export interface JinnangVoidedBody {
  kind: "jinnangVoided";
  cardId: string;
  shareSeat?: number;
}
/** 中招宣告(#385 缺口 5,缓兵之计):效果落账点产出——seat=用计者,targetSeat=中招者
 *  (fx 锚中招者位置出文案;下回合实际跳过另有 turnSkipped 相邻宣告)。 */
export interface JinnangInflictedBody {
  kind: "jinnangInflicted";
  cardId: string;
  targetSeat: number;
}
/** 窥探生效(#575,军情密探即时窥探):引擎真生效时点(executeJinnang peek 分支)
 *  产出,被识破不产出(窥探从未发生)。seat=窥方(viewer),targetSeat=被窥者;
 *  hand=被窥者锦囊手牌快照——阅览权随事件走:viewer 凭本事件看一次(redactEvents
 *  逐座位裁 hand,非 viewer 恒空,ADR-0016),窥探零客户端状态、关闭即逝。 */
export interface PeekAppliedBody {
  kind: "peekApplied";
  viewerSeat: number;
  targetSeat: number;
  hand: string[];
}
/** 定制问询自动执行(#719,#424):可用选项 ≤1 的 ADR-0013 自动执行轻提示宣告——
 *  零相位进出(挂起载荷即刻清账,相位保持原值),折面声明性;label 随事件走
 *  (扩展问询选项非静态目录,fx 无表可查——成品字段随事件,与 treasureStolen
 *  的 treasureName 同理);label 本就公开(问询选项走 snapshot.choices 单通道)。
 *  表现=选项文案浮字(fx 面派生,单机/联机同见,#719 自引擎浮字死通道迁事件面);
 *  命令应答路(卷轴点选)不产本事件——选项文案已由卷轴 UI 呈现。 */
export interface InquiryAutoExecutedBody {
  kind: "inquiryAutoExecuted";
  inquiryId: string;
  optionId: string;
  label: string;
}

/** 事件体联合(产出 API 的入参形状)。 */
export type GameEventBody =
  | GameStartedBody
  | SetupCompletedBody
  | TurnEndedBody
  | TurnStartedBody
  | RoundEndedBody
  | RoundStartedBody
  | GameOverBody
  | DiceRolledBody
  | MarchArrivedBody
  | CapitalHaltBody
  | CapitalSelectedBody
  | PropertyBoughtBody
  | PropertyUpgradedBody
  | PropertyRejectedBody
  | PropertyGrantedBody
  | CashChangedBody
  | TreasureGainedBody
  | TreasureSoldBody
  | TreasureTradedBody
  | TreasureStolenBody
  | AssetLiquidatedBody
  | AssetTransferredBody
  | HeroRecruitedBody
  | PlayerBankruptBody
  | SkillFiredBody
  | HeroSkillActivatedBody
  | JinnangDrawnBody
  | JinnangReshuffledBody
  | JinnangExhaustedBody
  | ReputationChangedBody
  | RepMilestoneCrossedBody
  | StaminaChangedBody
  | TurnSkippedBody
  | EncounterTriggeredBody
  | EncounterChosenBody
  | ExhaustionChosenBody
  | JinnangAnnouncedBody
  | ReactionOpenedBody
  | ReactionAnsweredBody
  | ReactionFailedBody
  | DuelResolvedBody
  | JinnangVoidedBody
  | JinnangInflictedBody
  | PeekAppliedBody
  | InquiryAutoExecutedBody;

/** 事件 = 事件体 + 公共首部(快照 `events` 字段与将来联机流式下发的线上形状)。 */
export type GameEvent = GameEventBody & GameEventBase;

/** 显式产出(#375 口 2):域模块结算点直呼;seat=行动者(事件语义上的主行动者,
 *  双向事件的对手座走专属字段)。时刻戳在此统一盖章。 */
export function emitGameEvent(g: GameEngine, seat: number | null, body: GameEventBody): void {
  g.gameEvents.push({ ...body, seat, round: g.round, turn: g.turnNumber } as GameEvent);
}

/** 开新批(编排入口调用:submitCommand / botAct / 开局驱动):弃当前批,从此刻起
 *  收集下一次转移的事件——「本批 = 本次编排转移的产出」,非全史的批界所在。
 *  快照只读透出当前批(非破坏性),恢复随批回灌(SNAPSHOT_FIELDS.events)。 */
export function beginGameEventBatch(g: GameEngine): void {
  g.gameEvents = [];
}

/** 时机字段必存校验:映射表条目声明的字段在派发点缺失 = 派发契约违反(数据 bug),
 *  当场炸出(零兜底:不产 undefined 字段的哑事件)。 */
function requireMomentField<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`事件产出:${label} 缺失(时机派发契约违反,数据 bug)`);
  return value;
}

/** 行军路径必存校验(#385):marchArrived/capitalHalt 的路径随事件走,产出点引擎
 *  lastMove 为空 = 状态机 bug,当场炸出(显式 emit 点与时机映射表共用)。 */
export function requireMovePath(g: GameEngine, label: string): MovePath {
  const path = g.lastMove;
  if (path == null) throw new Error(`事件产出:${label} 无行军路径(状态机 bug)`);
  return path;
}

/** 时机 → 事件体映射表:登记进词汇表的时机在派发点同步产出事件;引擎侧富化
 *  (查 catalog/持有)在此做。未登记时机(BeforeMarch/BeforeRoll/AfterMarch/
 *  PassedPlayer/MarchPassedCity/LandedOnProperty 等
 *  前置钩子与途经点)不产出事件。 */
type MomentEventFactory = (g: GameEngine, ctx: MomentCtx) => GameEventBody;

const MOMENT_EVENT_FACTORIES: Partial<Record<GameMoment, MomentEventFactory>> = {
  GameStart: () => ({ kind: "gameStarted" }),
  SetupComplete: () => ({ kind: "setupCompleted" }),
  TurnEnd: () => ({ kind: "turnEnded" }),
  TurnStart: () => ({ kind: "turnStarted" }),
  RoundEnd: () => ({ kind: "roundEnded" }),
  RoundStart: () => ({ kind: "roundStarted" }),
  GameOver: (g) => ({ kind: "gameOver", reason: g.winReason }),
  DieRolled: (_g, ctx) => ({
    kind: "diceRolled",
    die: requireMomentField(ctx.die, "DieRolled.die"),
  }),
  CapitalHalt: (g, ctx) => ({
    kind: "capitalHalt",
    tileIndex: requireMomentField(ctx.tileIndex, "CapitalHalt.tileIndex"),
    path: requireMovePath(g, "CapitalHalt"), // #385:截断到都城的路径随事件走
  }),
  PropertyBought: (g, ctx) => {
    const propertyId = requireMomentField(ctx.propertyId, "PropertyBought.propertyId");
    const def = g.catalog.get(propertyId);
    if (def == null) throw new Error(`事件产出:城 ${propertyId} 不在 catalog(数据 bug)`);
    return { kind: "propertyBought", propertyId, price: def.purchasePrice };
  },
  PropertyUpgraded: (g, ctx) => {
    const propertyId = requireMomentField(ctx.propertyId, "PropertyUpgraded.propertyId");
    const owner = g.findOwner(propertyId);
    const holding = owner != null ? findHolding(owner, propertyId) : null;
    if (holding == null) throw new Error(`事件产出:城 ${propertyId} 无归属持有(数据 bug)`);
    return { kind: "propertyUpgraded", propertyId, newLevel: holding.level };
  },
  PropertyGained: (_g, ctx) => ({
    kind: "propertyGranted",
    propertyId: requireMomentField(ctx.propertyId, "PropertyGained.propertyId"),
  }), // 机遇赐城(#719):传檄而定易主宣告(#457 与「购」语义区分的时机挂点)
  TreasureGained: (_g, ctx) => ({
    kind: "treasureGained",
    treasureId: requireMomentField(ctx.treasureId, "TreasureGained.treasureId"),
  }),
  TreasureSold: (_g, ctx) => ({
    kind: "treasureSold",
    treasureId: requireMomentField(ctx.treasureId, "TreasureSold.treasureId"),
    amount: requireMomentField(ctx.amount, "TreasureSold.amount"),
  }),
  HeroRecruited: (_g, ctx) => ({
    kind: "heroRecruited",
    heroId: requireMomentField(ctx.heroId, "HeroRecruited.heroId"),
  }),
  PlayerBankrupt: (_g, ctx) => ({
    kind: "playerBankrupt",
    creditorSeat: requireMomentField(ctx.creditorSeat, "PlayerBankrupt.creditorSeat"),
  }),
  JinnangAnnounced: (_g, ctx) => ({
    kind: "jinnangAnnounced",
    cardId: requireMomentField(ctx.cardId, "JinnangAnnounced.cardId"),
    targetSeats: [...requireMomentField(ctx.targetSeats, "JinnangAnnounced.targetSeats")],
  }),
};

/** 时机派发同步产出(#375 口 1,authority.dispatchMoment 入口调用):命中映射表即
 *  以 ctx.subject 为行动者产出事件;未登记时机零产出(查表 miss 是设计内路径)。 */
export function noteMomentEvent(g: GameEngine, moment: GameMoment, ctx: MomentCtx): void {
  const factory = MOMENT_EVENT_FACTORIES[moment];
  if (factory) emitGameEvent(g, ctx.subject, factory(g, ctx));
}

// ── 异常终局(#642 响亮终局,wayfinder #644「bot 对局零无声软锁」)──
/** 驱动链死亡出口(链内抛异常/驱动链停摆/时钟挂死)的唯一引擎语义:对局当场作废——
 *  无胜者(winner=null)、winReason="aborted"、phase/turnPhase=GameOver;终局行
 *  (category final,机读面板含 abortReason 摘要与全体玩家终态)与 GameOver 时机
 *  (gameOver 事件 reason="aborted" 判别,subject=activeIndex)照常产出,经编排侧
 *  persist/广播走常规下行通路。幂等:已终局(正常或已作废)再调用直接返回——多出口
 *  并发时首因优先,次因不覆盖已落账的终局行。
 *  域本体放本模块的理由:批界(beginGameEventBatch)/事件词汇(gameOver)/终局行三通道
 *  都在这里,且壳行数锁下 authority.ts 只留薄委托。调用方=房间编排三出口(room.abortGame
 *  经 ops 注入 bot-driver/watchdogs,单机 LocalController 时钟 fatal 同口)。 */
export function abortGame(g: GameEngine, reason: string): void {
  if (g.isOver) return; // 幂等(非兜底:重复出口以首因为准)
  beginGameEventBatch(g); // 编排级转移(#375 批界):abort 由脚本直呼(不经 submitCommand/botAct),自行开批
  g.isOver = true;
  g.winner = null;
  g.winReason = "aborted";
  g.phase = "GameOver";
  g.turnPhase = "GameOver";
  g.logEvent(
    "final",
    null,
    `对局作废(异常终局):${reason}`,
    JSON.stringify({
      type: "final",
      round: g.round,
      turnNumber: g.turnNumber,
      winner: null,
      winReason: "aborted",
      abortReason: reason,
      players: g.players.map((p) => ({
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
  // 时机·GameOver 照常派发:subject=activeIndex 是派发主体、非胜者(消费方以
  // reason="aborted" 判别;当前无 GameOver 时机监听技,事件面照常齐全)
  g.dispatchMoment("GameOver", { subject: g.activeIndex });
}

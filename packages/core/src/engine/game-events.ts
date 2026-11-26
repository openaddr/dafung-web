// 事件流词汇表与产出通道(#375,ADR-0020):引擎每次状态转移产出类型化 GameEvent
// (行动者座位 / 对象 / 原因),随快照 `events` 字段输出。**批语义**:批界 = 编排入口
// (submitCommand / botAct / 开局驱动,经 beginGameEventBatch 开批)——引擎缓冲持当前
// 批,快照非破坏性透出(同一转移的多次快照看到同一批,批语义幂等),新转移开批即弃
// 旧批:数组按转移产出,非全史。恢复随批走(写入侧回灌)。
// 本模块只管「词汇 + 产出」:折叠/动效等消费归后续工单。纯数据、序列化友好
// (架构红线 1/5):事件无函数、无循环引用、无 DOM 引用；联机按 ADR-0016 投影询问身份等私有载荷。
//
// 产出两口:
//  1. 时机映射(MOMENT_EVENT_FACTORIES):时机总线 dispatchMoment 是引擎的「转移宣告
//     总线」——回合相位/掷骰/驻跸/购地/升级/招贤/得宝/售宝/破产/出牌宣布在派发点同步
//     产出事件。词汇表未登记的时机(BeforeMarch/PassedPlayer 等前置钩子与高频途经点)
//     不产出;新增事件种类优先在此表加一行(加时机三步的最后一步顺带落地)。
//  2. 显式产出(emitGameEvent):行军落格、反应窗开合、名将技能、抽锦囊、体力变更、
//     清算交割等由各领域在结算点直接产出事件。reason 记录对应的结算来源。
import type { GameEngine, GameCommand, TurnPhase, VictoryReason } from "./authority";
import type { PendingSkillChoice } from "./choices";
import type { LandOutcomeSnapshot, PendingLand } from "./movement-flow";
import type { GameMoment, MomentCtx } from "./timing";
import type { ReactionCardSpend, ReactionTarget, ReactionView } from "./reaction-window";
import type { MovePath } from "./board";
import type {
  CityDamageEntry,
  CityDamageImpact,
  CityDamageOrigin,
  CityRewardReceipt,
} from "./city-damage";
import type { CityBurning } from "./model";
import { findHolding } from "./player";
import { heroSlotOf } from "./roster";
import { netWorth } from "./networth";

/** 命令 → 中文动词(cmd 行战报 brief 用;机读 detail 为完整命令 JSON)。原属引擎壳,
 *  #1377 随壳行数锁(#325 只减不增)迁入战报词汇域;消费=authority.submitCommand
 *  命令行落账,权威单点不变。 */
export const CMD_BRIEF: Record<GameCommand["type"], string> = {
  rollAndMove: "行军",
  buyProperty: "购地",
  upgradeProperty: "扩军",
  endDecision: "按兵不动",
  resolveHeroPick: "招贤",
  resolveTreasureOwner: "珍宝交涉",
  declareBankruptcy: "认破产",
  confirmBankruptcySettle: "出售并清偿",
  useJinnang: "用锦囊",
  useHeroSkill: "出技",
  useBookSkill: "用书学技",
  dismissHero: "遣散",
  respondReaction: "反应窗应答",
  respondSkillChoice: "技能发动抉择",
};

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
/** 落格结算落定:城池及固定事件效果落账后,权威宣告最终相位及决策载荷。
 *  行军到达只负责落位,客户端不得在效果落账前推演购地/扩军/珍宝交涉。
 *  招贤候选仍由既有 AwaitingHeroPick 校准同步,本事件只携落格公开事实。 */
export interface LandingResolvedBody {
  kind: "landingResolved";
  turnPhase: "AwaitingDecision" | "AwaitingTreasureOwner" | "AwaitingHeroPick";
  pendingLand: PendingLand | null;
  pendingCityEvent: boolean;
  treasureVisitor: { propertyId: string; ownerIdx: number } | null;
  outcome: LandOutcomeSnapshot & { ownerSeat: number | null };
}
/** 都城驻跸(经过己都城必停;补给金额随后以 cashChanged reason="supply" 跟进)。
 *  path=截断到都城的行军路径(#385 同 marchArrived 口径)。 */
export interface CapitalHaltBody {
  kind: "capitalHalt";
  tileIndex: number;
  path: MovePath;
}
/** 选都建城(开局三段式落子:建都即获城 Lv.1,扣建城费)。 */
export interface CapitalSelectedBody {
  kind: "capitalSelected";
  tileIndex: number;
  propertyId: string;
  cost: number;
}
/** 购地(决策命令成交;price=购入价)。 */
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
/** 城池受损后的等级、防御值、燃烧和持有期伤害排行榜；seat 为受击城主。 */
export interface PropertyDamagedBody {
  kind: "propertyDamaged";
  propertyId: string;
  level: number;
  defense: number;
  impact: CityDamageImpact;
  origin: CityDamageOrigin;
  burning: CityBurning | null;
  damageRanking: readonly CityDamageEntry[];
}
/** 一张火烧连营实际造成的最重城损。首处攻陷发生时即落定，其他结果等余城结清。 */
export interface FireWallImpactBody {
  kind: "fireWallImpact";
  castSeq: number;
  propertyId: string;
  impact: CityDamageImpact;
}
/** 燃烧计时独立变化；seat 为当前城主。 */
export interface PropertyBurningChangedBody {
  kind: "propertyBurningChanged";
  propertyId: string;
  burning: CityBurning | null;
}
/** 燃烧到期扣防；marks 为本次扣防前的火焰标记数。 */
export interface PropertyBurningTickedBody {
  kind: "propertyBurningTicked";
  propertyId: string;
  marks: number;
}
/** ADR-0013 自动执行默认行为的事件，原因是银两不足或城已满级。 */
export interface PropertyRejectedBody {
  kind: "propertyRejected";
  propertyId: string;
  reason: "insufficient-cash" | "maxed";
}
/** 金钱变更(被动经济结算点;delta 带符号,reason=领域词 slug,counterpartSeat=
 *  玩家间转移的对手座)。主动支出(购地/交涉付款)不产本事件——金额已在
 *  propertyBought/treasureTraded 等领域事件内。 */
export interface CashChangedBody {
  kind: "cashChanged";
  delta: number;
  reason: string;
  counterpartSeat?: number;
  cityReward?: CityRewardReceipt;
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
/** 破产批量自救(每件资产成交尾;asset=变卖物,amount=所得)。 */
export interface AssetLiquidatedBody {
  kind: "assetLiquidated";
  asset: { kind: "treasure" | "property"; id: string };
  amount: number;
}
/** 批量清偿完成:交割与现金技能结算后的余额,seat=债务人;无债主则 creditor=null。 */
export interface BankruptcySettledBody {
  kind: "bankruptcySettled";
  cashAfter: number;
  creditor: { seat: number; cashAfter: number } | null;
}
/** 城池易主，seat 为原城主；toSeat 为接手者，null 表示回无主。 */
export interface AssetTransferredBody {
  kind: "assetTransferred";
  propertyId: string;
  toSeat: number | null;
  conquest?: CityDamageOrigin;
}
/** 招贤得将(三送将路经授技单点入槽;heroId=名将 id,skillIds=本次授技=权威态,
 *  客户端折叠据此建槽、不得自行重掷——掷骰在权威侧,票 #787)。 */
export interface HeroRecruitedBody {
  kind: "heroRecruited";
  heroId: string;
  skillIds: string[];
}
/** 玩家破产出局(善后完成:名将已释放、资产已转债主;creditorSeat=债主座位,
 *  null=无债主归银行/销毁——#384 随派发点 finalizeBankruptcy 传参接线)。 */
export interface PlayerBankruptBody {
  kind: "playerBankrupt";
  creditorSeat: number | null;
}
/** 用书学技(#1146):seat=习得者,heroId=槽定位,skillId=习得之技,treasureId=消耗的
 *  技能书实例(技能书=「此技习得器」,书随学技出册;书名/技名客户端按表回查,不随事件
 *  重复携带)。折叠面据此槽内池序入技+珍宝位出册。 */
export interface SkillLearnedBody {
  kind: "skillLearned";
  heroId: string;
  skillId: string;
  treasureId: string;
}
/** 遣散(#1147):seat=遣散者,heroId=麾下槽定位,skillIds=遣散时已学技(=同批逐册
 *  折书明细;书 id=skillbook-<skillId> 由印书单源 makeSkillBook 派生,不另携带)。
 *  折叠面据此整槽出麾下+招贤池划名;折书入位由同批 treasureGained 各自折(珍宝现通路
 *  零特判)。显式 emit(遣散域结算点,非触发时机——不进 MOMENTS、无 scope/冷却语义)。 */
export interface HeroDismissedBody {
  kind: "heroDismissed";
  heroId: string;
  skillIds: string[];
}
/** 名将被动技击发(#384):时机技能经 scope/冷却/条件过滤后效果落账成功的瞬间;
 *  seat=技属主,技参数(步数/金额等)由技表 skills.ts 按 skillId 现查,不入事件。 */
export interface SkillFiredBody {
  kind: "skillFired";
  heroId: string;
  skillId: string;
  moment: GameMoment;
}

export interface SkillChoiceOpenedBody {
  kind: "skillChoiceOpened";
  choice: PendingSkillChoice;
  marks: number | null;
}

export interface SkillMarksChangedBody {
  kind: "skillMarksChanged";
  heroId: string;
  skillId: string;
  marks: number;
}

export interface SkillChoiceAnsweredBody {
  kind: "skillChoiceAnswered";
  heroId: string;
  skillId: string;
  targetSeat: number | null;
  skipTurns: number | null;
  remainingMarks: number | null;
  resumePhase: TurnPhase;
}
/** 名将主动技发动(#384,#188 档 3 三类;#1388 T2 火攻定向化定形 kind=fireBlast/relief/warDrum);
 *  seat=发动者,heroId=属主槽定位(#785 槽位化:冷却账内嵌槽,折叠按 heroId 定槽记账,
 *  同名技多槽不串账);费用/加成等技参数由技表 skills.ts 按 skillId 现查。
 *  判别联合(#1388 T2,零兜底:漏传目标在类型层面不可表达,#585 口径)——
 *  fireBlast=城目标域,body 必带目标城(targetPropertyId+targetTileIndex,fold/指向线锚
 *  城格两处消费);relief=席位域必带 targetSeat;warDrum=none 域无目标字段。 */
export interface FireBlastSkillBody {
  kind: "heroSkillActivated";
  heroId: string;
  skillId: string;
  skillKind: "fireBlast";
  targetPropertyId: string;
  targetTileIndex: number;
}
export interface ReliefSkillBody {
  kind: "heroSkillActivated";
  heroId: string;
  skillId: string;
  skillKind: "relief";
  targetSeat: number;
}
export interface WarDrumSkillBody {
  kind: "heroSkillActivated";
  heroId: string;
  skillId: string;
  skillKind: "warDrum";
}
export type HeroSkillActivatedBody = FireBlastSkillBody | ReliefSkillBody | WarDrumSkillBody;
/** 城池摸牌锚定实际离开或停下的城格。 */
export type JinnangDrawSource =
  | { reason: "turnStart" }
  | { reason: "cityPassed" | "cityArrived"; tileIndex: number };

/** 游戏中摸锦囊入手。座位、张数和来源公开，牌面只投影给该座位。起手由开局校准同步。 */
export type JinnangDrawnBody = JinnangDrawSource & {
  kind: "jinnangDrawn";
  count: number;
  cardIds?: string[];
};
/** 弃牌堆洗回牌库:抽牌遇牌库空且弃牌非空,弃牌堆骰序洗成新牌库(正式机制,非防御
 *  逻辑)。count=洗回张数(=洗回前弃堆全量);洗后牌序是暗信息,严禁携带牌 id
 *  (ADR-0016)。牌库与弃堆双空不产本事件
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
/** 体力变更：delta 为夹紧后的实际增减，reason 记录伤害、技能、补给或休整等来源。 */
export interface StaminaChangedBody {
  kind: "staminaChanged";
  delta: number;
  reason: string;
  /** 归零一击的表现随耗竭结算，待决技能可能把两者分到不同批。 */
  depletes?: true;
}
/** 消费跳过次数后记录该回合的编号。seat 为被跳过者。 */
export interface TurnSkippedBody {
  kind: "turnSkipped";
}
/** 体力耗竭开始休整。归零伤害来源、实际降级及失城清单供演出宣告；城损及易主分别由
 *  propertyDamaged、assetTransferred 同步，休整按 restTurns 累加。 */
export interface ExhaustionResolvedBody {
  kind: "exhaustionResolved";
  sourceSeat: number | null;
  downgradedPropertyIds: string[];
  lostPropertyIds: string[];
  strongestImpact: CityDamageImpact | null;
  restTurns: number;
}
/** 出牌扣账后、识破窗打开前宣布受影响的座位，座位去重。 */
export interface JinnangAnnouncedBody {
  kind: "jinnangAnnounced";
  cardId: string;
  targetSeats: number[];
}
/** 回合摸牌后进入出牌阶段，或城损技能应答后收尾时的权威相位。 */
export interface JinnangPhaseResumedBody {
  kind: "jinnangPhaseResumed";
  turnPhase: "AwaitingJinnang" | "Roll";
}
/** 权威窗号、时长和影响范围随开窗公告一起下行；询问身份按席位投影。 */
export interface ReactionOpenedBody {
  kind: "reactionOpened";
  seq: number;
  view: ReactionView;
}
/** 反应窗应答(use=false=「不用」;cardId=打出的反应牌,仅 use 时携带)。 */
export interface ReactionAnsweredBody {
  kind: "reactionAnswered";
  use: boolean;
  cardId?: string;
  /** 最终应答随附实际离手的反应锦囊，按权威扣账顺序；此窗无人消耗时为空数组。 */
  spentCards?: ReactionCardSpend[];
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
/** 公开拼点结算，包含本次各参与座位的点数及胜者；平局 winnerSeat=null。
 *  适用拦检、连环计和称帝。 */
export interface DuelResolvedBody {
  kind: "duelResolved";
  sides: { seat: number; roll: number }[];
  winnerSeat: number | null;
}
/** 识破生效后宣布被拆的锦囊、判词及指示线目标。seat 是生效识破者。 */
export interface JinnangVoidedBody {
  kind: "jinnangVoided";
  cardId: string;
  result:
    | { kind: "share"; target: ReactionTarget }
    | { kind: "whole"; userSeat: number; verdict: "voided" | "failed" }
    | { kind: "counter"; userSeat: number };
}
/** 反识破使整计或其中一份恢复，随根计实际执行发出。seat=原锦囊使用者。 */
export interface JinnangRestoredBody {
  kind: "jinnangRestored";
  cardId: string;
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
 *  cardId=被窥所因的锦囊 id(#1067:UI 题名按目录回查,不硬编码牌名;redact 透传);
 *  hand=被窥者锦囊手牌快照——阅览权随事件走:viewer 凭本事件看一次(redactEvents
 *  逐座位裁 hand,非 viewer 恒空,ADR-0016),窥探零客户端状态、关闭即逝。 */
export interface PeekAppliedBody {
  kind: "peekApplied";
  viewerSeat: number;
  targetSeat: number;
  cardId: string;
  hand: string[];
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
  | LandingResolvedBody
  | CapitalHaltBody
  | CapitalSelectedBody
  | PropertyBoughtBody
  | PropertyUpgradedBody
  | PropertyDamagedBody
  | FireWallImpactBody
  | PropertyBurningChangedBody
  | PropertyBurningTickedBody
  | PropertyRejectedBody
  | CashChangedBody
  | TreasureGainedBody
  | TreasureSoldBody
  | TreasureTradedBody
  | TreasureStolenBody
  | AssetLiquidatedBody
  | BankruptcySettledBody
  | AssetTransferredBody
  | HeroRecruitedBody
  | PlayerBankruptBody
  | HeroDismissedBody
  | SkillLearnedBody
  | SkillFiredBody
  | SkillChoiceOpenedBody
  | SkillMarksChangedBody
  | SkillChoiceAnsweredBody
  | HeroSkillActivatedBody
  | JinnangDrawnBody
  | JinnangReshuffledBody
  | JinnangExhaustedBody
  | StaminaChangedBody
  | TurnSkippedBody
  | ExhaustionResolvedBody
  | JinnangAnnouncedBody
  | JinnangPhaseResumedBody
  | ReactionOpenedBody
  | ReactionAnsweredBody
  | ReactionFailedBody
  | DuelResolvedBody
  | JinnangVoidedBody
  | JinnangRestoredBody
  | JinnangInflictedBody
  | PeekAppliedBody;

/** 事件 = 事件体 + 公共首部(快照 `events` 字段与将来联机流式下发的线上形状)。 */
export type GameEvent = GameEventBody & GameEventBase;

/** 事件词表运行时清单(#1161 无头确定性体系消费,如 whole-game 的词表合法不变量):
 *  与上方 GameEventBody 联合逐字对齐——新增事件体必同步登记;`satisfies` 保证不拼错,
 *  漏登记则新 kind 在无头巡检处被拒而当场红出来,顺势补齐。 */
export const GAME_EVENT_KINDS = [
  "gameStarted",
  "setupCompleted",
  "turnEnded",
  "turnStarted",
  "roundEnded",
  "roundStarted",
  "gameOver",
  "diceRolled",
  "marchArrived",
  "landingResolved",
  "capitalHalt",
  "capitalSelected",
  "propertyBought",
  "propertyUpgraded",
  "propertyDamaged",
  "fireWallImpact",
  "propertyBurningChanged",
  "propertyBurningTicked",
  "propertyRejected",
  "cashChanged",
  "treasureGained",
  "treasureSold",
  "treasureTraded",
  "treasureStolen",
  "assetLiquidated",
  "bankruptcySettled",
  "assetTransferred",
  "heroRecruited",
  "playerBankrupt",
  "skillFired",
  "skillChoiceOpened",
  "skillMarksChanged",
  "skillChoiceAnswered",
  "skillLearned",
  "heroSkillActivated",
  "jinnangDrawn",
  "jinnangReshuffled",
  "jinnangExhausted",
  "staminaChanged",
  "turnSkipped",
  "exhaustionResolved",
  "jinnangAnnounced",
  "jinnangPhaseResumed",
  "reactionOpened",
  "reactionAnswered",
  "reactionFailed",
  "duelResolved",
  "jinnangVoided",
  "jinnangRestored",
  "jinnangInflicted",
  "peekApplied",
] as const satisfies readonly GameEvent["kind"][];

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
  TreasureGained: (_g, ctx) => ({
    kind: "treasureGained",
    treasureId: requireMomentField(ctx.treasureId, "TreasureGained.treasureId"),
  }),
  TreasureSold: (_g, ctx) => ({
    kind: "treasureSold",
    treasureId: requireMomentField(ctx.treasureId, "TreasureSold.treasureId"),
    amount: requireMomentField(ctx.amount, "TreasureSold.amount"),
  }),
  HeroRecruited: (g, ctx) => {
    const heroId = requireMomentField(ctx.heroId, "HeroRecruited.heroId");
    // skillIds=本次授技(#785):槽已由授技单点建好,按 heroId 定槽读已授技;查无=数据 bug
    return {
      kind: "heroRecruited",
      heroId,
      skillIds: [...heroSlotOf(g.players[ctx.subject], heroId).skillIds],
    };
  },
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

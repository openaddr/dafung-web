// 事件流词汇表与产出通道(#375,ADR-0020):引擎每次状态转移产出类型化 GameEvent
// (行动者座位 / 对象 / 原因),随快照 `events` 字段输出。**批语义**:批界 = 编排入口
// (submitCommand / botAct / 开局驱动,经 beginGameEventBatch 开批)——引擎缓冲持当前
// 批,快照非破坏性透出(同一转移的多次快照看到同一批,与 lastJinnangPlay.seq 同幂等
// 哲学),新转移开批即弃旧批:数组按转移产出,非全史。恢复随批走(写入侧回灌)。
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
//     触发/选都建城/三变卖/交割/金钱结算)在各域模块结算点直呼,reason 用领域词短横
//     slug(供应/税/行情/机遇/横征/连环……开放词表,新来源即新 slug)。
import type { GameEngine, VictoryReason } from "./authority";
import type { GameMoment, MomentCtx } from "./timing";
import type { EncounterTier } from "./encounters";
import { findHolding } from "./player";

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
/** 终局(胜负判定确定;subject=胜者,reason=判定依据)。 */
export interface GameOverBody {
  kind: "gameOver";
  reason: VictoryReason;
}
/** 掷骰(DieRolled:骰面已定、行军未算;移动步数=骰面+技能加成,加成不在此列)。 */
export interface DiceRolledBody {
  kind: "diceRolled";
  die: number;
}
/** 行军落格(主路落位/拦停止步;辅路格与驻跸各走 capitalHalt/后续结算事件)。 */
export interface MarchArrivedBody {
  kind: "marchArrived";
  tileIndex: number;
}
/** 都城驻跸(经过己都城必停;补给金额随后以 cashChanged reason="supply" 跟进)。 */
export interface CapitalHaltBody {
  kind: "capitalHalt";
  tileIndex: number;
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
/** 破产变卖自救(三变卖命令成交尾;asset=变卖物,amount=所得)。 */
export interface AssetLiquidatedBody {
  kind: "assetLiquidated";
  asset: { kind: "treasure" | "property" | "hero"; id: string };
  amount: number;
}
/** 招贤得将(三选一选定/机遇·锦囊送将;heroId=名将 id)。 */
export interface HeroRecruitedBody {
  kind: "heroRecruited";
  heroId: string;
}
/** 玩家破产出局(善后完成:名将已释放、资产已转债主;债主座位暂不入事件——
 *  派发点 finalizeBankruptcy 不持有该信息,词汇后续需要时随派发点扩展)。 */
export interface PlayerBankruptBody {
  kind: "playerBankrupt";
}
/** 机遇触发(掷骰命中且已抽中具体机遇;encounterId/tier=目录条目)。 */
export interface EncounterTriggeredBody {
  kind: "encounterTriggered";
  encounterId: string;
  tier: EncounterTier;
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
/** 识破生效(锦囊被拆:shareSeat=被保住的份(AOE 按份拆),缺省=整计作废/落空)。 */
export interface JinnangVoidedBody {
  kind: "jinnangVoided";
  cardId: string;
  shareSeat?: number;
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
  | CashChangedBody
  | TreasureGainedBody
  | TreasureSoldBody
  | TreasureTradedBody
  | AssetLiquidatedBody
  | HeroRecruitedBody
  | PlayerBankruptBody
  | EncounterTriggeredBody
  | JinnangAnnouncedBody
  | ReactionOpenedBody
  | ReactionAnsweredBody
  | JinnangVoidedBody;

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

/** 时机 → 事件体映射表:登记进词汇表的时机在派发点同步产出事件;引擎侧富化
 *  (查 catalog/持有)在此做。未登记时机(BeforeMarch/BeforeRoll/AfterMarch/
 *  PassedPlayer/MarchPassedCity/LandedOnProperty/BranchEntered/BranchExited 等
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
  CapitalHalt: (_g, ctx) => ({
    kind: "capitalHalt",
    tileIndex: requireMomentField(ctx.tileIndex, "CapitalHalt.tileIndex"),
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
  HeroRecruited: (_g, ctx) => ({
    kind: "heroRecruited",
    heroId: requireMomentField(ctx.heroId, "HeroRecruited.heroId"),
  }),
  PlayerBankrupt: () => ({ kind: "playerBankrupt" }),
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

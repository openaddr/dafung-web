// 核心类型定义:纯数据模型,无 DOM 依赖,可单元测试。
import type { GameMoment } from "./timing";

/** 世界坐标(棋盘逻辑单位,View 层映射为像素)。 */
export interface BoardPos {
  x: number;
  y: number;
}

/** 格子类型。v2.0 棋盘 Property/TreasureCity/Wolong/Tax/Stock/Chance/Fate 均有落格处理。 */
export type TileType =
  | "Property"
  | "Tax"
  | "Chance"
  | "Fate"
  | "Stock"
  | "Wolong"
  | "TreasureCity"; // 宝物城:不可购买;落格触发珍宝判定

/** 单个格子定义。IsCapitalEligible=可作都城;Region=区域分组(美术配色)。 */
export interface TileDef {
  index: number;
  type: TileType;
  name: string;
  position: BoardPos;
  propertyId: string | null;
  isCapitalEligible: boolean;
  region: string | null;
  waypoints?: BoardPos[]; // 可选:主路该 tile 入边手配途经点(预留,默认自动避城)
  size?: "large" | "medium" | "small";
}

/** 地产定义。BuildCost=选都建城费;ResupplyPerLevel=都城补给系数。
 *  本作无过路费/升级费:自己到达己城可选免费扩军;他人落城不升级,
 *  仅当城主对该访客的珍宝交涉选择公道买卖且成交时 +1 级(满级封顶)。 */
export interface PropertyDef {
  id: string;
  group: string; // 'a'..'h'
  purchasePrice: number;
  maxLevel: number; // 最高等级(默认 3;持有等级 0..maxLevel,共 4 级)
  valueByLevel: number[]; // 各等级城池价值(变卖价),长度 = maxLevel+1,下标 = 等级
  buildCost: number;
  resupplyPerLevel: number; // 普通城为 0
  /** 坐地起价加价值(per-level,分银;下标=城池等级 0..maxLevel):premiumPriceOf = 指导价×tradeMult[cityLevel] + tradeAdd[cityLevel]。 */
  tradeAdd?: number[];
  /** 坐地起价乘数(per-level;下标=城池等级 0..maxLevel):premiumPriceOf = 指导价×tradeMult[cityLevel] + tradeAdd[cityLevel]。 */
  tradeMult?: number[];
  /** 旧贸易公式(向后兼容):premiumPriceOf 无 tradeAdd/tradeMult 时回退到此 × CITY_LEVEL_MULTIPLIER。 */
  trade?: TradeFormula;
}

/** 辅路格种类:treasure=拼点探宝,event=锦囊随机事件,penalty=中伏跳一回合。 */
export type BranchCellKind = "treasure" | "event" | "penalty";

/** 路线抉择:大路(主环)/ 辅路(辅路逐格行进)。 */
export type RouteKind = "Main" | "Branch";

/** 玩家持有的地产。Level 0..maxLevel(购入/建都即为 Lv.0);升级免费(到达触发)。 */
export interface PropertyHolding {
  propertyId: string;
  group: string;
  purchasePrice: number;
  level: number;
  maxLevel: number;
}

export const canUpgrade = (h: PropertyHolding): boolean => h.level < h.maxLevel;

/** 玩家。CapitalIndex=-1 表示尚未选都。 */
export interface Player {
  id: string;
  name: string;
  guohao: string; // 国号(单汉字,装饰)
  colorIndex: number;
  isBot: boolean;
  cash: number;
  warrants: number; // 委任状:进驻(买)新城的额度;经过自己都城补充。
  isBankrupt: boolean;
  position: number;
  capitalIndex: number;
  onBranch: { step: number } | null; // 在分岔辅路第几格(null=在主路;step=-1=入口待入辅路,棋子仍在主路入口格)
  skipTurns: number; // 待跳过的回合计数(辅路 penalty 格触发)
  properties: PropertyHolding[];
  heroes: HeroDef[]; // 已招揽的名将(上限 HERO_CAPACITY)
  treasures: TreasureDef[]; // 持有的珍宝
  heroLastFired: Record<string, number>; // 技能冷却:skill.id → 上次触发的 round(供 cooldown 判定)
  reputation: number; // 声望 -100~+100:机遇档位调制的唯一输入(见 CONTEXT.md;#121)
  stamina: number; // 体力 0~100:机遇/技能增减,归 0 触发耗竭惩罚(见 CONTEXT.md;#130)
  jinnangHand: string[]; // 锦囊手牌(#122):暗置牌 id,内容仅本人可见(联机经投影,ADR-0016)
  /** 免战金牌在身(#122):他人的锦囊无法指定你为目标,至你的下回合开始失效。
   *  (设计变更:原「免租金」——本作引擎不收租,按「免战=不可被指定」等义落地,
   *  docs/explanation/锦囊设计.md §4 已同步。) */
  jinnangShield: boolean;
  /** 已领取的声望献计里程碑(#147):值 ∈ {30,60,90};只认向上穿越且仅首次。 */
  repMilestones: number[];
  /** 锦囊手牌数(公开信息,引擎状态):与 jinnangHand.length 同步维护于唯一改动点
   *  (抽牌/打牌)。为什么独立成字段:联机客户端经「restore→重新 snapshot」hydrate,
   *  投影层注入的视图字段会在重生成时丢失——数量是全员可见的游戏状态,必须由引擎持有。 */
  jinnangHandCount: number;
}

/** 移动路径。
 *  Traversed=主路真实 tile 索引(辅路逐格时不填,改用 branchWaypoints);
 *  Waypoints=主路动画途经位置(避城弧线);
 *  LandBranchStep!=null 表示落辅路该 step 格(landIndex 为主路起点占位);
 *  BranchWaypoints=辅路逐格行进的坐标序列(主路时为空)。 */
export interface MovePath {
  from: number;
  traversed: number[];
  landIndex: number;
  passedCapital: boolean;
  capitalIndex: number;
  waypoints: BoardPos[];
  landBranchStep: number | null; // null=落主路 landIndex;number=落辅路第 step 格
  branchWaypoints: BoardPos[]; // 辅路行军坐标序列(主路时为 [])
}

export interface DiceRoll {
  die: number; // 1–6(单骰;移动步数 = die)
}

/** 落格结果。 */
export type LandOutcomeKind =
  | "Noop"
  | "PropertyAvailable"
  | "OwnProperty"
  | "TreasureTrade"
  | "TaxPaid";

export interface LandOutcome {
  kind: LandOutcomeKind;
  property?: PropertyDef;
  owner?: Player;
  amount?: number; // 珍宝成交价/税额
  resupply?: number; // 都城补给
  causedBankruptcy?: boolean;
}

// ── 决策载荷与表现态分离(spec #107 C2)──
/** 待决策落格的决策种类:无主城可购 / 己城可扩军。 */
export type PendingLandKind = "PropertyAvailable" | "OwnProperty";

/** 待决策落格载荷:决策上下文(购地/扩军命令与选项集计算的唯一依据),与表现态
 *  LandOutcome 分离。只含最小可序列化上下文——propertyId 是唯一句柄,价格/等级口径
 *  由 catalog 按 id 现查,恢复/联机不丢引用(旧 lastLandOutcome 兼任决策载荷时,曾因
 *  property 引用的序列化缺口在恢复后丢失决策上下文)。 */
export interface PendingLand {
  kind: PendingLandKind;
  propertyId: string;
}

/** LandOutcome 的快照行(纯表现态;propertyId 句柄,定义由 catalog 按需现查)。 */
export interface LandOutcomeSnapshot {
  kind: LandOutcomeKind;
  propertyId: string | null;
  amount: number | null;
  resupply: number | null;
  causedBankruptcy: boolean | null;
}

/** 军情密探窥探(#122/T4):viewer 可见 target 的锦囊手牌内容,至 viewer 下回合开始
 *  (endTurn 轮到 viewer 时清除)。窥探事件本身公开,清单随快照。 */
export interface JinnangPeek {
  viewer: number;
  target: number;
}

/** 锦囊目标段载荷(#122/T3):选牌后进入选人子状态(同相位内重算选项集);
 *  stage:one=单选立即执行;two-a/two-b=连环计两步(第二步排除第一步)。
 *  picked 为已定座位;随快照走(目标段中途断线可恢复)。 */
export interface PendingJinnang {
  cardId: string;
  stage: "one" | "two-a" | "two-b";
  picked: number[];
}

/** 回合阶段。AwaitingEncounter(#124)= 抽中抉择机遇,等待玩家选选项(resolveEncounterChoice)。 */
export type TurnPhase =
  | "Roll"
  | "AwaitingBranch"
  | "AwaitingDecision"
  | "AwaitingHeroPick"
  | "AwaitingEncounter"
  | "AwaitingJinnang" // 锦囊卷轴(#122/T2):回合开始掷骰前,主动用牌或今不用
  | "AwaitingExhaustion"
  | "AwaitingTreasureOwner"
  | "AwaitingBankruptcySettle"
  | "Land"
  | "EndTurn"
  | "GameOver";

export type AiDifficulty = "Simple" | "Normal";

export type VictoryReason =
  | "None"
  | "TargetNetWorth"
  | "LastStanding";

export interface VictoryResult {
  winner: Player | null;
  reason: VictoryReason;
}

/** 交易结果(判别联合):Ok/AlreadyMaxLevel 恒带 newLevel(等级口径唯一出处),
 *  其余失败态不带——ADR-0015 城池宣告读 newLevel 时由 status 窄化保证,无需兜底。 */
export type TransactionResult =
  | { status: "Ok"; newLevel: number }
  | { status: "InsufficientFunds" }
  | { status: "NotOwned" }
  | { status: "AlreadyMaxLevel"; newLevel: number }
  | { status: "NoWarrant" };

/** 对局日志事件(ADR-0014,原「战报」):每行 = 中文自然语言 brief + 机读 detail(英文键值),
 *  外加基本信息字段(ts/round/turn/player/category)。双层用途:人类可读层复盘 + 命令流重放。
 *
 *  category 分类表(显式化,新增类别须同步 docs/reference/对局日志.md):
 *  - 局头:header(构造时首行,重放要素:gameId/mapId/seed/座位表/现金/目标)
 *  - 玩法事件:roll 掷骰 | buy 购地 | upgrade 扩军/成交升级 | trade 珍宝交涉+escrow 交割退回 |
 *    supply 补给/委任状 | tax 税关 | branch 辅路抉择/中伏跳过 | halt 驻跸必停 |
 *    setup 开局流程(定序/三候选/选都/招贤)| skill 时机技能击发 | system 其余玩法杂项
 *    (随机事件/商市/破产清算过程/警告)| victory 胜负 | final 终局行(机读终态面板,重放断言锚点)
 *  - 命令类:cmd(submitCommand 提交的玩家命令,detail=命令 JSON;bot 直调引擎方法不产生,
 *    确定性重放自动重算——见 docs/reference/对局日志.md「命令流」)
 *  - 房间类:room(房间生命周期:开局/托管/接管/离线/重连/解散;联机由 room.ts 写、
 *    单机托管由 LocalController 写,detail=机读 JSON,重放据此调整 bot 驱动座位集) */
export interface LogEvent {
  ts: number; // 时间(epoch ms,引擎侧 Date.now())
  round: number; // 轮(engine.round,所有人各行动一次 = 1 轮)
  turn: number; // 回合(engine.turnNumber)
  player: string | null; // 玩家国号(无主行为为 null)
  brief: string; // 人类可读简报(中文)
  detail: string; // 机读审计行(英文键值;cmd/room/header/final 为 JSON)
  category:
    | "header"
    | "system"
    | "roll"
    | "buy"
    | "upgrade"
    | "trade"
    | "supply"
    | "tax"
    | "branch"
    | "halt"
    | "setup"
    | "skill"
    | "victory"
    | "final"
    | "cmd"
    | "room";
  amount?: number; // 涉及金额(+收入 / -支出)
}

// ── 地图 JSON schema(自定义地图 / 编辑器 / 导入导出)──
export interface MapData {
  version: number;
  targetNetWorth: number;
  startingCash: number;
  maxLevel: number;
  resupplyPerLevel: number;
  tiles: MapTile[];
  branch?: MapBranch | null; // 分岔辅路(可空;旧版 shortcuts 字段已废弃)
}
/** 旧贸易公式(向后兼容;新字段 tradeAdd/tradeMult):multiply=翻倍(指导价×param×等级倍率);markup=加价(指导价+param×等级倍率)。
 *  新字段 tradeAdd/tradeMult(per-level)优先;此字段仅作回退。 */
export interface TradeFormula {
  type: "multiply" | "markup";
  param: number;
}

export interface MapTile {
  id: string;
  name: string;
  pos: number[]; // [x, y]
  type?: TileType; // 默认 Property;Chance/Fate 等非地产格用
  group?: string;
  region?: string;
  price?: number;
  buildCost?: number;
  /** 各等级城池价值(变卖价),长度 = maxLevel+1,下标 = 等级。 */
  valueByLevel?: number[];
  /** 坐地起价加价值(per-level,分银):与 PropertyDef 同义。 */
  tradeAdd?: number[];
  /** 坐地起价乘数(per-level):与 PropertyDef 同义。 */
  tradeMult?: number[];
  /** 都城补给/级(分):内置地图逐城显式声明;缺省回退地图顶层 resupplyPerLevel(自定义地图用)。 */
  resupplyPerLevel?: number;
  trade?: TradeFormula;
}

/** 分岔辅路格(JSON 形式):kind + 手配坐标。 */
export interface MapBranchCell {
  kind: BranchCellKind;
  pos: number[]; // [x, y] 辅路格坐标(地图作者手配)
}
/** 分岔辅路(JSON 形式):start/end 为主路 tile id;cells 为辅路格子(逐格掷骰沿此推进)。 */
export interface MapBranch {
  id: string;
  start: string; // tile id(主路起点)
  end: string; // tile id(主路终点)
  cells: MapBranchCell[];
}

/** 玩家可提交的游戏命令(联机时 = 网络协议的消息类型)。 */
export type GameCommand =
  | { type: "rollAndMove" }
  | { type: "selectBranch"; kind: RouteKind }
  | { type: "buyProperty" }
  | { type: "upgradeProperty" }
  | { type: "endDecision" }
  | { type: "resolveHeroPick"; index: number }
  | { type: "resolveEncounterChoice"; index: number } // 抉择机遇选项(#124;index=def.choices 下标)
  | { type: "resolveExhaustionChoice"; index: number }
  | { type: "resolveTreasureOwner"; action: { type: "fair"; treasureId: string } | { type: "premium"; treasureId: string } | { type: "skip" } }
  | { type: "sellTreasureBankruptcy"; treasureId: string }
  | { type: "sellPropertyBankruptcy"; propId: string }
  | { type: "cashHeroBankruptcy"; heroId: string }
  | { type: "confirmBankruptcySettle" }
  | { type: "useJinnang"; cardId: string | null; targets?: number[]; cancel?: boolean }; // 锦囊(#122):null=今不用;targets=目标座位(T3/T4 目标段);cancel=作罢(保留牌)

// ── 珍宝系统 ──
export interface TreasureDef {
  id: string;          // 唯一(牌堆展开后含序号)
  name: string;
  level: number;      // 1-10
  count?: number;     // 牌堆中数量(仅 TREASURES 表用)
  desc?: string;      // 风味描述
  effect?: string;    // 预留:被动效果(暂不实现)
}

// ── 名将(英雄)系统:技能即数据(时机框架)。技能 = 「什么时机(when)触发什么效果(effect,查
// src/core/effects.ts 注册表)+ 纯数据参数(params)」;派发器统一在 game.ts dispatchMoment。
// 扩展指南见 docs/explanation/时机框架.md:加效果一步、加技能两步、加时机三步。
export interface TriggerSkill {
  id: string; // 唯一 id(如 "zhouyu-move+1";同时是 heroLastFired 冷却键)
  when: GameMoment; // 触发时机(查 src/core/timing.ts)
  effect: string; // EffectId,查 src/core/effects.ts 注册表;未知 id 派发时直接抛错(数据 bug)
  params?: Record<string, number>; // 效果参数(纯数据,可序列化)
  cooldown?: number; // 冷却(单位:轮,复用 heroLastFired 机制,键=skill.id)
  /** 技能属主(owner)与时机主体(subject)/当前行动者的关系;缺省 = "self":
   *  - "self":属主是时机主体(我的骰/我的失财/我的回合…)
   *  - "others":时机主体不是属主(别人失财/别人掷骰…)
   *  - "any":主体不限(任何人,含属主自己)
   *  - "actor":时机主体恰为当前行动玩家(activeIndex,属主不限)——当前所有派发点主体即行动者,
   *    与 "any" 等价;未来出现「非行动玩家」主体的时机(如回合外失财)时二者分化。 */
  scope?: "self" | "actor" | "others" | "any";
}

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  title: string; // 火烧赤壁(称号,风味)
  desc: string; // 给玩家看的技能说明
  skills?: TriggerSkill[]; // 一武多技(时机驱动,按数组序派发)
  image: string; // 画像路径(public 下,如 /assets/heroes/hero-zhouyu-sgs.png;3:4 竖版)
}

// 核心类型定义:纯数据模型,无 DOM 依赖,可单元测试。

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
 *  本作无过路费/升级费:升级由「到达城池」免费触发(自己到达可选扩军,他人到达自动升级)。 */
export interface PropertyDef {
  id: string;
  group: string; // 'a'..'h'
  purchasePrice: number;
  maxLevel: number; // 等级数(默认 3;持有等级 1..maxLevel)
  valueByLevel: number[]; // 各等级城池价值(变卖价),长度 = maxLevel,下标 level-1
  buildCost: number;
  resupplyPerLevel: number; // 普通城为 0
  /** 坐地起价加价值(per-level,分银;下标=城池等级 1..maxLevel):premiumPriceOf = 指导价×tradeMult[cityLevel] + tradeAdd[cityLevel]。 */
  tradeAdd?: number[];
  /** 坐地起价乘数(per-level;下标=城池等级 1..maxLevel):premiumPriceOf = 指导价×tradeMult[cityLevel] + tradeAdd[cityLevel]。 */
  tradeMult?: number[];
  /** 旧贸易公式(向后兼容):premiumPriceOf 无 tradeAdd/tradeMult 时回退到此 × CITY_LEVEL_MULTIPLIER。 */
  trade?: TradeFormula;
}

/** 辅路格种类:treasure=拼点探宝,event=锦囊随机事件,penalty=中伏跳一回合。 */
export type BranchCellKind = "treasure" | "event" | "penalty";

/** 路线抉择:大路(主环)/ 辅路(辅路逐格行进)。 */
export type RouteKind = "Main" | "Branch";

/** 玩家持有的地产。Level 1..maxLevel(购入/建都即为 Lv.1);升级免费(到达触发)。 */
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
  onBranch: { step: number } | null; // 在分岔辅路第几格(null=在主路)
  skipTurns: number; // 待跳过的回合计数(辅路 penalty 格触发)
  properties: PropertyHolding[];
  heroes: HeroDef[]; // 已招揽的名士(上限 HERO_CAPACITY)
  treasures: TreasureDef[]; // 持有的珍宝
  heroLastFired: Record<string, number>; // 名士技能冷却:heroId → 上次触发的 round(供 cooldown 判定)
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

/** 回合阶段。 */
export type TurnPhase =
  | "Roll"
  | "AwaitingCapitalHalt"
  | "AwaitingBranch"
  | "AwaitingDecision"
  | "AwaitingHeroPick"
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

export interface TransactionResult {
  status: "Ok" | "InsufficientFunds" | "NotOwned" | "AlreadyMaxLevel" | "NoWarrant";
  newLevel?: number;
}

/** 战报事件(简报行 + 详情审计行共享同一事件源)。 */
export interface LogEvent {
  turn: number;
  player: string | null;
  brief: string; // 人类可读简报
  detail: string; // 全流程审计行
  category:
    | "system"
    | "roll"
    | "move"
    | "buy"
    | "upgrade"
    | "trade"
    | "supply"
    | "tax"
    | "branch"
    | "halt"
    | "setup"
    | "victory";
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
  /** 各等级城池价值(变卖价),长度 = maxLevel,下标 level-1。 */
  valueByLevel?: number[];
  /** 坐地起价加价值(per-level,分银):与 PropertyDef 同义。 */
  tradeAdd?: number[];
  /** 坐地起价乘数(per-level):与 PropertyDef 同义。 */
  tradeMult?: number[];
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
  | { type: "haltAtCapital" }
  | { type: "continueMove" }
  | { type: "selectBranch"; kind: RouteKind }
  | { type: "buyProperty" }
  | { type: "upgradeProperty" }
  | { type: "endDecision" }
  | { type: "resolveHeroPick"; index: number }
  | { type: "resolveTreasureOwner"; action: { type: "fair"; treasureId: string } | { type: "premium"; treasureId: string } | { type: "skip" } }
  | { type: "sellTreasureBankruptcy"; treasureId: string }
  | { type: "sellPropertyBankruptcy"; propId: string }
  | { type: "cashHeroBankruptcy"; heroId: string }
  | { type: "confirmBankruptcySettle" };

// ── 珍宝系统 ──
export interface TreasureDef {
  id: string;          // 唯一(牌堆展开后含序号)
  name: string;
  level: number;      // 1-10
  count?: number;     // 牌堆中数量(仅 TREASURES 表用)
  desc?: string;      // 风味描述
  effect?: string;    // 预留:被动效果(暂不实现)
}

// ── 名士(英雄)系统:数据驱动的被动/触发技能。新增技能 = 给 HeroSkill 加一种 kind +
// 在 game.ts 的对应时机(heroMoveBonus 查询 / fireHeroTriggers 派发)加一个分支。
export type HeroSkill =
  // 被动:移动步数 +N(在 rollAndMove 计算步数时计入)
  | { kind: "moveBonus"; steps: number }
  // 触发:场上任意人掷出 face → 持有者 +gain(每次掷骰后派发)
  | { kind: "onAnyRoll"; face: number; gain: number }
  // 触发:任意其他玩家被动失去银两 → 持有者 +gain(在租金/税/天命/小路损失后派发)
  | { kind: "onOtherLoseCash"; gain: number };
// 将来扩展(在此加 kind,再到 game.ts 对应时机接一处):
//   onTurnStart(回合开始) | onLand(自己落格) | rentImmune(免租) | reroll(重掷)
//   capitalSupplyBonus(过都城补给倍率) | buyDiscount(买城折扣)…

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  title: string; // 火烧赤壁(称号,风味)
  desc: string; // 给玩家看的技能说明
  skill: HeroSkill;
  cooldown?: number; // 可选:冷却回合数(每 N 轮可触发一次);undefined = 永久被动/每次都触发
}

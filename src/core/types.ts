// 核心类型定义:与 Godot/C# 版 dafung.Core 等价,纯数据模型,无 DOM 依赖,可单元测试。

/** 世界坐标(棋盘逻辑单位,View 层映射为像素)。 */
export interface BoardPos {
  x: number;
  y: number;
}

/** 格子类型。v2.0 棋盘仅放置 Property;其余类型保留枚举,落格 noop。 */
export type TileType =
  | "Property"
  | "Tax"
  | "Chance"
  | "Fate"
  | "Shop"
  | "Stock"
  | "Airport"
  | "Jail";

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

/** 地产定义。BuildCost=选都建城费;ResupplyPerLevel=都城补给系数。 */
export interface PropertyDef {
  id: string;
  group: string; // 'a'..'h'
  purchasePrice: number;
  upgradeCost: number;
  maxLevel: number; // 默认 5
  rentByLevel: number[]; // 长度 maxLevel+1
  buildCost: number;
  resupplyPerLevel: number; // 普通城为 0
}

export const rentFor = (def: PropertyDef, level: number): number =>
  def.rentByLevel[level];

/** 支路(捷径)后果。 */
export type ShortcutConsequence =
  | { kind: "FixedCost"; amount: number }
  | { kind: "CoinFlip"; win: BranchEffect; lose: BranchEffect };

export interface BranchEffect {
  cashDelta: number; // 正=收入,负=支出
}

/** 分歧点的捷径(小路)。SideWaypoints 为 1–2 个独立坐标途经点。 */
export interface ShortcutDef {
  id: string;
  branchNode: number;
  rejoinNode: number;
  sideWaypoints: BoardPos[];
  consequence: ShortcutConsequence;
}

export type RouteKind = "Main" | "Shortcut";

/** 踩中分歧点后设定的路线选择;离开分歧点后清空。 */
export interface BranchChoice {
  fromNode: number;
  kind: RouteKind;
}

/** 玩家持有的地产。账面价值 = 购入价 + 累计升级费。 */
export interface PropertyHolding {
  propertyId: string;
  group: string;
  purchasePrice: number;
  totalUpgradeCost: number;
  level: number;
  maxLevel: number;
}

export const holdingBookValue = (h: PropertyHolding): number =>
  h.purchasePrice + h.totalUpgradeCost;

export const canUpgrade = (h: PropertyHolding): boolean => h.level < h.maxLevel;

/** 玩家。CapitalIndex=-1 表示尚未选都。 */
export interface Player {
  id: string;
  name: string;
  guohao: string; // 国号(单汉字,装饰)
  colorIndex: number;
  isBot: boolean;
  cash: number;
  isBankrupt: boolean;
  position: number;
  capitalIndex: number;
  pendingBranch: BranchChoice | null;
  properties: PropertyHolding[];
}

/** 移动路径。Traversed=真实 tile 索引(末尾为落点);Waypoints=动画途经位置序列(含支路途经点)。 */
export interface MovePath {
  from: number;
  traversed: number[];
  landIndex: number;
  passedCapital: boolean;
  capitalIndex: number;
  waypoints: BoardPos[];
}

export interface DiceRoll {
  die: number; // 1–6
  sum: number; // 单骰 = die
}

/** 落格结果。 */
export type LandOutcomeKind =
  | "Noop"
  | "PropertyAvailable"
  | "OwnProperty"
  | "RentPaid"
  | "TaxPaid";

export interface LandOutcome {
  kind: LandOutcomeKind;
  property?: PropertyDef;
  owner?: Player;
  amount?: number; // 租金/税额
  resupply?: number; // 都城补给
  causedBankruptcy?: boolean;
}

/** 回合阶段。 */
export type TurnPhase =
  | "Roll"
  | "Move"
  | "AwaitingCapitalHalt"
  | "AwaitingBranch"
  | "AwaitingDecision"
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
  status: "Ok" | "InsufficientFunds" | "NotOwned" | "AlreadyMaxLevel";
  newLevel?: number;
}

export interface RentResult {
  amount: number;
  causedBankruptcy: boolean;
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
    | "rent"
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
  shortcuts: MapShortcut[];
}
export interface MapTile {
  id: string;
  name: string;
  pos: number[]; // [x, y]
  type?: TileType; // 默认 Property;Chance/Fate 等非地产格用
  group?: string;
  region?: string;
  price?: number;
  upgrade?: number;
  buildCost?: number;
  rentByLevel?: number[];
}
export interface MapShortcut {
  id: string;
  from: string; // tile id
  to: string; // tile id
  consequence: ShortcutConsequence;
  waypoints?: number[][]; // 可选:手配支路途经点 [[x,y],...]
}

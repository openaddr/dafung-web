// 决策卷轴弹层(阶段 6b)统一出口:主线在 GameScreen 里从此处 import 接线。
export { ScrollShell, ScrollButton } from "./ScrollShell";
export type { ScrollShellProps } from "./ScrollShell";
export { HeroPickScroll } from "./HeroPickScroll";
export type { HeroPickScrollProps, HeroOfferInfo } from "./HeroPickScroll";
export { TreasureVisitorScroll } from "./TreasureVisitorScroll";
export type { TreasureVisitorScrollProps, TradePropertyInfo } from "./TreasureVisitorScroll";
export { BankruptcyScroll } from "./BankruptcyScroll";
export type { BankruptcyScrollProps } from "./BankruptcyScroll";
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
export { VictoryScreen } from "./VictoryScreen";
export type { VictoryScreenProps } from "./VictoryScreen";
export { TileDetailScroll } from "./TileDetailScroll";
export type { TileDetailScrollProps } from "./TileDetailScroll";
export {
  HaltDecisionScroll,
  BranchDecisionScroll,
  BuyDecisionScroll,
  UpgradeDecisionScroll,
} from "./DecisionScrolls";
export { RentTable } from "./RentTable";
export type { RentTableProperty } from "./RentTable";
export { SCROLL_TESTIDS } from "./testids";

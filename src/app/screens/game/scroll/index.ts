// 决策弹层(阶段 6b)统一出口:主线在 GameScreen 里从此处 import 接线。
// S9 #515:卷轴壳退役,壳 = 全屏宣告横幅(BannerShell),e2e 的 scroll-* testid 语义保留。
export { BannerShell, BannerButton, BannerGhostContext } from "./BannerShell";
export type { BannerShellProps } from "./BannerShell";
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
  BuyDecisionScroll,
  EncounterChoiceScroll,
  ExhaustionChoiceScroll,
  UpgradeDecisionScroll,
} from "./DecisionScrolls";
export { SCROLL_TESTIDS } from "./testids";
export { ValueTable } from "./ValueTable";
export type { ValueTableProperty } from "./ValueTable";

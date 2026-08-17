// 城池详情卷轴:对照旧 showTileDetail(只读展示,唯一交互是关闭)。
// 展示:城名 / 地域 / 持有者(含都城等级)/ 购入价 / 等级收益表。
import { formatMoney } from "@core/money";
import { ScrollShell } from "./ScrollShell";
import { ValueTable } from "./ValueTable";
import { SCROLL_TESTIDS as T } from "./testids";

export interface TileDetailScrollProps {
  /** 格索引(仅展示用,引擎定位由主线完成)。 */
  tileIndex: number;
  tileName: string;
  /** 地域名(如 幽州)。 */
  region: string;
  /** 城池定义(价/等级/价值)。 */
  property: {
    id: string;
    purchasePrice: number;
    maxLevel: number;
    valueByLevel: number[];
  };
  /** 持有者国号;null = 无主。 */
  ownerGuohao: string | null;
  /** 持有者当前城等级(0 起);无主时忽略。 */
  ownerLevel: number;
  /** 是否某家都城(都城展示 Lv 徽记)。 */
  isCapital: boolean;
  onClose: () => void;
}

export function TileDetailScroll({
  tileIndex,
  tileName,
  region,
  property,
  ownerGuohao,
  ownerLevel,
  isCapital,
  onClose,
}: TileDetailScrollProps) {
  const ownerText = ownerGuohao ? `持有:${ownerGuohao}` : "无主";
  const capText = isCapital ? ` · 都城 Lv.${ownerLevel}` : "";
  return (
    <ScrollShell title={`「${tileName}」`} onClose={onClose} testid={T.tileDetailScroll}>
      <span hidden data-tile-index={tileIndex} />
      <p className="m-1 mb-3 text-center text-sm text-ink-dim">
        {region} · {ownerText}
        {capText} · 购入 {formatMoney(property.purchasePrice)}
      </p>
      {/* 等级价值表:抽成共用 ValueTable(购地卷轴复用同一张表,避免两处漂移) */}
      <ValueTable property={property} />
    </ScrollShell>
  );
}

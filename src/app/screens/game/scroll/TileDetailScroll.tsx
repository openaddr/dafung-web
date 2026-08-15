// 城池详情卷轴:对照旧 showTileDetail(只读展示,唯一交互是关闭)。
// 展示:城名 / 地域 / 持有者(含都城等级)/ 购入价 / 等级收益表。
import { formatMoney } from "@core/money";
import { ScrollShell } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface TileDetailScrollProps {
  /** 格索引(仅展示用,引擎定位由主线完成)。 */
  tileIndex: number;
  tileName: string;
  /** 地域名(如 幽州)。 */
  region: string;
  /** 城池定义(价/等级/收益)。 */
  property: {
    id: string;
    purchasePrice: number;
    upgradeCost: number;
    maxLevel: number;
    rentByLevel: number[];
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
      {/* 等级收益表(旧版没列,这里补只读明细;数据 rentByLevel 本就有) */}
      <div className="mx-auto mb-3 max-w-[360px] overflow-hidden rounded border border-gold/40 text-sm">
        <div className="flex bg-panel-hi/60 font-brush text-ink">
          <span className="flex-1 px-2 py-1">等级</span>
          <span className="flex-1 px-2 py-1 text-center">过路费</span>
          <span className="flex-1 px-2 py-1 text-right">升级费</span>
        </div>
        {property.rentByLevel.map((rent, lv) => (
          <div key={lv} className="flex border-t border-gold/25 text-ink-dim">
            <span className="flex-1 px-2 py-1">Lv.{lv}</span>
            <span className="flex-1 px-2 py-1 text-center text-ink">{formatMoney(rent)}</span>
            <span className="flex-1 px-2 py-1 text-right">
              {lv < property.maxLevel ? formatMoney(property.upgradeCost) : "—"}
            </span>
          </div>
        ))}
      </div>
    </ScrollShell>
  );
}

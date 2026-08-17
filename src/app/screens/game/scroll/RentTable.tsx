// 等级收益表(等级/过路费/升级费):从 TileDetailScroll 抽出的共用子组件。
// 为什么抽:购地卷轴(BuyDecisionScroll)要与城池详情展示同一张租金表——
// 玩家做「买不买」的权衡依赖逐级收益明细,两处各写一份必然漂移。
import { formatMoney } from "@core/money";

export interface RentTableProperty {
  upgradeCost: number;
  maxLevel: number;
  rentByLevel: number[];
}

export function RentTable({ property }: { property: RentTableProperty }) {
  return (
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
  );
}

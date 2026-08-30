// 等级价值表(等级/城池价值):从 TileDetailScroll 抽出的共用子组件。
// 为什么抽:购地卷轴(BuyDecisionScroll)要与城池详情展示同一张表——
// 玩家做「买不买」的权衡依赖逐级价值明细,两处各写一份必然漂移。
// 本作无过路费/升级费:升级由到达免费触发(自己到达己城可选扩军;他人落城走珍宝交涉,
// 公道买卖成交才升级),表中只有各等级价值(变卖价,Lv0 起)。
// R3-C5(#92):可选 highlight 标出与当前决策相关的档位(淡金底 + 左金边 + 行尾角标),
// 免得玩家自己对表;不传时视觉与旧版完全一致。
import { formatMoney } from "@core/money";

export interface ValueTableProperty {
  maxLevel: number;
  valueByLevel: number[];
}

export function ValueTable({
  property,
  highlight,
}: {
  property: ValueTableProperty;
  /** #92:命中的档位下标与角标文案;下标越界(如满级时的「下一档」)则自然无命中行。 */
  highlight?: { level: number; label: string };
}) {
  return (
    <div className="mx-auto mb-3 max-w-[360px] overflow-hidden rounded border border-gold/40 text-sm">
      <div className="flex bg-panel-hi/60 font-brush text-ink">
        <span className="flex-1 px-2 py-1">等级</span>
        <span className="flex-1 px-2 py-1 text-right">城池价值</span>
      </div>
      {property.valueByLevel.map((value, i) => {
        const hit = highlight !== undefined && i === highlight.level;
        return (
          <div
            key={i}
            className={
              "flex border-t border-gold/25 text-ink-dim" +
              (hit ? " bg-[rgba(200,161,58,0.12)] border-l-2 border-l-gold text-ink" : "")
            }
          >
            <span className="flex-1 px-2 py-1">Lv.{i}</span>
            <span className="flex-1 px-2 py-1 text-right text-ink">{formatMoney(value)}</span>
            {hit && (
              <span className="self-center pr-2 whitespace-nowrap font-deco text-[10px] text-gold">
                {highlight.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

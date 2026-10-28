// 城池等级表(等级/交易加成/变卖价 或 都城补给):从 TileDetailScroll 抽出的共用子组件。
// 为什么抽:购地卷轴(BuyDecisionScroll)与扩军卷轴(UpgradeDecisionScroll)要和城池详情
// 展示同一张表,三处各写一份必然漂移。
// 本作无过路费/升级费:升级由到达免费触发(自己到达己城可选扩军;他人落城走珍宝交涉,
// 公道买卖成交才升级)。城随等级涨的是两样——交易加成(坐地要价公式的城侧可变部分,
// #671 起为表的主列)与变卖价(破产自救卖给银行的变现价)。都城不可变卖:变卖价对都城
// 是死信息,第二列按城型由调用方给口径——普通城 "sell",都城与选都候选 "supply"(补给,
// 固定值不随档位,四行同值)。
// R3-C5(#92):可选 highlight 标出与当前决策相关的档位(淡金底 + 左金边 + 行尾角标),
// 免得玩家自己对表;不传时视觉与旧版完全一致。
import { formatMoney } from "@core/money";

export interface ValueTableProperty {
  maxLevel: number;
  valueByLevel: number[];
  tradeMult: number[];
  tradeAdd: number[];
  resupply: number;
}

export function ValueTable({
  property,
  second,
  highlight,
}: {
  property: ValueTableProperty;
  /** 第二列口径(#671):普通城 "sell"=变卖价;都城与选都候选 "supply"=都城补给。 */
  second: "sell" | "supply";
  /** #92:命中的档位下标与角标文案;下标越界(如满级时的「下一档」)则自然无命中行。 */
  highlight?: { level: number; label: string };
}) {
  return (
    <div className="mx-auto mb-3 max-w-[400px] overflow-hidden rounded-[3px] border border-gold/25 text-sm">
      <div className="flex bg-panel-hi/60 font-brush text-ink">
        <span className="flex-1 px-2 py-1">等级</span>
        <span className="flex-1 px-2 py-1 text-right">交易加成</span>
        <span className="flex-1 px-2 py-1 text-right">
          {second === "supply" ? "都城补给" : "变卖价"}
        </span>
      </div>
      {property.valueByLevel.map((value, i) => {
        const hit = highlight !== undefined && i === highlight.level;
        return (
          <div
            key={i}
            className={
              "flex border-t border-gold/15 text-ink-dim" +
              (hit ? " bg-[rgba(200,161,58,0.14)] border-l-2 border-l-gold text-ink" : "")
            }
          >
            <span className="flex-1 px-2 py-1">Lv.{i}</span>
            <span className="flex-1 px-2 py-1 text-right text-ink tabular-nums">
              ×{property.tradeMult[i]} +{formatMoney(property.tradeAdd[i])}
            </span>
            <span className="flex-1 px-2 py-1 text-right text-ink tabular-nums">
              {second === "supply" ? formatMoney(property.resupply) : formatMoney(value)}
            </span>
            {hit && (
              <span className="self-center pr-2 whitespace-nowrap font-deco text-[10px] text-gold-deep">
                {highlight.label}
              </span>
            )}
          </div>
        );
      })}
      {/* 口径小字:主列两参数是坐地要价公式的可变部分(对齐名下城池清单的列底注) */}
      <div className="border-t border-gold/15 px-2 py-1 text-center font-wenkai text-[11.5px] text-ink-dim">
        坐地要价 = 指导价 × 系数 + 加成
      </div>
    </div>
  );
}

// 破产清算卷轴:对照旧 showBankruptcyScroll。
// 卖珍宝(指导价)/卖非都城城(当前等级变卖价 = valueByLevel[level],与引擎入账同一函数)/
// 遣名士(200)→ 每卖一件引擎加现金,pendingDebt 固定不变,快照刷新后「尚欠 = 债务 − 现金」
// 实时缩水;"结算"发 confirmBankruptcySettle。
// #60:展示价曾误用购入价(40%),与实际入账(valueByLevel)口径分裂 → 展示与入账必须同一函数。
// #94:「结算」分两态——仍欠(owe>0)时点结算=引擎 settleDebt+finalizeBankruptcy 破产出局,
// 降为警示次级并明说后果;凑足(owe===0)升为主行动金钮,加一次性脉冲反馈达成。
import { useEffect, useState } from "react";
import type { GameCommand } from "@core/types";
import { guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import { Motion } from "@core/theme";
import type { SnapshotTreasure } from "@app/store/gameStore";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface BankruptcyScrollProps {
  /** 待清算玩家国号。 */
  guohao: string;
  /** 当前现金(算尚欠缺口;每笔变卖入账已含,随快照实时刷新)。 */
  cash: number;
  /** 债务总额(pendingDebt.amount,清算期固定)。 */
  debtAmount: number;
  /** 可变卖珍宝(快照展示子集;卖价由 level 经 guidePriceOf 推导,与引擎同函数)。 */
  treasures: SnapshotTreasure[];
  /** 可卖城(变卖价 sellPrice 由调用方经 economy.sellValueOf 计算,与引擎入账同源)。
   *  都城已由调用方剔除(旧版同样跳过 capitalIndex)。 */
  sellableProperties: {
    propId: string;
    name: string;
    /** 变卖入账(= valueByLevel[level],引擎 sellPropertyBankruptcy 同一函数算出)。 */
    sellPrice: number;
    /** 购入价(仅用于折价小字对照,不再作为展示价)。 */
    purchasePrice: number;
    level: number;
  }[];
  /** 可遣散名士(每名 200)。 */
  heroes: { id: string; name: string }[];
  onCommand: (cmd: GameCommand) => void;
}

export function BankruptcyScroll({
  guohao,
  cash,
  debtAmount,
  treasures,
  sellableProperties,
  heroes,
  onCommand,
}: BankruptcyScrollProps) {
  const owe = Math.max(0, debtAmount - cash);
  const settled = owe === 0;
  /* ── #94 凑足达成的一拍脉冲 ──
     为什么不用 animation 类:项目惯例 keyframes 都住在领域 css(board/fx/scroll/victory),
     没有通用脉冲帧可引用,也不为此改 scroll.css → 用 transition transform 一拍替代:
     达成瞬间 scale-110,--dur-med(250ms)后回落,一次性不循环。
     why 一次性成立:清算期现金只增不减(凑足后引擎 assertStillOwing 硬拒绝再卖),
     settled 单调翻真一次,pulse 自然只播一遍。 */
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!settled) return;
    setPulsing(true);
    const t = window.setTimeout(() => setPulsing(false), Motion.dur.med); // 同 --dur-med(Motion 单源,#117 评审收口)
    return () => window.clearTimeout(t);
  }, [settled]);

  /* ── W4a:资产分组滚动 ──
     为什么要分:破产时资产可能 20+ 件,旧平铺 flex-wrap 会把卷轴撑得比视口还高,
     「结算」按钮被顶出屏幕外,玩家根本点不到;分「珍宝/城池/名士」三组、各组
     max-h-56 内滚,并把「结算」钉在卷轴底部(不随内容滚),任何资产量下都可达。 */
  const hasAny = treasures.length > 0 || sellableProperties.length > 0 || heroes.length > 0;
  return (
    <ScrollShell title={`${guohao}·变卖自救`} testid={T.bankruptcyScroll}>
      <p data-testid={T.bankruptcyDebt} className="m-1 mb-3 text-center text-sm text-ink-dim">
        {settled
          ? "现金已凑足债务!点「结算」清偿,转危为安。"
          : `现金不足,尚欠 ${formatMoney(owe)}。变卖资产凑够即免破产(珍宝按指导价、城按当前等级变卖价、名士 200 分)。`}
      </p>
      {/* #94 清偿进度条:进度 = 已凑/债务(payOrLiquidate 仅在 cash<amount 时进清算,
          pendingDebt.amount 恒 >0,直接除不设防);宽度走动效 token --dur-med/--ease-out,
          每卖一笔随快照实时涨,凑足时正好满格呼应金钮。 */}
      <div className="mx-1 mb-3 h-1.5 overflow-hidden rounded-full border border-gold/30 bg-paper-lo">
        <div
          className="h-full rounded-full bg-money"
          style={{
            width: `${((debtAmount - owe) / debtAmount) * 100}%`,
            transition: "width var(--dur-med) var(--ease-out)",
          }}
        />
      </div>
      <div className="flex max-h-[432px] flex-col gap-2 overflow-hidden">
        <section className="flex min-h-0 flex-col">
          <h4 className="mb-1 font-brush text-sm text-ink-dim">珍宝</h4>
          <div className="flex max-h-56 flex-wrap content-start justify-center gap-2 overflow-y-auto">
            {treasures.map((t) => (
              <ScrollButton
                key={t.id}
                testid={T.bankruptcySellTreasure(t.id)}
                onClick={() => onCommand({ type: "sellTreasureBankruptcy", treasureId: t.id })}
              >
                卖·{t.name} +{formatMoney(guidePriceOf(t.level))}
              </ScrollButton>
            ))}
            {treasures.length === 0 && <span className="text-xs text-ink-dim">无</span>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <h4 className="mb-1 font-brush text-sm text-ink-dim">城池</h4>
          <div className="flex max-h-56 flex-wrap content-start justify-center gap-2 overflow-y-auto">
            {sellableProperties.map((p) => (
              <ScrollButton
                key={p.propId}
                testid={T.bankruptcySellProp(p.propId)}
                onClick={() => onCommand({ type: "sellPropertyBankruptcy", propId: p.propId })}
              >
                <span className="inline-flex flex-col items-center gap-0.5">
                  <span>
                    卖城·{p.name} +{formatMoney(p.sellPrice)}
                  </span>
                  {/* #60:标价与购入价有落差时不静默——小字说明折价原因(Lv 越低折越多,
                      经济 v2:valueByLevel = 购价×[40/60/85/120]% 按等级),玩家可理解。 */}
                  {p.sellPrice < p.purchasePrice && (
                    <span className="font-deco text-[10px] leading-none text-ink-dim">
                      购入{formatMoney(p.purchasePrice)}·Lv.{p.level} 变卖折价
                    </span>
                  )}
                </span>
              </ScrollButton>
            ))}
            {sellableProperties.length === 0 && <span className="text-xs text-ink-dim">无</span>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <h4 className="mb-1 font-brush text-sm text-ink-dim">名士</h4>
          <div className="flex max-h-56 flex-wrap content-start justify-center gap-2 overflow-y-auto">
            {heroes.map((h) => (
              <ScrollButton
                key={h.id}
                testid={T.bankruptcySellHero(h.id)}
                onClick={() => onCommand({ type: "cashHeroBankruptcy", heroId: h.id })}
              >
                遣·{h.name} +{formatMoney(200)}
              </ScrollButton>
            ))}
            {heroes.length === 0 && <span className="text-xs text-ink-dim">无</span>}
          </div>
        </section>
      </div>
      {/* 结算钉底:在滚动容器之外,滚动资产列表时它纹丝不动 */}
      <div className="mt-3 flex justify-center border-t border-[rgba(140,110,60,0.35)] pt-3">
        {/* #94 两态:owe>0=警示次级(此时结算=引擎 finalizeBankruptcy 毁局,须红字说破);
            owe===0=主行动金钮,外层 span 承载一拍脉冲(ScrollButton 不吃自定义类,又不能改 ScrollShell)。 */}
        {settled ? (
          <span
            className={
              "inline-block transition-transform duration-[var(--dur-med)] ease-[var(--ease-out)] " +
              (pulsing ? "scale-110" : "scale-100")
            }
          >
            <ScrollButton primary testid={T.bankruptcyConfirm} onClick={() => onCommand({ type: "confirmBankruptcySettle" })}>
              结算 · 凑足!免破产
            </ScrollButton>
          </span>
        ) : (
          <button
            type="button"
            data-testid={T.bankruptcyConfirm}
            title="现金仍低于债务,此时结算即破产出局"
            onClick={() => onCommand({ type: "confirmBankruptcySettle" })}
            className="cursor-pointer rounded border border-danger/70 bg-transparent px-4 py-2 font-brush text-base text-danger transition-colors hover:bg-danger/10"
          >
            {hasAny ? "结算 · 仍欠 " : "结算(无资产可卖)· 仍欠 "}
            {formatMoney(owe)},认破产
          </button>
        )}
      </div>
    </ScrollShell>
  );
}

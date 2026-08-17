// 破产清算卷轴:对照旧 showBankruptcyScroll。
// 卖珍宝(指导价)/卖非都城城(购入价)/遣名士(200)→ 每卖一件引擎更新 pendingDebt,
// 主线接线后 snapshot 刷新会带着新数据重弹本卷轴;"结算"发 confirmBankruptcySettle。
import type { GameCommand } from "@core/types";
import { guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import type { SnapshotTreasure } from "@app/store/gameStore";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface BankruptcyScrollProps {
  /** 待清算玩家国号。 */
  guohao: string;
  /** 当前现金(算尚欠缺口)。 */
  cash: number;
  /** 债务总额(pendingDebt.amount)。 */
  debtAmount: number;
  /** 可变卖珍宝(快照展示子集;卖价由 level 经 guidePriceOf 推导)。 */
  treasures: SnapshotTreasure[];
  /** 可卖城(id → 展示名 + 购入价)。都城已由调用方剔除(旧版同样跳过 capitalIndex)。 */
  sellableProperties: { propId: string; name: string; purchasePrice: number }[];
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
  /* ── W4a:资产分组滚动 ──
     为什么要分:破产时资产可能 20+ 件,旧平铺 flex-wrap 会把卷轴撑得比视口还高,
     「结算」按钮被顶出屏幕外,玩家根本点不到;分「珍宝/城池/名士」三组、各组
     max-h-56 内滚,并把「结算」钉在卷轴底部(不随内容滚),任何资产量下都可达。 */
  const hasAny = treasures.length > 0 || sellableProperties.length > 0 || heroes.length > 0;
  return (
    <ScrollShell title={`${guohao}·变卖自救`} testid={T.bankruptcyScroll}>
      <p data-testid={T.bankruptcyDebt} className="m-1 mb-3 text-center text-sm text-ink-dim">
        现金不足,尚欠 {formatMoney(owe)}。变卖资产凑够即免破产(珍宝按指导价、城按购入价、名士 200 分)。
      </p>
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
                卖城·{p.name} +{formatMoney(p.purchasePrice)}
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
        <ScrollButton primary testid={T.bankruptcyConfirm} onClick={() => onCommand({ type: "confirmBankruptcySettle" })}>
          {hasAny ? "结算" : "结算(无资产可卖,认破产)"}
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

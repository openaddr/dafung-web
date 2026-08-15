// 破产清算卷轴:对照旧 showBankruptcyScroll。
// 卖珍宝(指导价)/卖非都城城(购入价)/遣名士(200)→ 每卖一件引擎更新 pendingDebt,
// 主线接线后 snapshot 刷新会带着新数据重弹本卷轴;"结算"发 confirmBankruptcySettle。
import type { GameCommand, TreasureDef } from "@core/types";
import { guidePriceOf } from "@core/treasures";
import { formatMoney } from "@core/money";
import { ScrollShell, ScrollButton } from "./ScrollShell";
import { SCROLL_TESTIDS as T } from "./testids";

export interface BankruptcyScrollProps {
  /** 待清算玩家国号。 */
  guohao: string;
  /** 当前现金(算尚欠缺口)。 */
  cash: number;
  /** 债务总额(pendingDebt.amount)。 */
  debtAmount: number;
  treasures: TreasureDef[];
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
  return (
    <ScrollShell title={`${guohao}·变卖自救`} testid={T.bankruptcyScroll}>
      <p data-testid={T.bankruptcyDebt} className="m-1 mb-3.5 text-center text-sm text-ink-dim">
        现金不足,尚欠 {formatMoney(owe)}。变卖资产凑够即免破产(珍宝按指导价、城按购入价、名士 200 分)。
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {treasures.map((t) => (
          <ScrollButton
            key={t.id}
            testid={T.bankruptcySellTreasure(t.id)}
            onClick={() => onCommand({ type: "sellTreasureBankruptcy", treasureId: t.id })}
          >
            卖·{t.name} +{formatMoney(guidePriceOf(t.level))}
          </ScrollButton>
        ))}
        {sellableProperties.map((p) => (
          <ScrollButton
            key={p.propId}
            testid={T.bankruptcySellProp(p.propId)}
            onClick={() => onCommand({ type: "sellPropertyBankruptcy", propId: p.propId })}
          >
            卖城·{p.name} +{formatMoney(p.purchasePrice)}
          </ScrollButton>
        ))}
        {heroes.map((h) => (
          <ScrollButton
            key={h.id}
            testid={T.bankruptcySellHero(h.id)}
            onClick={() => onCommand({ type: "cashHeroBankruptcy", heroId: h.id })}
          >
            遣·{h.name} +{formatMoney(200)}
          </ScrollButton>
        ))}
        <ScrollButton primary testid={T.bankruptcyConfirm} onClick={() => onCommand({ type: "confirmBankruptcySettle" })}>
          结算
        </ScrollButton>
      </div>
    </ScrollShell>
  );
}

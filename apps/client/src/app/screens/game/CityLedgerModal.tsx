import { memo } from "react";
import { formatMoney } from "@dafung/core/engine/money";
import { Theme } from "@dafung/core/engine/theme";
import type { OwnedSeatCity } from "@dafung/core/protocol/seat-queries";
import { PileShell } from "./PileModal";
import { TESTIDS } from "./testids";

const GRID_COLS =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_repeat(3,minmax(0,1fr))] items-center";

export const CityLedgerModal = memo(function CityLedgerModal({
  guohao,
  rows,
  self,
  onClose,
}: {
  guohao: string;
  rows: readonly OwnedSeatCity[];
  /** 自看口径(目标=屏前真人):标题转「本方名下城池」。 */
  self: boolean;
  onClose: () => void;
}) {
  const title = self ? "本方名下城池" : `${guohao}名下城池`;
  return (
    <PileShell
      title={title}
      seal="城"
      sub={`${rows.length} 座`}
      testid={TESTIDS.cityLedger}
      onClose={onClose}
    >
      {rows.length > 0 ? (
        <>
          <div
            className={
              GRID_COLS +
              " city-ledger-head sticky top-0 z-[1] gap-2 border-b border-gold/25 bg-panel py-2 font-brush text-paper"
            }
          >
            <span>城名</span>
            <span>等级 / 防御</span>
            <span className="text-right">购入价</span>
            <span className="text-right">变卖价</span>
            <span className="text-right">交易加成</span>
          </div>
          {rows.map(({ owner, tile, property }) => {
            const { multiplier, addition } = owner.trade;
            return (
              <div
                key={property.id}
                data-testid={TESTIDS.cityLedgerRow(property.id)}
                className={
                  GRID_COLS +
                  " city-ledger-row gap-2 border-t border-gold/15 py-1.5 first:border-t-0"
                }
                role="group"
                aria-label={`棋盘第 ${tile.index} 格`}
              >
                {/* 城池档位两字名(ADR-0042 决策 6 + DESIGN §4.8):小字缀在城名格内,
                    不加第六列(844×390 挤);唯一源 Theme.cityTierNames,零兜底直查
                    (tier 逐城必配)。 */}
                <span className="font-wenkai text-paper">
                  {tile.name}
                  <span className="ml-1 text-[11.5px] text-paper-dim">
                    {Theme.cityTierNames[property.tier]}
                  </span>
                </span>
                <span className="tabular-nums">
                  {owner.level} 级
                  <span className="block text-sm text-defense-shield">
                    {owner.defense}/{owner.fullDefense}
                  </span>
                </span>
                <span className="text-right text-paper tabular-nums">
                  {formatMoney(property.purchasePrice)}
                </span>
                <span className="text-right text-paper tabular-nums">
                  {formatMoney(owner.sellValue)}
                </span>
                <span className="text-right text-paper tabular-nums">
                  ×{multiplier} +{formatMoney(addition)}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <div className="flex justify-center py-10">
          <span
            data-testid={TESTIDS.cityLedgerEmpty}
            className="inline-block -rotate-3 rounded-md border-2 border-lacquer-gold/35 px-8 py-5 font-brush text-[26px] tracking-[0.3em] text-paper-dim opacity-75"
          >
            名下暂无城池
          </span>
        </div>
      )}
    </PileShell>
  );
});

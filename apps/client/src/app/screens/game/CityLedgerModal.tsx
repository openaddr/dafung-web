import { memo } from "react";
import { fullDefenseOf } from "@dafung/core/engine/defense";
import { formatMoney } from "@dafung/core/engine/money";
import { cityTradeTermsOf, sellValueOf } from "@dafung/core/engine/economy";
import { tileIndexOfProperty } from "@dafung/core/engine/board";
import { Theme } from "@dafung/core/engine/theme";
import type { WarlordDetails } from "@dafung/core/protocol/seat-queries";
import { getControllerContext } from "@app/controllers/registry";
import { PileShell } from "./PileModal";
import { TESTIDS } from "./testids";

const GRID_COLS =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_repeat(3,minmax(0,1fr))] items-center";

export const CityLedgerModal = memo(function CityLedgerModal({
  player,
  self,
  onClose,
}: {
  player: WarlordDetails;
  /** 自看口径(目标=屏前真人):标题转「本方名下城池」。 */
  self: boolean;
  onClose: () => void;
}) {
  // board/catalog:registry 静态上下文单源(对局期不可变,同 DecisionScrollLayer);
  // GameScreen 只在 controller/map 就位后挂载、本弹层只在其内开,缺上下文 = 接线
  // bug,断言炸出(零兜底)。
  const { board, catalog } = getControllerContext()!;
  // 行序 = 棋盘 index 序:holding 反查格索引升序(MapTile.id 与 propertyId 非同源,
  // 反查走 tiles);catalog 缺城 / 棋盘缺格 = 数据 bug 当场炸——board.at 对越界
  // index 环绕归一,fallback 进去只会静默错行,不设此闸(零兜底)。
  const rows = player.properties
    .map((h) => {
      const tileIndex = tileIndexOfProperty(board, h.propertyId);
      return { h, tileIndex, tile: board.at(tileIndex), def: catalog.get(h.propertyId)! };
    })
    .sort((a, b) => a.tileIndex - b.tileIndex);
  const title = self ? "本方名下城池" : `${player.guohao}名下城池`;
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
          {rows.map(({ h, tile, def, tileIndex }) => {
            const { multiplier, addition } = cityTradeTermsOf(def, h.level);
            return (
              <div
                key={def.id}
                data-testid={TESTIDS.cityLedgerRow(def.id)}
                className={
                  GRID_COLS +
                  " city-ledger-row gap-2 border-t border-gold/15 py-1.5 first:border-t-0"
                }
                role="group"
                aria-label={`棋盘第 ${tileIndex} 格`}
              >
                {/* 城池档位两字名(ADR-0042 决策 6 + DESIGN §4.8):小字缀在城名格内,
                    不加第六列(844×390 挤);唯一源 Theme.cityTierNames,零兜底直查
                    (tier 逐城必配)。 */}
                <span className="font-wenkai text-paper">
                  {tile.name}
                  <span className="ml-1 text-[11.5px] text-paper-dim">
                    {Theme.cityTierNames[def.tier]}
                  </span>
                </span>
                <span className="tabular-nums">
                  {h.level} 级
                  <span className="block text-sm text-defense-shield">
                    {h.defense}/{fullDefenseOf(h.level)}
                  </span>
                </span>
                <span className="text-right text-paper tabular-nums">
                  {formatMoney(def.purchasePrice)}
                </span>
                <span className="text-right text-paper tabular-nums">
                  {formatMoney(sellValueOf(def, h.level))}
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

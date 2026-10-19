// 名下城池清单弹层(#622,规格 #621):席位卡/仪表条城池徽章点开的只读清单——
// 一城一行按棋盘 index 序(行军顺序,合上弹窗扫视方向一致),五列 = 城名 /
// 等级 / 购入价 / 变卖价 / 交易加成;行首位为 T2 真实格缩略图预留位(本票不画
// 格子,#623 接手)。壳复用 PileShell(朱印「城」,题名「○○名下城池」/自看
// 「本方名下城池」;挂载不夺焦、Esc/点外/X 三路关闭全由底件白拿),零操作项;
// 弹层开着随快照实时重渲(数据每渲染现查 snapshot + board/catalog,不冻结不快照)。
// 宝物城与都城同权入列(ADR-0024,无特判外壳)。数据口径(与引擎同一函数):
// 购入价 = 城表 purchasePrice;变卖价 = 当前档 valueByLevel(`sellValueOf`);
// 交易加成 = 当前档 tradeMult/tradeAdd 现值(坐地要价公式的两项参数,公式细则
// 见「要价」词条与 rules 05-珍宝)。名下无城 = 「名下暂无城池」空态(真业务态:
// 未购地/破产清场均可达)。
import { formatMoney } from "@core/money";
import { sellValueOf } from "@core/economy";
import type { GameSnapshot } from "@app/store/gameStore";
import { getControllerContext } from "@app/controllers/registry";
import { PileShell } from "./PileModal";
import { TESTIDS } from "./testids";

/** 行栅格(六列):行首空位 = 行军格缩略图预留位(#623);后五列 = 五字段。
 *  表头与数据行共用同一模板,列对齐不漂移。 */
const GRID_COLS =
  "grid grid-cols-[56px_minmax(7em,1.3fr)_minmax(5em,0.9fr)_minmax(6.5em,1fr)_minmax(6.5em,1fr)_minmax(8em,1.1fr)] items-center";

export function CityLedgerModal({
  snapshot,
  seat,
  self,
  onClose,
}: {
  snapshot: GameSnapshot;
  /** 清单目标座位(开合态由 GameScreen 持座位号,不持玩家对象——随快照常新)。 */
  seat: number;
  /** 自看口径(目标=屏前真人):标题转「本方名下城池」。 */
  self: boolean;
  onClose: () => void;
}) {
  // board/catalog:registry 静态上下文单源(对局期不可变,同 DecisionScrollLayer);
  // GameScreen 只在 controller/map 就位后挂载、本弹层只在其内开,缺上下文 = 接线
  // bug,断言炸出(零兜底)。
  const { board, catalog } = getControllerContext()!;
  const player = snapshot.players[seat];
  // 行序 = 棋盘 index 序:holding 反查格索引升序(MapTile.id 与 propertyId 非同源,
  // 反查走 tiles);catalog 缺城 / 棋盘缺格 = 数据 bug 当场炸——board.at 对越界
  // index 环绕归一,fallback 进去只会静默错行,不设此闸(零兜底)。
  const rows = player.properties
    .map((h) => {
      const tileIndex = board.tiles.findIndex((t) => t.propertyId === h.propertyId);
      if (tileIndex < 0) {
        throw new Error(`名下城池清单:propertyId ${h.propertyId} 不在棋盘上(数据 bug)`);
      }
      return { h, tileIndex, tile: board.at(tileIndex), def: catalog.get(h.propertyId)! };
    })
    .sort((a, b) => a.tileIndex - b.tileIndex);
  const title = self ? "本方名下城池" : `${player.guohao}名下城池`;
  return (
    <PileShell
      title={title}
      seal="城"
      sub="按行军顺序一览 · 只读"
      testid={TESTIDS.cityLedger}
      onClose={onClose}
    >
      {rows.length > 0 ? (
        <>
          <div className="pile-zone">
            <span className="pile-zdot" aria-hidden="true" />
            名下城池 · {rows.length} 城<small>(行序 = 行军顺序)</small>
          </div>
          <div className={GRID_COLS + " border-b border-gold/25 pb-1.5 font-brush text-ink"}>
            {/* 行首列:缩略图位(#623),本票留空 */}
            <span aria-hidden="true" />
            <span>城名</span>
            <span>等级</span>
            <span className="text-right">购入价</span>
            <span className="text-right">变卖价</span>
            <span className="text-right">交易加成</span>
          </div>
          {rows.map(({ h, tile, def, tileIndex }) => {
            return (
              <div
                key={def.id}
                data-testid={TESTIDS.cityLedgerRow(def.id)}
                className={GRID_COLS + " border-t border-gold/15 py-1.5 first:border-t-0"}
                title={`棋盘第 ${tileIndex} 格`}
              >
                {/* 行首列:缩略图位(#623),本票留空 */}
                <span aria-hidden="true" />
                <span className="font-wenkai text-ink">{tile.name}</span>
                <span className="text-ink-dim tabular-nums">
                  Lv.{h.level}/{def.maxLevel}
                </span>
                <span className="text-right text-ink tabular-nums">
                  {formatMoney(def.purchasePrice)}
                </span>
                <span className="text-right text-ink tabular-nums">
                  {formatMoney(sellValueOf(def, h.level))}
                </span>
                <span className="text-right text-ink tabular-nums">
                  ×{def.tradeMult[h.level]} +{formatMoney(def.tradeAdd[h.level])}
                </span>
              </div>
            );
          })}
          {/* 口径小字(#621):交易加成列是坐地要价公式的两项现值参数 */}
          <div className="mt-3 text-right font-wenkai text-[11.5px] text-ink-dim">
            坐地要价 = 指导价 × 系数 + 加成
          </div>
        </>
      ) : (
        <div className="flex justify-center py-10">
          <span
            data-testid={TESTIDS.cityLedgerEmpty}
            className="inline-block -rotate-3 rounded-md border-2 border-lacquer-gold/35 px-8 py-5 font-brush text-[26px] tracking-[0.3em] text-ink-dim opacity-75"
          >
            名下暂无城池
          </span>
        </div>
      )}
    </PileShell>
  );
}

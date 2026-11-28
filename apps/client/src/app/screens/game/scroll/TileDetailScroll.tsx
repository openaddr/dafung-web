// 城池详情卷轴(#33/#34/#35):
//   - 只读查看:城名 / 地域 / 持有者(含都城等级)/ 燃烧 / 伤害排行榜 / 购入价 / 等级表
//     (交易加成 + 变卖价或都城补给,#671)。
//   - S10(#43):保留右上 ×(壳 44px 热区),关闭 = ×/遮罩/Esc;
//     hideClose 只留给必须决策的卷轴(详情卷轴均放弃性,不占用)。
//   - #35:选都模式下详情内嵌「定都于此 / 再想想」,确认才落子(整合旧 pendingCapital 确认框)。
//   - #767 城名下显示真实格缩略图。#1417:选都先读建城费、余额与补给,再翻等级表。
import { memo, useId } from "react";
import { formatMoney } from "@dafung/core/engine/money";
import type { CityDamageEntry } from "@dafung/core/engine/city-damage";
import type { SeatCity } from "@dafung/core/protocol/seat-queries";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { BannerShell, BannerButton } from "./BannerShell";
import { AffordRow } from "./AffordRow";
import { ValueTable } from "./ValueTable";
import { TileThumb } from "../TileThumb";
import { SCROLL_TESTIDS as T } from "./testids";
import { TESTIDS } from "../testids";

interface TileDetailScrollProps {
  city: SeatCity;
  /** 地域行区名(=分组名,Theme.groupNames 单源经 DecisionScrollLayer;空=未知分组省略段)。 */
  groupLabel: string;
  /** 城池档位两字名(Theme.cityTierNames 单源经 DecisionScrollLayer,ADR-0042 决策 6)。 */
  tierLabel: string;
  /** 伤害排行与燃烧来源的座位名称。 */
  players: SnapshotPlayer[];
  /** #1417:明确区分选都动作与只读资料,费用不可用购入价猜测。 */
  context:
    | {
        kind: "capital";
        cash: number;
        cost: number;
        canConfirm: boolean;
        reason: string | null;
        onConfirm: () => void;
      }
    | { kind: "view" };
  onClose: () => void;
}

/** 值等(#1140 渲染税):棋盘查询与 players 共用稳定引用;
 *  onClose 与 context.onConfirm 不入比较——setState/控制器驱动的关闭与定都
 *  (行为恒定,身份每渲染抖动);语境与屏前现金决定费用行与 footer。
 *  详情是「边看边掂量」件(ADR-0031 诉求本体),bot 定都/演出期间开着时内容没变
 *  的拍在此 bail out。 */
function tileDetailScrollEqual(a: TileDetailScrollProps, b: TileDetailScrollProps): boolean {
  return (
    a.city === b.city &&
    a.groupLabel === b.groupLabel &&
    a.tierLabel === b.tierLabel &&
    a.players === b.players &&
    (a.context.kind === "capital" && b.context.kind === "capital"
      ? a.context.cash === b.context.cash &&
        a.context.cost === b.context.cost &&
        a.context.canConfirm === b.context.canConfirm &&
        a.context.reason === b.context.reason
      : a.context.kind === b.context.kind)
  );
}

function CityDamageRanking({
  entries,
  players,
}: {
  entries: readonly CityDamageEntry[];
  players: SnapshotPlayer[];
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto mb-3 max-w-[560px] overflow-hidden rounded-[3px] border border-gold/25"
    >
      <h3 id={titleId} className="m-0 bg-panel-hi/60 px-2 py-1 text-sm text-paper">
        伤害排行榜
      </h3>
      {entries.length === 0 ? (
        <p className="m-0 border-t border-gold/15 px-2 py-1 text-sm text-paper-dim">暂无伤害</p>
      ) : (
        <ol className="m-0 list-decimal border-t border-gold/15 ps-7 marker:text-paper-dim">
          {entries.map(({ seat, damage }) => {
            const player = players[seat];
            if (player === undefined) throw new Error(`伤害排行榜:不存在座位 ${seat}`);
            return (
              <li key={seat} className="border-t border-gold/15 pe-2 py-1 text-sm first:border-t-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={
                      player.isBankrupt
                        ? "min-w-0 truncate text-paper-dim line-through"
                        : "min-w-0 truncate text-paper"
                    }
                  >
                    <span className="font-brush">{player.guohao}</span> {player.name}
                  </span>
                  {player.isBankrupt && <span className="sr-only">已破产</span>}
                  <span className="shrink-0 text-gold-deep tabular-nums">{damage} 点</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export const TileDetailScroll = memo(function TileDetailScroll({
  city,
  groupLabel,
  tierLabel,
  players,
  context,
  onClose,
}: TileDetailScrollProps) {
  const { tile, property, owner, capital } = city;
  const isCapital = owner !== null && capital?.seat === owner.seat;
  const burning = owner?.burning ?? null;
  const pickCapital = context.kind === "capital";
  let burningText: string | null = null;
  if (burning !== null) {
    const source = players[burning.sourceSeat];
    if (source === undefined) throw new Error(`城池燃烧:不存在来源座位 ${burning.sourceSeat}`);
    burningText = `燃烧x${burning.marks}, 伤害来源[${source.guohao}]`;
  }
  // #729:选都态「定都于此/再想想」钉底(壳 footer 槽);只读查看态不传 footer,
  // 槽不渲染零余白(详情内容矮,无需钉底段)。
  return (
    <BannerShell
      title={`「${tile.name}」`}
      onClose={onClose}
      testid={T.tileDetailScroll}
      summary={
        <>
          <span hidden data-tile-index={tile.index} />
          <div className="flex items-center justify-center gap-3">
            <TileThumb city={city} className="city-detail-thumb" />
            <div className="text-center text-xs text-paper-dim">
              <p className="m-0">
                {tierLabel}
                {" · "}
                {groupLabel ? `${groupLabel} · ` : ""}
                {owner !== null ? `${owner.guohao}持有` : "无主"}
                {isCapital ? ` · 都城 Lv.${owner.level}` : ""}
                {owner !== null ? (
                  <>
                    {" · 防御 "}
                    <span data-testid={T.tileDetailDefense} className="text-paper">
                      {owner.defense}/{owner.fullDefense}
                    </span>
                  </>
                ) : null}
              </p>
              {burningText !== null && <p className="m-0 mt-1 text-paper">{burningText}</p>}
            </div>
          </div>
          {pickCapital ? (
            <>
              <AffordRow cash={context.cash} need={context.cost} purpose="capital" />
              {context.reason !== null && (
                <p className="m-0 text-center text-sm text-danger">{context.reason}</p>
              )}
              <p className="m-0 text-center text-sm text-paper">
                都城补给 {formatMoney(property.resupply)}
              </p>
            </>
          ) : (
            <p className="text-center text-xs text-paper-dim">
              购入价 {formatMoney(property.purchasePrice)}
            </p>
          )}
        </>
      }
      footer={
        pickCapital ? (
          <div className="flex justify-center gap-3">
            <BannerButton
              primary
              disabled={!context.canConfirm}
              testid={TESTIDS.confirmCapitalOk}
              onClick={context.onConfirm}
            >
              定都于此
            </BannerButton>
            <BannerButton testid={TESTIDS.confirmCapitalCancel} onClick={onClose}>
              再想想
            </BannerButton>
          </div>
        ) : undefined
      }
    >
      <>
        {owner !== null && <CityDamageRanking entries={owner.damageRanking} players={players} />}
        {/* 等级表:抽成共用 ValueTable(购地/扩军卷轴复用同一张表,避免三处漂移)。
            #671:主列=交易加成;第二列按城型——都城与选都候选显示补给(变卖价对都城
            是死信息:都城永不可变卖),普通城显示变卖价。
            #92:持有城高亮持有者当前档;无主城省略当前等级高亮 */}
        <ValueTable
          property={property}
          second={isCapital || pickCapital ? "supply" : "sell"}
          highlight={owner !== null ? { level: owner.level, label: "当前" } : undefined}
        />
      </>
    </BannerShell>
  );
}, tileDetailScrollEqual);

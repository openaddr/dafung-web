// 侧栏·珍宝·名士区(L48:战报区移除后腾出的常驻展示区,侧栏唯一弹性纵向空间)。
// 珍宝:名·等级·指导价(guidePriceOf 按等级推导,快照不带价字段)一行一宝;
// 名士:画像(HeroDef.image 本地资源)·名 小卡横排。点击均弹 CardDetailScroll 详情。
// 卡详情卷轴原住 HandPanel,随卡迁来;双层卷轴互斥机制不变(onCardDetailOpen
// 通知 GameScreen 关掉城详情卷轴)。字号遵循 W3 三档:区标题 brush text-base /
// 条目 text-xs / 指导价数值 text-xs text-money;条目触达 ≥40px。
import { useState } from "react";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { CardDetailScroll, type CardDetail } from "./CardDetailScroll";
import { TESTIDS } from "./testids";

interface TreasuryPanelProps {
  /** 本地视角玩家(null = 观战,渲染空态)。 */
  player: SnapshotPlayer | null;
  /** G-17:打开卡详情卷轴时通知父层(用于关掉城详情卷轴,双层卷轴互斥)。 */
  onCardDetailOpen?: () => void;
}

/** 名士小卡:3:4 画像(object-cover,与详情卷轴 Portrait 同比例)+ 名。
 *  画像加载失败显式「像」错误位(与 CardDetailScroll 的「画像缺失」同口径,
 *  用户可感知,非静默兜底)。 */
function HeroCard({
  hero,
  onClick,
}: {
  hero: SnapshotPlayer["heroes"][number];
  onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      data-testid={TESTIDS.treasuryHero(hero.id)}
      title={hero.title}
      onClick={onClick}
      className="flex w-20 shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded border border-gold/40 bg-panel-hi p-1 hover:border-gold hover:bg-panel"
    >
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-sm border border-gold/30 bg-paper-lo">
        {failed ? (
          <span className="absolute inset-0 flex items-center justify-center font-brush text-lg text-ink-dim">
            像
          </span>
        ) : (
          <img
            src={hero.image}
            alt={`${hero.name}画像`}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
            draggable={false}
          />
        )}
      </span>
      <span className="w-full truncate text-center text-xs leading-none">{hero.name}</span>
    </button>
  );
}

export function TreasuryPanel({ player, onCardDetailOpen }: TreasuryPanelProps) {
  // UI F5(随卡迁来):当前查看详情的卡(珍宝/名士);null = 无卷轴
  const [cardDetail, setCardDetail] = useState<CardDetail | null>(null);
  const openDetail = (d: CardDetail) => {
    setCardDetail(d);
    onCardDetailOpen?.(); // G-17:卡详情卷轴打开时关掉城详情卷轴
  };
  return (
    <section
      data-testid={TESTIDS.treasuryPanel}
      className="flex min-h-0 flex-1 flex-col border-b border-gold/40 px-3 pb-2"
    >
      <h3 className="shrink-0 py-1 font-brush text-base">珍宝 · 名士</h3>
      {!player ? (
        <div className="text-xs leading-5 text-ink-dim/80">观战中 · 无手牌可看</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {/* 珍宝:名·等级·指导价。行触达 ≥40px(W5 触屏基线),指导价右对齐(可断言数值) */}
          {player.treasures.map((t) => (
            <div
              key={t.id}
              data-testid={TESTIDS.treasuryTreasure(t.id)}
              title={t.desc}
              onClick={() => openDetail({ kind: "treasure", card: t })}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded border border-gold/40 bg-panel-hi px-2.5 text-xs leading-none hover:border-gold hover:bg-panel"
            >
              {/* S6 符号表:珍宝统一 ◆(金色) */}
              <span className="shrink-0 text-gold">◆</span>
              <span className="truncate">{t.name}</span>
              <span className="shrink-0 text-ink-dim">Lv{t.level}</span>
              <span className="ml-auto shrink-0 text-money">指导价 {formatMoney(guidePriceOf(t.level))}</span>
            </div>
          ))}
          {player.treasures.length === 0 && <span className="text-xs text-ink-dim">暂无珍宝</span>}
          {/* 名士:画像·名小卡横排 */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {player.heroes.map((h) => (
              <HeroCard key={h.id} hero={h} onClick={() => openDetail({ kind: "hero", card: h })} />
            ))}
          </div>
          {player.heroes.length === 0 && <span className="text-xs text-ink-dim">暂无名士</span>}
        </div>
      )}
      {/* UI F5:珍宝/名士详情卷轴(点卡弹出;只读,唯一交互是关闭) */}
      {cardDetail && <CardDetailScroll detail={cardDetail} onClose={() => setCardDetail(null)} />}
    </section>
  );
}

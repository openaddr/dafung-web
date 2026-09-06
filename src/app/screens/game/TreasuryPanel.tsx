// 侧栏·珍宝·名将区(L48:战报区移除后腾出的常驻展示区,桌面并排下是侧栏唯一弹性纵向空间;
// 抽屉态由 R3-A5(#68) 放开弹性、随 aside 整抽屉滚动)。
// 珍宝:名·等级·指导价(guidePriceOf 按等级推导,快照不带价字段)一行一宝;
// 名将:画像(HeroDef.image 本地资源)·名 小卡横排。点击均弹 CardDetailScroll 详情。
// 卡详情卷轴原住 HandPanel,随卡迁来;双层卷轴互斥机制不变(onCardDetailOpen
// 通知 GameScreen 关掉城详情卷轴)。字号遵循 W3 三档:区标题 brush text-base /
// 条目 text-xs / 指导价数值 text-xs text-money;条目触达 ≥40px。
// R3-B6(#78):全空空态合并为居中「藏」浅章(观战「观」印同语言)+ 一行说明;
// 珍宝行按等级三档递进(Lv1 现样 / Lv2 金描边 / Lv3 金底浅染+徽点)。
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
  /** R3-A5(#68):抽屉态(P0-7 窄屏,GameScreen 以 isNarrow 同源下发)——aside 已改
   *  整抽屉滚动,本区 flex-none 放开 min-h-24/flex-1,内容自然展开随抽屉滚,不再
   *  挤压 shrink-0 的诸侯区;桌面并排仍由本区 flex-1 承接弹性空间(布局不变)。 */
  narrow: boolean;
}

/** 名将小卡:3:4 画像(object-cover,与详情卷轴 Portrait 同比例)+ 名。
 *  画像加载失败显式「像」错误位(与 CardDetailScroll 的「画像缺失」同口径,
 *  用户可感知,非静默兜底)。
 *  R3-D3(#101):照片容器做旧——金/纸色双线框(border + 外圈 1px 发丝 outline)
 *  + 老照片滤镜(sepia/saturate/contrast 任意值);img 本体 mix-blend-multiply
 *  融进宣纸底去贴图感。容器 filter 同时形成层叠上下文,multiply 只与本容器
 *  纸底(bg-paper-lo)融合,不外溢。仅位图画像(hero .png)做旧,3:4 比例不变。 */
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
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-sm border border-gold/40 bg-paper-lo outline outline-1 outline-offset-2 outline-gold/20 sepia-[.35] saturate-[.85] contrast-[.92]">
        {failed ? (
          <span className="absolute inset-0 flex items-center justify-center font-brush text-lg text-ink-dim">
            像
          </span>
        ) : (
          <img
            src={hero.image}
            alt={`${hero.name}画像`}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover mix-blend-multiply"
            draggable={false}
          />
        )}
      </span>
      <span className="w-full truncate text-center text-xs leading-none">{hero.name}</span>
    </button>
  );
}

export function TreasuryPanel({ player, onCardDetailOpen, narrow }: TreasuryPanelProps) {
  // UI F5(随卡迁来):当前查看详情的卡(珍宝/名将);null = 无卷轴
  const [cardDetail, setCardDetail] = useState<CardDetail | null>(null);
  const openDetail = (d: CardDetail) => {
    setCardDetail(d);
    onCardDetailOpen?.(); // G-17:卡详情卷轴打开时关掉城详情卷轴
  };
  return (
    <section
      data-testid={TESTIDS.treasuryPanel}
      // R3-A5(#68):桌面并排保持原样(min-h-24 保底 + flex-1 承接弹性纵向空间);
      // 抽屉态 flex-none 放开保底,内容自然高度展开,溢出由 aside 整抽屉滚动接管。
      className={
        "flex flex-col border-b border-gold/40 px-3 pb-2 " +
        (narrow ? "flex-none" : "min-h-24 flex-1")
      }
    >
      <h3 className="shrink-0 py-1 font-brush text-base">珍宝 · 名将</h3>
      {!player ? (
        <div className="text-xs leading-5 text-ink-dim/80">观战中 · 无手牌可看</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {/* 珍宝:名·等级·指导价。行触达 ≥40px(W5 触屏基线),指导价右对齐(可断言数值)。
              S9(#42):行本体是 button(与同区名将卡同语义)——Tab 可达、Enter 开详情,
              w-full + text-left 抵消 button 默认样式,视觉与原 div 行一致 */}
          {player.treasures.map((t) => {
            // R3-B6(#78):等级三档视觉——Lv1 现样(border-gold/40);Lv2 描边升一档
            // (border-gold/70);Lv3 在 Lv2 描边上再叠金底浅染(bg-gold/10)+ ◆ 前 6px 金点。
            // 三档单调递进、只动 className/行内装饰:button 语义、testid、min-h-10 触达不变。
            // bg-gold/10 与 bg-panel-hi 互斥(同一属性,避免编译序竞争),hover:bg-panel 三档统一。
            const tone =
              t.level >= 3 ? "border-gold/70 bg-gold/10" : t.level === 2 ? "border-gold/70" : "border-gold/40";
            return (
              <button
                type="button"
                key={t.id}
                data-testid={TESTIDS.treasuryTreasure(t.id)}
                title={t.desc}
                onClick={() => openDetail({ kind: "treasure", card: t })}
                className={
                  "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded border px-2.5 text-left text-xs leading-none hover:border-gold hover:bg-panel " +
                  tone
                }
              >
                {/* R3-B6(#78):Lv3 顶档徽点(6px 金点,◆ 前一眼位;纯装饰 aria-hidden) */}
                {t.level >= 3 && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
                {/* S6 符号表:珍宝统一 ◆(金色) */}
                <span className="shrink-0 text-gold">◆</span>
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 text-ink-dim">Lv{t.level}</span>
                <span className="ml-auto shrink-0 text-money">指导价 {formatMoney(guidePriceOf(t.level))}</span>
              </button>
            );
          })}
          {/* R3-B6(#78):空态合并——珍宝名将全空时,原两行散灰字收拢为居中一组:
              36px「藏」浅章(与 HandPanel 观战「观」印同语言:方章微旋、灰墨淡化)+
              一行说明。单侧为空仍各留一行(否则「尚未收藏珍宝名将」在已有名将时说谎)。 */}
          {player.treasures.length === 0 &&
            (player.heroes.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 rotate-[-4deg] items-center justify-center rounded-[2px] border border-ink/15 font-brush text-xl leading-none text-ink/20"
                >
                  藏
                </span>
                <span className="text-xs text-ink-dim/70">尚未收藏珍宝名将</span>
              </div>
            ) : (
              <span className="text-xs text-ink-dim">暂无珍宝</span>
            ))}
          {/* 名将:画像·名小卡横排 */}
          {player.heroes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {player.heroes.map((h) => (
                <HeroCard key={h.id} hero={h} onClick={() => openDetail({ kind: "hero", card: h })} />
              ))}
            </div>
          )}
          {player.heroes.length === 0 && player.treasures.length > 0 && (
            <span className="text-xs text-ink-dim">暂无名将</span>
          )}
        </div>
      )}
      {/* UI F5:珍宝/名将详情卷轴(点卡弹出;只读,唯一交互是关闭) */}
      {cardDetail && <CardDetailScroll detail={cardDetail} onClose={() => setCardDetail(null)} />}
    </section>
  );
}

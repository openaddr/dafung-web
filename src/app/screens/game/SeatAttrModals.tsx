// 席位格图标直达明细弹层族(#701,spec #697 ④):格上战盔/玉璧/墨竹/卷轴点开的
// 四路只读明细——名将名录与珍宝列表照现役 PileModal 名录/卡面同构装配(PileShell +
// HeroCardFace/TreasureCardFace 公开件;名将/珍宝是投影全员公开信息,逐件可陈),
// 声望/委任为轻量数值明细(大数+口径;声望带献计里程碑章,门槛单源
// core/reputation REP_MILESTONES,已领集=快照 repMilestones)。空陈列照常可开:
// 计数如实报 0、网格自然为空(业务空态,#361 口径);投影没有的数据不造(零兜底)。
// 壳全收口 shadcn(PileShell→ui/dialog 底件):可拖(ADR-0031)/点外/Esc/不夺焦
// 全由壳白拿,本件零自写交互语义。轻量明细样式在 seat-pop.css(spop-detail)。
import type { ReactNode } from "react";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { REP_MILESTONES } from "@core/reputation";
import { formatMoney } from "@core/money";
import { guidePriceOf } from "@core/treasures";
import { PileShell } from "./PileModal";
import { HeroCardFace } from "@app/components/card/HeroCardFace";
import { TreasureCardFace } from "@app/components/card/JinnangCardFace";
import { treasureImagePath } from "@app/components/card/jinnang-face-data";
import { ATTR_TIPS } from "./Tip";
import { TESTIDS } from "./testids";

/** 格上图标直达的明细种类(城池走现役 #622 CityLedgerModal,不在本族)。 */
export type SeatDetailKind = "hero" | "gem" | "rep" | "warrant";

/** 名将名录(战盔→):现役名将弹层同构(题名/朱印/陈列网格逐字对齐),数据按席。 */
function SeatHeroModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return (
    <PileShell
      title="名将"
      seal="将"
      sub={`${p.guohao} · 麾下名将`}
      testid={TESTIDS.seatHeroModal}
      ariaLabel={`名将 · ${p.guohao}`}
      onClose={onClose}
    >
      <div className="pile-zone">
        <span className="pile-zdot" aria-hidden="true" />
        麾下名将 · {p.heroes.length} 席
      </div>
      <div className="pile-hero-grid">
        {p.heroes.map((h) => (
          <HeroCardFace key={h.id} heroId={h.id} size="detail" />
        ))}
      </div>
    </PileShell>
  );
}

/** 珍宝列表(玉璧→):现役珍宝弹层同构(装裱卡陈列+指导价名牌),数据按席。 */
function SeatGemModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return (
    <PileShell
      title="珍宝"
      seal="宝"
      sub={`${p.guohao} · 珍宝收藏册`}
      testid={TESTIDS.seatGemModal}
      ariaLabel={`珍宝 · ${p.guohao}`}
      onClose={onClose}
    >
      <div className="pile-zone">
        <span className="pile-zdot" aria-hidden="true" />
        已持有 · {p.treasures.length} 件<small>(名牌=指导价)</small>
      </div>
      <div className="pile-grid">
        {p.treasures.map((t) => {
          const image = treasureImagePath(t.id);
          return (
            <div className="pile-cell" key={t.id}>
              <TreasureCardFace
                name={t.name}
                level={t.level}
                desc={t.desc}
                art={image != null ? <img src={image} alt="" /> : undefined}
                className="pile-cell-card"
                title={`${t.name} · 品级 ${t.level} · 指导价 ${formatMoney(guidePriceOf(t.level))}${t.desc ? ` · ${t.desc}` : ""}`}
              />
              <span className="pile-price">指导价 {formatMoney(guidePriceOf(t.level))}</span>
            </div>
          );
        })}
      </div>
    </PileShell>
  );
}

/** 轻量数值明细共用排版:大数 + 口径一句(文案单源 ATTR_TIPS,禁第二事实源)。 */
function NumDetail({
  value,
  neg,
  terms,
  children,
}: {
  value: number;
  /** 负值朱砂(#556 值色即状态)。 */
  neg?: boolean;
  terms: string;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="spop-numrow">
        <span className={"spop-bignum" + (neg ? " neg" : "")}>{value}</span>
      </div>
      {children}
      <div className="spop-terms">{terms}</div>
    </>
  );
}

/** 声望数值明细(墨竹→):现值大数 + 献计里程碑三档章(已献金章,色变即状态)+ 口径。 */
function SeatRepModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return (
    <PileShell
      title="声望"
      seal="声"
      sub={`${p.guohao} · 声望明细`}
      testid={TESTIDS.seatRepModal}
      ariaLabel={`声望 · ${p.guohao}`}
      className="spop-detail"
      onClose={onClose}
    >
      <NumDetail value={p.reputation} neg={p.reputation < 0} terms={ATTR_TIPS.rep.detail}>
        <div className="spop-milestones">
          {REP_MILESTONES.map((m) => {
            const claimed = p.repMilestones.includes(m);
            return (
              <span
                key={m}
                className={"spop-milestone" + (claimed ? " claimed" : "")}
                data-testid={TESTIDS.seatRepMilestone(m)}
                title={claimed ? `声望达 +${m},已获名将献计一封` : `未达 +${m}`}
              >
                +{m}
              </span>
            );
          })}
        </div>
      </NumDetail>
    </PileShell>
  );
}

/** 委任明细(卷轴→):现值大数 + 口径(委任无逐张数据,投影只有计数——明细到此为
 *  止,不造第二事实源)。 */
function SeatWarrantModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return (
    <PileShell
      title="委任状"
      seal="委"
      sub={`${p.guohao} · 委任明细`}
      testid={TESTIDS.seatWarrantModal}
      ariaLabel={`委任状 · ${p.guohao}`}
      className="spop-detail"
      onClose={onClose}
    >
      <NumDetail value={p.warrants} terms={ATTR_TIPS.warrant.detail} />
    </PileShell>
  );
}

/** 明细弹层路由入口(SeatRail 持 {kind, seat} 开合态,钻入时单层互斥)。 */
export function SeatDetailModal({
  kind,
  p,
  onClose,
}: {
  kind: SeatDetailKind;
  p: SnapshotPlayer;
  onClose: () => void;
}) {
  if (kind === "hero") return <SeatHeroModal p={p} onClose={onClose} />;
  if (kind === "gem") return <SeatGemModal p={p} onClose={onClose} />;
  if (kind === "rep") return <SeatRepModal p={p} onClose={onClose} />;
  return <SeatWarrantModal p={p} onClose={onClose} />;
}

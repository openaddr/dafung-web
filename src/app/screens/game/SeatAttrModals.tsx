// 组件收口:已收口——格上明细三路,复用 PileShell→ui/dialog 装配;唯一入口=诸侯详情四钻入(细则 docs/design/组件收口.md)
// 席位格图标直达明细弹层族(#701,spec #697 ④):格上战盔/玉璧/墨竹点开的
// 三路只读明细——名将复用 HeroInspectionModal 人物卷,珍宝复用 PileShell +
// TreasureCardFace;两者均只读当前席位的公开快照,
// 声望为轻量数值明细(终态 #1099:大数+三档概率条+三档百分比明文,零冗余文案)。
// 空陈列照常可开:
// 计数如实报 0;空网格接 #768 器物空态制式(斜放朱印+短注,单源
// screens/shared/ArtifactEmpty,PileModal #851 同款);投影没有的数据不造(零兜底)。
// 壳全收口 shadcn(PileShell→ui/dialog 底件):可拖(ADR-0031)/点外/Esc/不夺焦
// 全由壳白拿,本件零自写交互语义。轻量明细样式在 seat-detail.css(sdtl,#1097 起
// 唯一入口=诸侯详情四钻入——格上图标直达随单人格弹层退役)。
import { memo } from "react";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { PileShell, PileZone, treasureFace, treasurePrice } from "./PileModal";
import { HeroInspectionModal } from "./HeroInspectionModal";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { REP_TIER_COLORS, RepProbBar, repTierPct } from "./RepProbBar";
import { TESTIDS } from "./testids";
/* 轻量明细补皮(sdtl;导入序在 PileModal 之后——同特异性覆盖壳宽,见 css 头注) */
import "./seat-detail.css";

/** 格上图标直达的明细种类(城池走现役 #622 CityLedgerModal,不在本族)。 */
export type SeatDetailKind = "hero" | "gem" | "rep";

/** 名将钻入与自己的藏品入口共用人物卷;不传命令即只读。 */
function SeatHeroModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return <HeroInspectionModal player={p} testid={TESTIDS.seatHeroModal} onClose={onClose} />;
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
      <PileZone>
        已持有 · {p.treasures.length} 件<small>(名牌=指导价)</small>
      </PileZone>
      {p.treasures.length === 0 ? (
        <div className="flex justify-center py-6">
          <SealEmpty char="宝" note="库中尚空" title="暂无珍宝" />
        </div>
      ) : (
        <div className="pile-grid">
          {p.treasures.map((t) => (
            <div className="pile-cell" key={t.id}>
              {treasureFace(t)}
              {treasurePrice(t)}
            </div>
          ))}
        </div>
      )}
    </PileShell>
  );
}

/** 轻量数值明细共用排版:大数(值色即状态,#556)。 */
function NumDetail({ value, neg }: { value: number; neg?: boolean }) {
  return (
    <div className="sdtl-numrow">
      <span className={"sdtl-bignum" + (neg ? " neg" : "")}>{value}</span>
    </div>
  );
}

/** 声望数值明细(墨竹→)终态(#1099,#1096 决议5):大数+210×10 概率条+三档百分比
 *  明文一行(色字,档色单源 REP_TIER_COLORS);零冗余文案,不加说明句/caption,
 *  无浮签。条 aria-hidden,三档语义由明文行承。 */
function SeatRepModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  const pct = repTierPct(p.reputation);
  return (
    <PileShell
      title="声望"
      seal="声"
      sub={`${p.guohao} · 声望明细`}
      testid={TESTIDS.seatRepModal}
      ariaLabel={`声望 · ${p.guohao}`}
      className="sdtl"
      onClose={onClose}
    >
      <NumDetail value={p.reputation} neg={p.reputation < 0} />
      <div className="sdtl-prob">
        <RepProbBar reputation={p.reputation} size="modal" />
        <div className="sdtl-tiers">
          <span style={{ color: REP_TIER_COLORS.good }}>好运 {pct.good}%</span>
          <span style={{ color: REP_TIER_COLORS.neutral }}>中性 {pct.neutral}%</span>
          <span style={{ color: REP_TIER_COLORS.bad }}>霉运 {pct.bad}%</span>
        </div>
      </div>
    </PileShell>
  );
}

/** 值等(#1140 渲染税):p 引用由 GameTopBar 的 useStablePlayers 保证「内容不变
 *  即引用不变」;onClose 不入比较(setState 驱动,行为恒定)。 */
function seatDetailEqual(
  a: { kind: SeatDetailKind; p: SnapshotPlayer },
  b: { kind: SeatDetailKind; p: SnapshotPlayer },
): boolean {
  return a.kind === b.kind && a.p === b.p;
}

/** 明细弹层路由入口(SeatRail 持 {kind, seat} 开合态,钻入时单层互斥)。
 *  重渲口径(#1140):开着随内容变化重渲,演出期不再每拍陪跑。 */
export const SeatDetailModal = memo(function SeatDetailModal({
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
  return <SeatRepModal p={p} onClose={onClose} />;
}, seatDetailEqual);

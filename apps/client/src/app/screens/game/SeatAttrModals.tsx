// 组件收口:已收口——诸侯详情内的名将与珍宝分项共用现有弹层。
import { memo } from "react";
import type { SnapshotPlayer } from "@app/store/gameStore";
import { PileShell, treasureFace, treasurePrice } from "./PileModal";
import { HeroInspectionModal } from "./HeroInspectionModal";
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";
import { TESTIDS } from "./testids";

/** 诸侯详情的藏品明细种类(城池走现役 #622 CityLedgerModal,不在本族)。 */
export type SeatDetailKind = "hero" | "gem";

/** 名将钻入与自己的藏品入口共用人物卷;不传命令即只读。 */
function SeatHeroModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return <HeroInspectionModal player={p} testid={TESTIDS.seatHeroModal} onClose={onClose} />;
}

/** 珍宝列表:现役珍宝弹层同构(装裱卡陈列+指导价名牌),数据按席。 */
function SeatGemModal({ p, onClose }: { p: SnapshotPlayer; onClose: () => void }) {
  return (
    <PileShell
      title="珍宝"
      seal="宝"
      sub={`${p.guohao} · ${p.treasures.length} 件`}
      testid={TESTIDS.seatGemModal}
      ariaLabel={`珍宝 · ${p.guohao}`}
      onClose={onClose}
    >
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

/** 值等(#1140 渲染税):p 引用由 GameTopBar 的 useStablePlayers 保证「内容不变
 *  即引用不变」;onClose 不入比较(setState 驱动,行为恒定)。 */
function seatDetailEqual(
  a: { kind: SeatDetailKind; p: SnapshotPlayer },
  b: { kind: SeatDetailKind; p: SnapshotPlayer },
): boolean {
  return a.kind === b.kind && a.p === b.p;
}

/** 诸侯详情内的明细弹层。
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
  return <SeatGemModal p={p} onClose={onClose} />;
}, seatDetailEqual);

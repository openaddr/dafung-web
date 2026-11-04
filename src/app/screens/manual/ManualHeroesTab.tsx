// 名将签 stub(#1070 T1 只留文件缝,spec #1069 决议⑤):T2 在本文件填肉——
// HeroCardFace 详情档卡墙(池全技亮,陈列数=目录实数)+ 点卡开 SkillGlossaryDialog
// 只读模式(不传 onPick,池全亮不灰置);testid 用 MANUAL_TID.card(id)/detail(id)。
// 本票不写任何真实内容,空态器物化占位(#768 制式,单源 ArtifactEmpty)。
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";

/** 名将签(T2 装配;现为本票骨架占位)。 */
export default function ManualHeroesTab() {
  return (
    <div className="flex justify-center py-8">
      <SealEmpty char="将" note="名录待辑" title="名将 · 待装配" />
    </div>
  );
}

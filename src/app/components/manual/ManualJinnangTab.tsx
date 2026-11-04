// 锦囊签 stub(#1070 T1 只留文件缝,spec #1069 决议⑤):T2 在本文件填肉——
// JinnangCardFace 标准档网格(注牌库张数,陈列数=目录种数)+ 点卡开 JinnangCardDetail
// 进弹层壳。本票不写任何真实内容,空态器物化占位(#768 制式,单源 ArtifactEmpty)。
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";

/** 锦囊签(T2 装配;现为本票骨架占位)。 */
export default function ManualJinnangTab() {
  return (
    <div className="flex justify-center py-8">
      <SealEmpty char="囊" note="囊谱待辑" title="锦囊 · 待装配" />
    </div>
  );
}

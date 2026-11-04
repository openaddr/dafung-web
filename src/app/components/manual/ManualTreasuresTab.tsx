// 珍宝签 stub(#1070 T1 只留文件缝,spec #1069 决议⑤):T2 在本文件填肉——
// TreasureCardFace 网格(陈列数=目录种数)+ 点卡开大档详情(品级/指导价/描述)。
// 本票不写任何真实内容,空态器物化占位(#768 制式,单源 ArtifactEmpty)。
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";

/** 珍宝签(T2 装配;现为本票骨架占位)。 */
export default function ManualTreasuresTab() {
  return (
    <div className="flex justify-center py-8">
      <SealEmpty char="宝" note="库目待辑" title="珍宝 · 待装配" />
    </div>
  );
}

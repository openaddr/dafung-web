// 机遇签 stub(#1070 T1 只留文件缝,spec #1069 决议⑤):T3 在本文件填肉——新绘
// 「机遇笺」(五类唯一新视觉单元):3:4 竖笺形制,笺头=机遇名、档位章=好运青绿/
// 中性黛青/霉运朱砂、正文缩略;按档位三组陈列(11/8/11);点开详情=全文+抉择选项+
// 声望/体力代价。本票不写任何真实内容,空态器物化占位(#768 制式,单源 ArtifactEmpty)。
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";

/** 机遇签(T3 装配;现为本票骨架占位)。 */
export default function ManualEncountersTab() {
  return (
    <div className="flex justify-center py-8">
      <SealEmpty char="遇" note="笺录待辑" title="机遇 · 待装配" />
    </div>
  );
}

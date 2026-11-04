// 技能签 stub(#1070 T1 只留文件缝,spec #1069 决议⑤):T3 在本文件填肉——行式直读
// 列表,无详情层:主动 3 在前、被动 4 在后,一行一技(技名+类型+冷却/目标域小注+
// 描述全文+所属将名)。本票不写任何真实内容,空态器物化占位(#768 制式,单源
// ArtifactEmpty)。
import { SealEmpty } from "@app/screens/shared/ArtifactEmpty";

/** 技能签(T3 装配;现为本票骨架占位)。 */
export default function ManualSkillsTab() {
  return (
    <div className="flex justify-center py-8">
      <SealEmpty char="技" note="技目待辑" title="技能 · 待装配" />
    </div>
  );
}

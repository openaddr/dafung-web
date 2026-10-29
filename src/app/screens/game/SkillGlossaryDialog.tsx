// 技能全览弹框(#605,规格 #603 T2):名将卡面技名 chips 的唯一详情出口——点任一技名
// 弹该将**实授技**全部条目(#786 槽位原生读:target 带 skillIds,招贤候选=全池、
// 麾下将=槽位已授技;●被动逐条 / ◆主动带冷却,desc 全文),被点技金框高亮;
// 只读无命令钮(拷问 Q2/Q6 决议:全览非单技、不带「选此将」)。壳复用 PileShell
// (题名=将名=DialogTitle 可达名,朱印「技」;挂载不夺焦/Esc/点外关闭全由底件白拿);
// 数据 heroDefOf 回查名将目录 + 技对象按 id 读技表单源(skills.ts,#604 desc 挂技自带,
// ADR-0036)。交互语义(开合)归消费方:本件只吃 target(heroId+skillIds+被点技 id)
// 与 onClose,不自持状态。
import { PileShell } from "./PileModal";
import { heroDefOf } from "@app/components/card/HeroCardFace";
import { isActiveSkill, skillById } from "@core/skills";
import { TESTIDS } from "./testids";
import "./skill-glossary.css";

/** 全览目标:null=关。skillIds=实授技(渲染序=传入序,池序由上游保证);
 *  skillId=被点的技(弹框内高亮行;null=不高亮,如纯浏览入口)。 */
export interface SkillGlossaryTarget {
  heroId: string;
  skillIds: string[];
  skillId: string | null;
}

export function SkillGlossaryDialog({
  target,
  onClose,
}: {
  target: SkillGlossaryTarget | null;
  onClose: () => void;
}) {
  if (target == null) return null;
  const def = heroDefOf(target.heroId);
  const rowClass = (skillId: string) => (target.skillId === skillId ? "skg-row is-hl" : "skg-row");
  return (
    <PileShell
      title={def.name}
      seal="技"
      sub={`${def.title} · 技能全览`}
      testid={TESTIDS.skillGlossary}
      onClose={onClose}
    >
      <div className="skg-list">
        {target.skillIds.map(skillById).map((s) => (
          <div key={s.id} data-testid={TESTIDS.skillGlossaryRow(s.id)} className={rowClass(s.id)}>
            <div className="skg-shead">
              <i
                className={isActiveSkill(s) ? "skg-fu skg-fu-dia" : "skg-fu skg-fu-dot"}
                aria-hidden="true"
              />
              <span className="skg-sming">{s.name}</span>
              {isActiveSkill(s) && <span className="skg-cd">冷却 {s.cooldown} 轮</span>}
            </div>
            <div className="skg-sdesc">{s.desc}</div>
          </div>
        ))}
      </div>
    </PileShell>
  );
}

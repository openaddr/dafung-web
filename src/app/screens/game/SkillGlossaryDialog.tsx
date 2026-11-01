// 技能全览弹框(#605,规格 #603 T2):名将卡面技名 chips 的唯一详情出口——点任一技名
// 弹该将**技能池全貌**,与**实授技**对照(#787:target 带池与已授两 id 集;池序陈列,
// 已授者常态、未授者灰置降透明=状态表达 §4.6,不加大段文字标牌;被点技金框高亮)。
// 招贤候选亮预掷结果、麾下将亮槽位已授技,两处口径一致。
// 拍板钮(2026-11-01 用户拍板:招贤点卡先看详情再确定,替代旧「点卡即选」):消费方
// 传 onPick 则 footer 槽钉「收为麾下」钮——招贤卷轴点卡/点技名都开本框且钮同在(先看
// 后选一条路);浏览语境(麾下牌架)不传=只读无钮,旧拷问 Q2/Q6「全览不带选此将」对
// 浏览语境仍成立。壳复用 PileShell(题名=将名=DialogTitle 可达名,朱印「技」;挂载不
// 夺焦/Esc/点外关闭全由底件白拿);数据 heroDefOf 回查名将目录 + 技对象按 id 读技表
// 单源(skills.ts,#604 desc 挂技自带,ADR-0036)。交互语义(开合/拍板)归消费方:
// 本件只吃 target(heroId+两 id 集+被点技 id)与 onPick/onClose,不自持状态。
import { PileShell } from "./PileModal";
import { heroDefOf } from "@app/components/card/HeroCardFace";
import { isActiveSkill, skillById } from "@core/skills";
import { TESTIDS } from "./testids";
import "./skill-glossary.css";

/** 全览目标:null=关。poolSkillIds=池全貌(渲染序=池声明序);skillIds=实授技(灰置
 *  分流依据:池内不在其列者灰置);skillId=被点的技(弹框内高亮行;null=不高亮,
 *  如纯浏览入口)。 */
export interface SkillGlossaryTarget {
  heroId: string;
  poolSkillIds: string[];
  skillIds: string[];
  skillId: string | null;
}

export function SkillGlossaryDialog({
  target,
  onPick,
  onClose,
}: {
  target: SkillGlossaryTarget | null;
  /** 拍板语义归消费方(开合同先例):传=footer 钉「收为麾下」钮(招贤选将语境);
   *  不传=只读浏览(麾下牌架语境),无命令钮。 */
  onPick?: () => void;
  onClose: () => void;
}) {
  if (target == null) return null;
  const def = heroDefOf(target.heroId);
  const granted = new Set(target.skillIds);
  const rowClass = (skillId: string) =>
    ["skg-row", target.skillId === skillId ? "is-hl" : "", granted.has(skillId) ? "" : "is-off"]
      .filter(Boolean)
      .join(" ");
  return (
    <PileShell
      title={def.name}
      seal="技"
      sub={`${def.title} · 技能全览`}
      testid={TESTIDS.skillGlossary}
      onClose={onClose}
      footer={
        onPick != null && (
          <div className="skg-foot">
            <button
              type="button"
              data-testid={TESTIDS.skillGlossaryPick}
              className="skg-pick"
              onClick={onPick}
            >
              收为麾下
            </button>
          </div>
        )
      }
    >
      <div className="skg-list">
        {target.poolSkillIds.map(skillById).map((s) => (
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

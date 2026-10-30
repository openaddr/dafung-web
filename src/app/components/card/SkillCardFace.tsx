// 技能卡卡面(#818,spec #815):出牌窗主动技的牌形态——**技能为维度、名将为载体**
// (GLOSSARY「技能卡」正典):一张卡 = 「某将的某条主动技」,卡面 = 名将立绘与将名
// (载体,美术资产沿用 .hface 家族制式不裁)+ **主技名大字**(本卡代表的技,一眼定
// 身份)+ 该技一句话描述 + 冷却轮数注。不复用 HeroCardFace 紧凑档(技名 chips 列
// 全技=#360 旧形,同将双技双卡同脸的窗口期随此退役):每张牌只显示本卡代表的技,
// 该将全技对照归**点主技名开的技能全览弹框**(#605 池+已授,消费方在 HandRack 接线)。
//
// 器物豁免类(同 HeroCardFace/JinnangCardFace 口径):纯展示零交互状态、不套 shadcn;
// 交互语义(选中/确认/点击)全部归消费方,testid/aria/title 经 ...rest 挂根,本组件
// 不持有。主技名挂 data-skill=技 id(全览入口的点击判定单源 = HeroCardFace 的
// skillIdFromClick,消费方分流:点主技名=开全览,点卡体其余处=选中出牌)。
// 选中/灰置交互态(sel 上浮金描边 / off 下沉置灰 / .reason 原因印条)复用
// jinnang-card.css 的牌面交互态单源(选择器同批覆盖 .hface),本文件不另写一份;
// 装配差量(单技技能区)在 hero-card.css 的 .hface.skill 档。
//
// 数据单源:core/heroes.ts HEROES(名将,经 heroDefOf 回查)+ core/skills.ts SKILLS
// (技表,ADR-0036)——冷却注读技表声明的冷却周期(与详情档/技能全览同口径);实例
// 的解冻剩余轮数不在此算第二遍:冷却中选项 available=false,reason 由 choices 单源
// 携「冷却中(还差 N 轮)」上卡(.reason 印条),两条通路各说各的事实、零重复记账。
// 技 id 查无 / 技非主动 = 数据 bug 直接抛错(零兜底:被动技由时机框架自动触发,
// 无牌形态,永不入架)。
import type { HTMLAttributes } from "react";
import { heroDefOf, Lihui } from "@app/components/card/HeroCardFace";
import { extensionHeroFlagOf } from "@app/extensions/registry";
import { isActiveSkill, skillById } from "@core/skills";

export interface SkillCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  /** 载体名将(#817 实例定位:选项携 skillHeroId,消费方从本地玩家槽位反查后传入)。 */
  heroId: string;
  /** 本卡代表的主动技(主技名/desc/冷却注的唯一依据)。 */
  skillId: string;
}

/** 技能卡卡面(#818,双方案比选定案 B 案):载体五件 = 画心立绘/名带/称号签/将章/
 *  将旗(沿用家族制式不裁);主技名 = 竖章叠画心左缘(zhang-ming,与右缘将名带构成
 *  「左技右将」双维对读,data-skill=全览入口);技能区 = ◆ 冷却注+该技 desc 一句话。
 *  children 透传到卡面末尾——不可用态的原因印条(<span className="reason">)由消费方
 *  挂入(同家族口径)。 */
export function SkillCardFace({
  heroId,
  skillId,
  className,
  children,
  ...rest
}: SkillCardFaceProps) {
  const def = heroDefOf(heroId);
  const skill = skillById(skillId);
  if (!isActiveSkill(skill))
    throw new Error(`技能卡承载了非主动技:${skillId}(被动技无牌形态,数据 bug)`);
  const flag = extensionHeroFlagOf(heroId); // 扩展将旗(#378 渲染 hook):null = 无旗
  const classes = ["hface", "skill", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      <div className="stage">
        <Lihui src={def.image} name={def.name} />
        <span className="zhang-ming" data-skill={skill.id}>
          {skill.name}
        </span>
      </div>
      <span className="j-seal" aria-hidden="true">
        将
      </span>
      <span className="m-title">{def.title}</span>
      <span className="m-name">{def.name}</span>
      {flag && (
        <img
          className="x-flag"
          data-testid={`hero-flag-${heroId}`}
          src={flag.url}
          alt={flag.alt ?? "将旗"}
          draggable={false}
        />
      )}
      <div className="skz">
        <div className="shead">
          <i className="fu fu-dia" aria-hidden="true" />
          <span className="cd">冷却 {skill.cooldown} 轮</span>
        </div>
        <div className="sdesc">{skill.desc}</div>
      </div>
      {children}
    </div>
  );
}

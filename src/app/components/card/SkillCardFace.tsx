// 主动技能卡以技能为维度、名将为载体:上方横排技名、中间立绘、下方将名。
// 技名与其余牌面是两个独立按钮,分别查看技能全览和选择此牌。
// 不可用原因由调用方提供;技能描述和固定冷却周期留在技能全览中。
import { Button } from "@base-ui/react/button";
import type { ComponentProps, HTMLAttributes } from "react";
import { heroDefOf, Lihui } from "@app/components/card/HeroCardFace";
import { isActiveSkill, skillById } from "@core/skills";

type SkillCardButtonProps = Omit<ComponentProps<typeof Button>, "children" | "className"> & {
  "data-testid"?: string;
};

interface SkillCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  heroId: string;
  skillId: string;
  inspectProps: SkillCardButtonProps;
  selectProps: SkillCardButtonProps;
}

export function SkillCardFace({
  heroId,
  skillId,
  inspectProps,
  selectProps,
  className,
  children,
  ...rest
}: SkillCardFaceProps) {
  const def = heroDefOf(heroId);
  const skill = skillById(skillId);
  if (!isActiveSkill(skill))
    throw new Error(`技能卡承载了非主动技:${skillId}(被动技无牌形态,数据 bug)`);
  const classes = ["hface", "skill", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      <Button {...inspectProps} type="button" className="skill-name" data-skill={skill.id}>
        {skill.name}
      </Button>
      <Button {...selectProps} type="button" className="skill-body">
        <div className="stage">
          <Lihui src={def.image} name={def.name} />
        </div>
        {children}
        <span className="skill-hero-name">{def.name}</span>
      </Button>
    </div>
  );
}

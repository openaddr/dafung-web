// 名将签(#1071,spec #1069 决议⑤ T2 装配;#1183 形制改版;#1188 收编壳与卡基单源):
// HEROES 全量 HeroCardFace compact 缩略卡墙——技名 chips 只显名不带 desc(#1183 用户口径:
// 详细技能效果点开才看),换行居中 + 体部内滚与四签统一(旧一行 detail 档等宽墙
// 随名将扩容密不透风,退役)。卡基=CARD_WALL_BASE_PX(card-wall.ts 单源,珍宝签同拍):
// 6 张一行恰收进 844×390 体部宽,行数随目录实数换行续滚,不落数;点卡开 SkillGlossaryDialog
// 只读模式——不传 onPick=无拍板钮浏览语境;target.skillIds=poolSkillIds=池全亮不灰置;
// skillId=被点技,skillIdFromClick 单源判定(compact chips 自带 data-skill,点技名
// 直落该技高亮,点卡面其余处=纯浏览不高亮)。
// 点击壳=SelectableFaceButton 单源(#1188);testid 消费 MANUAL_TID.card(将 id)。
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { HEROES } from "@core/heroes";
import { HeroCardFace, skillIdFromClick } from "@app/components/card/HeroCardFace";
import { SelectableFaceButton } from "@app/components/card/SelectableFaceButton";
import {
  SkillGlossaryDialog,
  type SkillGlossaryTarget,
} from "@app/screens/game/SkillGlossaryDialog";
import { CARD_WALL_BASE_PX } from "./card-wall";
import { MANUAL_TID } from "./testids";

/** 名将签:全量名录 compact 缩略卡墙 + 技能全览只读叠层(spec #1069 决议⑤)。 */
export default function ManualHeroesTab() {
  const [glossary, setGlossary] = useState<SkillGlossaryTarget | null>(null);
  return (
    <>
      <div
        className="flex flex-wrap justify-center gap-3.5"
        style={{ ["--hface-base" as string]: `${CARD_WALL_BASE_PX}px` }}
      >
        {HEROES.map((h) => (
          <SelectableFaceButton
            key={h.id}
            data-testid={MANUAL_TID.card(h.id)}
            onClick={(e: ReactMouseEvent<HTMLButtonElement>) =>
              setGlossary({
                heroId: h.id,
                poolSkillIds: h.skillPool,
                skillIds: h.skillPool,
                skillId: skillIdFromClick(e),
              })
            }
          >
            <HeroCardFace heroId={h.id} skillIds={h.skillPool} size="compact" />
          </SelectableFaceButton>
        ))}
      </div>
      <SkillGlossaryDialog target={glossary} onClose={() => setGlossary(null)} />
    </>
  );
}

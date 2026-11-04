// 名将签(#1071,spec #1069 决议⑤ T2 装配):HEROES 全量 HeroCardFace 详情档卡墙
// (skillIds=def.skillPool 池全技亮,陈列数=目录实数——含 extension 名将包运行时
// 注册进 HEROES 单池者,如 hero-taishici;规格探索期「4 将」为旧数,目录实数权威,
// 本件不落任何具体张数)+ 点卡开 SkillGlossaryDialog 只读模式——不传 onPick=无拍板
// 钮浏览语境;target.skillIds=poolSkillIds=池全亮不灰置;skillId=被点技,
// skillIdFromClick 单源判定(detail 档技能区为全文行、不带 data-skill chips,现读
// null=纯浏览不高亮;卡面若日后给技能行挂 data-skill,高亮通道自动同接)。
// 卡墙几何(844×390 四张并排,挤则等宽收缩):一行 flex,每格 flex-1 basis-0 等宽;
// 格为 size container(inline-size),卡基 --hface-base=100cqw/15 → 卡宽恒等于格宽,
// 视口收窄四卡同步等宽缩;高度钳 (100dvh−196px)/20 保 844×390 首帧整墙不滚
// (钳量=壳让位 44+20 顶底带与题名/签行/内衬的总盘,ManualModal 文件头),
// 13px 上限防桌面档无限放大(pile-modal.css detail 档 13px 基同值)。
// 交互语义(开合)归本件,卡面维持纯展示豁免;选中语言=hover 金描边光圈(§4.6,
// HeroPickScroll 候选同款);testid 消费 MANUAL_TID.card(将 id)。
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { HEROES } from "@core/heroes";
import { HeroCardFace, skillIdFromClick } from "@app/components/card/HeroCardFace";
import {
  SkillGlossaryDialog,
  type SkillGlossaryTarget,
} from "@app/screens/game/SkillGlossaryDialog";
import { MANUAL_TID } from "./testids";

/** 卡墙格:size container + 卡基几何(见文件头;格等宽 → 卡等宽)。 */
function WallCell({
  heroId,
  skillIds,
  onOpen,
}: {
  heroId: string;
  skillIds: string[];
  onOpen: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className="grid min-w-0 flex-1 place-items-center"
      style={{
        containerType: "inline-size",
        ["--hface-base" as string]: "min(calc(100cqw / 15), calc((100dvh - 196px) / 20), 13px)",
      }}
    >
      <button
        type="button"
        data-testid={MANUAL_TID.card(heroId)}
        onClick={onOpen}
        className="block cursor-pointer rounded-[7px] border-0 bg-transparent p-0 outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)]"
      >
        <HeroCardFace heroId={heroId} skillIds={skillIds} size="detail" />
      </button>
    </div>
  );
}

/** 名将签:全量名录详情档卡墙 + 技能全览只读叠层(spec #1069 决议⑤)。 */
export default function ManualHeroesTab() {
  const [glossary, setGlossary] = useState<SkillGlossaryTarget | null>(null);
  return (
    <>
      <div className="flex items-stretch gap-3">
        {HEROES.map((h) => (
          <WallCell
            key={h.id}
            heroId={h.id}
            skillIds={h.skillPool}
            onOpen={(e) =>
              setGlossary({
                heroId: h.id,
                poolSkillIds: h.skillPool,
                skillIds: h.skillPool,
                skillId: skillIdFromClick(e),
              })
            }
          />
        ))}
      </div>
      <SkillGlossaryDialog target={glossary} onClose={() => setGlossary(null)} />
    </>
  );
}

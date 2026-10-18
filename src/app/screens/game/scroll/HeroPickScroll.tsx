// 招贤纳士卷轴:三选一,无「不取」——旧版同款:AwaitingHeroPick 相位引擎不接受
// endDecision(submitCommand 守卫 assertPhase("AwaitingDecision","EndDecision")),
// 必须三选其一。
// #360:三张 HeroCardFace 紧凑档(pick 档 7.6px 基 114×152,与手牌槽位同档)并排
// 替换旧横排列表——归一后招贤/出牌阶段确认/府库同一张名将卡面(「选将是收将的第一
// 眼」= 日后在府库摩挲的同一张);候选 Hover=金描边光圈(§4.6 状态变化承载)。
// r5 裁定②快捷键退场:1/2/3 键位角标与监听一并撤除,选择交互=点选(本作不重视
// 快捷键,DESIGN §4.6 邻域);卡 title 带全文(#605 起=技名 chips,全文走点技名
// 弹技能全览,先看后选)。
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GameCommand } from "@core/authority";
import { passiveDescLineOf } from "@core/heroes";
import { HeroCardFace, heroDefOf } from "@app/components/card/HeroCardFace";
import { BannerShell } from "./BannerShell";
import { SkillGlossaryDialog, type SkillGlossaryTarget } from "../SkillGlossaryDialog";
import { SCROLL_TESTIDS as T } from "./testids";

/** 候选名将的最小展示形状(snapshot.offeredHeroes 展示子集;卡面本体与技效描述
 *  均按 id 回查 core/heroes.ts 目录单源,#604 快照不落 desc)。 */
export interface HeroOfferInfo {
  id: string;
  name: string;
  title: string;
}

export interface HeroPickScrollProps {
  /** 候选名将(通常 3 个)。 */
  offered: HeroOfferInfo[];
  onCommand: (cmd: GameCommand) => void;
}

export function HeroPickScroll({ offered, onCommand }: HeroPickScrollProps) {
  // 技能全览(#605):点候选将技名 chip=先看后选,chip 点击不触发选将(closest 判定
  // 分流,出牌技卡同款);弹框浮于招贤层上,关闭再从容点卡选将。
  const [glossary, setGlossary] = useState<SkillGlossaryTarget | null>(null);
  if (!offered.length) return null; // 与旧 showHeroPickScroll 一致:无候选不弹
  const pick = (e: ReactMouseEvent<HTMLButtonElement>, i: number) => {
    const chip = (e.target as HTMLElement).closest("[data-skill]");
    if (chip != null) {
      setGlossary({ heroId: offered[i]!.id, skillId: chip.getAttribute("data-skill")! });
      return;
    }
    onCommand({ type: "resolveHeroPick", index: i });
  };
  return (
    <>
      <BannerShell title="招贤纳士" testid={T.heroPickScroll}>
        <div className="flex justify-center gap-5">
          {offered.map((h, i) => (
            <button
              key={h.id}
              type="button"
              data-testid={T.heroPickOption(i)}
              title={`${h.name}·${h.title} — ${passiveDescLineOf(heroDefOf(h.id))}`}
              onClick={(e) => pick(e, i)}
              className="block cursor-pointer rounded-[7px] border-0 bg-transparent p-0 outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)]"
            >
              <HeroCardFace heroId={h.id} size="pick" />
            </button>
          ))}
        </div>
      </BannerShell>
      <SkillGlossaryDialog target={glossary} onClose={() => setGlossary(null)} />
    </>
  );
}

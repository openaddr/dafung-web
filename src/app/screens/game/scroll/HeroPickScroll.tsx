// 招贤纳士卷轴:三选一,无「不取」——旧版同款:AwaitingHeroPick 相位引擎不接受
// endDecision(submitCommand 守卫 assertPhase("AwaitingDecision","EndDecision")),
// 必须三选其一。
// #360:三张 HeroCardFace 紧凑档(pick 档 7.6px 基 114×152,与手牌槽位同档)并排
// 替换旧横排列表——归一后招贤/出牌阶段确认/府库同一张名将卡面(「选将是收将的第一
// 眼」= 日后在府库摩挲的同一张);候选 Hover=金描边光圈(§4.6 状态变化承载)。
// r5 裁定②快捷键退场:1/2/3 键位角标与监听一并撤除,选择交互=点选(本作不重视
// 快捷键,DESIGN §4.6 邻域);卡 title 带全文(#605 起=技名 chips,全文走点技名
// 弹技能全览,先看后选)。
// #787 预掷明牌(ADR-0036):候选行自带生成时掷定的授技子集(快照 offeredHeroes
// 随行),卡面只亮预掷结果——招贤瞬间看到的授技,就是日后在府库摩挲的同一份。
// #850 技能演出补课:①实授技 chips 入场后逐个钤落(fx.css fx-chip-slam,120ms 错拍,
// 错拍账本 --chip-skip 逐卡内联);②点将确认拍卡面钤金「将」小印一拍(.pick-seal-gold,
// 落章弧+linger 双动画零改动复用,时长消费点内联注入),印钤定驻留一拍(UI.pickSealMs)
// 后再发 resolveHeroPick——卷轴随相位收场,「入麾下」落印即落定。
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GameCommand } from "@core/authority";
import { skillById } from "@core/skills";
import { HeroCardFace, heroDefOf, skillIdFromClick } from "@app/components/card/HeroCardFace";
import { FX, UI } from "@app/fx/timings";
import { BannerShell } from "./BannerShell";
import { SkillGlossaryDialog, type SkillGlossaryTarget } from "../SkillGlossaryDialog";
import { SCROLL_TESTIDS as T } from "./testids";

/** 候选名将的最小展示形状(snapshot.offeredHeroes 行:展示字段 + 预掷授技,#787);
 *  卡面本体与技效描述均按 id 回查 core/heroes.ts 目录单源(#604 快照不落 desc)。 */
export interface HeroOfferInfo {
  id: string;
  name: string;
  title: string;
  /** 预掷授技(池序子集,≥1):卡面 chips 与全览「已授」都读这份。 */
  skillIds: string[];
}

export interface HeroPickScrollProps {
  /** 候选名将(通常 3 个)。 */
  offered: HeroOfferInfo[];
  onCommand: (cmd: GameCommand) => void;
}

export function HeroPickScroll({ offered, onCommand }: HeroPickScrollProps) {
  // 技能全览(#605):点候选将技名 chip=先看后选,chip 点击不触发选将(closest 判定
  // 分流,出牌技能卡主技名同款);弹框浮于招贤层上,关闭再从容点卡选将。
  // 池全貌与已授对照(#787):全览入参带池(heroDefOf 回查)与已授(候选行预掷)两集,
  // 池内未授者灰置——先看全貌再决定收不收。
  const [glossary, setGlossary] = useState<SkillGlossaryTarget | null>(null);
  // 确认节拍(#850):点将后先钤金「将」印一拍(UI.pickSealMs 全长,消隐拍=发命令),
  // 在途期间重复点击一律忽略(交互守卫,非兜底);卸载(整屏切换类)随 effect 清场
  // 收计时器——命令未发则相位原封,卷轴随快照重开,选择权回到玩家。
  const [confirming, setConfirming] = useState<number | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    },
    [],
  );
  if (!offered.length) return null; // 与旧 showHeroPickScroll 一致:无候选不弹
  const pick = (e: ReactMouseEvent<HTMLButtonElement>, i: number) => {
    if (confirming != null) return; // 钤印节拍在途,吞掉重复点击
    const chipSkillId = skillIdFromClick(e);
    if (chipSkillId != null) {
      setGlossary({
        heroId: offered[i]!.id,
        poolSkillIds: heroDefOf(offered[i]!.id).skillPool,
        skillIds: offered[i]!.skillIds,
        skillId: chipSkillId,
      });
      return;
    }
    setConfirming(i);
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      onCommand({ type: "resolveHeroPick", index: i });
    }, UI.pickSealMs);
  };
  // 钤落错拍账本(#850):--chip-skip = 本卡之前所有候选的授技 chip 数(卡内位次
  // 由 fx.css nth-child 派生 --chip-n),全卡依次接力钤落,120ms 步长单源在 fx.css。
  let chipSkip = 0;
  return (
    <>
      <BannerShell title="招贤纳士" testid={T.heroPickScroll}>
        <div className="flex justify-center gap-5">
          {offered.map((h, i) => {
            const skip = chipSkip;
            chipSkip += h.skillIds.length;
            return (
              <button
                key={h.id}
                type="button"
                data-testid={T.heroPickOption(i)}
                title={`${h.name}·${h.title} — ${h.skillIds.map((id) => skillById(id).desc).join(";")}`}
                onClick={(e) => pick(e, i)}
                style={{ ["--chip-skip" as string]: String(skip) }}
                className="relative block cursor-pointer rounded-[7px] border-0 bg-transparent p-0 outline-offset-2 transition hover:shadow-[0_0_0_2px_var(--color-gold)]"
              >
                <HeroCardFace heroId={h.id} skillIds={h.skillIds} size="pick" />
                {confirming === i && (
                  <span
                    className="pick-seal-gold"
                    aria-hidden="true"
                    // 入麾金印双动画时长(#850,棒3 时长收口同法):钤定段 FX.sealSlamMs,
                    // linger 全长 UI.pickSealMs(消隐拍=命令发出)
                    style={{ animationDuration: `${FX.sealSlamMs}ms, ${UI.pickSealMs}ms` }}
                  >
                    将
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </BannerShell>
      <SkillGlossaryDialog target={glossary} onClose={() => setGlossary(null)} />
    </>
  );
}

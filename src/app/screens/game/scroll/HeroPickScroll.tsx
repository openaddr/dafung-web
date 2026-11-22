// 组件收口:BannerShell 壳与底部 BannerButton,候选复用 SelectableFaceButton。
// 招贤纳士卷轴:看卡后招将,或用底部按钮求书、跳过。
// #360:三张 HeroCardFace 紧凑档(pick 档 7.6px 基 114×152,与手牌槽位同档)并排
// 替换旧横排列表——归一后招贤/出牌阶段确认/府库同一张名将卡面(「选将是收将的第一
// 眼」= 日后在府库摩挲的同一张)。
// 点击卡面或技名都打开技能全览,在弹框内拍板——先看后选。
// #787 预掷明牌(ADR-0036):候选行自带生成时掷定的授技子集(快照 offeredHeroes
// 随行),卡面只亮预掷结果——招贤瞬间看到的授技,就是日后在府库摩挲的同一份。
// #850 技能演出补课:①实授技 chips 入场后逐个钤落(fx.css fx-chip-slam,120ms 错拍,
// 错拍账本 --chip-skip 逐卡内联);②点将确认拍卡面钤金「将」小印一拍(.pick-seal-gold,
// 落章弧+linger 双动画零改动复用,时长消费点内联注入),印钤定驻留一拍(UI.pickSealMs)
// 后再发 resolveHeroPick——卷轴随相位收场,「入麾下」落印即落定。
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GameCommand } from "@core/authority";
import type { ChoiceOption } from "@core/choices";
import { HeroCardFace, heroDefOf, skillIdFromClick } from "@app/components/card/HeroCardFace";
import { SelectableFaceButton } from "@app/components/card/SelectableFaceButton";
import { FX, UI } from "@app/fx/timings";
import { BannerButton, BannerShell } from "./BannerShell";
import { SkillGlossaryDialog, type SkillGlossaryTarget } from "../SkillGlossaryDialog";
import { TESTIDS } from "../testids";
import { SCROLL_TESTIDS as T } from "./testids";

/** 候选名将的最小展示形状(snapshot.offeredHeroes 行:展示字段 + 预掷授技,#787);
 *  卡面本体与技效描述均按 id 回查 core/heroes.ts 目录单源(#604 快照不落 desc)。 */
interface HeroOfferInfo {
  id: string;
  name: string;
  /** 预掷授技(池序子集,≥1):卡面 chips 与全览「已授」都读这份。 */
  skillIds: string[];
}

interface HeroPickScrollProps {
  /** 候选名将(通常 3 个)。 */
  offered: HeroOfferInfo[];
  choices: ChoiceOption[];
  onCommand: (cmd: GameCommand) => void;
}

export function HeroPickScroll({ offered, choices, onCommand }: HeroPickScrollProps) {
  // 先看后选(2026-11-01 用户拍板:点卡不再直选):点卡与点技名 chip 都开技能全览
  // 详情弹框,弹框内「收为麾下」拍板——技名不知道是啥、想点开看看却直接定将的误选
  // 通路就此断掉。#605 chip 分流保留:点技名仍弹框,只是额外高亮被点技;弹框记候选
  // 位次,拍板回调先关弹框(卡面回台前)再走钤印节拍。
  // #850 确认节拍:拍板后先钤金「将」印一拍(UI.pickSealMs 全长,消隐拍=发命令),
  // 在途期间重复点击一律忽略(交互守卫,非兜底);卸载(整屏切换类)随 effect 清场
  // 收计时器——命令未发则相位原封,卷轴随快照重开,选择权回到玩家。
  const [glossary, setGlossary] = useState<{ index: number; target: SkillGlossaryTarget } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<number | null>(null);
  const picks = choices.map(({ heroPick, ...option }) => {
    if (heroPick == null) throw new Error(`招贤选项 ${option.id} 缺少命令载荷`);
    return { ...option, pick: heroPick };
  });
  const canConfirm =
    confirming === null &&
    picks.some(
      ({ available, pick }) => available && "index" in pick && pick.index === glossary?.index,
    );
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    },
    [],
  );
  const preview = (e: ReactMouseEvent<HTMLButtonElement>, index: number, hero: HeroOfferInfo) => {
    setGlossary({
      index,
      target: {
        heroId: hero.id,
        poolSkillIds: heroDefOf(hero.id).skillPool,
        skillIds: hero.skillIds,
        skillId: skillIdFromClick(e),
      },
    });
  };
  const confirmPick = (i: number) => {
    setGlossary(null); // 弹框收场,卡面回台前接钤金印
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
      <BannerShell
        title="招贤纳士"
        testid={T.heroPickScroll}
        footer={
          <div className="flex items-center justify-center gap-3">
            {picks.map(({ id, pick, label, available }) =>
              "action" in pick ? (
                <BannerButton
                  key={id}
                  primary={pick.action === "seekBook"}
                  disabled={confirming !== null || !available}
                  testid={
                    pick.action === "seekBook"
                      ? TESTIDS.actionButton("seek-book")
                      : T.heroPickDecline
                  }
                  onClick={() => onCommand({ type: "resolveHeroPick", ...pick })}
                >
                  {label}
                </BannerButton>
              ) : null,
            )}
          </div>
        }
      >
        {!picks.some(({ pick }) => "index" in pick) && (
          <p className="m-0 py-2 text-center">本次无可招名将</p>
        )}
        <div className="flex justify-center gap-5">
          {picks.map(({ id, pick, available }) => {
            if (!("index" in pick)) return null;
            const { index } = pick;
            const hero = offered[index];
            if (hero == null) throw new Error(`招贤选项 ${id} 缺少名将候选 ${index}`);
            const skip = chipSkip;
            chipSkip += hero.skillIds.length;
            return (
              // 位点类 relative:confirming 钤印 span 的锚位根(#850);壳单源 #1188
              <SelectableFaceButton
                key={id}
                data-testid={T.heroPickOption(index)}
                disabled={confirming !== null || !available}
                onClick={(e) => preview(e, index, hero)}
                style={{ ["--chip-skip" as string]: String(skip) }}
                className="relative"
              >
                <HeroCardFace heroId={hero.id} skillIds={hero.skillIds} size="pick" />
                {confirming === index && (
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
              </SelectableFaceButton>
            );
          })}
        </div>
      </BannerShell>
      <SkillGlossaryDialog
        target={glossary?.target ?? null}
        onPick={canConfirm && glossary != null ? () => confirmPick(glossary.index) : undefined}
        onClose={() => setGlossary(null)}
      />
    </>
  );
}

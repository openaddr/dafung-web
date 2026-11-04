// 机遇签(#1072 T3,spec #1069 决议⑤):ENCOUNTERS 全量 30 条按档三组陈列
// (好运/中性/霉运,组头=档位名+档位点,计数如实报数、随目录数据走),卡墙=
// EncounterCardFace 新绘机遇笺;点卡开 PileShell 详情叠层(screens 层内复用,
// #1069 归位口径):壳题名=机遇名、正文全文+choices 选项文案,每选项 text+
// 代价注(repDelta/staminaDelta/treasureCost)——正负带符号,正值青绿
// (--color-money)/负值朱砂(--color-danger),零值不注。
// 即时条(无 choices)注体力代价(#1072 主线拍板 Q1):机读 effect.staminaDelta,
// 与 choices 注同形制(统一原则);cash delta 不注(text 已载,注了重复)。
// 壳朱印章恒「遇」(PileShell .pile-seal 恒朱砂,器物身份);档位章在详情体头
// 以档位色另绘(笺面档位语言带入详情)。数据单源 core/encounters.ts,零复制。
import { useState } from "react";
import type { EncounterChoiceOption, EncounterDef, EncounterTier } from "@core/encounters";
import { ENCOUNTERS } from "@core/encounters";
import { PileShell } from "@app/screens/game/PileModal";
import { MANUAL_TID } from "./testids";
import { ENCOUNTER_TIER_FACE, EncounterCardFace } from "./EncounterCardFace";

const TIERS: readonly EncounterTier[] = ["好运", "中性", "霉运"];

/** 代价注(带符号上色):正值青绿/负值朱砂;减号用 −(U+2212,随目录文案同形)。 */
function SignedNote({ label, delta }: { label: string; delta: number }) {
  return (
    <span style={{ color: delta > 0 ? "var(--color-money)" : "var(--color-danger)" }}>
      {label} {delta > 0 ? "+" : "−"}
      {Math.abs(delta)}
    </span>
  );
}

/** 抉择选项行:选项文案全文 + 代价注(声望/体力/珍宝,零值与缺省不注)。 */
function ChoiceRow({ choice }: { choice: EncounterChoiceOption }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-[3px] bg-[color-mix(in_srgb,var(--color-paper-hi)_55%,transparent)] px-2.5 py-2">
      <span className="font-wenkai text-[13px] leading-[1.7] text-paper">{choice.text}</span>
      <span className="flex flex-none basis-[auto] items-baseline gap-2.5 text-[12px] font-medium [font-variant-numeric:tabular-nums]">
        {choice.repDelta !== 0 && <SignedNote label="声望" delta={choice.repDelta} />}
        {choice.staminaDelta != null && choice.staminaDelta !== 0 && (
          <SignedNote label="体力" delta={choice.staminaDelta} />
        )}
        {choice.treasureCost != null && <SignedNote label="珍宝" delta={-choice.treasureCost} />}
      </span>
    </div>
  );
}

/** 详情叠层:PileShell 壳(题名=机遇名);体=档位章+档名+标签行、正文全文、
 *  抉择选项(如有,含单选项抉择)。 */
function EncounterDetail({ def, onClose }: { def: EncounterDef; onClose: () => void }) {
  const tier = ENCOUNTER_TIER_FACE[def.tier];
  return (
    <PileShell
      title={def.id}
      seal="遇"
      sub={`${def.tier} · ${def.tags.map((t) => `「${t}」`).join("")}`}
      testid={MANUAL_TID.detail(def.id)}
      onClose={onClose}
    >
      <div className="mx-auto flex w-[min(620px,92%)] flex-col gap-3 pb-3">
        <div className="flex items-center gap-2.5">
          {/* 档位章(笺面语言带入详情):档位色深底小方章 + 档名 */}
          <span
            aria-hidden="true"
            className="inline-grid h-[22px] w-[22px] rotate-[2.5deg] place-items-center rounded-[3px] font-title text-[13px] text-paper"
            style={{
              background: `color-mix(in srgb, ${tier.fam} 62%, var(--color-bg-deep))`,
            }}
          >
            {tier.seal}
          </span>
          <span className="font-brush text-[16px] tracking-[0.15em] text-paper">{def.tier}</span>
        </div>
        <p className="font-wenkai text-[14px] leading-[1.9] [font-variant-numeric:tabular-nums] text-paper">
          {def.text}
        </p>
        {def.choices != null ? (
          <div className="flex flex-col gap-2 border-t border-dashed border-gold/30 pt-3">
            {def.choices.map((c) => (
              <ChoiceRow key={c.text} choice={c} />
            ))}
          </div>
        ) : (
          /* 即时条(无 choices):体力代价注(Q1 拍板),同 choices 注形制;cash 不注 */
          def.effect != null &&
          def.effect.staminaDelta != null &&
          def.effect.staminaDelta !== 0 && (
            <div className="flex items-baseline justify-end border-t border-dashed border-gold/30 pt-3 text-[12px] font-medium [font-variant-numeric:tabular-nums]">
              <SignedNote label="体力" delta={def.effect.staminaDelta} />
            </div>
          )
        )}
      </div>
    </PileShell>
  );
}

/** 机遇签:按档三组陈列(组头=档位名),卡墙点卡开详情。 */
export default function ManualEncountersTab() {
  // 开着的机遇(持目录条目引用;catalog 稳定,无按 id 回查一跳)
  const [open, setOpen] = useState<EncounterDef | null>(null);
  return (
    <>
      {TIERS.map((tier) => {
        const list = ENCOUNTERS.filter((e) => e.tier === tier);
        const face = ENCOUNTER_TIER_FACE[tier];
        return (
          <section key={tier}>
            {/* 组头:档位点(色变即档,§4.6)+档位名+如实计数 */}
            <div className="flex items-baseline gap-2 px-1">
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] flex-none self-center rounded-full"
                style={{ background: face.fam }}
              />
              <span className="font-brush text-[17px] tracking-[0.18em] text-paper">{tier}</span>
              <span className="text-[12px] text-paper-dim">· {list.length} 条</span>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-4">
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-label={`机遇 ${e.id}`}
                  onClick={() => setOpen(e)}
                  className="cursor-pointer border-none bg-transparent p-0 transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:-translate-y-0.5"
                >
                  <EncounterCardFace encounter={e} data-testid={MANUAL_TID.card(e.id)} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {open != null && <EncounterDetail def={open} onClose={() => setOpen(null)} />}
    </>
  );
}

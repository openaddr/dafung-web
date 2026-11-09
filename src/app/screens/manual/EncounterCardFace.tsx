// 组件收口:器物豁免(永久)——机遇笺,纯展示零内部状态,复用 jinnang-card.css 笺语言,档位色经 --fam 单通道注 token;开合语义归消费方 ManualEncountersTab(细则 docs/design/组件收口.md)
// 机遇笺(#1072 T3,spec #1069 决议⑤):手册机遇签的新绘视觉单元——五类内容里
// 唯一的新器物。3:4 竖笺形制复用 jinnang-card.css 的笺语言(类名复用,该 css 零改动):
// 笺头(.tou/.jie/.ming)=机遇名、右上档位章(.zhang/.seal)=好运青绿/中性黛青/
// 霉运朱砂、画心(.yang)=档位气象墨线、笺脚(.jiao)=正文两行截断(既有 clamp 形制)。
//
// 档位色单通道:根上以 --fam 注入档位 token(色值单源 core/theme.ts 经 gen:theme 的
// --color-*,零硬编码 hex),界格线(.jie)与画心描边(.yang svg 既有规则)自动随色;
// 章底沿用 .seal 的深底 color-mix 配方、唯把 --color-danger 换 --fam(css 的 .seal
// 恒朱砂不可改,故经内联覆写——档位语义优先于「章恒朱砂」,spec #1069 拍板口径)。
// 画心母题 = 档位气象三绘(好运·旭日祥云 / 中性·平云舒卷 / 霉运·密云骤雨):
// 矢量 path 自绘零位图、零常驻动画,笔触语汇随 ink-art/jinnang-huaxin(主笔粗/
// 飞白细宽窄对、低透衬景),viewBox 同 0 0 100 70。
// 器物豁免类(DESIGN §4.5 同口径):纯展示、零内部状态、不套 shadcn;testid 契约
// (MANUAL_TID.card)由消费方经 ...rest 挂在根元素上,本组件不持有 testid。
import type { HTMLAttributes, ReactNode } from "react";
import type { EncounterDef, EncounterTier } from "@core/encounters";
import "@app/components/card/jinnang-card.css";

/** 档位 → 笺面档:--fam 供给界格线/画心描边/章底三处(单通道),章字取档位首字
 *  (全档名由组头与详情承载,章面单字随印制式)。 */
export const ENCOUNTER_TIER_FACE: Record<EncounterTier, { fam: string; seal: string }> = {
  好运: { fam: "var(--color-money)", seal: "好" }, // 青绿
  中性: { fam: "var(--color-seal-qing)", seal: "中" }, // 黛青
  霉运: { fam: "var(--color-danger)", seal: "霉" }, // 朱砂
};

/** 档位气象三绘(机遇笺画心):好运·旭日祥云(日升云开)/ 中性·平云舒卷
 *  (无日无雨,一片平云)/ 霉运·密云骤雨(云沉雨斜)。描边色/线宽基调由
 *  jinnang-card.css 的 .yang svg 规则供给(--fam 档位 token),path 上只做宽窄变化。 */
const TIER_INK: Record<EncounterTier, ReactNode> = {
  好运: (
    <>
      <g opacity={0.11}>
        <path d="M2 64 Q18 59 34 62 Q50 58 66 61 Q82 58 98 62" strokeWidth={1.2} />
        <path d="M6 68 Q30 65 54 67 Q78 69 98 66" strokeWidth={1.0} />
      </g>
      <circle cx={70} cy={20} r={11} strokeWidth={3.2} />
      <path d="M52 12 L46 8" strokeWidth={2} />
      <path d="M87 12 L92 8" strokeWidth={2} />
      <path d="M88 28 L93 32" strokeWidth={2} />
      <path
        d="M13 52 C9 42 19 36 28 39 C30 29 44 25 52 32 C58 24 71 26 75 35 C84 35 88 46 80 51 C76 53 72 54 69 53"
        strokeWidth={3.2}
      />
      <path d="M29 46 C27 40 36 37 38 43 C39 47 34 50 31 47" strokeWidth={1.9} />
      <path d="M31 60 C43 55 55 62 69 57" strokeWidth={1.9} />
    </>
  ),
  中性: (
    <>
      <g opacity={0.11}>
        <path d="M4 60 Q28 56 52 59 Q76 62 96 58" strokeWidth={1.2} />
      </g>
      <path
        d="M17 42 C13 33 23 27 32 30 C35 21 48 18 55 25 C62 19 74 22 77 30 C85 31 88 40 81 44 C76 46 71 46 68 45"
        strokeWidth={3.2}
      />
      <path d="M33 36 C31 30 40 28 42 34 C43 38 38 40 35 38" strokeWidth={1.9} />
      <path d="M22 56 Q48 61 76 55" strokeWidth={2.4} />
      <path d="M34 64 Q54 67 72 63" strokeWidth={1.4} />
    </>
  ),
  霉运: (
    <>
      <g opacity={0.12}>
        <path d="M10 66 Q50 69 90 65" strokeWidth={1.1} />
      </g>
      <path
        d="M19 26 C15 18 25 12 33 16 C36 8 49 5 56 12 C62 6 73 9 76 17 C84 18 87 26 81 30 C77 32 72 32 69 31"
        strokeWidth={3.2}
      />
      <path d="M35 20 C33 14 42 12 44 18 C45 22 40 24 37 22" strokeWidth={1.9} />
      <path d="M26 42 L21 58" strokeWidth={2.1} />
      <path d="M42 46 L37 62" strokeWidth={1.7} />
      <path d="M58 44 L53 60" strokeWidth={2.1} />
      <path d="M74 40 L69 56" strokeWidth={1.7} />
      <path d="M86 48 L82 60" strokeWidth={1.4} />
      <path d="M33 50 L29 63" strokeWidth={1.3} />
      <path d="M66 52 L62 65" strokeWidth={1.3} />
    </>
  ),
};

interface EncounterCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  encounter: EncounterDef;
}

/** 机遇笺:笺头(界格线+机遇名,≥4 字降档)/ 档位章(右上,档位色深底)/
 *  画心(档位气象墨线)/ 笺脚(正文两行截断,.jiao 既有形制)。 */
export function EncounterCardFace({
  encounter,
  className,
  children,
  ...rest
}: EncounterCardFaceProps) {
  const tier = ENCOUNTER_TIER_FACE[encounter.tier];
  return (
    <div
      className={["jinnang-card", className ?? ""].filter(Boolean).join(" ")}
      style={{ ["--fam" as string]: tier.fam }}
      {...rest}
    >
      <div className="tou">
        <span className="jie" />
        {/* 机遇名 = 目录 id(中文自带因果);≥4 字降档防溢出(原型 .ming.long) */}
        <span className={encounter.id.length > 3 ? "ming long" : "ming"}>{encounter.id}</span>
      </div>
      {/* 档位章:章面字随档,章底换档位色深底(.seal 恒朱砂的覆写,见文件头) */}
      <div className="zhang">
        <span
          className="seal"
          style={{
            background: "color-mix(in srgb, var(--fam) 62%, var(--color-bg-deep))",
          }}
        >
          {tier.seal}
        </span>
      </div>
      <div className="yang">
        <svg viewBox="0 0 100 70" aria-hidden="true">
          {TIER_INK[encounter.tier]}
        </svg>
      </div>
      <div className="jiao">{encounter.text}</div>
      {children}
    </div>
  );
}

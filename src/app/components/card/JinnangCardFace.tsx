// 锦囊牌面组件(#236 一期 T1):牌面 JinnangCardFace / 牌背 JinnangCardBack /
// 详情内容面板 JinnangCardDetail。规格见 docs/design/锦囊牌UI优化方案.md §4 P0-A。
//
// 器物豁免类(方案 §5,同棋盘 Tile 口径):牌面本体自绘 SVG/HTML,纯展示、零内部
// 状态、不套 shadcn;交互语义(选中/确认/详情弹层壳)全部归消费方。testid 契约
// (jinnang-card-* 等)由消费方经 ...rest 挂在根元素上,本组件不持有 testid。
//
// 尺寸 em 制:根 font-size 即 em 基,两档见 jinnang-face-data.ts 尺寸表
// (standard 8px→120×160 / large 16px→240×320,样式在 jinnang-card.css);
// 消费方可再传 style={{ fontSize }} 在两档之间微调降档(Android 短横屏 ~96×128 = 6.4px 基)。
//
// frameTone 是二期珍宝变体预留的品级框色通道(方案 §4「同形框,异色=品级」),
// 一期消费方不传(默认 none=基线墨框)。
import type { HTMLAttributes, ReactNode } from "react";
import { jinnangCardOf } from "@core/jinnang";
import {
  jinnangAliasSplit,
  JINNANG_FAMILY,
  JINNANG_TARGET_LABEL,
  treasureFrameTone,
  type FrameTone,
  type JinnangPattern,
  type JinnangFaceSize,
} from "./jinnang-face-data";
import "./jinnang-card.css";

/** 标签 → 族色类已收口进 jinnang-face-data.ts 的 JINNANG_FAMILY.faceClass
 *  (组件不再自备第二份映射——评审 Standards 轴的三重镜像收敛)。 */

/** 四族纹样线稿:path 自 tmp/prototype-jinnang-ui.html 原样移植(viewBox 0 0 100 70),
 *  stroke 色/线宽在 jinnang-card.css 按 .f-* 族类与尺寸档给。 */
const PATTERN_PATHS: Record<JinnangPattern, ReactNode> = {
  cloud: (
    <>
      <path d="M14 52 q6-16 22-12 q4-14 20-10 q16-4 22 10 q12 2 10 12" />
      <path d="M30 40 a9 9 0 1 1 9 9 M52 30 a7 7 0 1 0-7 7" />
      <path d="M22 58 q14 6 28 0 q14-6 28 0" />
    </>
  ),
  fire: (
    <>
      <path d="M50 8 c-4 12 6 16 2 26 c12-6 10-14 20-16 c-4 10 8 16 4 28 c8-4 8-10 12-12" />
      <path d="M28 62 c-6-12 4-18 4-30 c8 8 6 16 12 22 c0-8 6-12 10-14 c-2 10 6 14 4 24" />
      <path d="M18 64 q32 8 64 0" />
    </>
  ),
  shield: (
    <>
      <path d="M50 6 L84 16 V38 c0 16-15 24-34 30 C31 62 16 54 16 38 V16 Z" />
      <path d="M36 30 h20 v18 h-14 v-10 h8" />
      <path d="M50 6 v-2 M16 16 l-3-3 M84 16 l3-3" />
    </>
  ),
  branch: (
    <>
      <path d="M10 60 C30 48 44 40 62 20 M62 20 q10-8 24-8" />
      <path d="M34 44 q-2-10 6-14 M46 36 q0-10 8-12 M54 28 q2-8 10-10" />
      <path d="M28 50 q-8 2-12 8" />
    </>
  ),
  // 电纹(#281 即时族):主形闪电 + 两道疾风短线——反应窗一闪即发
  bolt: (
    <>
      <path d="M54 4 L28 38 L44 38 L34 66 L74 26 L54 26 Z" />
      <path d="M12 22 h14 M74 50 h14" />
    </>
  ),
};

export interface JinnangCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  cardId: string;
  size?: JinnangFaceSize;
  frameTone?: FrameTone;
}

/** 锦囊牌面:笺头(界格线+牌名)/ 标签章(右上竖排)/ 纹样窗 / 笺脚(别称已剥离,
 *  2 行截断;large 4 行)。children 透传到牌面末尾——不可用态的原因印条
 *  (<span className="reason">,样式见 jinnang-card.css)由消费方这样挂入。 */
export function JinnangCardFace({
  cardId,
  size = "standard",
  frameTone = "none",
  className,
  children,
  ...rest
}: JinnangCardFaceProps) {
  const def = jinnangCardOf(cardId); // 未知 id 引擎抛错(目录外牌不允许存在),不兜底
  const fam = JINNANG_FAMILY[def.tags[0]];
  const classes = [
    "jinnang-card",
    fam.faceClass,
    frameTone !== "none" ? `tone-${frameTone}` : "",
    size === "large" ? "lg" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      <div className="tou">
        <span className="jie" />
        {/* 牌名 = 目录 id(中文自带因果);≥4 字降档防溢出(原型 .ming.long) */}
        <span className={def.id.length > 3 ? "ming long" : "ming"}>{def.id}</span>
      </div>
      <div className="zhang">
        {def.tags.map((t) => (
          <span key={t} className="seal">
            {JINNANG_FAMILY[t].label}
          </span>
        ))}
      </div>
      <div className="yang">
        <svg viewBox="0 0 100 70" aria-hidden="true">
          {PATTERN_PATHS[fam.pattern]}
        </svg>
      </div>
      <div className="jiao">{jinnangAliasSplit(def.text).body}</div>
      {children}
    </div>
  );
}

/** 珍宝牌面(#234 变体,#281 落地,#359 装裱升级):「名家鉴藏」装裱形制
 *  (视觉基准 proto/treasure/r5.html 节二,语言源第三轮 backpack.html)——
 *  绫边(程序化斜纹)/四角包角/画心(距条随品级)/题签(竖排承牌名)/
 *  鉴藏印(朱砂,右下)/跋文 六件套;品级大字退役,品级=画心距条+右上品级角标
 *  (菱形小底+数字,底色随品级)双通道。画心双通道:art 传入 ReactNode 即渲染
 *  (容器裁剪),缺省=远山肌理回退(程序化 SVG)。宝章恒朱砂(DESIGN §4.5
 *  「章恒朱砂」);数据单源 core/treasures.ts(TreasureDef),本组件不复制目录;
 *  消费方(手牌架珍宝明细行)经 title 自带指导价浮签。 */
export interface TreasureCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  /** 品级 1..10(core/treasures.ts TreasureDef.level);越界=数据 bug 显式抛错(零兜底)。 */
  level: number;
  desc?: string;
  /** 画心配图通道(#359):传入节点即渲染,容器裁剪;缺省=远山肌理回退。 */
  art?: ReactNode;
}

/** 画心缺省回退·远山线稿:path 自 proto/treasure/backpack.html 原样移植
 *  (viewBox 0 0 100 26,stroke 色/线宽在 jinnang-card.css 按 .shan 给)。 */
const SHAN_PATHS = (
  <>
    <path d="M4 22 Q18 8 32 18 Q40 12 50 18" />
    <path d="M52 20 Q64 10 76 18 Q84 14 96 20" />
    <path d="M8 24 q20 3 42 0 q22 -3 42 0" />
  </>
);

export function TreasureCardFace({
  name,
  level,
  desc,
  art,
  className,
  children,
  ...rest
}: TreasureCardFaceProps) {
  if (level < 1 || level > 10) {
    throw new Error(`珍宝等级 ${level} 超出 1..10(treasures 数据 bug)`);
  }
  const classes = ["jinnang-card", "mount", `tone-${treasureFrameTone(level)}`, className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      <span className="ling" aria-hidden="true" />
      {/* 包角四枚(被画心 inset 1.5em 裁于绫边区,不入画心) */}
      <span className="bj a" aria-hidden="true" />
      <span className="bj b" aria-hidden="true" />
      <span className="bj c" aria-hidden="true" />
      <span className="bj d" aria-hidden="true" />
      <div className="huaxin">
        {art == null ? (
          <span className="shan" aria-hidden="true">
            <svg viewBox="0 0 100 26" aria-hidden="true">
              {SHAN_PATHS}
            </svg>
          </span>
        ) : (
          <div className="art">{art}</div>
        )}
        <div className="ba">{desc}</div>
      </div>
      <span className="lv-badge">
        <i>{level}</i>
      </span>
      {/* 题签:牌名唯一承载体(珍=鉴藏类小字,朱砂) */}
      <span className="qian">
        <span className="ling-zi">珍</span>
        <span className={name.length > 3 ? "qian-ming long" : "qian-ming"}>{name}</span>
      </span>
      <span className="jian-yin">
        <span className="seal">宝</span>
      </span>
      {children}
    </div>
  );
}

export interface JinnangCardBackProps extends HTMLAttributes<HTMLDivElement> {
  size?: JinnangFaceSize;
}

/** 牌背(暗置语义):漆木底 + 「锦囊」朱印 + 回纹双环。空手牌斜放占位、暗牌
 *  展示等场景复用;斜放由消费方经 style.transform 自定。 */
export function JinnangCardBack({
  size = "standard",
  className,
  children,
  ...rest
}: JinnangCardBackProps) {
  return (
    <div
      className={["jinnang-card", "back", size === "large" ? "lg" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span className="yin-s">
        <span>锦</span>
        <span>囊</span>
      </span>
      {children}
    </div>
  );
}

export interface JinnangCardDetailProps {
  cardId: string;
  className?: string;
}

/** 详情内容面板(非弹层,弹层壳归消费方)五段:牌名 / 标签章横排+目标域+牌库数 /
 *  全文(def.text 原文,含别称前缀)/ 虚线分隔 / 脚注(每回合每类限用一张+标签序列)。 */
export function JinnangCardDetail({ cardId, className }: JinnangCardDetailProps) {
  const def = jinnangCardOf(cardId);
  return (
    <div className={["jinnang-detail", className ?? ""].filter(Boolean).join(" ")}>
      <div className="dt-ming">{def.id}</div>
      <div className="dt-row">
        {def.tags.map((t) => (
          <span key={t} className="seal">
            {JINNANG_FAMILY[t].label}
          </span>
        ))}
        <span className="dt-meta">
          {JINNANG_TARGET_LABEL[def.targetDomain]} · 牌库 {def.copies} 张
        </span>
      </div>
      <p className="dt-text">{def.text}</p>
      <div className="dt-foot">每回合每类限用一张 ·{def.tags.map((t) => `「${t}」`).join("")}</div>
    </div>
  );
}

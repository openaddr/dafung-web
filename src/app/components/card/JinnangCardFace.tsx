// 锦囊牌面组件(#236 一期 T1):牌面 JinnangCardFace / 牌背 JinnangCardBack /
// 详情内容面板 JinnangCardDetail。规格见 docs/design/DESIGN.md §4.5(竖笺牌面正典)。
//
// 器物豁免类(同棋盘 Tile 口径):牌面本体自绘 SVG/HTML,纯展示、零内部
// 状态、不套 shadcn;交互语义(选中/确认/详情弹层壳)全部归消费方。testid 契约
// (jinnang-card-* 等)由消费方经 ...rest 挂在根元素上,本组件不持有 testid。
//
// 尺寸 em 制:根 font-size 即 em 基,两档见 jinnang-face-data.ts 尺寸表
// (standard 8px→120×160 / large 16px→240×320,样式在 jinnang-card.css);
// 消费方可再传 style={{ fontSize }} 在两档之间微调降档(Android 短横屏 ~96×128 = 6.4px 基)。
//
// frameTone 是二期珍宝变体预留的品级框色通道(DESIGN §4.5「品级框色」),
// 一期消费方不传(默认 none=基线墨框)。
import type { HTMLAttributes, ReactElement } from "react";
import { jinnangCardOf } from "@core/jinnang";
import {
  jinnangAliasSplit,
  JINNANG_FAMILY,
  JINNANG_TARGET_LABEL,
  treasureFrameTone,
  type FrameTone,
  type JinnangFaceSize,
} from "./jinnang-face-data";
import { JINNANG_INK_ART } from "./ink-art/jinnang-huaxin";
import { JINNANG_STORY_ART } from "./jinnang-art";
import "./jinnang-card.css";

/** 牌面和详情按同一目录 id 取画心，画框裁切由各处样式负责。 */
function JinnangArt({ cardId }: { cardId: string }) {
  const story = JINNANG_STORY_ART.get(cardId);
  if (story) {
    return <img className="jinnang-story-art" src={story.src} alt={story.alt} draggable={false} />;
  }
  const ink = JINNANG_INK_ART.get(cardId);
  if (!ink) throw new Error(`锦囊缺少画心:${cardId}`);
  return (
    <svg viewBox="0 0 100 70" role="img" aria-label={ink.label}>
      {ink.paths}
    </svg>
  );
}

interface JinnangCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  cardId: string;
  size?: JinnangFaceSize;
  frameTone?: FrameTone;
}

/** 锦囊牌面:笺头(界格线+牌名)/ 标签章(右上竖排)/ 金框画心 /
 *  笺脚(别称已剥离,2 行截断;large 4 行)。children 透传到牌面
 *  末尾——不可用态的原因印条(<span className="reason">,样式见 jinnang-card.css)
 *  由消费方这样挂入。 */
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
      {/* 章数注入(#841 刀③):--zhang-n 供 jinnang-card.css 次枚缩档让位
          (多章下挂不再整枚压进画心金框);单章缺省路径同值 1,零分支 */}
      <div className="zhang" style={{ ["--zhang-n" as string]: def.tags.length }}>
        {def.tags.map((t) => (
          <span key={t} className="seal">
            {JINNANG_FAMILY[t].label}
          </span>
        ))}
      </div>
      <div className="yang">
        <JinnangArt cardId={def.id} />
      </div>
      <div className="jiao">{jinnangAliasSplit(def.text).body}</div>
      {children}
    </div>
  );
}

/** 珍宝牌面(#234 变体,#281 落地,#359 装裱升级,#511 B 案改制):「名家鉴藏」装裱形制
 *  (视觉基准 proto/treasure/r5.html 节二,语言源第三轮 backpack.html)——
 *  绫边(程序化斜纹)/四角包角/画心(漆金外框+品级距条内衬,白纸画心)/题签
 *  (竖排承牌名,白纸签墨字)/鉴藏印(朱砂,右下)/跋文 六件套;品级大字退役,
 *  品级=画心距条内衬+右上品级角标(菱形小底+数字,底色随品级)双通道。
 *  宝章恒朱砂。各陈列位共用珍宝画心，指导价由调用方呈现。 */
interface TreasureCardFaceProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  /** 品级 1..10(core/treasures.ts TreasureDef.level);越界=数据 bug 显式抛错(零兜底)。 */
  level: number;
  desc?: string;
  art: ReactElement;
}

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
        <div className="art">{art}</div>
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

interface JinnangCardBackProps extends HTMLAttributes<HTMLDivElement> {
  size?: JinnangFaceSize;
}

/** 暗牌牌背由漆木底、「锦囊」朱印和回纹双环组成，用于窥探翻牌。 */
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

interface JinnangCardDetailProps {
  cardId: string;
  className?: string;
}

/** 详情内容面板的画心与全文并列，外层弹窗仍负责滚动、触达和关闭。 */
export function JinnangCardDetail({ cardId, className }: JinnangCardDetailProps) {
  const def = jinnangCardOf(cardId);
  const fam = JINNANG_FAMILY[def.tags[0]];
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
      <div className="dt-body">
        <div className="dt-art" style={{ ["--fam" as string]: `var(${fam.token})` }}>
          <JinnangArt cardId={def.id} />
        </div>
        <p className="dt-text">{def.text}</p>
      </div>
    </div>
  );
}

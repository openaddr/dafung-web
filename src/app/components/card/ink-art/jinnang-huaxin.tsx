// 锦囊牌画心·自绘墨线(#763):按牌族母题的极简墨线 SVG path——毛笔笔触感
// (圆头笔锋、主笔粗/飞白细的宽窄对、不对称取势),全部吃族色描边通道:
// 描边色/线宽基调由 jinnang-card.css 的 .yang svg 规则供给(--fam 族 token),
// path 上只做族内的宽窄变化(strokeWidth 覆盖继承值,随 viewBox 缩放)。
// 取材纪要(#763):comigo fantasy-icons-ink(CC0)全包为笔触轮廓化路径,
// 最小单枚 5.5KB 超单枚 ≤4KB 预算红线,未采;本组为按票面兜底条款的自绘
// 墨线(矢量 path,零位图、零外链,总量 ~5KB)。
//
// 两条通道:
// - 族通道 JINNANG_INK_FAMILY:一标签一族母题(谋=云/攻=火/守=盾/援=枝/即时=电),
//   键 = jinnang-face-data.ts 的 JinnangPattern(单测钉值,勿改);
// - 名牌通道 JINNANG_INK_CARDS:个别名牌的专属画心母题,键 = core/jinnang.ts
//   目录 id(类型取自 JINNANG_CARDS 推导,目录外键编译期即报)。消费端先查
//   名牌通道,缺省落族通道(缺省=族母题是设计语义,非错误回退)。
// viewBox 统一 0 0 100 70(画心窗既有口径,原型 tmp/ink-proto/ 三轮眼验定稿)。
import type { ReactNode } from "react";
import { JINNANG_CARDS } from "@core/jinnang";
import type { JinnangPattern } from "../jinnang-face-data";

/** 目录牌 id 联合类型(core/jinnang.ts JINNANG_CARDS 推导,新增牌自动入型)。 */
export type JinnangCardId = (typeof JINNANG_CARDS)[number]["id"];

/** 五族墨线母题(键与 JINNANG_FAMILY.pattern 一一对应)。 */
export const JINNANG_INK_FAMILY: Record<JinnangPattern, ReactNode> = {
  // 谋·云:祥云主笔 + 云头回卷 + 底部飞白横抹
  cloud: (
    <>
      <path
        d="M16 46 C12 34 24 28 34 31 C36 20 50 16 58 23 C64 14 78 16 82 26 C92 26 95 38 87 44 C84 46 80 47 77 46"
        strokeWidth={2.6}
      />
      <path d="M32 40 C30 33 40 31 42 37 C43 41 38 44 35 41" strokeWidth={1.6} />
      <path d="M34 56 C46 51 58 58 72 53 C79 50 85 53 88 56" strokeWidth={1.5} />
    </>
  ),
  // 攻·火:主火舌侧卷 + 内焰 + 底部余烬横线
  fire: (
    <>
      <path
        d="M50 8 C44 18 56 22 52 32 C62 26 62 16 72 12 C68 24 80 32 74 44 C70 54 60 60 48 60 C34 60 26 50 28 40 C29 32 34 28 36 20 C40 26 46 26 46 20 C46 15 48 11 50 8"
        strokeWidth={2.6}
      />
      <path d="M50 58 C44 52 44 45 50 39 C56 45 56 52 50 58" strokeWidth={1.6} />
      <path d="M32 64 Q50 68 68 64" strokeWidth={1.5} />
    </>
  ),
  // 守·盾:盾形外廓 + 内衬回线(甲片缘)
  shield: (
    <>
      <path d="M50 6 L82 15 V36 C82 52 66 61 50 66 C34 61 18 52 18 36 V15 Z" strokeWidth={2.8} />
      <path d="M50 13 L77 21 V36 C77 48 64 55 50 61 C36 55 23 48 23 36 V21 Z" strokeWidth={1.3} />
    </>
  ),
  // 援·枝:斜出梅枝(主笔渐细)+ 双歧 + 枝顶梅朵 + 梅蕊点睛
  branch: (
    <>
      <path d="M10 62 C28 56 44 46 58 28 C63 22 67 14 69 7" strokeWidth={3} />
      <path d="M34 50 C40 46 46 40 48 32" strokeWidth={1.7} />
      <path d="M52 34 C58 30 64 30 70 33" strokeWidth={1.7} />
      <circle cx={75} cy={5.5} r={2.2} strokeWidth={1.3} />
      <circle cx={79.3} cy={8.5} r={2.2} strokeWidth={1.3} />
      <circle cx={77.7} cy={13.5} r={2.2} strokeWidth={1.3} />
      <circle cx={72.3} cy={13.5} r={2.2} strokeWidth={1.3} />
      <circle cx={70.7} cy={8.5} r={2.2} strokeWidth={1.3} />
      <circle cx={75} cy={9.5} r={1.1} style={{ fill: "var(--fam)" }} stroke="none" />
      <circle cx={52} cy={28} r={2.2} strokeWidth={1.5} />
    </>
  ),
  // 即时·电:闪电主形(锐角折笔)+ 两道疾风短线——反应窗一闪即发(#281)
  bolt: (
    <>
      <path d="M58 4 L29 39 L46 40 L34 66 L75 25 L55 24 Z" strokeWidth={2.4} />
      <path d="M8 20 H20" strokeWidth={2} />
      <path d="M80 50 H92" strokeWidth={2} />
    </>
  ),
};

/** 个别名牌专属画心(族母题语义跑偏时才立此项;键=目录牌 id)。 */
export const JINNANG_INK_CARDS: Partial<Record<JinnangCardId, ReactNode>> = {
  // 军情密探(谋族):细作出探=一只睁开的眼睛(瞳仁点睛)
  // 军情密探(谋族):细作出探=一只睁开的眼睛(瞳仁点睛)
  军情密探: (
    <>
      <path d="M10 36 C24 18 76 18 90 36 C76 54 24 54 10 36 Z" strokeWidth={2.6} />
      <circle cx={50} cy={36} r={12} strokeWidth={2.2} />
      <circle cx={50} cy={36} r={4.5} style={{ fill: "var(--fam)" }} stroke="none" />
      <path d="M38 13 L42 19 M62 13 L58 19" strokeWidth={1.5} />
    </>
  ),
  // 横征暴敛(攻族):强征贡赋=大小铜钱各一(圆钱方孔,重迭相累)
  横征暴敛: (
    <>
      <circle cx={44} cy={28} r={20} strokeWidth={2.8} />
      <path d="M38 22 H50 V34 H38 Z" strokeWidth={1.7} />
      <circle cx={68} cy={46} r={13} strokeWidth={2.2} />
      <path d="M63 41 H73 V51 H63 Z" strokeWidth={1.4} />
    </>
  ),
  // 求贤令(援族):张榜求贤=榜文卷轴(天杆地杆+正文两行+钤印一方)
  求贤令: (
    <>
      <path d="M22 12 H78" strokeWidth={2.8} />
      <circle cx={22} cy={12} r={3} strokeWidth={1.6} />
      <circle cx={78} cy={12} r={3} strokeWidth={1.6} />
      <path d="M30 17 V53 M70 17 V53" strokeWidth={1.8} />
      <path d="M30 53 Q50 59 70 53" strokeWidth={1.8} />
      <path d="M38 26 H62 M38 34 H62" strokeWidth={1.5} />
      <rect x={46} y={41} width={9} height={9} rx={1} strokeWidth={1.5} />
    </>
  ),
};

/** 画心取数(JinnangCardFace 消费):名牌通道优先,缺省落族母题(设计缺省,
 *  非错误回退——目录外 id 在组件入口 jinnangCardOf 已抛错,不会走到这)。 */
export function jinnangInkArtOf(cardId: string, pattern: JinnangPattern): ReactNode {
  const specific = (JINNANG_INK_CARDS as Partial<Record<string, ReactNode>>)[cardId];
  return specific ?? JINNANG_INK_FAMILY[pattern];
}

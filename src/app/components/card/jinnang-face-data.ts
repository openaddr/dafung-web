// 锦囊牌面纯数据/纯函数(#236 一期 T1):零 DOM 零 React,单测直测。
// 牌面文案与效果的单源是 core/jinnang.ts(组件经 jinnangCardOf 取数,不复制文案);
// 本文件只持有「牌面怎么画」的映射——别称剥离、四族色、目标域中文、尺寸档,
// 消费方:JinnangCardFace.tsx(同目录)与 jinnang-card.css(族色类/尺寸档为镜像)。
import type { JinnangTag, JinnangTargetDomain } from "@core/jinnang";

/** 纹样族:一标签一族(方案 §4 P0-A)——谋=云纹 / 攻=火纹 / 守=盾纹 / 援=枝纹 /
 *  即时=电纹(#281 反应锦囊:电光石火,反应窗一闪即发)。 */
export type JinnangPattern = "cloud" | "fire" | "shield" | "branch" | "bolt";

/** 牌面尺寸档:em 基准 font-size(standard 8px→120×160 / large 16px→240×320)。
 *  数值唯一事实源是 jinnang-card.css 的档类(.jinnang-card / .jinnang-card.lg,
 *  单测读 CSS 钉镜像);消费方还可以再传 style.fontSize 在两档之间微调降档
 *  (Android 短横屏 ~96×128 = 6.4px 基)。 */
export type JinnangFaceSize = "standard" | "large";

/**
 * 剥离 text 的计法别称前缀:按第一个全角冒号「:」切分——冒号前是四字计名别称
 * (如「二虎竞食」),后是效果正文。牌面笺脚只渲染 body(2026-09-24 原型评审定:
 * 牌名+别称双层命名在 120×160 上既挤又惑),别称随全文进详情(detail 渲染 def.text 原文)。
 * 无冒号时 alias=null、body=全文。
 */
export function jinnangAliasSplit(text: string): { alias: string | null; body: string } {
  const i = text.indexOf(":");
  if (i < 0) return { alias: null, body: text };
  return { alias: text.slice(0, i), body: text.slice(i + 1) };
}

/** 五族映射:族色 token、纹样、章字、CSS 族色类(jinnang-card.css 的 .f-* ——组件不再
 *  自备第二份映射,单测钉 CSS 镜像)。牌面族色 = tags[0]
 *  (谋=云纹·黛青 / 攻=火纹·朱砂 / 守=盾纹·赭石 / 援=枝纹·青绿 / 即时=电纹·靛青)。 */
export const JINNANG_FAMILY: Record<
  JinnangTag,
  { token: string; pattern: JinnangPattern; label: string; faceClass: string }
> = {
  谋: { token: "--color-seal-qing", pattern: "cloud", label: "谋", faceClass: "f-mou" }, // 黛青
  攻: { token: "--color-danger", pattern: "fire", label: "攻", faceClass: "f-gong" }, // 朱砂
  守: { token: "--color-road-side", pattern: "shield", label: "守", faceClass: "f-shou" }, // 赭石
  援: { token: "--color-money", pattern: "branch", label: "援", faceClass: "f-yuan" }, // 青绿
  即时: { token: "--color-jishi", pattern: "bolt", label: "即时", faceClass: "f-shi" }, // 靛青(#281 反应锦囊正式族)
};

/** 目标域中文(牌面用语规范口径,与 core/jinnang.ts 文件头注释同一版)。 */
export const JINNANG_TARGET_LABEL: Record<JinnangTargetDomain, string> = {
  self: "自身",
  one: "指定一名其他诸侯",
  "two-others": "指定两名其他诸侯",
  "all-others": "其余所有诸侯",
  reaction: "反应窗打出",
};

/** 品级框色通道(frameTone,#234 珍宝牌面变体):同形装裱,异色=品级——
 *  --tone 供画心距条与品级角标底取色(CSS 消费在 jinnang-card.css 的 .tone-*)。
 *  锦囊消费方不传(none=基线墨框)。 */
export type FrameTone = "none" | "tong" | "yin" | "gold";

/** 珍宝品级 → 框色档(#281 落地):level 1–3 铜 / 4–6 银 / 7–10 金。珍宝 level 1..10
 *  由 core/treasures.ts 数据保证(组件对越界显式抛错,零兜底)。 */
export function treasureFrameTone(level: number): Exclude<FrameTone, "none"> {
  if (level <= 3) return "tong";
  if (level <= 6) return "yin";
  return "gold";
}

/** 军师幕/反应窗牌面微旋(#234 P2-E TablePile 质感):确定性伪随机 ±1.5°——同一张牌
 *  在同一位置恒同角(重渲不翻滚),幅度收敛在「人手摆上去」的一指拨动。散列用 FNV-1a
 *  (乘 31 类散列 mod 小素数会塌到末字符,正负角分布失效);prefers-reduced-motion
 *  的退场在 jinnang-card.css 兜层(JS 不感知)。 */
export function rackTilt(key: string): number {
  let h = -2128831035; // FNV-1a offset basis(2166136261 的 int32 形式)
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime
  }
  return (((h >>> 0) % 31) - 15) / 10;
}

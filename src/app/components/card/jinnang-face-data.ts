// 锦囊牌面纯数据/纯函数(#236 一期 T1):零 DOM 零 React,单测直测。
// 牌面文案与效果的单源是 core/jinnang.ts(组件经 jinnangCardOf 取数,不复制文案);
// 本文件只持有「牌面怎么画」的映射——别称剥离、四族色、目标域中文、尺寸档,
// 消费方:JinnangCardFace.tsx(同目录)与 jinnang-card.css(族色类/尺寸档为镜像)。
import type { JinnangTag, JinnangTargetDomain } from "@core/jinnang";

/** 纹样族:一标签一族(方案 §4 P0-A)——谋=云纹 / 攻=火纹 / 守=盾纹 / 援=枝纹。 */
export type JinnangPattern = "cloud" | "fire" | "shield" | "branch";

/** 牌面尺寸档:em 基准 font-size(standard 8px→120×160 / large 16px→240×320)。
 *  承接点在 jinnang-card.css 的档类(.jinnang-card / .jinnang-card.lg);消费方还
 *  可以再传 style.fontSize 在两档之间微调降档(Android 短横屏 ~96×128 = 6.4px 基)。 */
export type JinnangFaceSize = "standard" | "large";
export const JINNANG_FACE_SIZE_EM: Record<JinnangFaceSize, number> = { standard: 8, large: 16 };

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

/** 四族映射:族色 token(与原型色值逐一相等,已在 tokens.css 核对)、纹样、章字。
 *  牌面族色 = tags[0](谋=云纹·黛青 / 攻=火纹·朱砂 / 守=盾纹·赭石 / 援=枝纹·青绿)。 */
export const JINNANG_FAMILY: Record<JinnangTag, { token: string; pattern: JinnangPattern; label: string }> = {
  "谋": { token: "--color-seal-qing", pattern: "cloud", label: "谋" }, // 黛青
  "攻": { token: "--color-danger", pattern: "fire", label: "攻" }, // 朱砂
  "守": { token: "--color-road-side", pattern: "shield", label: "守" }, // 赭石
  "援": { token: "--color-money", pattern: "branch", label: "援" }, // 青绿
};

/** 目标域中文(牌面用语规范口径,与 core/jinnang.ts 文件头注释同一版)。 */
export const JINNANG_TARGET_LABEL: Record<JinnangTargetDomain, string> = {
  self: "自身",
  one: "指定一名其他诸侯",
  "two-others": "指定两名其他诸侯",
  "all-others": "其余所有诸侯",
};

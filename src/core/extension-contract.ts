// 扩展包契约(#378,ADR-0022「TS 双跑+一次搭全的骨架」):扩展 = 磁盘上的包目录
// (manifest + 编译后 JS 入口),权威侧加载做裁决、注册进引擎既有注册面。
// 本文件是包格式的**类型契约 + 接口位总登记**,不含任何运行时逻辑:
//   - 包目录布局与 manifest 语义(extensions/<包目录>/manifest.json);
//   - 权威侧贡献形状(名将/效果,注册进 heroes.ts HEROES / effects.ts EFFECTS);
//   - 第一版不实现能力的接口位清单(ADR-0022 决策 2:架子一次搭全,长位不挖坑)。
// 运行时注册面在 extension-registry.ts;bun/node 文件装载器在 extension-loader.ts;
// 浏览器装载器在 src/app/extensions/loader.ts(只做权威侧注册;客户端半边已退役,
// #1064——表现类型属 app 层,core 不 import,分层红线 1)。
//
// ── 包目录契约 ──
//   extensions/
//     <包目录>/                  目录名建议与 manifest.id 一致(不强制,装载按目录扫描)
//       manifest.json            包清单(下 ExtensionManifest;缺文件/坏 JSON = 装载炸出)
//       index.js                 权威侧入口(manifest.entry;默认导出 AuthorityContribution)
//       assets/                  静态资源(立绘图等;数据字段读站点根相对 URL,如 HeroDef.image)
//       src/                     TS 源(分发 = 编译后 JS;源码供作者维护类型/工具链)
//
// ── 接口位总登记(ADR-0022 决策 2;实现状态 2026-11-04)──
//   ✅ 技能/效果注册     core:技能进 SKILLS 表、名将进 HEROES 池、效果进 EFFECTS
//                       注册表(extension-registry;名将池按技 id 引用,ADR-0036)
//   ⚰ 动画 handler      已退役(#1064):演出归 ADR-0029 演出中心策展,扩展侧零真实消费
//   ⚰ 渲染 hook         已退役(#1064):将旗零真实消费,随客户端扩展面整体下线
//   ⚰ 交互 handler      已退役(#1065):定制问询线整线拆除,choices 通路(ADR-0013)已
//                       覆盖全部问询形制且零真实用例,问询一律走各相位注册计算器
//   ⚰ 新牌类型          已否决:结算 switch 在引擎(单一事实源),扩展只能注册数据;
//                       新牌种类一律 core 正常开发
//   ⚰ 新格子类型        已否决:#826 全城池制方向已定,非城格=重开该级决策,不设挂点
//   ⚰ 自定义面板        已否决:客户端扩展面已退役(#1064),UI 挂点无承载层
//   ⚰ 音效              已否决:音效归 ADR-0029 演出中心策展(与动画 handler 同口径)
//   ⚰ 文案              已否决:文案直接写在包代码内即终态,不设资源表挂点
//   终态:包能力 = skills + effects + heroes + 图片,新机制一律 core 正常开发。
import type { EffectFn } from "./effects";
import type { HeroDef } from "./heroes";
import type { SkillDef } from "./skills";

/** 扩展包清单(manifest.json 的解析后形状)。id 是全局唯一键(与已装包/注册冲突即炸);
 *  entry 为包根下的**平铺文件名**(不含路径分隔符——装载器按目录拼路径,子目录
 *  入口留待后续票)。 */
export interface ExtensionManifest {
  /** 包 id:全局唯一(重复装载同名包 = 数据 bug,当场炸)。 */
  id: string;
  /** 显示名(日志/诊断用,不进对局 UI)。 */
  name: string;
  /** 包版本(semver 风格字符串,契约不解析)。 */
  version: string;
  /** 权威侧入口:包根下平铺 JS 文件名(默认导出 ExtensionAuthorityContribution)。 */
  entry: string;
}

/** 权威侧贡献(包入口模块的默认导出):技能/名将/效果,经 extension-registry
 *  注册进引擎既有注册面(SKILLS 技表 / HEROES 名将池 / EFFECTS 效果注册表)。
 *  效果函数与内置效果同签名(EffectFn:纯逻辑、禁 DOM/React、经引擎公共方法改状态),信任
 *  作者、无沙箱(ADR-0022 信任模型);无随机数/时钟纪律(ADR-0021)。 */
export interface ExtensionAuthorityContribution {
  /** 追加进技能表的技能(被动+主动同表,ADR-0036;扩展名将的池可引用核心技)。 */
  skills?: SkillDef[];
  /** 追加进名将池的名将(招贤/机遇送将/快照回链全走 HEROES 单表;skillPool 声明池)。 */
  heroes?: HeroDef[];
  /** 追加进效果注册表的效果(TriggerSkill.effect 按 id 查用)。 */
  effects?: Record<string, EffectFn>;
}

/** 权威侧装载单元:manifest(来自 manifest.json)+ 贡献(来自入口模块)——
 *  extension-registry.registerExtensionAuthorityModule 的入参。 */
export interface ExtensionAuthorityModule extends ExtensionAuthorityContribution {
  manifest: ExtensionManifest;
}

/** manifest 必为非空字符串字段(装载面统一校验:缺/空/带路径分隔符 = 包数据 bug,炸出)。 */
function assertPlainFilename(value: unknown, label: string, pkgDir: string): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`扩展包 ${pkgDir}:manifest.${label} 缺失或非非空字符串(包格式 bug)`);
  if (value.includes("/") || value.includes("\\") || value.includes(".."))
    throw new Error(`扩展包 ${pkgDir}:manifest.${label} 必须是包根下平铺文件名(得「${value}」)`);
  return value;
}

/** manifest 形状校验(装载器与注册面共用单源):字段缺失/平铺名违规当场炸(零兜底)。 */
export function assertExtensionManifest(m: unknown, pkgDir: string): ExtensionManifest {
  if (m == null || typeof m !== "object" || Array.isArray(m))
    throw new Error(`扩展包 ${pkgDir}:manifest.json 不是 JSON 对象(包格式 bug)`);
  const raw = m as Record<string, unknown>;
  const id = assertPlainFilename(raw.id, "id", pkgDir);
  for (const key of ["name", "version"] as const) {
    const v = raw[key];
    if (typeof v !== "string" || v === "")
      throw new Error(`扩展包 ${pkgDir}:manifest.${key} 缺失或非非空字符串(包格式 bug)`);
  }
  const entry = assertPlainFilename(raw.entry, "entry", pkgDir);
  const manifest: ExtensionManifest = {
    id,
    name: raw.name as string,
    version: raw.version as string,
    entry,
  };
  return manifest;
}

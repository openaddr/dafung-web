// 扩展包契约(#378,ADR-0022「TS 双跑+一次搭全的骨架」):扩展 = 磁盘上的包目录
// (manifest + 编译后 JS 入口),权威侧加载做裁决、客户端动态 import 做表现。
// 本文件是包格式的**类型契约 + 接口位总登记**,不含任何运行时逻辑:
//   - 包目录布局与 manifest 语义(extensions/<包目录>/manifest.json);
//   - 权威侧贡献形状(名将/效果,注册进 heroes.ts HEROES / effects.ts EFFECTS);
//   - 第一版不实现能力的接口位清单(ADR-0022 决策 2:架子一次搭全,长位不挖坑)。
// 运行时注册面在 extension-registry.ts;bun/node 文件装载器在 extension-loader.ts;
// 浏览器装载器与客户端贡献类型在 src/app/extensions/(表现类型 PresentationEvent
// 属 app 层,core 不 import——分层红线 1)。
//
// ── 包目录契约 ──
//   extensions/
//     <包目录>/                  目录名建议与 manifest.id 一致(不强制,装载按目录扫描)
//       manifest.json            包清单(下 ExtensionManifest;缺文件/坏 JSON = 装载炸出)
//       index.js                 权威侧入口(manifest.entry;默认导出 AuthorityContribution)
//       client.js                客户端入口(manifest.client;默认导出 app 侧 ClientPackage)
//       assets/                  静态资源(将旗/牌面图等;客户端 hook 读站点根相对 URL)
//       src/                     TS 源(分发 = 编译后 JS;源码供作者维护类型/工具链)
//
// ── 接口位总登记(ADR-0022 决策 2;实现状态 2026-10-05)──
//   ✅ 技能/效果注册     core:名将进 HEROES 池、效果进 EFFECTS 注册表(extension-registry)
//   ✅ 动画 handler      app:吃引擎事件批补演出(src/app/extensions,消费点 fx/event-extract)
//   ✅ 渲染 hook         app:名将专属将旗(HeroCardFace 消费;assets/ 资源走 URL)
//   ✅ 交互 handler      定制问询(choices 之外问询,ADR-0022 与 ADR-0020 咬合):
//                       权威侧 askPlayer 经 extension-registry 注册(本文件
//                       ExtensionInquiry,#410);引擎消费挂点(无匹配 choices 时回调
//                       出选项集)与客户端呈现挂点归后续票
//   ◻ 新牌类型          锦囊/珍宝牌新种类(数据表+结算案+卡面),后续票
//   ◻ 新格子类型        棋盘格新种类(board.ts 格判别+落格结算),后续票
//   ◻ 自定义面板        扩展自有 UI 面板/弹层挂点,后续票
//   ◻ 音效              扩展自定义音效资源挂点(现 animation handler 只能复用既有
//                       SoundEvent 词表),后续票
//   ◻ 文案              扩展文案资源表(现文案直接写在包代码内),后续票
import type { ChoiceOption } from "./choices";
import type { EffectFn } from "./effects";
import type { GameEngine } from "./authority";
import type { HeroDef } from "./heroes";

/** 扩展包清单(manifest.json 的解析后形状)。id 是全局唯一键(与已装包/注册冲突即炸);
 *  entry/client 为包根下的**平铺文件名**(不含路径分隔符——装载器按目录拼路径,子目录
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
  /** 客户端入口:包根下平铺 JS 文件名(默认导出客户端贡献包;缺省 = 纯权威侧包)。 */
  client?: string;
}

/** 权威侧贡献(包入口模块的默认导出):名将/效果/定制问询,经 extension-registry
 *  注册进引擎既有注册面(HEROES 名将池 / EFFECTS 效果注册表 / 问询注册面)。效果函数
 *  与内置效果同签名(EffectFn:纯逻辑、禁 DOM/React、经引擎公共方法改状态),信任
 *  作者、无沙箱(ADR-0022 信任模型);无随机数/时钟纪律(ADR-0021)。 */
export interface ExtensionAuthorityContribution {
  /** 追加进名将池的名将(招贤/机遇送将/快照回链全走 HEROES 单表)。 */
  heroes?: HeroDef[];
  /** 追加进效果注册表的效果(TriggerSkill.effect 按 id 查用)。 */
  effects?: Record<string, EffectFn>;
  /** 定制问询(#410):choices 决策选项集(ADR-0013)无法自然表达的扩展问询,
   *  经 extension-registry 注册、引擎按 id 回调(extensionInquiries 读口)。 */
  inquiries?: ExtensionInquiry[];
}

// ── 交互 handler(#410,#378 遗留概念位落型)──
// 与 choices 通路(ADR-0013)的咬合口径:**handler 是选项集的上游生产者之一,不是
// 旁路**——choices 已能表达的问询仍走各相位注册的计算器;handler 只接管 choices 无法
// 自然表达的定制问询(如「从两张暗牌中盲选」:通用卷轴按 label 渲染会泄露牌面)。
// 引擎在无匹配 choices 时按 id 回调 askPlayer,产出的选项集**仍用 ChoiceOption 词汇**,
// 经 snapshot.choices 单通道透出——UI/bot/联机零新消费通路;定制呈现意图(牌背等)
// 由客户端交互 hook 声明(src/app/extensions/registry.ts),弹层行为收口 shadcn。
/** 定制问询上下文:engine=只读语义(产选项不改状态,状态变更是后续命令结算的事);
 *  seat=被询问者座位(决策归属,联机侧据此投影私密问询);params=发起方透传参数
 *  (包作者自定义词汇,与 EffectFn 的 params 同纪律:缺项由 handler 自己炸出)。 */
export interface ExtensionInquiryCtx {
  engine: GameEngine;
  seat: number;
  params: Record<string, number>;
}

/** 单条定制问询:id 全局唯一(与已装包冲突即炸,extension-registry 校验);askPlayer
 *  纯函数(core 纪律同 EffectFn:禁 DOM/React、无随机数/时钟)。 */
export interface ExtensionInquiry {
  id: string;
  askPlayer(ctx: ExtensionInquiryCtx): ChoiceOption[];
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
  if (raw.client != null) manifest.client = assertPlainFilename(raw.client, "client", pkgDir);
  return manifest;
}

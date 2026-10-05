// 客户端扩展面(#378,ADR-0022 双端加载器·客户端侧):浏览器动态装载的包贡献
// 注册表——动画 handler(吃引擎事件批补演出)与渲染 hook(名将专属将旗等表现定制)。
// 装载器(loader.ts)在应用启动时装包;本模块只管「类型契约 + 注册表 + 读口」:
//  - 客户端包代码只做表现,不做任何裁决(裁决全在权威侧,ADR-0022);
//  - 注册冲突即炸(零兜底),与 core 注册面同口径;
//  - 消费点:fx/event-extract.ts(动画 handler,提取尾追加演出)、
//    components/card/HeroCardFace.tsx(将旗渲染 hook)。
import type { GameEngine } from "@core/authority";
import type { GameEvent } from "@core/game-events";
import type { ExtensionManifest } from "@core/extension-contract";
import type { PresentationEvent } from "@app/fx/presentation";

// ── 动画 handler(三能力之二)──
/** 动画上下文:engine=推进后的引擎(单机=本地权威;联机=快照水合副本,只读语义),
 *  events=本转移的引擎事件批(core/game-events 词汇表)。 */
export interface ExtensionAnimationCtx {
  engine: GameEngine;
  events: readonly GameEvent[];
}
/** 动画 handler:吃一批事件,返回要追加播放的表现事件(复用既有 PresentationEvent
 *  词表——自定义浮字/印章/指示线等;扩展专属动效词表归接口位,见文件尾登记)。 */
export type ExtensionAnimationHandler = (ctx: ExtensionAnimationCtx) => PresentationEvent[];

// ── 渲染 hook(三能力之三)──
/** 名将专属将旗:URL 挂卡面(assets/ 走站点根相对路径,客户端 hook 只读 URL)。 */
export interface ExtensionHeroFlag {
  url: string;
  alt?: string;
}
/** 渲染 hook 集(第一版仅将旗;牌面标记等接口位见文件尾登记)。 */
export interface ExtensionRenderHooks {
  /** 名将 id → 将旗(null = 无旗;多包同挂一名将时先装者胜,注册面按装载序取首个命中)。 */
  heroFlag?(heroId: string): ExtensionHeroFlag | null;
}

/** 客户端贡献包(包 client 入口的默认导出形状;manifest 由装载器随注册携带入台账)。 */
export interface ExtensionClientPackage {
  animations?: ExtensionAnimationHandler[];
  render?: ExtensionRenderHooks;
}

/** 已装客户端包台账(包 id → manifest + 贡献;装载序保留,读口按序取)。 */
const installed = new Map<string, { manifest: ExtensionManifest; pkg: ExtensionClientPackage }>();

/** 客户端包注册(重复包 id = bug,当场炸)。 */
export function registerExtensionClientPackage(
  manifest: ExtensionManifest,
  pkg: ExtensionClientPackage,
): void {
  if (manifest.id === "") throw new Error("客户端扩展注册:包缺 id(包格式 bug)");
  if (installed.has(manifest.id)) throw new Error(`客户端扩展注册:包 id「${manifest.id}」重复装载`);
  installed.set(manifest.id, { manifest, pkg });
}

/** 卸载(测试隔离/将来热卸载);未装过的 id = bug,炸出。 */
export function unregisterExtensionClientPackage(id: string): void {
  if (!installed.delete(id)) throw new Error(`客户端扩展卸载:包「${id}」未装载(状态机 bug)`);
}

/** 全部动画 handler(装载序;事件提取层逐个消费)。 */
export function extensionAnimationHandlers(): readonly ExtensionAnimationHandler[] {
  return [...installed.values()].flatMap((p) => p.pkg.animations ?? []);
}

/** 名将将旗读口:按装载序取首个命中(null = 无扩展旗,卡面维持现状)。 */
export function extensionHeroFlagOf(heroId: string): ExtensionHeroFlag | null {
  for (const p of installed.values()) {
    const flag = p.pkg.render?.heroFlag?.(heroId);
    if (flag != null) return flag;
  }
  return null;
}

/** 已装客户端包清单(诊断读口)。 */
export function registeredClientPackages(): readonly ExtensionManifest[] {
  return [...installed.values()].map((p) => p.manifest);
}

// ── 接口位(第一版不实现,登记防忘;总登记见 core/extension-contract.ts)──
// ◻ 交互 handler:定制问询(补足 choices 决策选项集之外的扩展问询)——类型与挂点归后续票。
// ◻ 牌面/立绘渲染扩展:自定义牌面装配、立绘替换 hook——后续票(本版仅将旗)。
// ◻ 自定义面板:扩展自有 UI 面板挂点——后续票。
// ◻ 音效/动效词表:扩展专属 SoundEvent/表现事件种类(现复用既有 PresentationEvent)——后续票。
// ◻ 文案资源表:包内文案 i18n/集中管理(现文案内联包代码)——后续票。

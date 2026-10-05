// 扩展注册面(#378,ADR-0022):权威侧贡献的**唯一装载入口**——把包内名将/效果注册进
// 引擎既有注册面(heroes.ts 的 HEROES 名将池 / effects.ts 的 EFFECTS 效果注册表)。
// 设计口径:
//  - **注册进既有表,不另立平行表**:招贤三选一(recruitment)/机遇与锦囊送将
//    (encounter-flow / jinnang-execution)/快照回链(snapshot)/事件消费面
//    (event-fold/event-extract)/卡面(HeroCardFace)全部直读 HEROES·EFFECTS——
//    注册即全链生效,消费方零改动;heroes.ts / effects.ts 本体仍是纯数据/纯注册表。
//  - **冲突即炸(零兜底)**:包 id、名将 id、效果 id 任一与内置表或已装包冲突,
//    当场抛错——不静默跳过、不覆盖;两包作者撞 id 是包生态 bug,必须炸出来修。
//  - **装载即校验**:技能 when 必须是登记过的时机(MOMENTS)、effect 必须可解析
//    (内置 ∪ 本包 ∪ 已装包)——把「对局中途派发才炸」的数据 bug 提前到启动装载点。
//  - 注册是模块级全局态(与 EFFECTS/HEROES 同生命周期):进程内装载一次即全引擎生效
//    (服务端=全房间,单机=本页);unregisterExtensionPackage 供测试隔离与将来热卸载。
import { HEROES, type HeroDef } from "./heroes";
import { EFFECTS } from "./effects";
import { MOMENTS } from "./timing";
import type { ExtensionAuthorityModule, ExtensionManifest } from "./extension-contract";

/** 已装包台账:包 id → 其贡献(精确卸载/冲突检测用)。 */
const installed = new Map<
  string,
  { manifest: ExtensionManifest; heroes: HeroDef[]; effectIds: string[] }
>();

/** 已装包清单(装载完成后的诊断/日志读口;数组序 = 装载序)。 */
export function registeredExtensionPackages(): readonly ExtensionManifest[] {
  return [...installed.values()].map((p) => p.manifest);
}

/** 权威侧注册入口(零兜底:形状/冲突/引用任一不合法即抛,装载中止)。 */
export function registerExtensionAuthorityModule(mod: ExtensionAuthorityModule): void {
  const { manifest } = mod;
  if (manifest.id === "" || manifest.id.includes("/") || manifest.id.includes("\\"))
    throw new Error(`扩展注册:非法包 id「${manifest.id}」`);
  if (installed.has(manifest.id))
    throw new Error(
      `扩展注册:包 id「${manifest.id}」重复装载(已装版本 ${installed.get(manifest.id)!.manifest.version})`,
    );

  const heroes = mod.heroes ?? [];
  const effects = mod.effects ?? {};
  const effectIds = Object.keys(effects);

  // 冲突检测:名将/效果 id 对注册面全局唯一(已装包的贡献已并入 HEROES/EFFECTS,
  // 与内置表同表校验,无需另扫台账);包内也不得自撞。
  const seenHeroIds = new Set<string>();
  for (const h of heroes) {
    if (typeof h.id !== "string" || h.id === "")
      throw new Error(`扩展注册:${manifest.id} 包内存在缺 id 的名将(包数据 bug)`);
    if (seenHeroIds.has(h.id))
      throw new Error(`扩展注册:${manifest.id} 包内名将 id 重复:「${h.id}」`);
    seenHeroIds.add(h.id);
    if (HEROES.some((x) => x.id === h.id))
      throw new Error(`扩展注册:${manifest.id} 名将 id「${h.id}」与名将池冲突(内置或已装包)`);
  }
  const seenEffectIds = new Set<string>();
  for (const id of effectIds) {
    if (id === "") throw new Error(`扩展注册:${manifest.id} 包内存在空效果 id(包数据 bug)`);
    if (seenEffectIds.has(id))
      throw new Error(`扩展注册:${manifest.id} 包内效果 id 重复:「${id}」`);
    seenEffectIds.add(id);
    if (id in EFFECTS)
      throw new Error(`扩展注册:${manifest.id} 效果 id「${id}」与效果注册表冲突(内置或已装包)`);
  }

  // 引用校验(把派发期数据 bug 提前到装载点):when 必须是登记时机;effect 必须可解析。
  for (const h of heroes) {
    for (const s of h.skills ?? []) {
      if (!MOMENTS.includes(s.when))
        throw new Error(
          `扩展注册:${manifest.id} 名将「${h.id}」技能「${s.id}」挂了未登记时机「${s.when}」(查 core/timing.ts MOMENTS)`,
        );
      if (!(s.effect in EFFECTS) && !(s.effect in effects))
        throw new Error(
          `扩展注册:${manifest.id} 名将「${h.id}」技能「${s.id}」引用了不可解析效果「${s.effect}」(内置表与本包均无)`,
        );
    }
    // 主动技的 kind 结算案穷尽由 core/jinnang-execution.ts 的 never 守卫在编译期/结算期逼出,
    // 此处不重复登记第二份 kind 清单(单一事实源纪律)。
  }

  // 提交:并入既有注册面 + 记台账。此后招贤/送将/快照/派发全链可见。
  HEROES.push(...heroes);
  Object.assign(EFFECTS, effects);
  installed.set(manifest.id, { manifest, heroes, effectIds });
}

/** 卸载(测试隔离/将来热卸载):按台账精确摘除本包贡献;未装过的 id = bug,炸出。 */
export function unregisterExtensionPackage(id: string): void {
  const pkg = installed.get(id);
  if (pkg == null) throw new Error(`扩展卸载:包「${id}」未装载(状态机 bug)`);
  for (const h of pkg.heroes) {
    const idx = HEROES.indexOf(h);
    if (idx >= 0) HEROES.splice(idx, 1);
  }
  for (const eid of pkg.effectIds) delete EFFECTS[eid];
  installed.delete(id);
}

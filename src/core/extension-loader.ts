// 扩展包装载器(#378,ADR-0022 双端加载器·权威侧):**bun/node 环境**从扩展目录
// 扫描装载已安装包——读 manifest.json → 动态 import 权威入口 → 注册进引擎注册面。
// 消费方:scripts/server.ts(启动时装载)与 test/(单测/示例包全链断言)。
// **浏览器禁入**:本文件依赖 node:fs,src/app 不得 import(单机本地引擎的装载走
// src/app/extensions/ 的浏览器装载器,语义与这里一致——单机与联机装同一份包)。
//
// 零兜底口径:目录不存在 / manifest 缺失或坏 JSON / 入口 import 失败 / 入口缺默认导出,
// 一律当场炸(加载失败不静默跳过坏包——ADR-0022「加载失败当场炸」);目录存在但为空
// = 合法的「零包」环境,返回空表(不装包 = 现状)。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertExtensionManifest,
  type ExtensionAuthorityContribution,
  type ExtensionManifest,
} from "./extension-contract";
import { registerExtensionAuthorityModule } from "./extension-registry";

/** 扫描扩展目录:返回 [{ manifest, 包目录绝对路径 }](按目录名字典序,装载序确定)。
 *  目录不存在 = 环境损坏(上游永远交付 extensions/ 布局),炸;非目录项(README 等)略过。 */
export function scanExtensionManifests(
  dir: string,
): { manifest: ExtensionManifest; pkgDir: string }[] {
  if (!existsSync(dir)) throw new Error(`扩展装载:扩展目录不存在:${dir}`);
  const out: { manifest: ExtensionManifest; pkgDir: string }[] = [];
  for (const dent of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (!dent.isDirectory()) continue;
    const pkgDir = join(dir, dent.name);
    const manifestPath = join(pkgDir, "manifest.json");
    if (!existsSync(manifestPath))
      throw new Error(`扩展装载:${dent.name}/ 缺 manifest.json(包格式 bug)`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      throw new Error(
        `扩展装载:${dent.name}/manifest.json 不是合法 JSON(${(err as Error).message})`,
      );
    }
    out.push({ manifest: assertExtensionManifest(parsed, dent.name), pkgDir });
  }
  return out;
}

/** 装载扩展目录全部包:逐包 import 权威入口并注册,返回已装 manifest(装载序)。
 *  任一包失败即抛、整批中止(半装态比坏包更难排查;服务端启动失败=立刻可见)。 */
export async function loadExtensionPackages(dir: string): Promise<ExtensionManifest[]> {
  const loaded: ExtensionManifest[] = [];
  for (const { manifest, pkgDir } of scanExtensionManifests(dir)) {
    const entryPath = join(pkgDir, manifest.entry);
    if (!existsSync(entryPath))
      throw new Error(`扩展装载:${manifest.id} 权威入口不存在:${manifest.entry}(包格式 bug)`);
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      default?: ExtensionAuthorityContribution;
    };
    if (mod.default == null || typeof mod.default !== "object")
      throw new Error(`扩展装载:${manifest.id} 权威入口缺默认导出贡献对象(${manifest.entry})`);
    registerExtensionAuthorityModule({ manifest, ...mod.default });
    loaded.push(manifest);
  }
  return loaded;
}

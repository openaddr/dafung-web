// 扩展包装载器(#378,ADR-0022):客户端从 packages/core/extensions/ 装载已安装包——
// import.meta.glob 构建期锁定包清单与入口(dev 直出、build 切懒 chunk),逐包动态
// import() 后做**权威侧注册**(单机本地引擎做裁决 + 事件消费面按 HEROES 回链)。
// 客户端半边(动画/渲染/呈现 hook)已退役(#1064):扩展包无 client 入口,装载器
// 只做权威侧注册;单机与联机走同一装载路径(联机客户端也注册权威贡献:折叠/快照
// 回链要按 HEROES 解析扩展名将;裁决仍在服务端,客户端注册的效果不会被调用)。
//
// 口径:
//  - 「已安装」= 公共包 extensions/ 下存在的包目录。
//    装载在构建/启动期确定,新增包需重启 dev / 重新 build(骨架已知边界,非热载)。
//  - 零兜底:manifest 与入口 glob 不齐、入口缺默认导出、注册冲突——一律当场炸。
//  - 顶层 await 消费(main.tsx):扩展先于首帧注册,任何引擎构造前名将池即全量。
import {
  assertExtensionManifest,
  type ExtensionAuthorityContribution,
  type ExtensionManifest,
} from "@dafung/core/engine/extension-contract";
import { registerExtensionAuthorityModule } from "@dafung/core/engine/extension-registry";

// 构建期扫描:manifest 全量(eager,小对象),入口按 glob 懒加载。
// manifest 和入口都在同一包目录，直接用 manifest 的路径计算入口键。
const manifestModules = import.meta.glob("@extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const authorityEntries = import.meta.glob("@extensions/*/*.js");

/** 装载扩展目录全部包(重复调用 = bug:注册面冲突当场炸,main.tsx 顶层只调一次)。 */
export async function loadInstalledExtensionPackages(): Promise<ExtensionManifest[]> {
  const loaded: ExtensionManifest[] = [];
  for (const [manifestPath, raw] of Object.entries(manifestModules)) {
    const parts = manifestPath.split("/");
    const dirName = parts.at(-2)!; // glob 固定匹配 <目录>/manifest.json
    const manifest = assertExtensionManifest(raw, dirName);
    parts[parts.length - 1] = manifest.entry;
    const entryKey = parts.join("/");
    const entryImport = authorityEntries[entryKey];
    if (entryImport == null)
      throw new Error(
        `扩展装载:${manifest.id} 权威入口不在构建扫描面:${entryKey}(检查包根平铺布局)`,
      );
    const authority = (await entryImport()) as { default?: ExtensionAuthorityContribution };
    if (authority.default == null || typeof authority.default !== "object")
      throw new Error(`扩展装载:${manifest.id} 权威入口缺默认导出贡献对象(${manifest.entry})`);
    registerExtensionAuthorityModule({ manifest, ...authority.default });
    loaded.push(manifest);
  }
  return loaded;
}

// 扩展包装载器(#378,ADR-0022 双端加载器·客户端侧):浏览器从仓库 extensions/ 布局
// 装载已安装包——import.meta.glob 构建期锁定包清单与入口(dev 直出、build 切懒 chunk),
// 逐包动态 import() 后**双注册**:权威贡献进 core 注册面(单机本地引擎做裁决 + 事件
// 消费面按 HEROES 回链),客户端贡献进本层扩展面(动画/渲染)。
// 单机与联机走同一装载路径(联机客户端也注册权威贡献:折叠/快照回链要按 HEROES 解析
// 扩展名将;裁决仍在服务端,客户端注册的效果不会被调用)。
//
// 口径:
//  - 「已安装」= 仓库 extensions/ 下存在的包目录;本票不建安装/分发通路(后续票)。
//    装载在构建/启动期确定,新增包需重启 dev / 重新 build(骨架已知边界,非热载)。
//  - 零兜底:manifest 与入口 glob 不齐、入口缺默认导出、注册冲突——一律当场炸。
//  - 顶层 await 消费(main.tsx):扩展先于首帧注册,任何引擎构造前名将池即全量。
import {
  assertExtensionManifest,
  type ExtensionAuthorityContribution,
  type ExtensionManifest,
} from "@core/extension-contract";
import { registerExtensionAuthorityModule } from "@core/extension-registry";
import { registerExtensionClientPackage, type ExtensionClientPackage } from "./registry";

// 构建期扫描:manifest 全量(eager,小对象),两个入口位按 glob 懒加载。
// 平铺文件名契约(core/extension-contract.ts)保证「/extensions/<目录>/<entry>」拼得出 glob 键。
const manifestModules = import.meta.glob("/extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;
const authorityEntries = import.meta.glob("/extensions/*/*.js");
const clientEntries = import.meta.glob("/extensions/*/*.js");

/** 装载扩展目录全部包(重复调用 = bug:注册面冲突当场炸,main.tsx 顶层只调一次)。 */
export async function loadInstalledExtensionPackages(): Promise<ExtensionManifest[]> {
  const loaded: ExtensionManifest[] = [];
  for (const [manifestPath, raw] of Object.entries(manifestModules)) {
    // "/extensions/<目录>/manifest.json" → 目录名(glob 键形状由 pattern 保证)
    const dirName = manifestPath.split("/")[2];
    const manifest = assertExtensionManifest(raw, dirName);
    const entryKey = `/extensions/${dirName}/${manifest.entry}`;
    const entryImport = authorityEntries[entryKey];
    if (entryImport == null)
      throw new Error(
        `扩展装载:${manifest.id} 权威入口不在构建扫描面:${entryKey}(检查包根平铺布局)`,
      );
    const authority = (await entryImport()) as { default?: ExtensionAuthorityContribution };
    if (authority.default == null || typeof authority.default !== "object")
      throw new Error(`扩展装载:${manifest.id} 权威入口缺默认导出贡献对象(${manifest.entry})`);
    registerExtensionAuthorityModule({ manifest, ...authority.default });

    if (manifest.client != null) {
      const clientKey = `/extensions/${dirName}/${manifest.client}`;
      const clientImport = clientEntries[clientKey];
      if (clientImport == null)
        throw new Error(
          `扩展装载:${manifest.id} 客户端入口不在构建扫描面:${clientKey}(检查包根平铺布局)`,
        );
      const client = (await clientImport()) as { default?: ExtensionClientPackage };
      if (client.default == null || typeof client.default !== "object")
        throw new Error(`扩展装载:${manifest.id} 客户端入口缺默认导出贡献对象(${manifest.client})`);
      registerExtensionClientPackage(manifest, client.default);
    }
    loaded.push(manifest);
  }
  return loaded;
}

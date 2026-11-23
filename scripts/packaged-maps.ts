import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
// 相对路径让 Vite 把仓库内的 TypeScript 一起打包进配置，再交给 Node 加载。
import { parseCatalog } from "../packages/core/src/engine/map-source";

/** 两个构建入口和部署工具以清单为准，保留相对目录。 */
export function readPackagedMaps(mapsDir: string) {
  const root = realpathSync(mapsDir);
  const filePath = (file: string) => {
    const path = join(root, file);
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile() || realpathSync(path) !== path) {
      throw new Error(`地图文件必须是清单目录内的普通文件:${path}`);
    }
    return path;
  };
  const catalog = parseCatalog(JSON.parse(readFileSync(filePath("index.json"), "utf8")));
  const files = new Set(["index.json"]);
  for (const { file } of catalog) {
    const plain = file.split("/").every((part) => {
      return /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..";
    });
    if (!plain || extname(file) !== ".json" || file === "index.json") {
      throw new Error(`地图清单指向非法文件:${file}`);
    }
    filePath(file);
    files.add(file);
  }
  return { catalog, files };
}

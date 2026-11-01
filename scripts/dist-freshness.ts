// dist 新鲜度判定(#986,效率批 R1):e2e 入口的 build 门——同树重复定向跑
// 不再重复 build(#945 实测 3 天 e2e 机器时 ~15h,重复 build 占 3-5h)。
// 语义保守判新、存疑必 build(陈旧 dist 错配世界红线一步不退):
//   新鲜 = dist/index.html 在 + stamp 在 + 新鲜面全部严格早于 stamp mtime。
//   新鲜面 = src/**、public/**、index.html、vite.config.ts、tsconfig*.json、
//   package.json(vite build 的全部输入;spec/e2e 配置与 scripts/** 不进 dist,
//   不在面上)。任一不满足 → 照旧 build,成功后 stampDistBuild() 重盖。
// stamp 落 dist/ 内(vite 的 emptyOutDir 每次构建先清空 dist):构建中断/失败
// 即 stamp 消失,下次必然重建——中断残骸不会骗过判新。jj rebase/换书签刷新
// 文件 mtime,天然判旧重建,不需特判。
// 消费方:scripts/e2e-one.ts(唯一 build 点;test:e2e:one / test:e2e /
// e2e-full.ts 全经它,单源成立)。
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STAMP_PATH = join("dist", ".e2e-build-stamp");

/** 判新面里直接 stat 的文件(vite build 的配置面与入口)。 */
const SURFACE_FILES = [
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.scripts.json",
  "package.json",
] as const;

/** 判新面里递归走的目录。 */
const SURFACE_DIRS = ["src", "public"] as const;

/** 单文件 mtime;目录递归取最新 mtime。 */
function newestMtimeMs(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs;
  for (const entry of readdirSync(path)) {
    const m = newestMtimeMs(join(path, entry));
    if (m > newest) newest = m;
  }
  return newest;
}

export interface DistFreshness {
  fresh: boolean;
  /** 不新鲜的原因(新鲜时为空串);入口把它打进日志,跳过/构建可观测。 */
  reason: string;
}

/** dist 是否可免构建。判定保守:相等视为旧(mtime 拿不准就 build)。 */
export function distFreshness(): DistFreshness {
  if (!existsSync("dist/index.html")) {
    return { fresh: false, reason: "dist/index.html 不存在" };
  }
  if (!existsSync(STAMP_PATH)) {
    return { fresh: false, reason: "构建 stamp 不存在(首次或上次构建未完成)" };
  }
  const stampMs = statSync(STAMP_PATH).mtimeMs;
  let newestFile = "";
  let newestMs = -1;
  for (const path of [...SURFACE_DIRS, ...SURFACE_FILES]) {
    const m = newestMtimeMs(path);
    if (m > newestMs) {
      newestMs = m;
      newestFile = path;
    }
  }
  if (newestMs >= stampMs) {
    return { fresh: false, reason: `${newestFile} 不早于 stamp(mtime 同刻或更新)` };
  }
  return { fresh: true, reason: "" };
}

/** 构建成功后盖 stamp(其 mtime 即新鲜度锚点;内容仅供人读)。 */
export function stampDistBuild(): void {
  writeFileSync(STAMP_PATH, `${new Date().toISOString()}\n`);
}

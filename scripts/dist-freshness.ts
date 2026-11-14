// #1434:常规 build/e2e/探针共用的打包完成判据。标记只表示打包成功,
// 不代表类型门已过;类型检查始终由 build 入口单独执行。
// 输入与产物按内容签名,覆盖删除/同刻修改/换树保留 mtime 的情况。
// 构建开始前撤销标记,成功且输入未变才重建;失败/中断均不能放行旧 dist。
import { createHash } from "node:crypto";
import { Scanner } from "@tailwindcss/oxide";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const STAMP_PATH = join("dist", ".build-complete.json");

interface BuildReceipt {
  inputs: string;
  output: string;
}

export type DistFreshness =
  | { fresh: true; reason: ""; receipt: BuildReceipt }
  | { fresh: false; reason: string };

/** 文件名和内容共同签名;标记本身不属于构建产物。缺输入/读盘失败直接报错。 */
function fingerprint(paths: string[]): string {
  const hash = createHash("sha256");
  const visit = (path: string): void => {
    if (path === STAMP_PATH) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(path)).digest());
  };
  for (const path of paths.sort()) visit(path);
  return hash.digest("hex");
}

/** 脚本可能被前端导入;Tailwind 自动发现的文档/测试同样会改变 CSS。 */
export function distInputFingerprint(): string {
  const scanner = new Scanner({
    sources: [{ base: process.cwd(), pattern: "**/*", negated: false }],
  });
  scanner.scan();
  const config = readdirSync(".").filter(
    (name) =>
      /^tsconfig.*\.json$/.test(name) ||
      /\.config\.[cm]?[jt]s$/.test(name) ||
      /^\.env(?:\.|$)/.test(name) ||
      name === "bunfig.toml",
  );
  const files = fingerprint([
    "src",
    "public",
    "scripts",
    "index.html",
    "package.json",
    "bun.lock",
    ...config,
    ...scanner.files.map((path) => relative(process.cwd(), path)),
  ]);
  const environment = Object.entries(process.env)
    .filter(([name]) => name.startsWith("VITE_") || name === "NODE_ENV")
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(files).update(JSON.stringify(environment)).digest("hex");
}

/** 存疑即明确判旧;调用方负责日志与重建,不静默使用旧产物。 */
export function distFreshness(): DistFreshness {
  if (!existsSync("dist/index.html")) return { fresh: false, reason: "dist/index.html 不存在" };
  if (!existsSync(STAMP_PATH)) {
    return { fresh: false, reason: "打包完成标记不存在(首次或上次构建未完成)" };
  }
  const receipt: unknown = JSON.parse(readFileSync(STAMP_PATH, "utf8"));
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !("inputs" in receipt) ||
    !("output" in receipt) ||
    typeof receipt.inputs !== "string" ||
    typeof receipt.output !== "string"
  ) {
    throw new Error("打包完成标记格式无效");
  }
  if (receipt.inputs !== distInputFingerprint()) return { fresh: false, reason: "打包输入已变化" };
  if (receipt.output !== fingerprint(["dist"])) return { fresh: false, reason: "dist 产物已变化" };
  return { fresh: true, reason: "", receipt: { inputs: receipt.inputs, output: receipt.output } };
}

export function invalidateDistBuild(): void {
  rmSync(STAMP_PATH, { force: true });
}

/** 仅供唯一打包编排入口收口;复用时还核对类型检查期间产物未被改写。 */
export function completeDistBuild(inputs: string, reusedOutput: string | null): void {
  if (inputs !== distInputFingerprint()) throw new Error("构建期间输入发生变化,请重新构建");
  if (!existsSync("dist/index.html")) throw new Error("构建未产出 dist/index.html");
  const output = fingerprint(["dist"]);
  if (reusedOutput !== null && output !== reusedOutput) {
    throw new Error("类型检查期间 dist 产物发生变化,请重新构建");
  }
  writeFileSync(STAMP_PATH, JSON.stringify({ inputs, output } satisfies BuildReceipt) + "\n");
}

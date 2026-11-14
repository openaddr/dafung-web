// #1434:唯一打包编排入口。build 带 --typecheck,每次检查类型;build:bundle/e2e
// 仅保证产物完整新鲜。先撤标记再启动子进程,只有正常成功路径能重新写入。
import { spawn } from "node:child_process";
import {
  completeDistBuild,
  distFreshness,
  distInputFingerprint,
  invalidateDistBuild,
} from "./dist-freshness";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--typecheck") || args.length > 1) {
  throw new Error("用法:bun scripts/build-dist.ts [--typecheck]");
}

const run = (args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    console.log(`[build] $ bun ${args.join(" ")}`);
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

const { freshness, inputs } = (() => {
  try {
    const freshness = distFreshness();
    return {
      freshness,
      inputs: freshness.fresh ? freshness.receipt.inputs : distInputFingerprint(),
    };
  } finally {
    // 输入缺失/读盘失败也必须先撤销旧判据,恢复原文件后不能把失败产物重新放行。
    invalidateDistBuild();
  }
})();
if (args.includes("--typecheck")) {
  const code = await run(["run", "--bun", "tsc", "--noEmit"]);
  if (code !== 0) process.exit(code);
}
if (freshness.fresh) {
  completeDistBuild(inputs, freshness.receipt.output);
  console.log("[build] dist 新鲜,跳过打包");
} else {
  console.log(`[build] ${freshness.reason},执行打包…`);
  const code = await run(["run", "--bun", "vite", "build"]);
  if (code !== 0) process.exit(code);
  completeDistBuild(inputs, null);
}

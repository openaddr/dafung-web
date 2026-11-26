// #1434:客户端打包编排入口。build:client 带 --typecheck,每次检查类型;build:bundle
// 仅保证产物完整新鲜。先撤标记再启动子进程,只有正常成功路径能重新写入。
import { resolve } from "node:path";
import { commandFailureTail, reportCommandResult, runLoggedCommand } from "./command-log";
import {
  CLIENT_DIR,
  completeDistBuild,
  distFreshness,
  distInputFingerprint,
  invalidateDistBuild,
} from "./dist-freshness";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--typecheck") || args.length > 1) {
  throw new Error("用法:bun scripts/build-dist.ts [--typecheck]");
}

const logs: string[] = [];
async function run(step: string, args: string[]): Promise<void> {
  console.log(`[build] $ bun ${args.join(" ")}`);
  const { code, log } = await runLoggedCommand([process.execPath, ...args]);
  if (code !== 0) {
    console.error(`[build] ${step}失败 · 退出 ${code} · 完整日志 ${log.dir}`);
    const detail = await commandFailureTail(log);
    if (detail) console.error(detail);
    process.exit(code);
  }
  logs.push(log.dir);
}

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
  await run("类型检查", ["run", "--bun", "tsc", "--noEmit", "-p", `${CLIENT_DIR}/tsconfig.json`]);
}
if (freshness.fresh) {
  completeDistBuild(inputs, freshness.receipt.output);
  console.log("[build] dist 新鲜,跳过打包");
} else {
  console.log(`[build] ${freshness.reason},执行打包…`);
  await run("客户端打包", ["run", "--bun", "vite", "build", CLIENT_DIR]);
  completeDistBuild(inputs, null);
}
reportCommandResult(
  `build · 产物 ${resolve(CLIENT_DIR, "dist")}${logs.length ? ` · 完整日志 ${logs.join(" · ")}` : ""}`,
);

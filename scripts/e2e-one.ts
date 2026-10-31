// 定向 e2e 包装(how-to「管道尾巴吞挂例名/吞退出码」双坑的根治形态):
// build + playwright 的全部输出 tee 到 tmp/e2e-one-last.log(最后一次跑为准,
// 挂例归因先读文件,不再重跑)同时透传到控制台;子进程退出码原样透传——
// 管道里跑命令吞非零退出码(fmt 假失败险些放行,2026-10-20 实锤)由此杜绝。
// 用法(package.json 单源):bun scripts/e2e-one.ts [playwright 参数透传]
//   例:bun run test:e2e:one e2e/react-board.spec.ts
// 全量入口(test:e2e)经 test-lock 包本脚本,E2E_WORKERS 等环境变量自然流入。
import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";

const LOG = "tmp/e2e-one-last.log";
mkdirSync("tmp", { recursive: true });
const log = createWriteStream(LOG, { flags: "w" });
const tee = (chunk: Buffer | string): void => {
  const text = typeof chunk === "string" ? chunk : chunk.toString();
  process.stdout.write(text);
  log.write(text);
};
const exitCode = await new Promise<number>((resolve) => {
  const run = (command: string, args: string[]): Promise<number> =>
    new Promise((res) => {
      tee(`\n[e2e-one] $ ${command} ${args.join(" ")}\n`);
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      child.stdout.on("data", tee);
      child.stderr.on("data", tee);
      child.on("close", (code) => res(code ?? 1));
    });

  (async () => {
    // 段 1:前端构建(失败即止,输出同样留档)
    const buildCode = await run("bun", ["run", "--bun", "vite", "build"]);
    if (buildCode !== 0) {
      tee(`\n[e2e-one] build 失败(exit ${buildCode}),跳过 playwright。\n`);
      resolve(buildCode);
      return;
    }
    // 段 2:playwright,参数透传。注意必须走 node 通道(不带 --bun:
    // bun 跑 playwright launch() 挂起,how-to「截图/探针通路」节在案)。
    resolve(await run("playwright", ["test", ...process.argv.slice(2)]));
  })();
});
log.end();
process.exit(exitCode);

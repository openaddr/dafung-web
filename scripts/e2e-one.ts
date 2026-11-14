// 定向 e2e 包装(how-to「管道尾巴吞挂例名/吞退出码」双坑的根治形态):
// build + playwright 的全部输出 tee 到 tmp/e2e-one-last.log(最后一次跑为准,
// 挂例归因先读文件,不再重跑)同时透传到控制台;子进程退出码原样透传——
// 管道里跑命令吞非零退出码(fmt 假失败险些放行,2026-10-20 实锤)由此杜绝。
// 用法(package.json 单源):bun scripts/e2e-one.ts [playwright 参数透传]
//   例:bun run test:e2e:one e2e/react-solo.spec.ts
// 全量入口(test:e2e)经 test-lock 包本脚本,E2E_WORKERS 等环境变量自然流入。
// 入口水位前置闸(#1003,#958 会话复盘):开跑 CPU≥80% 红字警告负载竞速风险
// (advisory 不拦跑)——负载期盲跑挂例谱漂移,2 轮纯浪费才想起 A/B 定性,判读机械闸化。
// 进程水位硬闸(#1280):bun+非工具代理 node 超阈值响亮失败拒绝开跑——负载窗假挂
// 不是算力是进程/调度水位(纯 CPU 燃烧 6 核 2.4m 不复现,#1280 进程取证),CPU
// advisory 挡不住 bun/node 叠加窗;计数与阈值单源见 e2e-watermark.ts。
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { assertWatermark, warnIfLoaded } from "./e2e-watermark";

const LOG = "tmp/e2e-one-last.log";
mkdirSync("tmp", { recursive: true });
writeFileSync(LOG, "");
let outputTail = "";
const tee = (chunk: Buffer | string): void => {
  const text = typeof chunk === "string" ? chunk : chunk.toString();
  outputTail = (outputTail + text).slice(-8192);
  process.stdout.write(text);
  appendFileSync(LOG, text); // 同步落盘,任何退出路径都不丢最终判决。
};

try {
  assertWatermark(warnIfLoaded("e2e-one"));
} catch (error) {
  const msg = `${String(error)}\n`;
  process.stderr.write(msg);
  // 探针/闸拒绝的明确理由也同步落盘。
  appendFileSync(LOG, msg);
  process.exit(1);
}
const run = (command: string, args: string[]): Promise<number> =>
  new Promise((res, reject) => {
    tee(`\n[e2e-one] $ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("error", reject);
    child.on("close", (code) => res(code ?? 1));
  });

async function execute(): Promise<number> {
  // 段 1:与常规 build 共用打包完成判据;这里不声称跑过类型检查。
  const buildCode = await run("bun", ["run", "build:bundle"]);
  if (buildCode !== 0) {
    tee(`\n[e2e-one] build 失败(exit ${buildCode}),跳过 playwright。\n`);
    return buildCode;
  }
  // 段 2:playwright,参数透传。注意必须走 node 通道(不带 --bun:
  // bun 跑 playwright launch() 挂起,how-to「截图/探针通路」节在案)。
  outputTail = ""; // 只认 Playwright 汇总,不让 build 输出冒充已执行的用例。
  const code = await run("playwright", [
    "test",
    ...process.argv.slice(2),
    "--forbid-only",
    "--fail-on-flaky-tests",
  ]);
  if (code === 0 && !/^\s*[1-9]\d* passed\b/m.test(stripVTControlCharacters(outputTail))) {
    tee("\n[e2e-one] 零执行或缺少 Playwright 通过汇总,不构成验证通过(列表/全 skip 也不放行)。\n");
    return 1;
  }
  return code;
}
let exitCode: number;
try {
  exitCode = await execute();
} catch (error) {
  tee(`[e2e-one] 子进程启动失败:${String(error)}\n`);
  exitCode = 1;
}
process.exit(exitCode);

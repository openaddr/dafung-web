// 定向 e2e 包装(how-to「管道尾巴吞挂例名/吞退出码」双坑的根治形态):
// build + playwright 的全部输出 tee 到 tmp/e2e-one-last.log(最后一次跑为准,
// 挂例归因先读文件,不再重跑)同时透传到控制台;子进程退出码原样透传——
// 管道里跑命令吞非零退出码(fmt 假失败险些放行,2026-10-20 实锤)由此杜绝。
// 用法(package.json 单源):bun scripts/e2e-one.ts [playwright 参数透传]
//   例:bun run test:e2e:one e2e/react-solo.spec.ts
// 全量入口(test:e2e)经 test-lock 包本脚本,E2E_WORKERS 等环境变量自然流入。
// 入口水位前置闸(#1003,#958 会话复盘):开跑 CPU≥80% 红字警告负载竞速风险
// (advisory 不拦跑)——负载期盲跑挂例谱漂移,2 轮纯浪费才想起 A/B 定性,判读机械闸化。
// 进程水位硬闸(#1280):bun+node 进程计数超阈值响亮失败拒绝开跑——负载窗假挂
// 不是算力是进程/调度水位(纯 CPU 燃烧 6 核 2.4m 不复现,#1280 进程取证),CPU
// advisory 挡不住 bun/node 叠加窗,机械闸化成硬失败;阈值判据见 WATERMARK_GATE。
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, createWriteStream } from "node:fs";
import { distFreshness, stampDistBuild } from "./dist-freshness";
import { probeWatermark, warnIfLoaded } from "./e2e-watermark";

const LOG = "tmp/e2e-one-last.log";
mkdirSync("tmp", { recursive: true });
const log = createWriteStream(LOG, { flags: "w" });
const tee = (chunk: Buffer | string): void => {
  const text = typeof chunk === "string" ? chunk : chunk.toString();
  process.stdout.write(text);
  log.write(text);
};

/** 进程水位硬闸阈值(#1280):bun+node ≥ 28 拒绝开跑。校准判据:安静基线
 *  bun3+node11=14(2026-11-08 实测,含本闸自身 bun 进程与机器常驻 node 服务);
 *  早晨失败窗收尾水位 bun=17 为「本会话+单并行会话」叠加态(#1280 进程取证)——
 *  阈值取基线 2 倍,容一整个并行会话满编叠加,低于它历史无假挂聚集;纯 CPU 燃烧
 *  (不增进程数)不触闸,负载复现验收(6 燃烧进程)照跑。 */
const WATERMARK_GATE = 28;

function gateWatermark(): void {
  const w = probeWatermark();
  const count = (name: string): number =>
    Number(w.text.match(new RegExp(`${name}=(\\d+)`))?.[1] ?? 0);
  const bun = count("bun");
  const node = count("node");
  if (bun + node >= WATERMARK_GATE) {
    const msg =
      `[e2e-one] ⛔ 水位闸:并行会话水位过高(bun=${bun}+node=${node}≥${WATERMARK_GATE}),` +
      `等其收尾或协调后重跑;负载窗假挂指纹见 #1280(到站链 waitFor 30s 爬不完=` +
      `进程/调度水位,纯 CPU 燃烧不复现)。\n`;
    process.stdout.write(msg);
    // 同步落盘再退:log 流异步刷写跟不上 process.exit,闸拒绝理由必须留在 tmp 日志
    appendFileSync(LOG, msg);
    process.exit(1);
  }
}
gateWatermark();
warnIfLoaded("e2e-one");
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
    // 段 1:前端构建——dist 新鲜即跳(#986,scripts/dist-freshness.ts 保守判新,
    // 存疑必 build):同树重复定向跑不再付重复 build 的墙钟。
    const freshness = distFreshness();
    if (freshness.fresh) {
      tee("\n[e2e] dist 新鲜,跳过构建\n");
    } else {
      tee(`\n[e2e-one] ${freshness.reason},执行构建…\n`);
      const buildCode = await run("bun", ["run", "--bun", "vite", "build"]);
      if (buildCode !== 0) {
        tee(`\n[e2e-one] build 失败(exit ${buildCode}),跳过 playwright。\n`);
        resolve(buildCode);
        return;
      }
      stampDistBuild();
    }
    // 段 2:playwright,参数透传。注意必须走 node 通道(不带 --bun:
    // bun 跑 playwright launch() 挂起,how-to「截图/探针通路」节在案)。
    resolve(await run("playwright", ["test", ...process.argv.slice(2)]));
  })();
});
log.end();
process.exit(exitCode);

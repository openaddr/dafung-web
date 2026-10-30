// e2e 全量包装(#807,2026-10-29 UI 审计波 retro):workspace 内一键全量 e2e,env 在
// TS 内构造(Bun.spawnSync env 参数)——结构性免疫后台壳吞行内赋值(`E2E_STATIC_PORT=
// 4180 bun …` 的赋值不进子进程,端口以空串落进 config,静默互踩共享默认;global-setup
// 已对空串响亮炸出,本脚本让「env 写进脚本文件」成为默认通路,不再依赖记性)。
// 用法:bun scripts/e2e-full.ts <代号> [--static N] [--game N] [--rooms 后缀] [--log 绝对路径] [spec 过滤...]
//   <代号>        jj workspace 代号(../dafung-web-ws-<代号>,须已存在);目录校验与
//                 ws-run 同款(不存在/无 .jj 当场报错退出)
//   --static N    静态 preview 端口起点(默认 4180,刻意避开共享默认 4173)
//   --game N      游戏服务器端口起点(默认 3040,刻意避开共享默认 3010)
//   --rooms 后缀  E2E_ROOMS_DIR=./tmp/e2e-rooms-<后缀>(不设=playwright.config 默认)
//   --log 路径    子进程输出落盘(须绝对路径):首行 env-check、末行 RAW_EXIT=<码>,
//                 中间活流写入(可另开终端 tail);不设=直接继承终端
//   spec 过滤     其余位置参数原样透传 playwright(如 e2e/react-solo.spec.ts)
// 端口一律由本脚本定(--static/--game 或默认;调用方环境里的 E2E_* 端口变量覆盖):
// 被占自动 +1 重试至多 5 次;4190 是 node fetch 黑名单端口,视同被占永不选用。
// E2E_GLOBAL_TIMEOUT=30、E2E_WORKERS=4(调用方已设非空值则尊重)固定下传,全量通道
// 的墙钟与并发口径由此归一。

import { existsSync, openSync, closeSync, writeSync } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";

const usage = () =>
  console.error(
    "用法:bun scripts/e2e-full.ts <代号> [--static N] [--game N] [--rooms 后缀] [--log 绝对路径] [spec 过滤...]",
  );

const argv = process.argv.slice(2);
let code = "";
let staticStart: number | undefined;
let gameStart: number | undefined;
let roomsSuffix: string | undefined;
let logPath: string | undefined;
const forward: string[] = [];

const parsePort = (name: string, raw: string | undefined): number => {
  if (raw === undefined || raw === "") {
    console.error(`[e2e-full] ${name} 缺值`);
    usage();
    process.exit(2);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[e2e-full] ${name} 非法端口:${raw}`);
    process.exit(2);
  }
  return port;
};
const parseValue = (name: string, raw: string | undefined): string => {
  if (raw === undefined || raw === "") {
    console.error(`[e2e-full] ${name} 缺值`);
    usage();
    process.exit(2);
  }
  return raw;
};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--static") staticStart = parsePort("--static", argv[++i]);
  else if (arg === "--game") gameStart = parsePort("--game", argv[++i]);
  else if (arg === "--rooms") roomsSuffix = parseValue("--rooms", argv[++i]);
  else if (arg === "--log") logPath = parseValue("--log", argv[++i]);
  else if (arg.startsWith("--")) {
    console.error(`[e2e-full] 未知旗标:${arg}`);
    usage();
    process.exit(2);
  } else if (code === "") code = arg;
  else forward.push(arg);
}
if (!code) {
  usage();
  process.exit(2);
}
if (logPath !== undefined && !isAbsolute(logPath)) {
  console.error(
    `[e2e-full] --log 须绝对路径(子进程跑在 workspace 里,相对路径会指错地方):${logPath}`,
  );
  process.exit(2);
}

// workspace 定位与 ws-run 同款:按本脚本位置反推仓库根再找兄弟目录,零兜底。
const wsDir = join(import.meta.dir, "..", "..", `dafung-web-ws-${code}`);
if (!existsSync(wsDir)) {
  console.error(
    `[e2e-full] workspace 不存在:${wsDir}(先 jj workspace add ../dafung-web-ws-${code})`,
  );
  process.exit(2);
}
if (!existsSync(join(wsDir, ".jj"))) {
  console.error(
    `[e2e-full] ${wsDir} 无 .jj,不是 jj workspace——拒绝执行(静默回退主树正是本脚本要消灭的事故)`,
  );
  process.exit(2);
}

const NODE_FETCH_BLACKLIST_PORT = 4190;
const PORT_ATTEMPTS = 5;

function portFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolveFree(true));
    });
  });
}

async function pickPort(label: string, start: number): Promise<number> {
  let candidate = start;
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const taken = candidate === NODE_FETCH_BLACKLIST_PORT || !(await portFree(candidate));
    if (!taken) return candidate;
    candidate += 1;
  }
  console.error(
    `[e2e-full] ${label} 端口 ${start} 起连续 ${PORT_ATTEMPTS} 个全被占——换起点(--static/--game)或清理占用者。`,
  );
  process.exit(1);
}

const staticPort = await pickPort("静态 preview", staticStart ?? 4180);
const gamePort = await pickPort("游戏服务器", gameStart ?? 3040);

const childEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) childEnv[key] = value;
}
childEnv.E2E_STATIC_PORT = String(staticPort);
childEnv.E2E_GAME_PORT = String(gamePort);
childEnv.E2E_GLOBAL_TIMEOUT = process.env.E2E_GLOBAL_TIMEOUT || "30";
childEnv.E2E_WORKERS = process.env.E2E_WORKERS || "4";
if (roomsSuffix !== undefined) childEnv.E2E_ROOMS_DIR = `./tmp/e2e-rooms-${roomsSuffix}`;

const command = ["bun", "run", "test:e2e", ...forward];
const envCheck =
  `[e2e-full] env-check E2E_STATIC_PORT=${staticPort} E2E_GAME_PORT=${gamePort} ` +
  `E2E_GLOBAL_TIMEOUT=${childEnv.E2E_GLOBAL_TIMEOUT} E2E_WORKERS=${childEnv.E2E_WORKERS} ` +
  `E2E_ROOMS_DIR=${childEnv.E2E_ROOMS_DIR ?? "(未设,用 playwright.config 默认)"} ` +
  `cwd=${wsDir} cmd=${command.join(" ")}`;

console.error(`[e2e-full] workspace:${wsDir}`);
console.error(`[e2e-full] 端口:static=${staticPort} game=${gamePort}`);

// spawnSync 本身阻塞到跑完,fd 直写即活流落盘(已实测 Bun.spawnSync 支持 fd)。
let logFd: number | undefined;
if (logPath !== undefined) {
  logFd = openSync(logPath, "w");
  writeSync(logFd, `${envCheck}\n`);
  console.error(`[e2e-full] 日志:${logPath}`);
} else {
  console.log(envCheck);
}

const proc = Bun.spawnSync(command, {
  cwd: wsDir,
  env: childEnv,
  stdin: "inherit",
  stdout: logFd ?? "inherit",
  stderr: logFd ?? "inherit",
});
const rawExitLine = `[e2e-full] RAW_EXIT=${proc.exitCode}`;
if (logFd !== undefined) {
  writeSync(logFd, `${rawExitLine}\n`);
  closeSync(logFd);
}
console.error(rawExitLine);
process.exit(proc.exitCode ?? 1);

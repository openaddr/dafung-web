// 一键开发编排(bun run dev)—— vite 热更新(永远最新代码)+ 权威引擎服务器(联机)。
// 为什么存在:serve 只托管 dist(构建产物,不跟着源码走),dev 只起 vite 没后端——
// 过去要开两个终端、记两个端口、联机还得先 build。现在一条命令、开一个地址(5173):
// 页面是 vite 实时编译的最新代码,联机 API 由 vite 反代到引擎(vite.config.ts server.proxy),
// 前端取 location.origin(App.tsx)同源直连,联机零配置。
//
// 端口约定:dev 引擎默认 3001——刻意错开 serve 惯用的 3000,旧 serve 还挂着也照常起,
// 不打架;房间落盘默认 ./tmp/dev-rooms,与生产 ./rooms、e2e ./tmp/e2e-rooms 互不踩。
// 浏览器只见 5173 一个地址,引擎端口对页面不可见。
// env:PORT / ROOMS_DIR 照常透传引擎(设了就以你为准);DEV_ENGINE_URL 覆写代理目标。
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const ENGINE_PORT = process.env.PORT ?? "3001";
const ENGINE_URL = process.env.DEV_ENGINE_URL ?? `http://127.0.0.1:${ENGINE_PORT}`;

const procs: Array<{ label: string; child: ChildProcess }> = [];
let shuttingDown = false;

function up(
  label: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  stdin: "inherit" | "ignore",
): ChildProcess {
  const child = spawn("bun", args, {
    stdio: [stdin, "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  procs.push({ label, child });
  const tag = label === "serve" ? "\x1b[33m[serve]\x1b[0m" : "\x1b[36m[vite]\x1b[0m";
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    createInterface({ input: stream }).on("line", (line) => console.log(`${tag} ${line}`));
  }
  return child;
}

/** Windows 下 child.kill 只杀 `bun run` 包装层杀不到 vite 孙进程,须整树杀;POSIX 直杀。 */
function killTree(child: ChildProcess): void {
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* 已死 */
  }
}

function down(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[dev] ${reason},收掉两端…`);
  for (const { child } of procs) killTree(child);
}

async function waitHealthy(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

up(
  "serve",
  ["scripts/server.ts"],
  { PORT: ENGINE_PORT, ROOMS_DIR: process.env.ROOMS_DIR ?? "./tmp/dev-rooms" },
  "ignore",
);
if (!(await waitHealthy(ENGINE_URL, 15000))) {
  down("引擎服务器健康检查超时(看上面 [serve] 日志;常见:端口被占)");
  process.exit(1);
}
// vite 故意不套 --bun:2026-09-26 实测 Bun 运行时下 vite 的 ws 反代是僵尸管道——
// 升级请求能到引擎、数据帧回不来,联机永久连不上;Node 跑(裸 x vite,随 shebang)
// 一切正常。与 playwright runner 必须 Node 同款教训(bun 跑开发链路基建仍不可靠)。
up("vite", ["x", "vite"], {}, "inherit");

console.log("\x1b[32m[dev]\x1b[0m UI   → http://localhost:5173 (最新代码,热更新;联机/单机同源)");
console.log(
  `\x1b[32m[dev]\x1b[0m 引擎 → ${ENGINE_URL} (REST 大厅 + WS;/help 看接口;房间落盘 ./tmp/dev-rooms)`,
);
console.log("\x1b[32m[dev]\x1b[0m Ctrl+C 两端一起停");

for (const { label, child } of procs) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    down(`${label} 先退了(code=${code ?? signal})`);
    setTimeout(() => process.exit(code ?? 1), 400); // 留一拍让另一端的收尾日志打完
  });
}
process.on("SIGINT", () => {
  down("收到 Ctrl+C");
  process.exit(0);
});
process.on("SIGTERM", () => down("收到 SIGTERM"));

// 开发网页由 Vite 提供，HTTPS/WS 同源代理到独立的联机服务器。
import { spawn, type ChildProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline";

const preview = process.argv.includes("--preview");
const clientPort = preview ? (process.env.PORT ?? "3000") : "5173";
const ENGINE_PORT = preview
  ? (process.env.PLAY_ENGINE_PORT ?? "3002")
  : (process.env.PORT ?? "3001");
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

if (preview) {
  const build = Bun.spawn(["bun", "run", "build:client"], { stdout: "inherit", stderr: "inherit" });
  const code = await build.exited;
  if (code !== 0) process.exit(code);
  const clientUrl = `http://127.0.0.1:${clientPort}`;
  if (await waitHealthy(clientUrl, 1000)) {
    const index = await fetch(clientUrl);
    await index.body?.cancel();
    if (!index.ok || !index.headers.get("content-type")?.startsWith("text/html")) {
      console.error(`[play] ${clientPort} 已被联机服务占用。请选择空闲的 PORT 启动网页预览。`);
      process.exit(1);
    }
    console.log(`[play] 服务已在跑 → http://localhost:${clientPort}，刷新页面即可加载新快照。`);
    process.exit(0);
  }
}

up(
  "serve",
  ["apps/server/src/server.ts"],
  {
    HOST: "127.0.0.1",
    PORT: ENGINE_PORT,
    ROOMS_DIR: process.env.ROOMS_DIR ?? (preview ? "./tmp/play-rooms" : "./tmp/dev-rooms"),
    LOGS_DIR: process.env.LOGS_DIR ?? (preview ? "./tmp/play-logs" : "./tmp/dev-logs"),
  },
  "ignore",
);
if (!(await waitHealthy(ENGINE_URL, 15000))) {
  down("引擎服务器健康检查超时(看上面 [serve] 日志;常见:端口被占)");
  process.exit(1);
}
// vite 故意不套 --bun:2026-09-26 实测 Bun 运行时下 vite 的 ws 反代是僵尸管道——
// 升级请求能到引擎、数据帧回不来,联机永久连不上;Node 跑(裸 x vite,随 shebang)
// 一切正常。与 playwright runner 必须 Node 同款教训(bun 跑开发链路基建仍不可靠)。
up(
  "vite",
  ["x", "vite", ...(preview ? ["preview", "apps/client", "--port", clientPort] : ["apps/client"])],
  { DEV_ENGINE_URL: ENGINE_URL },
  "inherit",
);

console.log(`\x1b[32m[dev]\x1b[0m UI   → http://localhost:${clientPort}`);
if (preview) {
  for (const info of Object.values(networkInterfaces()).flat()) {
    if (info && !info.internal && info.family === "IPv4")
      console.log(`[play] 局域网 → http://${info.address}:${clientPort} (安卓设备)`);
  }
}
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

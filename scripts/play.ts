// 一键快照游玩(bun run play)—— build(定格当前代码进 dist/)+ 起引擎服务(:3000)。
//
// 与 dev 的分工:dev=开发线(5173 热更新,文件一动页面就变);play=快照线(3000 只端
// dist/,build 一次快照一次,浏览器 F5 生效)。serve 每次请求现读盘,故已在跑时无须
// 重启——build 完提示 F5 即玩;改了引擎(src/core/)或服务端(scripts/)要换引擎进程,
// 退出旧 serve(Ctrl+C)再跑本命令。
//
// env:PORT(默认 3000)/ ROOMS_DIR / STATIC_DIR 照常透传 server.ts,设了就以你为准。
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";
const ENGINE_URL = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;

function up(args: string[]): ChildProcess {
  const c = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [c.stdout, c.stderr]) {
    if (!stream) continue;
    createInterface({ input: stream }).on("line", (line) => console.log(`[serve] ${line}`));
  }
  return c;
}

/** Windows 下 child.kill 杀不到孙进程,须整树杀;POSIX 直杀。 */
function killTree(c: ChildProcess): void {
  try {
    if (process.platform === "win32" && c.pid) {
      spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      c.kill("SIGTERM");
    }
  } catch {
    /* 已死 */
  }
}

async function healthy(url: string, timeoutMs: number): Promise<boolean> {
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

function lanIPs(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && i.family === "IPv4")
    .map((i) => i!.address);
}

// ① 快照:build 失败即原样退出(dist/ 保持上一张快照,游戏不受影响)
const build = spawn("bun", ["run", "build"], { stdio: "inherit" });
const code = await new Promise<number>((resolve) => build.on("exit", (c) => resolve(c ?? 1)));
if (code !== 0) {
  console.error(`[play] build 失败(exit ${code}),快照未更新,继续玩上一张。`);
  process.exit(code);
}

// ② 已在跑:无须重启(serve 现读盘),F5 即新快照
if (await healthy(ENGINE_URL, 1500)) {
  console.log(`\n[play] 服务已在跑 → http://localhost:${PORT} —— 快照已更新,F5 即玩。`);
  console.log(`[play] (改了 src/core/ 或 scripts/ 才需重启引擎:退出旧 serve 再跑一次)`);
  process.exit(0);
}

// ③ 冷启动:起服务并等健康
child = up(["scripts/server.ts"]);
if (!(await healthy(ENGINE_URL, 15000))) {
  console.error("[play] 服务健康检查超时(看上面 [serve] 日志;常见:端口被占)");
  if (child.pid) killTree(child);
  process.exit(1);
}

console.log(
  `\x1b[32m[play]\x1b[0m 开玩 → http://localhost:${PORT} (快照=刚刚的 build,单机联机同源)`,
);
for (const ip of lanIPs()) console.log(`[play] 局域网 → http://${ip}:${PORT} (手机/平板真机)`);
console.log("[play] Ctrl+C 停服务");

process.on("SIGINT", () => {
  if (child) killTree(child);
  process.exit(0);
});
process.on("SIGTERM", () => {
  if (child) killTree(child);
  process.exit(0);
});

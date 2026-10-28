// e2e 陈旧服务器守门(globalSetup:webServer 就绪后、用例前跑一次):
// reuseExistingServer 会静默复用端口上的既有 preview——若那是并行会话/旧构建留下的,
// 整轮 e2e 就在「新 spec + 旧客户端」的错配世界上跑,假红一轮才现形(2026-10-17 实锤:
// 4173 上的旧 preview 被复用,联机族 21 例假红,烧掉一整轮才定位到端口)。
// 这里比对「本地 dist/index.html 引用的 bundle 集」与「服务器实际吐出的 bundle 集」,
// 不一致立即报错并指路换端口。比较引用集而非全文:对将来可能的 HTML 注入留余量,
// vite preview 按字节回吐,正常路径下集合逐字相等。
// 隔离协议(三件套 env)见 playwright.config.ts 头注。
//
// 环境水位探针(2026-10-29 retro):开跑与收尾各打一行 CPU/进程水位进日志。背景:
// #734 会话全量 7 挂烧掉 ~35min 归因,才定位 CPU 97% 满载(21 个非本会话进程)——
// 「墙钟超 2 倍判废」判据的输入靠事后取证太贵,现在首行即判:开跑高载=预期挂例
// 散布无关 spec,直接按过载轮处置(等窗口/串行复验),别进逐例排查。
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** win32 专用一行水位(cpu% + node/bun/msedge 进程计数);其余平台打印跳过说明。 */
function envProbe(): string {
  if (process.platform !== "win32") return "非 win32,探针跳过";
  const ps =
    "$cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).LoadPercentage; " +
    "$p=(Get-Process node,bun,msedge -ErrorAction SilentlyContinue | Group-Object ProcessName | " +
    'ForEach-Object { "$($_.Name)=$($_.Count)" }) -join " "; "cpu=$cpu% $p"';
  return execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}

export default async function globalSetup() {
  console.log(`[e2e-env] 开跑水位:${envProbe()}`);
  const port = process.env.E2E_STATIC_PORT ?? "4173";
  const local = readFileSync("dist/index.html", "utf8");
  const refs = (html: string) =>
    new Set(html.match(/(?:bundles|assets)\/[A-Za-z0-9._-]+\.(?:js|css)/g) ?? []);
  const localRefs = refs(local);
  if (localRefs.size === 0) {
    throw new Error(
      "[e2e-server] 本地 dist/index.html 读不到 bundle 引用——dist 缺失或损坏,先 build(bun run test:e2e 自带)。",
    );
  }
  const served = await (await fetch(`http://localhost:${port}/`)).text();
  const servedRefs = refs(served);
  const same =
    localRefs.size === servedRefs.size && [...localRefs].every((ref) => servedRefs.has(ref));
  if (!same) {
    throw new Error(
      `[e2e-server] 端口 ${port} 上的既有服务器服务的是旧 dist(陈旧 preview 被复用)。` +
        `换空闲端口重跑:E2E_STATIC_PORT=<端口> npx playwright test …` +
        `(多会话隔离协议见 playwright.config.ts 头注)。`,
    );
  }
  console.log(`[e2e-server] 服务器 dist 与本地一致(${localRefs.size} 个 bundle 引用)。`);
  // 收尾水位:归因失败集时与开跑行对照——收尾仍高载,挂例谱按过载族读;平载仍挂才谈真回归。
  return () => console.log(`[e2e-env] 收尾水位:${envProbe()}`);
}

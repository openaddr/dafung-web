import { defineConfig, devices } from "@playwright/test";

// ⚠️ runner 必须跑在 Node 上,不要迁 Bun(2026-09 实测 bun 1.4.0):①裸跑
// `bun run --bun playwright test` 会静默 exit 0 且 0 条用例执行(pw 的
// module.register TS/ESM loader 在 bun 下自杀,需 PW_DISABLE_TS_ESM=1 才能启动);
// ②能跑后全量 4.5m(node 1.9m),联机重型用例单跑 45s(node 12s)且并行必超时。
// runner 是纯开发工具,与产品运行时性能无关,node 只为此保留。

// 多 agent 并行跑 e2e 的隔离协议(全局把控者按 agent 分配互不相同的值):
//   E2E_STATIC_PORT  静态 preview 端口(默认 4173)
//   E2E_GAME_PORT    游戏服务器端口(默认 3010)
//   E2E_ROOMS_DIR    联机房间落盘目录(默认 ./tmp/e2e-rooms)
//   E2E_WORKERS      本 run 的 worker 数(默认不设,playwright 自决)
// 不设这些 env = 行为与历史完全一致(共享默认端口与目录)。
// 隔离的必要性:webServer 虽 reuseExistingServer,但"谁 spawn 谁杀"——B 复用 A 的
// server,A 跑完即杀,B 后续用例全部 connection refused;固定 ROOMS_DIR 则跨 run 互踩。
const STATIC_PORT = process.env.E2E_STATIC_PORT ?? "4173";
const GAME_PORT = process.env.E2E_GAME_PORT ?? "3010";
const ROOMS_DIR = process.env.E2E_ROOMS_DIR ?? "./tmp/e2e-rooms";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 重试本地与 CI 同为 1:已知负载 flake 家族(联机双端/scrolls 时序/sidebar 8 人局)
  // 几乎每轮全量都出 1-3 例单跑绿,过去每批门都要多跑一轮收尾。#106 的 10s 点击
  // 上限后真回归是确定性的(重试照挂,如 pendingLand 回归),重试不再掩盖问题。
  retries: 1,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 整个 run 的墙钟上限:单测 60s 是故意放长的(吸收骰子/行军动画与 bot 链的负载
  // 抖动),代价是系统性破坏(如弹层穿透)下每个挂例都烧满预算——实测 21 挂跑出
  // 16 分钟。15 分钟 = 绿跑(2 workers 约 5-7 分钟)的 2 倍余量,坏跑封顶不再拖垮节奏。
  globalTimeout: 15 * 60_000,
  use: {
    baseURL: `http://localhost:${STATIC_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Windows 用系统 Edge(免下载自带浏览器);Linux/macOS 回退 playwright 自带
        // chromium(~/.cache/ms-playwright 缓存,首次需 npx playwright install chromium)。
        ...(process.platform === "win32" && { channel: "msedge" }),
        // headless 无 GPU,WebGL 不可用会导致 3D 骰子 fallback。
        // 强制 swiftshader 软件渲染 WebGL,使 e2e 跑真实 3D 路径(与实机一致)。
        launchOptions: {
          args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  // 两个 webServer:热座用 vite preview(纯静态);联机用引擎服务器(托管 dist + WS)。
  // 两者都需要先 build 产出 dist/。端口/目录由顶部 env 决定(默认与历史一致)。
  webServer: [
    {
      command: `bun run --bun vite preview --port ${STATIC_PORT} --strictPort`,
      url: `http://localhost:${STATIC_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun scripts/server.ts",
      url: `http://localhost:${GAME_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        STATIC_DIR: "./dist",
        ROOMS_DIR,
        PORT: GAME_PORT,
        HOST: "127.0.0.1",
        // 联机机遇归零隔离(#135):服务器默认读 public/config/jiyu.json(触发率 40)，
        // e2e 换归零文件保持用例节奏与机遇开启前一致——机遇开启必须可隔离(#118 教训)。
        JIYU_CONFIG: "./e2e/jiyu-off.json",
      },
    },
  ],
});

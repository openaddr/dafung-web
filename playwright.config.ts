import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 用系统 Edge(chromium 内核)免下载 playwright 自带浏览器。
        // 注意:测试版本随本机 Edge 漂移(换机器需装 Edge);CI 场景删掉 channel 即回退下载版。
        channel: "msedge",
        // headless 无 GPU,WebGL 不可用会导致 3D 骰子 fallback。
        // 强制 swiftshader 软件渲染 WebGL,使 e2e 跑真实 3D 路径(与实机一致)。
        launchOptions: {
          args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  // 两个 webServer:热座用 vite preview(纯静态 4173);联机用引擎服务器(托管 dist + WS,3010)。
  // 两者都需要先 npm run build 产出 dist/。
  webServer: [
    {
      command: "bun run serve:e2e",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "bun run serve",
      url: "http://localhost:3010/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        STATIC_DIR: "./dist",
        ROOMS_DIR: "./tmp/e2e-rooms",
        PORT: "3010",
        HOST: "127.0.0.1",
      },
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";
import { basename } from "node:path";

// ⚠️ runner 必须跑在 Node 上,不要迁 Bun(2026-09 实测 bun 1.4.0):①裸跑
// `bun run --bun playwright test` 会静默 exit 0 且 0 条用例执行(pw 的
// module.register TS/ESM loader 在 bun 下自杀,需 PW_DISABLE_TS_ESM=1 才能启动);
// ②能跑后全量 4.5m(node 1.9m),联机重型用例单跑 45s(node 12s)且并行必超时。
// runner 是纯开发工具,与产品运行时性能无关,node 只为此保留。

// 多 agent 并行跑 e2e 的隔离协议:
//   E2E_STATIC_PORT  静态 preview 端口
//   E2E_GAME_PORT    游戏服务器端口
//   E2E_ROOMS_DIR    联机房间落盘目录
//   E2E_WORKERS      本 run 的 worker 数(默认不设,playwright 自决)
// 三旋钮默认已按 workspace 派生,显式 env 仍可覆盖(#658):缺省值从 workspace 身份
// (basename(process.cwd()))派生——同名恒同端口(hash 是确定性函数,无随机,
// 同一 workspace 名每次解析同值),多 workspace 并行天然互不撞端口、互不抢 rooms
// 目录;单 workspace/CI 同样解析出确定值。派生值同时发布回进程 env(见下),
// globalSetup 与联机 spec 的直读口据此拿到与 webServer 一致的解析结果。
// 显式 env 最高优先,语义不变;端口空串兜派生默认(#807):`||` 而非 `??`——空串
// (后台壳吞行内赋值的产物)与未设同回默认;空串的教育由 e2e/global-setup.ts 的
// 响亮错误负责,config 不重复红。
// 隔离的必要性:webServer 虽 reuseExistingServer,但"谁 spawn 谁杀"——B 复用 A 的
// server,A 跑完即杀,B 后续用例全部 connection refused;固定 ROOMS_DIR 则跨 run 互踩。
const WS = basename(process.cwd());
// FNV-1a 32 位:确定性哈希选型只求稳定性(同名恒同输出),无新依赖;不追求均匀性,
// 异名撞同 offset 概率 1/60,撞了走显式 env(隔离协议本意)。
function hashWs(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const WS_PORT = hashWs(WS) % 60;
const STATIC_PORT = process.env.E2E_STATIC_PORT || String(4100 + WS_PORT);
const GAME_PORT = process.env.E2E_GAME_PORT || String(3510 + WS_PORT);
const ROOMS_DIR = process.env.E2E_ROOMS_DIR ?? `./tmp/e2e-rooms-${WS}`;
// 派生值发布回进程 env(#658):config 之外另有直读 env 的消费口——globalSetup 的
// 陈旧服务器守门(E2E_STATIC_PORT,同进程)与联机 spec 的 ONLINE/rooms 观测口
// (E2E_GAME_PORT/E2E_ROOMS_DIR,worker 继承)——不发布则 env 未设时它们各自落到
// 旧硬编码默认,与 webServer 实际端口错位。??=:只补未设,显式 env(含空串)原样
// 保留,空串教育仍在 global-setup。
if (process.env.E2E_STATIC_PORT == null) process.env.E2E_STATIC_PORT = STATIC_PORT;
if (process.env.E2E_GAME_PORT == null) process.env.E2E_GAME_PORT = GAME_PORT;
if (process.env.E2E_ROOMS_DIR == null) process.env.E2E_ROOMS_DIR = ROOMS_DIR;

export default defineConfig({
  testDir: "./e2e",
  // 陈旧服务器守门:webServer 就绪后、用例前比对「本地 dist 引用的 bundle 集」与
  // 「服务器实际吐出的」,不一致即报错指路换端口(2026-10-17 实锤:4173 旧 preview
  // 被复用,联机族 21 例假红;守门原理见 e2e/global-setup.ts 头注)。
  globalSetup: "./e2e/global-setup.ts",
  // e2e 产物(trace/失败截图/视频)进 tmp/:与 shot.mjs 工作区同区,gitignore 单点覆盖
  outputDir: "tmp/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 重试本地与 CI 同为 1:已知负载 flake 家族(联机双端/scrolls 时序/sidebar 8 人局)
  // 几乎每轮全量都出 1-3 例单跑绿,过去每批门都要多跑一轮收尾。#106 的 10s 点击
  // 上限后真回归是确定性的(重试照挂,如 pendingLand 回归),重试不再掩盖问题。
  retries: 1,
  workers: process.env.E2E_WORKERS
    ? Number(process.env.E2E_WORKERS)
    : process.env.CI
      ? 1
      : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 整个 run 的墙钟上限:单测 60s 是故意放长的(吸收骰子/行军动画与 bot 链的负载
  // 抖动),代价是系统性破坏(如弹层穿透)下每个挂例都烧满预算——实测 21 挂跑出
  // 16 分钟。本地默认 15 分钟 = 绿跑(2 workers 约 5-7 分钟)的 2 倍余量,坏跑封顶
  // 不再拖垮节奏。CI 单核 workers=1 全量要 ~25-35 分钟,由 ci.yml 传
  // E2E_GLOBAL_TIMEOUT=30 放宽(env 单位:分钟)。
  globalTimeout:
    (process.env.E2E_GLOBAL_TIMEOUT ? Number(process.env.E2E_GLOBAL_TIMEOUT) : 15) * 60_000,
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
        // 反应窗加长通道(#284,#626 加固 8s→15s):窗寿必须盖过 4-worker 帧停滞的
        // 最坏观测延迟——横幅是瞬态,窗开又关 = 等窗 helper 永远等不到(原 8s×渲染
        // 赛跑是 flake 家族)。react-reaction-online.spec 的 fallback 与此值成对改。
        // 客户端横幅读快照 view.windowMs,两端同长自动成立。
        E2E_REACTION_MS: "15000",
        // bot 配速关隔离(#730):生产 bot 按 core BOT_STEP_MS 逐拍下行(演出可读),
        // e2e 的 bot 连锁节奏(种子局核算/窗闭沿冲洗)按 0ms 保墙钟,与机遇归零同款隔离。
        E2E_BOT_STEP_MS: "0",
      },
    },
  ],
});

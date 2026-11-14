// 物理成本取数器(#1222):自起 vite preview + headless chromium(playwright 直驱),
// 实测「挂载链(goto→__dafung 桥可用)→ seedSolo 种局 → 首掷行军链(waitMyRollDone
// +waitSettled)」三段耗时 + 资源按名聚合表,输出人读表 + JSON 表。
//
// ⚠️ 定位:纯取数工具,**不进任何门禁**。测试耗时讨论先跑本工具拿数,禁拍脑袋——
// 谈「e2e 为什么慢/开局链该不该优化」之前,先 `bun run probe:cost` 拿物理成本事实。
//
// 用法:bun run probe:cost [--seed 1101] [--runs 1]   (底层恒 node 直跑,见 package.json——
//   bun 驱动 playwright 有挂起前科,frame-probe 同款纪律)
//   --seed            对局种子(缺省 1101;改码前后同 seed A/B)
//   --runs N          同 seed 重复 N 遍取中位(#1273 亚段打点定版口径:A/B 各 5 遍);
//                     每遍独立 browser context(HTTP 缓存/IDB/localStorage 全冷,与
//                     e2e 每例新 context 同形制),默认 1 = 旧单遍形制不变
//   COST_PROBE_PORT   preview 端口显式覆盖(最高优先,撞口时用)
//
// 亚段打点回读(#1273):页内 seedSolo/loadMapData 段打 performance.measure(名字
// 统一 `df.` 前缀,实体在 src/app/controllers/registry.ts seedSolo 与
// src/app/map-sources.ts),本工具每遍 evaluate 回读 getEntriesByType("measure")
// 过滤 df.* 按名聚合出亚段表。改前基线(无打点)该表为空属预期,如实标注。
// 挂载段顺读 FCP(paint timing;起点=navigationStart,读数时机晚读不晚准)。
//
// 端口:scripts/dev-ports.ts staticPreviewPort 单源派生,派生名 = workspace 目录名
// + "-cost-probe" 后缀——与 e2e 静态 preview 同族不同名,同 workspace 里 e2e 正跑也
// 不撞口(同处 4100-4159 段,异名撞同 offset 概率 1/60,撞了走 COST_PROBE_PORT 覆盖);
// **不走 test-lock**,不碰 e2e 测试锁(取数与回归测试互不排队)。测量档:dist 生产
// 构建(陈旧自动 build,dist-freshness 判新——先 build 后起服,vite preview 空 dist
// 即退)+ 844×390 DPR3 真机档 + swiftshader 软渲染(playwright.config 同款,
// headless 渲染环境稳定可复现)+ **e2e fixtures 同款五键注入**(倍率 0.25/桥/反应窗
// 5s/bot 配速 0/默认图钉关中,e2e/fixtures.ts 同值同形制)——waitMyRollDone/
// waitSettled 就是 e2e 镜头下的形制,bot 配速不归零光 Setup 选都三 bot 就 ≥9s
// (BOT_STEP_MS=3000 实测),2026-11-07 基线数 271/668/3458 同此口径,同形制才可比。
// 探针原理(#1222 一次性版实测 271/668/3458ms 后正式化):goto 后 waitForFunction
// (__dafung) 计挂载链,顺读 navigation/resource timing;performance.now 包 seedSolo
// evaluate;waitMyRollDone+waitSettled 轮询体逐拍放行出牌阶段(react-helpers.ts
// 同逻辑,本地复刻不 import——e2e/ 面属测试域,工具不反向依赖)。
import { basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { staticPreviewPort } from "./dev-ports.ts";
import { distFreshness } from "./dist-freshness.ts";
import { MOBILE_CONTEXT_OPTIONS } from "./mobile-context.ts";

// ── 参数面 ──
let SEED = 1101;
let RUNS = 1;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--seed") SEED = Number(argv[++i]);
  if (argv[i] === "--runs") RUNS = Number(argv[++i]);
}
if (!Number.isInteger(SEED)) throw new Error(`--seed 须为整数,收到:${process.argv.join(" ")}`);
if (!Number.isInteger(RUNS) || RUNS < 1)
  throw new Error(`--runs 须为 ≥1 整数,收到:${process.argv.join(" ")}`);
const PORT =
  Number(process.env.COST_PROBE_PORT) || staticPreviewPort(`${basename(process.cwd())}-cost-probe`);
const URL = `http://localhost:${PORT}/`;
const win = process.platform === "win32";
// win 侧 shell:true 是本仓 spawn bun 的正典形制(e2e-one.ts/frame-probe.ts 同款)——
// node spawn 无 shell 解析不到 PATH 上的 bun(ENOENT 实测);代价是 DEP0190 一行
// 弃用警告,认了(杀树走 taskkill /T,壳 pid 照样全灭)。
const sh = (cmd: string, args: string[]) => spawn(cmd, args, { shell: win, stdio: "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitServer(url: string, timeoutMs = 30000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 未就绪,继续轮询 */
    }
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`preview 服务器 ${timeoutMs}ms 未就绪(端口 ${PORT})`);
    await sleep(300);
  }
}

function killTree(pid: number): void {
  if (win) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else spawnSync("kill", ["-TERM", "--", "-" + String(pid)], { stdio: "ignore" });
}

/** 工具级看门狗:段级等待自带超时,evaluate 类无内建——挂死取数器是最坏结局,
 *  到点响亮报错(Ctrl+C 之外的兜住方式),不吞不改。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`${label} 超过 ${ms}ms 未完成(疑似挂死,现场另取证)`);
    }),
  ]);
}

// ── waitMyRollDone/waitSettled(react-helpers.ts 同逻辑,本地复刻)──
const TID_PASS = "actionbar-pass"; // 各屏 testids.ts 单源的现役挂点;scripts 侧不进 testids 闸

/** 等人类当前一手自动走完(#188 行军自动化;seat=0 单机人类):逐拍放行出牌阶段,
 *  直到决策方换人 / 我的回合推进过掷骰 / 终局。 */
async function waitMyRollDone(page: Page, timeoutMs = 30000): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const jp = page.getByTestId(TID_PASS);
    if (await jp.isVisible().catch(() => false)) await jp.click({ timeout: 5000 }).catch(() => {});
    const s = (await page.evaluate(() => (window as any).__dafung.snapshot())) as {
      phase: string;
      decisionOwner: number;
      turnPhase: string;
    };
    const done =
      s.phase === "GameOver" ||
      (s.phase === "Playing" &&
        (s.decisionOwner !== 0 || (s.turnPhase !== "Roll" && s.turnPhase !== "AwaitingJinnang")));
    if (done) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`waitMyRollDone ${timeoutMs}ms 未走完(phase=${s.phase}/${s.turnPhase})`);
    await sleep(200);
  }
}

/** 等局面稳定:连续两次引擎快照一致(300ms 间隔,400ms 轮询;同 waitSettled)。 */
async function waitSettled(page: Page, timeoutMs = 30000): Promise<number> {
  const t0 = Date.now();
  await page.waitForFunction(
    async () => {
      const read = () => JSON.stringify((window as any).__dafung.snapshot());
      const a = read();
      await new Promise((r) => setTimeout(r, 300));
      return a === read();
    },
    undefined,
    { timeout: timeoutMs, polling: 400 },
  );
  return Date.now() - t0;
}

/** 新开一测冷 context(独立 browser context = HTTP 缓存/IDB/localStorage 全冷,
 *  与 e2e 每例新 context 同形制)+ 五键注入(e2e/fixtures.ts 同值同形制)。 */
async function newColdContext(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...MOBILE_CONTEXT_OPTIONS,
    deviceScaleFactor: 3,
  });
  // 五键注入 = e2e/fixtures.ts 同值同形制(键名是 timings.ts/App.tsx 单源字面,
  // scripts 侧不 import src 模块——@core 别名在 node 直跑下不解析,frame-probe 同款
  // 字面 + 注释锚定单源)。值面:e2e 默认 = 倍率 0.25 / 反应窗 5s / bot 配速 0。
  await ctx.addInitScript(() => {
    localStorage.setItem("dafung-e2e-debug-bridge", "1"); // 双门禁桥键(E2E_DEBUG_BRIDGE_KEY)
    localStorage.setItem("dafung-e2e-time-scale", "0.25"); // E2E_TIME_SCALE_KEY
    localStorage.setItem("dafung-e2e-reaction-ms", "5000"); // E2E_REACTION_MS_KEY
    localStorage.setItem("dafung-e2e-bot-step-ms", "0"); // E2E_BOT_STEP_MS_KEY(关配速)
    localStorage.setItem("dafung.mapId", "guanzhong"); // MAP_PREF_KEY(默认图,fixtures 同钉)
  });
  return ctx;
}

// ── 单遍测量 ──
interface MeasureRow {
  name: string;
  ms: number;
}
interface ResourceRow {
  name: string;
  transferKB: number;
  decodedKB: number;
  ms: number;
}
interface RunResult {
  run: number;
  mount: { total: number; htmlFetch: number; dcl: number; fcp: number };
  seedSolo: number;
  firstRoll: { total: number; waitMyRollDone: number; waitSettled: number };
  total: number;
  measures: MeasureRow[];
  resources: ResourceRow[];
}

async function measureOnce(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  run: number,
): Promise<RunResult> {
  const ctx = await newColdContext(browser);
  try {
    const page = await ctx.newPage();

    const mountT0 = performance.now();
    await page.goto(URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => (window as any).__dafung != null, undefined, {
      polling: 25,
      timeout: 30000,
    });
    const mountMs = Math.round(performance.now() - mountT0);
    const nav = (await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (!n) return null;
      return {
        htmlFetch: Math.round(n.responseEnd - n.requestStart),
        dcl: Math.round(n.domContentLoadedEventEnd),
      };
    })) as { htmlFetch: number; dcl: number } | null;

    const seedSoloMs = Math.round(
      await withTimeout(
        page.evaluate(async (seed) => {
          const t0 = performance.now();
          await (window as any).__dafung.seedSolo({ seed });
          return performance.now() - t0;
        }, SEED),
        60000,
        "seedSolo",
      ),
    );

    const rollMs = await waitMyRollDone(page);
    const settleMs = await waitSettled(page);

    // FCP 绝对时刻(started at navigationStart;桥可能先于首渲可用,故行军链后再读)。
    const fcp = await page.evaluate(() => {
      const p = performance
        .getEntriesByType("paint")
        .find((e) => e.name === "first-contentful-paint");
      return p ? Math.round(p.startTime) : -1;
    });

    // 亚段打点回读(df.* 前缀;实体见 registry.ts seedSolo / map-sources.ts)。
    const measures = (await page.evaluate(() =>
      performance
        .getEntriesByType("measure")
        .filter((m) => m.name.startsWith("df."))
        .map((m) => ({ name: m.name, ms: Math.round(m.duration * 10) / 10 })),
    )) as MeasureRow[];

    // 浏览器侧只取原始字节(evaluate 回调是序列化后执行的,Node 侧助手够不着),
    // KB 换算回 Node 做。
    const rawResources = (await page.evaluate(() =>
      performance.getEntriesByType("resource").map((e) => {
        const r = e as PerformanceResourceTiming;
        return {
          name: r.name.split("/").pop() || r.name,
          transfer: r.transferSize,
          decoded: r.decodedBodySize,
          ms: Math.round(r.duration),
        };
      }),
    )) as { name: string; transfer: number; decoded: number; ms: number }[];
    const resources: ResourceRow[] = rawResources.map((r) => ({
      name: r.name,
      transferKB: kb(r.transfer),
      decodedKB: kb(r.decoded),
      ms: r.ms,
    }));

    return {
      run,
      mount: { total: mountMs, htmlFetch: nav?.htmlFetch ?? -1, dcl: nav?.dcl ?? -1, fcp },
      seedSolo: seedSoloMs,
      firstRoll: { total: rollMs + settleMs, waitMyRollDone: rollMs, waitSettled: settleMs },
      total: mountMs + seedSoloMs + rollMs + settleMs,
      measures,
      resources,
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ── 聚合面 ──
const median = (xs: number[]): number => {
  if (xs.length === 0) return -1;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
interface MeasureAgg {
  name: string;
  values: number[];
  median: number;
}
const aggregateMeasures = (runs: RunResult[]): MeasureAgg[] => {
  const byName = new Map<string, number[]>();
  for (const r of runs)
    for (const m of r.measures) {
      const list = byName.get(m.name);
      if (list == null) byName.set(m.name, [m.ms]);
      else list.push(m.ms);
    }
  return [...byName.entries()]
    .map(([name, values]) => ({ name, values, median: median(values) }))
    .sort((a, b) => b.median - a.median);
};
interface ResourceAgg {
  name: string;
  count: number;
  medianMs: number;
  medianKB: number;
}
const aggregateResources = (runs: RunResult[]): ResourceAgg[] => {
  const byName = new Map<string, { ms: number[]; kb: number[] }>();
  for (const r of runs)
    for (const res of r.resources) {
      const e = byName.get(res.name);
      if (e == null) byName.set(res.name, { ms: [res.ms], kb: [res.decodedKB] });
      else {
        e.ms.push(res.ms);
        e.kb.push(res.decodedKB);
      }
    }
  return [...byName.entries()]
    .map(([name, e]) => ({
      name,
      count: e.ms.length,
      medianMs: median(e.ms),
      medianKB: median(e.kb),
    }))
    .sort((a, b) => b.medianMs - a.medianMs);
};

const kb = (b: number) => Math.round(b / 102.4) / 10;

let server: ReturnType<typeof sh> | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  // 段 1:dist 新鲜即跳(frame-probe 同款判新;陈旧 dist 量出来的是旧世界的成本)。
  // 先 build 后起服——vite preview 对空 dist 直接退,起早了白起。
  const fresh = distFreshness();
  if (!fresh.fresh) {
    console.log(`[probe] dist 陈旧(${fresh.reason}),build…`);
    const build = spawnSync("bun", ["run", "build"], { shell: win, stdio: "inherit" });
    if (build.error) throw build.error;
    if (build.status !== 0)
      throw new Error(`build 失败(exit ${build.status},signal ${build.signal})`);
  }
  server = sh("bun", ["run", "--bun", "vite", "preview", "--port", String(PORT), "--strictPort"]);
  await waitServer(URL);

  // 段 2:N 遍冷 context 测量。桥键 = 生产构建双门禁(timings.ts E2E_DEBUG_BRIDGE_KEY
  // 单源字面);种局走 seedSolo 快路径(机遇硬关是 seedSolo 内建语义),seed 经
  // evaluate 参数传入。
  browser = await chromium.launch({
    ...(win && { channel: "msedge" }),
    headless: true,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const runs: RunResult[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await measureOnce(browser, i);
    runs.push(r);
    console.log(
      `[probe] 第 ${i}/${RUNS} 遍:mount ${r.mount.total}ms / seedSolo ${r.seedSolo}ms / firstRoll ${r.firstRoll.total}ms`,
    );
  }

  const med = {
    mount: median(runs.map((r) => r.mount.total)),
    htmlFetch: median(runs.map((r) => r.mount.htmlFetch)),
    dcl: median(runs.map((r) => r.mount.dcl)),
    fcp: median(runs.map((r) => r.mount.fcp)),
    seedSolo: median(runs.map((r) => r.seedSolo)),
    firstRoll: median(runs.map((r) => r.firstRoll.total)),
    roll: median(runs.map((r) => r.firstRoll.waitMyRollDone)),
    settle: median(runs.map((r) => r.firstRoll.waitSettled)),
    total: median(runs.map((r) => r.total)),
  };
  const measureAgg = aggregateMeasures(runs);
  const resourceAgg = aggregateResources(runs);

  // 段 3:报告(人读表 + JSON 表;JSON 块整体可复制入讨论/台账)
  console.log("\n═══ 物理成本取数(probe:cost)═══");
  console.log(
    `种子=${SEED}  遍数=${RUNS}(各遍独立冷 context,取中位)  档=dist/preview + 844x390@3x + swiftshader + e2e倍率0.25`,
  );
  console.log(
    `挂载链(goto→桥可用)     ${String(med.mount).padStart(6)}ms  (html fetch ${med.htmlFetch}ms / DCL ${med.dcl}ms / FCP ${med.fcp}ms)`,
  );
  console.log(`seedSolo 种局            ${String(med.seedSolo).padStart(6)}ms`);
  console.log(
    `首掷行军链               ${String(med.firstRoll).padStart(6)}ms  (waitMyRollDone ${med.roll}ms / waitSettled ${med.settle}ms)`,
  );
  console.log(`合计(goto→首回合停稳)   ${String(med.total).padStart(6)}ms`);

  console.log("\n── 亚段 measures(df.* 前缀,中位;遍值列出)──");
  if (measureAgg.length === 0) {
    console.log("(无 df.* measures——改前基线无打点,属预期)");
  }
  for (const m of measureAgg) {
    console.log(`${String(m.median).padStart(8)}ms  ${m.name}  [${m.values.join(", ")}]`);
  }

  console.log("\n── 资源(按名聚合;count=总拉取次数,双取会现形)──");
  for (const r of resourceAgg.slice(0, 12)) {
    console.log(
      `x${String(r.count).padStart(2)}  ${String(r.medianMs).padStart(6)}ms  ${String(r.medianKB).padStart(8)}KB  ${r.name}`,
    );
  }

  console.log("\n── JSON ──");
  console.log(
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        seed: SEED,
        runsN: RUNS,
        url: URL,
        profile: "dist/preview + 844x390@3x + swiftshader + e2e倍率0.25",
        median: {
          mount: { total: med.mount, htmlFetch: med.htmlFetch, dcl: med.dcl, fcp: med.fcp },
          seedSolo: med.seedSolo,
          firstRoll: { total: med.firstRoll, waitMyRollDone: med.roll, waitSettled: med.settle },
          total: med.total,
        },
        runs: runs.map((r) => ({
          run: r.run,
          mount: r.mount,
          seedSolo: r.seedSolo,
          firstRoll: r.firstRoll,
          total: r.total,
        })),
        measures: measureAgg,
        resources: resourceAgg,
      },
      null,
      2,
    ),
  );
  console.log("═══ 取数完 ═══");
} catch (err) {
  console.error("[FAIL]", err instanceof Error ? err.message.split("\n")[0] : String(err));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server?.pid != null) killTree(server.pid);
}

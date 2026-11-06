// 帧率薄弱点检测(ADR-0047 消费面;#1028 渲染深排查后续)。
// 干什么:自动开一局真机档(844×390 DPR3)单机托管对局,吃游戏内置帧诊采样器
// (frameDiag.ts,GameScreen 挂载即采),到点经 window.__dafung.frameDiag() 读数,
// 按 判读表(docs/how-to/开发与测试.md「真机取证」节)输出薄弱点报告——纯报告零断言,
// 不进门禁;改演出/棋盘视觉后、发版前跑一次,desktop 代理也能抓主线程侧薄弱点
// (栅格侧仍以真机 JSON 为准)。
// 用法:node scripts/frame-probe.ts   (bun 跑 playwright 有超时前科,恒 node 直跑 TS)
//   FRAME_PROBE_MS     采样窗(默认 20000;GameScreen 挂载起采,含开局前奏)
//   FRAME_PROBE_SEED   对局种子(默认 7,固定种子便于改码前后 A/B)
//   FRAME_PROBE_PORT   preview 端口(默认 4330,撞车换口)
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { distFreshness, stampDistBuild } from "./dist-freshness.ts";

const MS = Number(process.env.FRAME_PROBE_MS ?? 20000);
const SEED = process.env.FRAME_PROBE_SEED ?? "7";
const PORT = Number(process.env.FRAME_PROBE_PORT ?? 4330);
const URL = `http://localhost:${PORT}/?seed=${SEED}`;
const win = process.platform === "win32";
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
    if (Date.now() - t0 > timeoutMs) throw new Error(`preview 服务器 ${timeoutMs}ms 未就绪`);
    await sleep(300);
  }
}

function killTree(pid: number): void {
  if (win) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else spawnSync("kill", ["-TERM", "--", "-" + String(pid)], { stdio: "ignore" });
}

// ── 报告排版助手 ──
interface Ctx {
  marching: number;
  floaters: number;
  seals: number;
  cashFlies: number;
  jinnangLines: number;
  pulses: number;
}
const ctxStr = (c: Ctx): string => {
  const on = Object.entries(c)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`);
  return on.length ? on.join(" ") : "静止";
};
const bar = (n: number, w = 34): string =>
  "█".repeat(Math.min(w, Math.round((n / 200) * w))) || "·";

const server = sh("bun", [
  "run",
  "--bun",
  "vite",
  "preview",
  "--port",
  String(PORT),
  "--strictPort",
]);
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  // 段 1:dist 新鲜即跳(#986 同款判新,存疑必 build)
  const fresh = distFreshness();
  if (!fresh.fresh) {
    console.log(`[probe] dist 陈旧(${fresh.reason}),build…`);
    spawnSync("bun", ["run", "build"], { shell: win, stdio: "inherit" });
    stampDistBuild();
  }
  await waitServer(URL);

  // 段 2:真机档开一局托管对局(autopilot 前置=无人值守,diag spec 同款)
  browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
  });
  await ctx.addInitScript(() => {
    localStorage.setItem("dafung-e2e-debug-bridge", "1"); // 双门禁桥键(timings.ts 单源字面)
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByTestId("home-solo").click({ timeout: 15000 });
  await page.getByTestId("start-game").click({ timeout: 15000 });
  await page.locator(".bv-tile.bv-selectable").nth(0).click({ timeout: 20000 });
  await page.getByTestId("confirm-capital-ok").click({ timeout: 15000 });
  const pass = page.getByTestId("actionbar-pass");
  if (await pass.isVisible().catch(() => false))
    await pass.click({ timeout: 5000 }).catch(() => {});
  // 开托管(#1097 通路:设置弹层「托管」开关;设置钮 DOM 直派防遮罩吞点击,
  // diag spec 同款前置)
  await page.getByTestId("settings-button").dispatchEvent("click");
  const sw = page.getByTestId("settings-autopilot");
  await sw.waitFor({ timeout: 5000 });
  await sw.click();
  await page.keyboard.press("Escape");

  // 段 3:采样窗(帧诊自 GameScreen 挂载起采,窗口 5s 一档)
  console.log(`[probe] 采样 ${MS}ms(种子 ${SEED},托管无人值守)…`);
  await page.waitForTimeout(2000);
  await page.waitForTimeout(MS);
  // scripts 侧无 debug.d.ts 全局面:桥形状本地最小声明(与 src/app/debug.d.ts 同形)
  const dump = (await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        __dafung?: { frameDiag?: () => unknown };
      }
    ).__dafung;
    return bridge?.frameDiag?.() ?? null;
  })) as import("./../src/app/frameDiag.ts").FrameDiagDump | null;
  if (dump == null) throw new Error("frameDiag 桥无读数(桥键未生效或采样器未挂)");

  // 段 4:判读表报告
  const ws = dump.windows.filter((w) => w.frames > 0);
  const worst = [...ws].sort((a, b) => b.p95 - a.p95);
  const totalFrames = ws.reduce((a, w) => a + w.frames, 0);
  console.log("\n═══ 帧诊薄弱点报告 ═══");
  console.log(
    `loafSupported=${dump.loafSupported}  窗数=${ws.length}  总帧=${totalFrames}  jank(>50ms)=${dump.jank.length}`,
  );
  console.log("\n── 窗明细(每窗 5s;p95 柱长 ∝ ms/200)──");
  for (const w of ws) {
    console.log(
      `t=${String(Math.round(w.t0)).padStart(6)}ms  p50=${String(w.p50).padStart(5)}  p95=${String(w.p95).padStart(6)}  max=${String(w.max).padStart(6)} ${bar(w.p95)}  lt=${w.longTasks}  loaf[s=${Math.round(w.loafScriptMs)}/sl=${Math.round(w.loafStyleLayoutMs)}]  ${ctxStr(w.ctx)}`,
    );
  }
  console.log("\n── 薄弱点 TOP5(p95 降序)──");
  for (const w of worst.slice(0, 5)) {
    console.log(`t=${Math.round(w.t0)}ms  p95=${w.p95}ms max=${w.max}ms  ${ctxStr(w.ctx)}`);
  }
  if (dump.jank.length) {
    console.log("\n── jank 事件 TOP5(帧距>50ms)──");
    for (const j of [...dump.jank].sort((a, b) => b.deltaMs - a.deltaMs).slice(0, 5)) {
      console.log(`t=${Math.round(j.t)}ms  gap=${Math.round(j.deltaMs)}ms  ${ctxStr(j.ctx)}`);
    }
  }
  if (dump.slowFrames.length) {
    console.log("\n── LoAF 慢帧 TOP5(script vs style+layout 分账)──");
    for (const f of [...dump.slowFrames].sort((a, b) => b.durMs - a.durMs).slice(0, 5)) {
      console.log(
        `t=${Math.round(f.t)}ms  dur=${Math.round(f.durMs)}ms  script=${Math.round(f.scriptMs)}ms  style+layout=${Math.round(f.styleLayoutMs)}ms`,
      );
    }
  }
  // 判读表提示(docs/how-to「真机取证」节同口径)
  const s = worst.reduce((a, w) => a + w.loafScriptMs, 0);
  const sl = worst.reduce((a, w) => a + w.loafStyleLayoutMs, 0);
  let hint: string;
  if (!dump.loafSupported) hint = "LoAF 盲区(WebView 旧):慢帧归因看 jank 分布与真机 JSON";
  else if (s > sl * 2 && s > 0) hint = "script 重 → 演出积压型(JS 侧查演出/重渲)";
  else if (sl > s * 2 && sl > 0) hint = "style+layout 重 → 回流型(查 layout 触发面)";
  else if (dump.jank.length > 0) hint = "LoAF 轻 + 帧距宽 → 栅格型(合成器/GPU 侧,JS 无辜)";
  else hint = "无薄弱点(本窗全绿)";
  console.log(`\n判读:${hint}`);
  console.log("═══ 报告完 ═══\n");
} catch (err) {
  console.error("[FAIL]", err instanceof Error ? err.message.split("\n")[0] : String(err));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  killTree(server.pid!);
}

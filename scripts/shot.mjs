// 截图自证脚手架(单源,2026-09-25 定——耗时回顾发现 T1-T4 五个代理各手写一份
// 起服/PID 杀/就绪轮询/swiftshader/路由 mock/enterGame/force 样板,每份 20-40min)。
//
// 用法:临时场景脚本放 tmp/(gitignore),只写「局面与断言」,样板全走这里:
//   import { openShotSession } from "../scripts/shot.mjs";
//   const s = await openShotSession({ port: 5301, viewport: { width: 844, height: 390 } });
//   await s.enterGame(49);
//   await s.force(`e.players[0].jinnangHand = ["连环计"];`);
//   await s.shot("tmp/ui-shots/x/full.png");                     // 整页
//   await s.shot("tmp/ui-shots/x/scroll.png", '[data-testid="scroll-jinnang"]'); // 元素级
//   await s.close();
// 跑法:先 `flock tmp/build.lock bun run build`(preview 服务 dist),再 `node tmp/<场景>.mjs`。
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

export async function openShotSession({
  port = 5300,
  viewport = { width: 1280, height: 800 },
  deviceScaleFactor = 2,
  /** true = 落格机遇关零(确定性无机遇卷轴;默认不 mock,读真实 public/config/jiyu.json)。 */
  zeroEncounter = false,
  /** 建局后等待的卷轴 testid(如 "scroll-jinnang";不等待传 null)。 */
  waitScroll = null,
} = {}) {
  const vite = spawn("bunx", ["vite", "preview", "--port", String(port), "--strictPort"], {
    stdio: "ignore",
    detached: true, // 独立进程组:杀组连带子进程(记录 PID,不用 pkill 防误伤)
  });
  const killVite = () => {
    if (vite.pid != null && vite.exitCode === null && vite.signalCode === null) {
      process.kill(-vite.pid, "SIGTERM");
    }
  };
  process.on("exit", killVite);

  const url = `http://localhost:${port}/`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(url).then((r) => r.ok).catch(() => false);
  }
  if (!up) {
    killVite();
    throw new Error(`vite ${port} 30s 未就绪(先 flock tmp/build.lock bun run build?)`);
  }

  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.addInitScript(() => localStorage.setItem("E2E_TIME_SCALE", "0.25")); // 演出加速,同 e2e
  if (zeroEncounter) {
    await page.route("**/config/jiyu.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ triggerRate: 0, baseRates: { good: 0, neutral: 0, bad: 0 } }),
      }),
    );
  }

  return {
    page,
    /** 整页或元素级截图(path 目录自动建;locator 给 CSS 选择器串)。 */
    async shot(path, locator = null) {
      mkdirSync(dirname(path), { recursive: true });
      if (locator) await page.locator(locator).screenshot({ path });
      else await page.screenshot({ path });
      console.log("shot ->", path);
    },
    /** 走到对局中:选都确认落定(可再等首个决策卷轴)。 */
    async enterGame(seed = 49) {
      await page.goto(seed != null ? `${url}?seed=${seed}` : url);
      await page.getByTestId("home-screen").waitFor();
      await page.getByTestId("home-solo").click();
      await page.getByTestId("start-game").click();
      await page.locator(".bv-tile.bv-selectable").first().waitFor({ timeout: 30000 });
      await page.locator(".bv-tile.bv-selectable").first().click();
      await page.getByTestId("confirm-capital-ok").waitFor({ timeout: 15000 });
      await page.getByTestId("confirm-capital-ok").click();
      if (waitScroll) await page.getByTestId(waitScroll).waitFor({ timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
    },
    /** 引擎直写改局(同步灌回 UI):fn 体内 `e` = GameEngine。 */
    async force(fn) {
      await page.evaluate(`(() => { const e = window.__dafung.getEngine(); ${fn} window.__dafung.controller().sync(); })()`);
    },
    async close() {
      await browser.close();
      killVite();
    },
  };
}

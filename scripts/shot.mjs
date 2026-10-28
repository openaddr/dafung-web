// 截图自证脚手架(单源,2026-09-25 定——耗时回顾发现 T1-T4 五个代理各手写一份
// 起服/PID 杀/就绪轮询/swiftshader/路由 mock/enterGame/force 样板,每份 20-40min)。
//
// 用法:临时场景脚本放 tmp/(gitignore),只写「局面与断言」,样板全走这里:
//   import { openShotSession } from "../scripts/shot.mjs";
//   const s = await openShotSession({ port: 5301 }); // 视口默认 844×390(移动横屏标准档,#733)
//   await s.enterGame(49);
//   await s.force(`e.players[0].jinnangHand = ["连环计"];`);
//   await s.shot("tmp/ui-shots/x/full.png");                     // 整页
//   await s.shot("tmp/ui-shots/x/scroll.png", '[data-testid="scroll-jinnang"]'); // 元素级
//   await s.close();
// 跑法:先 `flock tmp/build.lock bun run build`(preview 服务 dist),再 `node tmp/<场景>.mjs`。
// 干净静帧配方(2026-10-24 实锤:单 clockPause 冻不住在途演出,行军落格照样触发
// 购地卷轴糊进截图;#700 托管钮退役后 autopilot-button 通道失效,2026-10-27 注):
// 页面内清场(react-seat-pop settleForTap 同法:等 fx 排空→actIfCan 清决策→循环收敛)
// → `window.__dafung.clockPause()` →再补一轮清场(卷轴挂载不吃时钟,冻结挡不住)
// →留 ~1s 排空在途演出→再拍。
//
// force 双写陷阱(2026-10-20 实锤,三轮 force 不生效才定位):count 类镜像字段
// (jinnangHandCount 等)由引擎在结算点维护,只改源数组(jinnangHand)UI 投影不动——
// 改局必须源数组与镜像字段同写,如 `p.jinnangHand=[]; p.jinnangHandCount=0;`。
// 图标/小件视觉迭代:s.page.setContent 拼放大预览页(多尺寸×双底色)整页截图,
// 比实拍元素级截图快一个量级;实拍留给最终自证。
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";

export async function openShotSession({
  port = 5300,
  viewport = { width: 844, height: 390 },
  deviceScaleFactor = 2,
  /** true = 落格机遇关零(确定性无机遇卷轴;默认不 mock,读真实 public/config/jiyu.json)。 */
  zeroEncounter = false,
  /** 建局后等待的卷轴 testid(如 "scroll-jinnang";不等待传 null)。 */
  waitScroll = null,
} = {}) {
  // 起服走 vite JS API(preview 在本进程内跑,close() 随调用收干净——旧
  // spawn(bun x vite) 通道杀 wrapper 留 node 孤儿占口,三代会话受害
  // (#510/#583 实测击杀、2026-10-18 retro 立项根治);strictPort 口被占当场炸。
  //   node tmp/<场景>.mjs
  const server = await preview({ preview: { port, strictPort: true } });
  const url = `http://localhost:${port}/`;

  const browser = await chromium.launch({
    // Windows 走系统 Edge 通道(免下载自带浏览器),与 playwright.config 同口径;
    // 其他平台回退 playwright 自带 chromium。
    ...(process.platform === "win32" && { channel: "msedge" }),
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-time-scale", "0.25")); // 演出加速,同 e2e
  // 调试桥门禁键(单源 src/app/fx/timings.ts E2E_DEBUG_BRIDGE_KEY;.mjs 无法 import TS,字面量随其注记同步):
  // preview 服务的是生产构建,无此键 window.__dafung 不注册,force/force 依赖的钩子全哑。
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-debug-bridge", "1"));
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
      await page.evaluate(
        `(() => { const e = window.__dafung.getEngine(); ${fn} window.__dafung.controller().sync(); })()`,
      );
    },
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

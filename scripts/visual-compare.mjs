// 明确请求页面观察、截图对比或浏览器复现时的一次性辅助(ADR-0065),不接入验证门槛。
// 比较指定 tag 与当前工作树,生成 844×390 移动横屏四场景并排图。
// 用法:bun run visual:compare [--tag vX.Y.Z];缺省取最新 v* tag。
// tag 侧在独立 git worktree 构建并以 :4330 预览,当前侧构建后以 :4331 预览。
// Node 运行 Playwright,Vite preview JS API 管理静态服务;端口占用直接失败。
//
// 场景:主页、单机设置、对局静帧、终局。对局经 UI 开局,parkMyTurn 停靠后冻结时钟;
// 冻结不拦同步命令链,因此须复核停靠态。终局前态经 core/planter.armGameOver 构造,
// 造态失败报告 exit 3 并保留前三场景。
// 确定性输入:固定 seed、route 关闭机遇、clockPause、reducedMotion、禁用截图动画、
// fonts.ready 与双 rAF;两侧各用独立 context,避免 localStorage 残留。
// 左为 tag、右为工作树,版本号取各侧 package.json;差异由人工判读。
// 产出:tmp/visual-compare/<tag>/NN-<场景名>.png 与控制台 sha256。
// 退出码:0=四场景齐,3=终局造态失败,1=硬失败。
// tag worktree(<主树>-wt-visreg)与 dist 保留供重跑;按需 git worktree remove --force 清理。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { preview } from "vite";
import { MOBILE_CONTEXT_OPTIONS } from "./mobile-context.ts";

const PORT_TRUTH = 4330;
const PORT_CURRENT = 4331;
const SEED = 1486;
const VIEWPORT = MOBILE_CONTEXT_OPTIONS.viewport;
const HALF_PX = VIEWPORT.width * 2; // deviceScaleFactor 2,单侧截图天然像素宽

// testid 字面量(随各 testids.ts 注记同步;两侧 tag 使用同一驱动):
// home/setup: src/app/screens/home/testids.ts、src/app/screens/setup/testids.ts;
// 对局/终局: src/app/screens/game/testids.ts、src/app/screens/game/scroll/testids.ts。
const TID = {
  homeScreen: "home-screen",
  homeSolo: "home-solo",
  setupScreen: "solo-setup-screen",
  encounterEnabled: "setup-encounter-enabled",
  startGame: "start-game",
  confirmCapitalOk: "confirm-capital-ok",
  treasureSkip: "scroll-treasure-skip",
  reactionDecline: "reaction-decline",
  victoryScreen: "victory-screen",
};

const tagArg = (() => {
  const i = process.argv.indexOf("--tag");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith("--tag="));
  if (inline) return inline.slice("--tag=".length);
  return null;
})();

function run(cmd, args, cwd, opts = {}) {
  // shell:true + 命令串(node 数组+shell 会报 DEP0190;本机 bun 常为无扩展名 sh shim,
  // 不带 shell 直呼 ENOENT,cmd shell 才落到 bun.cmd);参数均为无空格字面量,拼接安全。
  const r = spawnSync([cmd, ...args].join(" "), { cwd, stdio: "inherit", shell: true, ...opts });
  if (r.status !== 0)
    throw new Error(
      `${cmd} ${args.join(" ")}(cwd=${cwd})退出码 ${r.status}${r.error ? ` err=${r.error}` : ""}`,
    );
}

/** 定位 git 目录与主树根:主树(.git 目录)直用;jj workspace 经 .jj/repo 指针文件
 *  (内容形如 ../../dafung-web/.jj/repo)回溯主树。 */
function findRepo() {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, ".git"))) return { gitDir: join(dir, ".git"), mainRoot: dir };
    const jjRepo = join(dir, ".jj", "repo");
    if (existsSync(jjRepo)) {
      // 指针内容相对 .jj/ 目录(如 ../../dafung-web/.jj/repo)→ <主树>/.jj/repo
      const real = resolve(join(dir, ".jj"), readFileSync(jjRepo, "utf8").trim());
      const mainRoot = dirname(dirname(real));
      return { gitDir: join(mainRoot, ".git"), mainRoot };
    }
    const up = dirname(dir);
    if (up === dir) throw new Error("visual-compare:未找到 .git 或 .jj/repo——须在仓库检出内运行");
    dir = up;
  }
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, stdio: "pipe", shell: false, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} 失败:\n${r.stderr}`);
  return r.stdout.trim();
}

const repo = findRepo();
const cwd = process.cwd();

const tag =
  tagArg ?? git(["--git-dir", repo.gitDir, "tag", "-l", "v*", "--sort=-v:refname"]).split("\n")[0];
if (!tag) throw new Error("visual-compare:仓库无 v* tag,缺省取「最新 v*」失败——用 --tag 显式指定");

// 真值侧 worktree(逃生舱通道):不存在则建,存在则对齐到 tag(脏工作区响亮失败——
// 工具自用目录不该有别人的活)。
const wt = `${repo.mainRoot}-wt-visreg`;
if (!existsSync(join(wt, ".git"))) {
  console.log(`[visual-compare] worktree 不存在,新建:${wt} @ ${tag}`);
  git(["--git-dir", repo.gitDir, "worktree", "add", "--detach", wt, tag]);
} else {
  const head = git(["-C", wt, "rev-parse", "HEAD"]);
  const want = git(["--git-dir", repo.gitDir, "rev-parse", tag]);
  if (head !== want) {
    console.log(`[visual-compare] worktree HEAD 对齐到 ${tag}(原 ${head.slice(0, 9)})`);
    git(["-C", wt, "checkout", "--detach", tag]);
  }
}
// bun 调用走 run(shell 通道,见 run 内注记);git 是真 .exe,另走无 shell 直呼。
const bun = (args, dir) => run("bun", args, dir);

bun(["install", "--frozen-lockfile"], wt);
mkdirSync(join(wt, "tmp"), { recursive: true });

console.log("[visual-compare] 构建真值侧(tag)…");
bun(["run", "build"], wt);
console.log("[visual-compare] 构建当前侧(工作树)…");
bun(["run", "build"], cwd);

const outDir = join(cwd, "tmp", "visual-compare", tag);
mkdirSync(outDir, { recursive: true });

console.log(`[visual-compare] 起服:真值 :${PORT_TRUTH} / 当前 :${PORT_CURRENT}`);
const serverTruth = await preview({ root: wt, preview: { port: PORT_TRUTH, strictPort: true } });
const serverCurrent = await preview({
  root: cwd,
  preview: { port: PORT_CURRENT, strictPort: true },
});

const browser = await chromium.launch({
  ...(process.platform === "win32" && { channel: "msedge" }),
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

/** 读当前 store 的全量快照。 */
const snap = (page) => page.evaluate(() => window.__dafung.snapshot());
const waitFxIdle = (page) =>
  page.waitForFunction(
    () => {
      const fx = window.__dafung.controller()?.fx;
      return fx == null || !fx.playing;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
const fontsReady = (page) => page.evaluate(() => document.fonts.ready);
/** 双 rAF:等布局与绘制沉降(确定性闸,非盲睡)。 */
const twoFrames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function shot(page, path) {
  await fontsReady(page);
  await twoFrames(page);
  await page.screenshot({ path, animations: "disabled" });
  console.log("shot ->", path);
}

const park = (s) =>
  s.phase === "Playing" &&
  s.activeIndex === 0 &&
  s.decisionOwner === 0 &&
  s.turnPhase.startsWith("Awaiting");

/** 人类自身回合 Awaiting 停靠后冻结时钟:
 *  轮询体内代发「暂不交易/不用」两类 bot 回合询问窗,停靠即冻结后复核——冻结 gap 内被
 *  同步链推走则解冻续等下一拍。锦囊「不出」不放行(AwaitingJinnang 本身是合法停靠)。 */
async function parkMyTurn(page, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline)
      throw new Error(`parkMyTurn:${timeoutMs}ms 内未停到人类自身回合 Awaiting 态`);
    for (const tid of [TID.treasureSkip, TID.reactionDecline]) {
      const el = page.getByTestId(tid);
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 2_000 }).catch(() => {});
      }
    }
    if (park(await snap(page))) {
      await page.evaluate(() => window.__dafung.clockPause());
      if (park(await snap(page))) return;
      await page.evaluate(() => window.__dafung.clockResume());
    }
    await page.waitForTimeout(150);
  }
}

/** 一侧四场景采集,返回 { gameoverError } —— 终局屏造态失败不炸整轮(降级三场景)。 */
async function captureSide(port, sideDir) {
  mkdirSync(sideDir, { recursive: true });
  const ctx = await browser.newContext({
    ...MOBILE_CONTEXT_OPTIONS,
    deviceScaleFactor: 2,
    reducedMotion: "reduce", // M-9 静态口径,常驻氛围动画钉死(见头注确定性段)
  });
  const page = await ctx.newPage();
  // 演出加速 + 调试桥门禁键(单源 src/app/fx/timings.ts;字面量
  // 随 shot.mjs 注记同步)。route 关闭机遇以固定场景输入。
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-time-scale", "0.25"));
  await page.addInitScript(() => localStorage.setItem("dafung-e2e-debug-bridge", "1"));
  await page.route("**/config/jiyu.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false }),
    }),
  );
  const url = `http://localhost:${port}/`;

  // ① 主页
  await page.goto(`${url}?seed=${SEED}`);
  await page.getByTestId(TID.homeScreen).waitFor({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await shot(page, join(sideDir, "01-home.png"));

  // ② 单机设置屏(等机遇开关落到 aria-checked=false:挂载初值内置「开」,fetch 竞速
  // 窗口内可能为真,等收敛——同 react-helpers.openSoloSetup 口径)
  await page.getByTestId(TID.homeSolo).click();
  await page.getByTestId(TID.setupScreen).waitFor({ timeout: 15_000 });
  await page
    .waitForFunction(
      (tid) =>
        document.querySelector(`[data-testid="${tid}"]`)?.getAttribute("aria-checked") === "false",
      TID.encounterEnabled,
      { timeout: 15_000, polling: 100 },
    )
    .catch(() => {
      throw new Error("设置屏机遇开关未落到 aria-checked=false(机遇隔离失效?)");
    });
  await page.waitForLoadState("networkidle");
  await shot(page, join(sideDir, "02-setup.png"));

  // ③ 对局静帧:UI 旅程开局(同 shot.mjs enterGame 三步)→ 停靠冻结
  await page.getByTestId(TID.startGame).click();
  await page.locator(".bv-tile.bv-selectable").first().waitFor({ timeout: 30_000 });
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId(TID.confirmCapitalOk).waitFor({ timeout: 15_000 });
  await page.getByTestId(TID.confirmCapitalOk).click();
  await parkMyTurn(page);
  await waitFxIdle(page);
  await shot(page, join(sideDir, "03-game.png"));

  // ④ 终局屏:plant(armGameOver) 造态(判词见文件头注)
  let gameoverError = null;
  try {
    await waitFxIdle(page);
    await page.evaluate(() => {
      // armGameOver 一并设置 isOver/winner/phase,保持终局前态一致。
      window.__dafung.plant({ kind: "armGameOver", winnerSeat: 0 });
      window.__dafung.controller().sync();
    });
    await page.getByTestId(TID.victoryScreen).waitFor({ timeout: 15_000 });
    await waitFxIdle(page);
    await shot(page, join(sideDir, "04-gameover.png"));
  } catch (e) {
    gameoverError = String(e).slice(0, 500);
  }
  await ctx.close();
  return { gameoverError };
}

/** 左右并排拼图(各 844×390@2x)+ 头注条;compose 页用后即删。truthPng/currentPng
 *  须相对 outDir(outDir 内物),src 以相对路径引用。 */
async function compose(sceneName, truthRel, currentRel, outPng, headline) {
  const htmlPath = join(outDir, "_compose.html");
  writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1c1a17">
<div style="height:56px;display:flex;align-items:center;gap:24px;padding:0 20px;
     background:#1c1a17;color:#e8dfcf;font:600 24px/1 'Segoe UI',system-ui,sans-serif">
  <span style="font-size:26px">${sceneName}</span>
  <span style="color:#b9ad97;font-weight:400">${headline}</span>
</div>
<div style="display:flex"><img width="${HALF_PX}" height="780" src="./${truthRel}">
<img width="${HALF_PX}" height="780" src="./${currentRel}"></div>
</body>`,
  );
  const ctx = await browser.newContext({
    viewport: { width: HALF_PX * 2, height: 780 + 56 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.screenshot({ path: outPng, fullPage: true, animations: "disabled" });
  await ctx.close();
  rmSync(htmlPath);
}

try {
  console.log(`[visual-compare] 采集真值侧(${tag})…`);
  const truth = await captureSide(PORT_TRUTH, join(outDir, "side-truth"));
  console.log("[visual-compare] 采集当前侧(工作树)…");
  const current = await captureSide(PORT_CURRENT, join(outDir, "side-current"));

  const scenes = [
    ["01-home", "主页"],
    ["02-setup", "设置屏"],
    ["03-game", "对局静帧(停靠冻结)"],
    ["04-gameover", "终局屏(armGameOver 造态:视觉对照前提态,只需可表示不需可达)"],
  ];
  const report = [];
  let degraded = truth.gameoverError != null || current.gameoverError != null;
  for (const [id, label] of scenes) {
    if (id === "04-gameover" && degraded) continue;
    const outPng = join(outDir, `${id}.png`);
    await compose(
      label,
      join("side-truth", `${id}.png`),
      join("side-current", `${id}.png`),
      outPng,
      `左:上一版 ${tag} | 右:当前工作树${id === "04-gameover" ? " | 种植判词:视觉对照前提态,只需可表示不需可达" : ""}`,
    );
    const h = createHash("sha256").update(readFileSync(outPng)).digest("hex");
    report.push(`${id}.png  sha256=${h}\n          ${outPng}`);
  }
  for (const line of report) console.log(line);

  if (degraded) {
    console.error(
      `\n[visual-compare][WARN] 终局屏造态失败,降级三场景——上报如下:\n  真值侧: ${truth.gameoverError}\n  当前侧: ${current.gameoverError}`,
    );
    process.exitCode = 3;
  } else {
    console.log(`\n[visual-compare] 完成:四场景并排图已落盘 ${outDir}`);
  }
} finally {
  await browser.close();
  await serverTruth.close();
  await serverCurrent.close();
}

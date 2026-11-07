// 发版前视觉对照工具:上一 tag 构建 vs 当前工作树,四场景并排图(#1258;ADR-0059 决策 2)。
//
// 用法: bun run visual:compare [--tag vX.Y.Z]      (缺省 tag = git tag 最新 v*,CalVer)
// 跑法与起服通道同 scripts/shot.mjs:本脚本用 node 跑(bun 直接跑 playwright 会超时,
// 见 package.json "playwright" 条目注记),起服走 vite preview JS API(进程内收放,
// 端口 strictPort 占用即响亮失败)。真值侧 = git worktree(逃生舱通道)checkout 该
// tag → bun install → bun run build → 静态服 :4330;当前侧 = 本检出 build → :4331。
//
// 场景(两侧同一驱动器,844×390 移动横屏标准档):
//   01-home        主页
//   02-setup       单机设置屏(机遇开关按 route 归零,同 e2e disableEncounters 口径)
//   03-game        对局静帧:UI 旅程开局(选都确认落定)→ parkMyTurn 停靠冻结
//                  (轮询快照停靠人类自身回合 Awaiting 态 → clockPause → 复核,语义照抄
//                  e2e/react-helpers.ts parkMyTurn;冻结只钉时钟回调,钉不住同步命令链)
//   04-gameover    终局屏(胜利覆盖层):force 造态。
//                  判词:视觉对照前提态,force 合法——只需可表示不需可达(终局态由身价
//                  目标结算产生,无「直判胜负」公共命令;同 e2e/react-scrolls.spec 胜利屏
//                  force 判词)。造不出来 → 降级三场景并上报(exit 3),不硬扛。
//
// 确定性(同 tag 两跑应逐字节一致,自查=两跑控制台 sha256 对拍):
//   seed 钉 1486(quickStart 家族钉谱种子=人类座位 0 首回合)+ 机遇 route 归零
//   + clockPause 冻结 + context reducedMotion:"reduce"(氛围层常驻动画按 app 自带
//   M-9 静态口径钉死——旗停摇/呼吸钉中程;实锤:screenshot animations:"disabled"
//   压不住 bv-flag-sway 无限摇,两跑 42 像素旗姿漂移)+ 截图 animations:"disabled"
//   (钉一次性出场动画)+ fonts.ready + 双 rAF 排帧;两侧各开独立 context
//   (localStorage 零残留)。
//
// 判读:左=上一 tag(真值),右=当前工作树;已知必然差异=版本号行(__APP_VERSION__
// 各取自本侧 package.json),其余差异=本版视觉改动候选项,人工过目。
// 非门禁:不进任何 check 链,不做像素 diff 自动判定(ADR-0059:像素 diff 自动门禁
// 继续否决——flake 零容忍)。
// 产出: tmp/visual-compare/<tag>/NN-<场景名>.png(左右并排+头注条),控制台逐图列
// 路径与 sha256。退出码:0=四场景齐;3=终局屏造态失败(降级三场景);1=硬失败。
//
// 用后清理:真值侧 worktree(<主树>-wt-visreg)与两侧 dist 保留不清——重跑复用,
// 手工清理 = git worktree remove --force <该目录>。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { preview } from "vite";

const PORT_TRUTH = 4330;
const PORT_CURRENT = 4331;
const SEED = 1486;
const VIEWPORT = { width: 844, height: 390 };
const HALF_PX = 1688; // 844 × deviceScaleFactor 2,单侧截图天然像素宽

// testid 字面量(.mjs 无法 import TS 单源,随各 testids.ts 注记同步;两侧 tag 对拍一致):
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

/** 读引擎快照(god view,同 e2e snap)。 */
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

/** 人类自身回合 Awaiting 停靠 + 时钟冻结(语义照抄 e2e/react-helpers.ts parkMyTurn):
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
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: "reduce", // M-9 静态口径,常驻氛围动画钉死(见头注确定性段)
  });
  const page = await ctx.newPage();
  // 演出加速 + 调试桥门禁键(单源 src/app/fx/timings.ts;.mjs 无法 import TS,字面量
  // 随 shot.mjs 注记同步)。机遇 route 归零 = e2e disableEncounters 同口径(确定性)。
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

  // ④ 终局屏:force 造态(判词见文件头注)
  let gameoverError = null;
  try {
    await waitFxIdle(page);
    await page.evaluate(() => {
      const e = window.__dafung.getEngine();
      e.isOver = true;
      e.winner = e.players[0];
      e.phase = "GameOver";
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
    ["04-gameover", "终局屏(force 造态:视觉对照前提态,force 合法——只需可表示不需可达)"],
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
      `左:上一版 ${tag} | 右:当前工作树${id === "04-gameover" ? " | force 判词:视觉对照前提态,只需可表示不需可达" : ""}`,
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

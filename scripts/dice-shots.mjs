// 临时脚本:驱动 dafung-web 到对局,在人类掷骰时连续截图 3D 骰子动画。
// 只读 + 截图,不改游戏代码。运行前提:npm run preview 已在 :4173 起好,且 dist 最新。
//
// 用法:node scripts/dice-shots.mjs
//
// SwiftShader 软件 WebGL 跑真实 3D 路径(与 playwright.config.ts 一致)。
import { chromium } from "@playwright/test";
import { mkdirSync, cpSync } from "node:fs";

const BASE = "http://localhost:4173";
const SHOT_DIR = "screenshots";
const SEED = 42;
const ATTEMPTS = 3; // 多掷几次取姿态分明的一组

mkdirSync(SHOT_DIR, { recursive: true });

const snap = (page) => page.evaluate(() => window.__dafung.snapshot());
const freeCap = (page) =>
  page.evaluate(
    () => window.__dafung?.engine?.firstAvailableCapitalIndex() ?? -1,
  );

async function driveSetup(page) {
  await page.goto(`${BASE}/?seed=${SEED}`, { waitUntil: "domcontentloaded" });
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(
    () => !!window.__dafung,
    undefined,
    { timeout: 10000 },
  );
  // drive pick capital(人类点空城 + 确认,bot 自动)
  for (let i = 0; i < 40; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") return s;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) return s;
    if (s.players[idx].isBot) {
      await page.waitForTimeout(1100);
      continue;
    }
    const free = await freeCap(page);
    if (free < 0) return s;
    await page.click(`[data-tile='${free}']`);
    await page.click('[data-action="confirm"]');
    await page.waitForTimeout(250);
  }
  return snap(page);
}

async function dismissScroll(page) {
  const overlay = await page.$(".scroll-overlay");
  if (!overlay) return false;
  const primary = await overlay.$(".btn-primary");
  const anyBtn = await overlay.$('[data-action]');
  if (primary) await primary.click();
  else if (anyBtn) await anyBtn.click();
  await page.waitForTimeout(250);
  return true;
}

async function captureRoll(page, outPrefix) {
  // 在人类 Roll 回合:测骰盘 bbox → 点行军 → 5 连拍
  const dice = await page.locator("#dice-3d");
  const box = await dice.boundingBox();
  // 适当外扩,把骰盘 + 周围光影纳入;deviceScaleFactor=3 保证清晰
  const pad = 16;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };

  // 同时拍一张全景(带侧栏)用于定位上下文
  await page.screenshot({ path: `${outPrefix}-ctx.png`, fullPage: false });

  // 确认 WebGL 骰子激活(应有 .available + 内嵌 canvas)
  const probe = await page.evaluate(() => {
    const el = document.getElementById("dice-3d");
    return {
      available: el?.classList.contains("available") ?? false,
      hasCanvas: !!el?.querySelector("canvas"),
    };
  });

  // 触发掷骰,5 连拍(乱滚 ~0.7s + 吸附 ~0.2s)
  await page.locator("#roll-btn").click();
  await page.screenshot({ path: `${outPrefix}-1.png`, clip }); // ~刚掷出
  await page.waitForTimeout(130);
  await page.screenshot({ path: `${outPrefix}-2.png`, clip }); // 乱滚中
  await page.waitForTimeout(130);
  await page.screenshot({ path: `${outPrefix}-3.png`, clip }); // 乱滚中
  await page.waitForTimeout(130);
  await page.screenshot({ path: `${outPrefix}-4.png`, clip }); // 快停
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outPrefix}-5.png`, clip }); // 停下,一面朝上

  // 读最终 die(应朝上的签面)
  const s = await snap(page);
  await dismissScroll(page);
  return { die: s.lastRoll?.die ?? null, probe };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
});

try {
  const setupSnap = await driveSetup(page);
  console.log("[setup] phase=", setupSnap.phase, "turnPhase=", setupSnap.turnPhase);

  let attempts = 0;
  const meta = [];
  for (let turn = 0; turn < 30 && attempts < ATTEMPTS; turn++) {
    const s = await snap(page);
    if (s.isOver) { console.log("[over]"); break; }
    const active = s.players[s.activeIndex];
    if (active.isBot) {
      await page.waitForTimeout(2200);
      await dismissScroll(page);
      continue;
    }
    // 人类回合
    if (s.turnPhase === "Roll") {
      attempts++;
      const prefix = `${SHOT_DIR}/dice-attempt${attempts}`;
      console.log(`[attempt ${attempts}] human Roll; capturing...`);
      const r = await captureRoll(page, prefix);
      console.log(`[attempt ${attempts}] die=${r.die} probe=`, r.probe);
      meta.push({ attempt: attempts, ...r });
      // 再等一下让 bot 接上
      await page.waitForTimeout(800);
      await dismissScroll(page);
    } else {
      // 遗留决策弹窗,先消解
      await dismissScroll(page);
      await page.waitForTimeout(300);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(meta, null, 2));
  console.log("\n_attempts_dir_:", `${SHOT_DIR}/dice-attempt{1..3}-[1-5].png`);
} finally {
  await browser.close();
}

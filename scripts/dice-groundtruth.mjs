// 地面真值:对每个掷骰,对比 engine.lastRoll.die(期望)与 threeDice.getUpFace()(实际渲染朝上面)。
// getUpFace 基于骰 mesh 的世界四元数算各面法线与 +Y 点积,无 OCR 误差。
import { chromium } from "@playwright/test";

const BASE = "http://localhost:4173";
const SEED = 42;

const snap = (page) => page.evaluate(() => window.__dafung.snapshot());
const freeCap = (page) =>
  page.evaluate(() => window.__dafung?.engine?.firstAvailableCapitalIndex() ?? -1);

async function driveSetup(page) {
  await page.goto(`${BASE}/?seed=${SEED}`, { waitUntil: "domcontentloaded" });
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => !!window.__dafung, undefined, { timeout: 10000 });
  for (let i = 0; i < 40; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") return;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) return;
    if (s.players[idx].isBot) { await page.waitForTimeout(1100); continue; }
    const free = await freeCap(page);
    if (free < 0) return;
    await page.click(`[data-tile='${free}']`);
    await page.click('[data-action="confirm"]');
    await page.waitForTimeout(250);
  }
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

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await driveSetup(page);
  console.log("die(engine) | getUpFace(rendered) | match | char");
  console.log("------------|---------------------|-------|-----");
  for (let turn = 0, humanRolls = 0; turn < 40 && humanRolls < 6; turn++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await page.waitForTimeout(2200);
      await dismissScroll(page);
      continue;
    }
    if (s.turnPhase === "Roll") {
      humanRolls++;
      await page.locator("#roll-btn").click();
      // 等动画 + 吸附完成(~0.9s,留余量到 1.3s)
      await page.waitForTimeout(1300);
      const after = await snap(page);
      const die = after.lastRoll?.die ?? null;
      const upFace = await page.evaluate(() => window.__dafung.threeDice.getUpFace());
      const SIGNS = ["一","二","三","四","五","六"];
      const match = die === upFace;
      console.log(
        `  ${die}         |         ${upFace}           |  ${match ? "OK " : "MISMATCH"} | ${SIGNS[(die??1)-1]} 期望 / ${upFace>=1?SIGNS[upFace-1]:"?"} 渲染`,
      );
      await page.waitForTimeout(400);
      await dismissScroll(page);
    } else {
      await dismissScroll(page);
      await page.waitForTimeout(300);
    }
  }
} finally {
  await browser.close();
}

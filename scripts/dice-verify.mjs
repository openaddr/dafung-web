// 验证 + 高清重拍:同一 seed=42 确定性序列,deviceScaleFactor=5 把 58px 骰子放到 ~290px,
// 让 OCR 能准确区分 五 vs 六。同时这次直接把选定序列落盘为 dice-roll-{1..5}.png。
import { chromium } from "@playwright/test";

const BASE = "http://localhost:4173";
const SHOT_DIR = "screenshots";
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
    if (s.phase !== "Setup") return s;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) return s;
    if (s.players[idx].isBot) { await page.waitForTimeout(1100); continue; }
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

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 5, // 58px 骰子 → ~290px,OCR 可分辨六/五
});

try {
  await driveSetup(page);
  // 捕获前 3 个人类 Roll(deterministic: 1,6,5),每个 5 连拍 + 单独高清最终面
  const results = [];
  for (let turn = 0, caught = 0; turn < 30 && caught < 3; turn++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await page.waitForTimeout(2200);
      await dismissScroll(page);
      continue;
    }
    if (s.turnPhase === "Roll") {
      caught++;
      const tag = `hires-attempt${caught}`;
      const box = await page.locator("#dice-3d").boundingBox();
      const pad = 8;
      const clip = {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
        width: box.width + pad * 2, height: box.height + pad * 2,
      };
      await page.locator("#roll-btn").click();
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-1.png`, clip });
      await page.waitForTimeout(130);
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-2.png`, clip });
      await page.waitForTimeout(130);
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-3.png`, clip });
      await page.waitForTimeout(130);
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-4.png`, clip });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-5.png`, clip });
      const after = await snap(page);
      const die = after.lastRoll?.die ?? null;
      console.log(`[${tag}] die=${die}`);
      results.push({ tag, die });
      await page.waitForTimeout(600);
      await dismissScroll(page);
    } else {
      await dismissScroll(page);
      await page.waitForTimeout(300);
    }
  }
  console.log("RESULTS=", JSON.stringify(results));
} finally {
  await browser.close();
}

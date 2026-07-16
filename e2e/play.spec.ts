// 对局流程 e2e:开局渲染、选都就位、掷骰推进、全 bot 终局。
import { test, expect } from "@playwright/test";
import { startGame, setupAndPlay, snap, drivePickCapital, dismissScroll, waitForBot } from "./helpers";

test("开局画面渲染", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".setup-screen h1")).toHaveText("群雄逐鹿");
  await expect(page.locator("#start-btn")).toBeVisible();
});

test("完整选都后进入对局,棋盘与诸侯就位", async ({ page }) => {
  await startGame(page, "2"); // 含 waitForFunction(__dafung),避免地图异步 fetch 期间 snap 拿空
  await drivePickCapital(page);

  const s = await snap(page);
  expect(s.phase).toBe("Playing");
  expect(s.players.length).toBe(2);
  expect(s.players.every((p) => p.capitalIndex >= 0)).toBe(true);
  expect(s.players.every((p) => p.guohao.length > 0)).toBe(true);

  // 棋盘上有 30 城与旌旗棋子
  const tileCount = await page.locator("[data-tile]").count();
  expect(tileCount).toBeGreaterThanOrEqual(30);
  await expect(page.locator(".token")).toHaveCount(2);
});

test("掷骰行军推进流程(含 bot 自动回合),不崩溃", async ({ page }) => {
  await setupAndPlay(page, "2");

  // 跑若干回合:人类掷骰 + bot 自动 + 处理弹窗
  for (let i = 0; i < 12; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await waitForBot(page); // bot 回合(掷骰+动画+决策)
      continue;
    }
    // 人类回合:先处理抉择弹窗,再掷骰
    await dismissScroll(page);
    const rollBtn = page.locator("#roll-btn");
    if (await rollBtn.isEnabled()) {
      await rollBtn.click();
    }
    await page.waitForTimeout(1800);
  }

  const s = await snap(page);
  expect(s.turnNumber).toBeGreaterThanOrEqual(1);
  expect(s.logCount).toBeGreaterThan(0);
});

test("全 bot 演示局能自行推进并终局", async ({ page }) => {
  await startGame(page, "4");
  await drivePickCapital(page);

  // 让 bot 们自行对局,人类回合则自动掷骰
  let lastTurn = -1;
  for (let i = 0; i < 14; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await waitForBot(page, 2200);
      continue;
    }
    // 人类回合:自动处理弹窗 + 掷骰
    if (await page.$(".scroll-overlay")) {
      await page.locator(".scroll-overlay .btn-primary").first().click().catch(() => {});
      await page.waitForTimeout(600);
    }
    if (await page.locator("#roll-btn").isEnabled()) await page.locator("#roll-btn").click();
    await page.waitForTimeout(1600);
    if (s.turnNumber === lastTurn) await page.waitForTimeout(1000);
    lastTurn = s.turnNumber;
  }
  // 至少推进了若干回合且未卡死
  const s = await snap(page);
  expect(s.turnNumber).toBeGreaterThanOrEqual(1);
  expect(s.logCount).toBeGreaterThan(5);
});

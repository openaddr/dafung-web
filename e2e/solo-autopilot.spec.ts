// 单机托管 e2e(spec: autopilot 03):挂机看电脑替自己打。
// 快速托管 → 零输入推进到终局;收回后轮到人类正常弹决策等输入。
import { test, expect } from "@playwright/test";
import { startGame, snap } from "./helpers";

test("单机快速托管:零输入持续推进(掷骰/买地/卷轴决策全由 bot 代打)", async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page, "2", 123); // 1 真人 + 1 电脑(solo-mode 语义)
  // 选都(人类)——托管按钮在对局中才出现
  for (let i = 0; i < 40; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") break;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (s.players[idx].isBot) { await page.waitForTimeout(1100); continue; }
    const free = await page.evaluate(
      () => (window as unknown as { __dafung?: { engine?: { firstAvailableCapitalIndex(): number } } }).__dafung?.engine?.firstAvailableCapitalIndex() ?? -1,
    );
    if (free < 0) break;
    await page.click(`[data-tile='${free}']`);
    await page.click('[data-action="confirm"]');
    await page.waitForTimeout(300);
  }
  await expect(page.locator("#autopilot-btn")).toBeVisible({ timeout: 10000 });
  await page.locator("#autopilot-btn").click();
  await expect(page.locator("#autopilot-btn")).toHaveText("收回托管", { timeout: 10000 });
  await expect(page.locator("#autopilot-status")).toContainText("电脑代打中·快", { timeout: 10000 });
  // 零输入持续推进(动画仍逐回合播放,终局耗时较长;全终局语义由联机快速托管 e2e 与
  // 单测覆盖,此处断言零输入下回合数可观增长)
  await expect
    .poll(async () => (await snap(page)).turnNumber, { timeout: 150_000, message: "托管零输入推进回合数" })
    .toBeGreaterThanOrEqual(10);
});

test("单机慢速托管后收回:轮到人类时行军等待输入", async ({ page }) => {
  test.setTimeout(180_000);
  await startGame(page, "2", 7);
  for (let i = 0; i < 40; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") break;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (s.players[idx].isBot) { await page.waitForTimeout(1100); continue; }
    const free = await page.evaluate(
      () => (window as unknown as { __dafung?: { engine?: { firstAvailableCapitalIndex(): number } } }).__dafung?.engine?.firstAvailableCapitalIndex() ?? -1,
    );
    if (free < 0) break;
    await page.click(`[data-tile='${free}']`);
    await page.click('[data-action="confirm"]');
    await page.waitForTimeout(300);
  }
  // 慢速托管 → 收回(慢速局不会秒完,收回后有真实的人类决策点)
  await page.locator("#autopilot-speed").selectOption("slow");
  await page.locator("#autopilot-btn").click();
  await expect(page.locator("#autopilot-btn")).toHaveText("收回托管", { timeout: 10000 });
  await expect(page.locator("#autopilot-status")).toContainText("电脑代打中·慢", { timeout: 10000 });
  await page.locator("#autopilot-btn").click();
  await expect(page.locator("#autopilot-btn")).toHaveText("托管", { timeout: 10000 });
  // 轮到人类时:行军按钮可用(等待输入),且不再自动推进
  await expect
    .poll(async () => (await page.locator("#roll-btn").isEnabled().catch(() => false)), { timeout: 120_000, message: "收回后轮到人类时行军可用" })
    .toBe(true);
  const t1 = (await snap(page)).turnNumber;
  await page.waitForTimeout(4000);
  const t2 = (await snap(page)).turnNumber;
  expect(t2).toBe(t1); // 无输入不推进
});

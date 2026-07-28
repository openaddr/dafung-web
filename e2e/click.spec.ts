// 点击可靠性:点城池 → 弹筑城确认框 → 确认定都。
// 防 tap 判定(pointerdown→pointerup)回归:曾因 click 被吞、需点两三下才中。
import { test, expect } from "@playwright/test";
import { startGame, snap } from "./helpers";

test("点城池弹筑城确认框,确认后定都", async ({ page }) => {
  await startGame(page, "2", 1);
  // 等轮到人类选都
  let humanIdx = -1;
  for (let i = 0; i < 24; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") break;
    const idx = s.currentSetupPlayerIndex;
    if (idx >= 0 && !s.players[idx].isBot) { humanIdx = idx; break; }
    await page.waitForTimeout(500);
  }
  expect(humanIdx).toBeGreaterThanOrEqual(0);

  const s = await snap(page);
  const free = await page.evaluate((taken: number[]) => {
    const el = Array.from(document.querySelectorAll("[data-tile]")).find(
      (e) => !taken.includes(parseInt(e.getAttribute("data-tile")!, 10)),
    );
    return el ? parseInt(el.getAttribute("data-tile")!, 10) : -1;
  }, s.takenCapitalIndices);
  expect(free).toBeGreaterThanOrEqual(0);

  // 点城 → 应弹出确认框(tap 判定生效的标志)
  await page.locator(`[data-tile="${free}"]`).click();
  await expect(page.locator(".confirm-box")).toBeVisible({ timeout: 3000 });
  // 确认 → 该城被占为都
  await page.locator('[data-action="confirm"]').click();
  await page.waitForTimeout(300);
  const s2 = await snap(page);
  expect(s2.takenCapitalIndices).toContain(free);
});

test("对局中点城池弹出只读详情卷轴(可关)", async ({ page }) => {
  await startGame(page, "2", 1);
  // 推过选都进入对局
  for (let i = 0; i < 30; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") break;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (s.players[idx].isBot) { await page.waitForTimeout(600); continue; }
    const free = await page.evaluate(
      () => (window as unknown as { __dafung?: { engine?: { firstAvailableCapitalIndex(): number } } }).__dafung?.engine?.firstAvailableCapitalIndex() ?? -1,
    );
    if (free < 0) break;
    await page.locator(`[data-tile="${free}"]`).click();
    await page.locator('[data-action="confirm"]').click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  // 点一座城 → 详情卷轴
  await page.locator("[data-name='洛阳']").first().click();
  await expect(page.locator(".scroll-overlay .scroll")).toBeVisible({ timeout: 3000 });
  // × 关闭
  await page.locator(".scroll-close").first().click();
  await expect(page.locator(".scroll-overlay")).toHaveCount(0);
});

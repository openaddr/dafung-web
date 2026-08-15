// 单机模式 e2e(spec: .scratch/solo-mode):设置屏单机化 = 恰好 1 真人,其余全电脑。
// 接缝:设置屏 DOM + window.__dafung 引擎快照(与 map-selection/human spec 同道)。
// 断言:
//  - 类型切换控件从设置屏消失(热座入口已死)
//  - 各诸侯数档(3/4)起兵后:p0 人类、其余全部电脑;电脑国号引擎自动分配(无重号)
//  - 你的国号非单个汉字时起兵被拦,出现提示且未进入对局
import { test, expect } from "@playwright/test";
import { startGame, drivePickCapital, snap, GOTO_OPTS } from "./helpers";

test("设置屏无类型切换;首行国号可编辑、其余行锁电脑", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  // 热座入口已死:不存在人类/电脑切换下拉
  await expect(page.locator("select option[value='human']")).toHaveCount(0);
  await expect(page.locator("select option[value='bot']")).toHaveCount(0);
  // 首行国号输入可用,其余行禁用(默认 4 诸侯档)
  const inputs = page.locator("input[data-seat]");
  await expect(inputs).toHaveCount(4);
  await expect(inputs.nth(0)).toBeEnabled();
  for (let i = 1; i < 4; i++) await expect(inputs.nth(i)).toBeDisabled();
  await expect(inputs.nth(1)).toHaveValue("机");
  // 2 诸侯档:1 可编辑 + 1 禁用
  await page.locator("#seat-count").selectOption("2");
  await expect(inputs).toHaveCount(2);
  await expect(inputs.nth(0)).toBeEnabled();
  await expect(inputs.nth(1)).toBeDisabled();
});

test("3 诸侯起兵:p0 人类,其余电脑;国号无重号", async ({ page }) => {
  await startGame(page, "3", 20260815);
  await drivePickCapital(page);
  const s = await snap(page);
  expect(s.players).toHaveLength(3);
  expect(s.players[0].isBot).toBe(false);
  expect(s.players[1].isBot).toBe(true);
  expect(s.players[2].isBot).toBe(true);
  // 国号全部非空且互不重复(电脑由引擎分配)
  const gh = s.players.map((p) => p.guohao);
  for (const g of gh) expect(g).toBeTruthy();
  expect(new Set(gh).size).toBe(3);
});

test("4 诸侯起兵:同样 p0 人类 + 其余电脑", async ({ page }) => {
  await startGame(page, "4", 7);
  await drivePickCapital(page);
  const s = await snap(page);
  expect(s.players).toHaveLength(4);
  expect(s.players.filter((p) => p.isBot)).toHaveLength(3);
  expect(s.players[0].isBot).toBe(false);
});

test("国号非法(清空)起兵被拦:提示出现且未进入对局", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  await page.locator("input[data-seat='0']").fill("");
  await page.locator("#start-btn").click();
  // 设置屏仍在(未进入对局),提示可见
  await expect(page.locator(".setup-hint")).toContainText("国号", { timeout: 3000 });
  await expect(page.locator(".setup-screen")).toBeVisible();
  await expect(
    page.evaluate(() => !!(window as unknown as { __dafung?: unknown }).__dafung),
  ).resolves.toBe(false);
});

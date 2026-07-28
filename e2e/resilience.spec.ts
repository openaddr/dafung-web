// 地图加载韧性:坏档/旧版存档自动降级到内置地图,不卡死、清坏档。
// 对应 map-loading-resilience 规约;防 v1.9.3 那次"最小间距校验卡死用户旧档"的回归。
import { test, expect } from "@playwright/test";

const BAD_OVERLAP_MAP = {
  version: 1,
  targetNetWorth: 8000,
  startingCash: 2500,
  maxLevel: 5,
  resupplyPerLevel: 150,
  tiles: [
    { id: "a", name: "坏城A", pos: [0, 0], group: "a", region: "x", price: 200, upgrade: 100, buildCost: 450, rentByLevel: [10, 30, 90, 270, 400, 550] },
    { id: "b", name: "坏城B", pos: [10, 0], group: "a", region: "x", price: 200, upgrade: 100, buildCost: 450, rentByLevel: [10, 30, 90, 270, 400, 550] },
  ],
  shortcuts: [],
};

test("坏档(城池重叠)自动降级到内置地图,不卡死且清档", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((m) => localStorage.setItem("dafung-custom-map", JSON.stringify(m)), BAD_OVERLAP_MAP);
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  // 降级后内置图加载 → __dafung 挂载(若卡死会超时失败)
  await page.waitForFunction(
    () => !!(window as unknown as { __dafung?: unknown }).__dafung,
    undefined,
    { timeout: 10000 },
  );
  // 加载的是内置图(≥30 城),不是坏档的 2 城
  const tileCount = await page.locator("[data-tile]").count();
  expect(tileCount).toBeGreaterThanOrEqual(30);
  // 页面没有"地图加载失败"错误屏
  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  expect(bodyText).not.toContain("地图加载失败");
  // 坏档被清除
  expect(await page.evaluate(() => localStorage.getItem("dafung-custom-map"))).toBeNull();
});

test("版本不符的存档也降级到内置", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    (m) => localStorage.setItem("dafung-custom-map", JSON.stringify(m)),
    { ...BAD_OVERLAP_MAP, version: 99 },
  );
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(
    () => !!(window as unknown as { __dafung?: unknown }).__dafung,
    undefined,
    { timeout: 10000 },
  );
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
  expect(await page.evaluate(() => localStorage.getItem("dafung-custom-map"))).toBeNull();
});

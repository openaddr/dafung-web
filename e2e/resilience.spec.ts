// 地图加载韧性:localStorage 有垃圾/坏数据时,起兵默认选内置图(sanguo)不卡死。
// ticket 03 后:启动只按 dafung-selected-map 指定的 id 加载(默认 sanguo),
// 不再读取旧的单图 key(dafung-custom-map 已废弃)。坏数据不应影响默认起兵流程。
import { test, expect } from "@playwright/test";
import { GOTO_OPTS } from "./helpers";

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
};

test("localStorage 有旧单图坏档(dafung-custom-map)不影响默认起兵", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  // 旧单图 key 写入坏数据(已被废弃,启动完全不读它)
  await page.evaluate((m) => localStorage.setItem("dafung-custom-map", JSON.stringify(m)), BAD_OVERLAP_MAP);
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  // 默认 sanguo 加载 → __dafung 挂载(若卡死会超时失败)
  await page.waitForFunction(
    () => !!(window as unknown as { __dafung?: unknown }).__dafung,
    undefined,
    { timeout: 10000 },
  );
  // 加载的是内置图(≥30 城),不是坏档
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
  // 页面没有"地图加载失败"错误屏
  const bodyText = await page.evaluate(() => document.body.textContent ?? "");
  expect(bodyText).not.toContain("地图加载失败");
});

test("dafung-selected-map 指向已失效的 id 时回退默认 sanguo 不卡死", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  // 清掉 selected-map:确保走默认(DEFAULT_MAP_ID = sanguo)路径
  await page.evaluate(() => localStorage.removeItem("dafung-selected-map"));
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(
    () => !!(window as unknown as { __dafung?: unknown }).__dafung,
    undefined,
    { timeout: 10000 },
  );
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
});


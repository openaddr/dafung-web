// React 重构 · 地图选择(阶段 11)。
// 意图来源:旧 map-selection.spec(清单/预览/确认/记忆 localStorage/换图起兵;
// 自建图部分归 react-editor.spec,此处覆盖内置图与选中记忆)。
import { test, expect } from "@playwright/test";
import { snap, waitForEngine, openSoloSetup } from "./react-helpers";

test("选图面板:列出内置图(含城数与目标),点选展开 SVG 预览", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("home-select-map").click();
  const panel = page.getByTestId("map-select-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("map-item-sanguo")).toContainText("30 城");
  await expect(page.getByTestId("map-item-zhongyuan")).toContainText("8 城");
  // 点 zhongyuan → 异步加载 + 简版预览 SVG
  await page.getByTestId("map-item-zhongyuan").click();
  await expect(page.getByTestId("map-preview")).toBeVisible({ timeout: 10_000 });
});

test("选 zhongyuan 确认:地图名刷新 + 记忆到 localStorage(dafung.mapId)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-zhongyuan").click();
  await page.getByTestId("map-confirm").click();
  await expect(page.getByTestId("current-map-name")).toHaveText("中原争霸");
  expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toBe("zhongyuan");
});

test("选 zhongyuan 起兵:棋盘为 8 城小环,快照健康", async ({ page }) => {
  await page.goto("/?seed=42");
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-zhongyuan").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await waitForEngine(page);
  await expect(page.locator("[data-tile]")).toHaveCount(8);
  const s = await snap(page);
  expect(s.phase).toBe("Setup");
  expect(s.players).toHaveLength(4); // 默认 4 诸侯档
});

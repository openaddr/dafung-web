// React 重构 · 地图选择(阶段 11)。
// 意图来源:旧 map-selection.spec(清单/预览/确认/记忆 localStorage/换图起兵;
// 自建图部分归 react-editor.spec,此处覆盖内置图与选中记忆)。
import { test, expect } from "./fixtures";
import { snap, waitForEngine, openSoloSetup } from "./react-helpers";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

// 真实段(ADR-0058):首页「选择地图」真实点击开面板,内置图清单(城数/目标)与
// 点选展开的预览真实加载即被测环——零种植零冻结。
test("选图面板:列出内置图(含城数与目标),点选展开 SVG 预览", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId(HOME_TID.selectMap).click();
  const panel = page.getByTestId(SETUP_TID.mapPanel);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId(SETUP_TID.mapItem("guanzhong"))).toContainText("28 城"); // #938 28 城 4×7 缩域盘(全城池制:tileCount=城数)
  await expect(page.getByTestId(SETUP_TID.mapItem("zhongyuan"))).toContainText("8 城");
  // 点 zhongyuan → 异步加载 + 简版预览 SVG
  await page.getByTestId(SETUP_TID.mapItem("zhongyuan")).click();
  await expect(page.getByTestId(SETUP_TID.mapPreview)).toBeVisible({ timeout: 10_000 });
});

// 真实段(ADR-0058):点选→确认的真实交互链,地图名刷新+localStorage 记忆写入即
// 被测环——零种植零冻结。
test("选 zhongyuan 确认:地图名刷新 + 记忆到 localStorage(dafung.mapId)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId(HOME_TID.selectMap).click();
  await page.getByTestId(SETUP_TID.mapItem("zhongyuan")).click();
  await page.getByTestId(SETUP_TID.mapConfirm).click();
  await expect(page.getByTestId(SETUP_TID.currentMapName)).toHaveText("中原争霸");
  expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toBe("zhongyuan");
});

// 真实段(ADR-0058):选图→起兵真实开局链,棋盘渲染(8 城小环)+快照健康(Setup
// 相位/默认 4 席)即被测环——零种植零冻结。
test("选 zhongyuan 起兵:棋盘为 8 城小环,快照健康", async ({ page }) => {
  await page.goto("/?seed=42");
  await page.getByTestId(HOME_TID.selectMap).click();
  await page.getByTestId(SETUP_TID.mapItem("zhongyuan")).click();
  await page.getByTestId(SETUP_TID.mapConfirm).click();
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.startGame).click();
  await waitForEngine(page);
  await expect(page.locator("[data-tile]")).toHaveCount(8);
  const s = await snap(page);
  expect(s.phase).toBe("Setup");
  expect(s.players).toHaveLength(4); // 默认 4 诸侯档
});

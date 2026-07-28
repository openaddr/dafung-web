// 地图编辑器:此前无 e2e 覆盖。验证打开 / 重置(防丢字段崩溃)/ 试玩衔接。
import { test, expect, type Page } from "@playwright/test";

async function openEditor(page: Page) {
  await page.goto("/");
  await page.locator("#edit-btn").click();
  await page.locator("[data-tile]").first().waitFor({ state: "attached", timeout: 10000 });
}

test("打开编辑器,渲染城池与侧栏面板", async ({ page }) => {
  await openEditor(page);
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
  await expect(page.locator(".editor-panel")).toBeVisible();
});

test("重置回内置地图后仍正常渲染(防 v1.9.x 丢 maxLevel 等字段崩溃)", async ({ page }) => {
  await openEditor(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "重置" }).click();
  await page.locator("[data-tile]").first().waitFor({ state: "attached", timeout: 10000 });
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
});

test("试玩这局:编辑器衔接进入对局", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: /试玩/ }).click();
  await page.waitForFunction(
    () => !!(window as unknown as { __dafung?: unknown }).__dafung,
    undefined,
    { timeout: 10000 },
  );
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
});

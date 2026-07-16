// 截图 e2e:生成 README/文档用画面。
import { test } from "@playwright/test";
import { setupAndPlay } from "./helpers";

test("截图:开局布阵", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/01-setup.png" });
});

test("截图:对局沙盘", async ({ page }) => {
  await setupAndPlay(page, "2");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/02-playing.png" });
});

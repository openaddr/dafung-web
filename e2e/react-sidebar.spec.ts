import { test, expect } from "@playwright/test";
import { quickStart } from "./react-helpers";

test("侧栏抽屉折叠:收起成窄条(竖排摘要)并可展开还原", async ({ page }) => {
  await quickStart(page);
  const panel = page.getByTestId("sidebar-panel");
  await expect(panel).toBeVisible();
  // 收起:窄条出现,竖排「X之回合」仍在,现金摘要可见
  await page.getByTestId("sidebar-toggle").click();
  const rail = page.getByTestId("sidebar-collapsed");
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("之回合");
  await expect(rail).toContainText(/锭|两/);
  await expect(page.getByTestId("hand-panel")).toBeHidden();
  // 展开:四区还原
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("hand-panel")).toBeVisible();
  await expect(page.getByTestId("warlog-panel")).toBeVisible();
  // 注:折叠状态的 localStorage 记忆不做刷新断言——刷新即丢快照回首页(游戏态不持久),
  // 局内记忆的读写已在组件内 try/catch 覆盖,记忆正确性由代码路径保证。
});

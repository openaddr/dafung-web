// #279 联机服务器地址可配置:默认同源;覆写持久化;跨源建房冒烟。
// 跨源段是 APK 真机联机的同款形态:页面在静态源(vite preview),REST+WS 打到引擎源
// (E2E_GAME_PORT;playwright.config 第二个 webServer,自带 CORS)——证明地址单源与
// 服务端 CORS 生效。默认路径零改动由 react-online(引擎源自托管)全绿背书。
import { test, expect } from "./fixtures";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

test("服务器地址:默认同源;覆写后跨源建房成功;持久化;清空恢复默认", async ({ page }) => {
  await page.goto("/?online=1");
  await expect(page.getByTestId("lobby-screen")).toBeVisible();
  const staticOrigin = new URL(page.url()).origin;
  const input = page.getByTestId("lobby-server-base");
  await expect(input).toHaveValue(staticOrigin); // 默认 = 页面同源

  // 覆写到引擎源,失焦即存;建房(REST 建房 + WS 入座广播)打到引擎源 = 跨源链路全通
  await input.fill(ONLINE);
  await input.blur();
  await page.getByTestId("lobby-create").click();
  await expect(page.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });

  // 持久化:reload(?online=1 直进大厅)后覆写仍在
  await page.reload();
  await expect(page.getByTestId("lobby-screen")).toBeVisible();
  await expect(page.getByTestId("lobby-server-base")).toHaveValue(ONLINE);

  // 清空保存 = 恢复默认同源
  await page.getByTestId("lobby-server-base").fill("");
  await page.getByTestId("lobby-server-base").blur();
  await page.reload();
  await expect(page.getByTestId("lobby-screen")).toBeVisible();
  await expect(page.getByTestId("lobby-server-base")).toHaveValue(staticOrigin);
});

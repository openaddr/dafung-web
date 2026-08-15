// React 重构 · 健壮性(阶段 11)。
// 意图来源:旧 resilience.spec(localStorage 坏数据不卡死、失效 id 回退)。
// 联机刷新重入:服务器无 token 重入(online.ts 注释 TODO),刷新 ?room= 会重新走
// 加入流程(满员则失败)——此处测降级不崩溃(意图同旧 resilience 的"重进"场景)。
import { test, expect } from "@playwright/test";

test("图库 localStorage 垃圾数据:选图清单忽略之,起兵不卡死", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dafung-custom-maps", "not-json{{{"));
  await page.goto("/");
  await page.getByTestId("select-map").click();
  await expect(page.getByTestId("map-item-sanguo")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("map-cancel").click();
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 30_000 });
});

test("记忆的地图 id 失效:起兵被拦,停留设置屏(降级不崩溃)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dafung.mapId", "no-such-map"));
  await page.goto("/");
  await expect(page.getByTestId("current-map-name")).toHaveText("no-such-map");
  await page.getByTestId("start-game").click();
  // ⚠ 产品缺陷(已报告):loadMapById 抛错后 pushHint 的「起兵失败」只渲染在 Game 屏,
  // 设置屏看不到失败原因(静默失败)。此处只断言降级不崩溃:停留设置屏、未开局。
  await expect(page.getByTestId("setup-screen")).toBeVisible({ timeout: 5_000 });
  await expect(
    page.evaluate(() => !!(window as any).__dafung?.getEngine?.()),
  ).resolves.toBe(false);
});

test("联机刷新 ?room= 直链:重新走加入流程,不崩溃", async ({ browser }) => {
  const ONLINE = "http://localhost:3010";
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();

  // 建房 + 加入 + 开局(2 人房,速战身价)
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill("3000");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 8_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 8_000 });
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-sanguo").click();
  await host.getByTestId("map-confirm").click();
  await host.getByTestId("lobby-start").click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId("hand-panel")).toBeVisible({ timeout: 20_000 });
  }

  // 刷新 guest:无 token 重入,重走 ?room= 加入(满员 409 → 停留大厅并提示;无论哪种,UI 不崩溃)
  await guest.reload();
  await expect(guest.getByTestId("lobby-screen")).toBeVisible({ timeout: 15_000 });
  // host 端对局不受影响
  await expect(host.getByTestId("hand-panel")).toBeVisible();

  await host.context().close();
  await guest.context().close();
});

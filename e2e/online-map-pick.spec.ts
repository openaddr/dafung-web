// 联机选图(ticket 05):Host 大厅选图 → 非 Host 见图名 → 开局两端同图。
// 验证:
//  - Host 大厅有「选择地图」入口,选 zhongyuan(8 城小图)
//  - 非 Host 大厅只读显示房主选定的地图名「中原争霸」
//  - 开局后两端 snapshot 的 board.tiles 一致(都是 zhongyuan,8 城)
//  - Host 选图列表不含自建图(联机仅内置图)
//
// 不复用 multi-helpers.createClients(它自动开局);这里手写建房/加入/选图/开局流程。
import { test, expect, type Browser } from "@playwright/test";

const ONLINE = "http://localhost:3010";
const MAP_ID = "zhongyuan";
const MAP_NAME = "中原争霸";

/** 建 N 个独立 context;返回 page 数组(未进入大厅)。 */
async function openClients(browser: Browser, n: number) {
  const clients = [];
  for (let i = 0; i < n; i++) clients.push(await (await browser.newContext()).newPage());
  for (const c of clients) await c.goto(`${ONLINE}/?online=1`);
  return clients;
}

test("Host 大厅选图(zhongyuan)→非 Host 见图名→开局两端同图(8 城)", async ({ browser }) => {
  test.setTimeout(120_000);
  const [host, guest] = await openClients(browser, 2);

  // host 建房
  await host.getByPlaceholder("目标身价(默认8000)").fill("5000");
  await host.getByRole("button", { name: "建房" }).click();
  await expect(host.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });
  const roomId = ((await host.locator(".lobby-code").textContent()) ?? "").trim();
  expect(roomId).toMatch(/^[A-Z]{4}$/);

  // 非 Host 加入
  await guest.getByPlaceholder("房间码").fill(roomId);
  await guest.getByRole("button", { name: "加入" }).click();
  await expect(guest.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });

  // Host 选图:点「选择地图」→ 选 zhongyuan → 确认选择(联机仅内置图,无 custom- 条目)
  await host.getByRole("button", { name: "选择地图" }).click();
  const mapPanel = host.locator(".map-select-panel");
  await expect(mapPanel).toBeVisible({ timeout: 8000 });
  // 联机仅内置图:不应出现 custom- 前缀的自建图条目
  await expect(mapPanel.locator("[data-map-id^='custom-']")).toHaveCount(0);
  await mapPanel.locator(`[data-map-id="${MAP_ID}"]`).click();
  await mapPanel.getByRole("button", { name: "确认选择" }).click();
  // Host 大厅当前地图名应刷新为「中原争霸」
  await expect(host.locator(".lobby-map-name")).toContainText(MAP_NAME, { timeout: 8000 });

  // 非 Host(只读)应在广播后看到同一图名
  await expect(guest.locator(".lobby-map-name")).toContainText(MAP_NAME, { timeout: 10000 });

  // 非 Host 端:占位引擎 board 应已重建为 zhongyuan(8 城)——mapId 变化触发 rebuildForMap
  await expect.poll(
    async () => {
      const n = await guest.evaluate(() => (window as unknown as { __dafung?: { engine: { board: { tiles: { length: number } } } } }).__dafung?.engine.board.tiles.length ?? -1);
      return n;
    },
    { timeout: 10000, message: "非 Host 占位引擎 board 重建为 8 城(zhongyuan)" },
  ).toBe(8);

  // Host 开局
  await host.getByRole("button", { name: "开局" }).click();
  // 两端进对局(状态条出现「的回合」)
  for (const c of [host, guest]) {
    await expect(c.locator("#status-bar")).toContainText(/的回合/, { timeout: 20000 });
  }

  // 开局后两端 board 一致:都是 zhongyuan(8 城)
  const [hostTiles, guestTiles] = await Promise.all([
    host.evaluate(() => (window as unknown as { __dafung?: { engine: { board: { tiles: { length: number } } } } }).__dafung!.engine.board.tiles.length),
    guest.evaluate(() => (window as unknown as { __dafung?: { engine: { board: { tiles: { length: number } } } } }).__dafung!.engine.board.tiles.length),
  ]);
  expect(hostTiles).toBe(8);
  expect(guestTiles).toBe(hostTiles); // 两端同图

  await host.close();
  await guest.close();
});

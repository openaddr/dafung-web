// 选择地图二级屏 e2e:设置屏「选择地图」→ 选 zhongyuan → 起兵用的是 zhongyuan(8 城,非 sanguo 的 30)。
// 复用 e2e/helpers.ts 模式(?seed= 确定性、setupAndPlay/snap)。e2e 跑在 vite preview 构建产物上。
import { test, expect } from "@playwright/test";
import { GOTO_OPTS, snap } from "./helpers";

test("设置屏显示「选择地图」按钮,点开列出内置地图", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  // 「选择地图」按钮存在
  await expect(page.locator("#select-map-btn")).toBeVisible();
  // 点开二级屏
  await page.locator("#select-map-btn").click();
  // 清单加载后应出现地图条目(内置 sanguo / zhongyuan)
  const sanguoItem = page.locator('.map-list .map-item[data-map-id="sanguo"]');
  await expect(sanguoItem).toBeVisible();
  await expect(page.locator('.map-list .map-item[data-map-id="zhongyuan"]')).toBeVisible();
  // 每项展示城池数与目标身价(zhongyuan = 8 城)
  await expect(sanguoItem).toContainText(/30\s*城/);
  await expect(page.locator('.map-list .map-item[data-map-id="zhongyuan"]')).toContainText(/8\s*城/);
});

test("点击某项展开实时 SVG 棋盘预览(createBoardSvg)", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  await page.locator("#select-map-btn").click();
  // 点 zhongyuan 展开 preview
  await page.locator('.map-list .map-item[data-map-id="zhongyuan"]').click();
  // 预览容器内出现棋盘 SVG(id=board);等待异步 loadMapById + createBoardSvg 完成
  const previewSvg = page.locator(".map-preview #board");
  await expect(previewSvg).toBeVisible({ timeout: 10000 });
});

test("选 zhongyuan 起兵,棋盘用的是 zhongyuan(8 城而非 sanguo 的 30)", async ({ page }) => {
  await page.goto("/?seed=42", GOTO_OPTS);
  // 进设置屏 → 点「选择地图」→ 选 zhongyuan → 确认
  await page.locator("#select-map-btn").click();
  await page.locator('.map-list .map-item[data-map-id="zhongyuan"]').click();
  await page.locator("#map-confirm-btn").click();
  // 回设置屏:当前地图名应已刷新为「中原争霸」
  await expect(page.locator("#selected-map-name")).toHaveText("中原争霸");
  // 起兵(2 诸侯,确定性 seed)
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  // 等 App 就绪(__dafung 挂载;地图异步 fetch)
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });

  // 断言棋盘是 zhongyuan:tile 数 = 8(而非 sanguo 的 30)
  const boardCount = await page.evaluate(
    () => (window as unknown as { __dafung?: { board?: { count: number } } }).__dafung?.board?.count ?? -1,
  );
  expect(boardCount).toBe(8);
  // DOM 上的城池格也应为 8
  await expect(page.locator("[data-tile]")).toHaveCount(8);
});

test("选图记忆到 localStorage(dafung-selected-map)", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  await page.locator("#select-map-btn").click();
  await page.locator('.map-list .map-item[data-map-id="zhongyuan"]').click();
  await page.locator("#map-confirm-btn").click();
  // 仅选定(未起兵)也应已持久化(onMapChange 回调)
  const stored = await page.evaluate(() => localStorage.getItem("dafung-selected-map"));
  expect(stored).toBe("zhongyuan");
});

test("起兵时把选中地图 id 存入 localStorage", async ({ page }) => {
  await page.goto("/?seed=7", GOTO_OPTS);
  await page.locator("#select-map-btn").click();
  await page.locator('.map-list .map-item[data-map-id="zhongyuan"]').click();
  await page.locator("#map-confirm-btn").click();
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });
  const stored = await page.evaluate(() => localStorage.getItem("dafung-selected-map"));
  expect(stored).toBe("zhongyuan");
});

test("默认选中清单第一项(sanguo)", async ({ page }) => {
  await page.goto("/", GOTO_OPTS);
  // 初始:未选过时默认 sanguo,展示名解析后应为「群雄逐鹿」
  // 等异步 listMaps 解析名称(listMaps 是 async fetch)
  await expect(page.locator("#selected-map-name")).toHaveText("群雄逐鹿", { timeout: 10000 });
  // 点开二级屏:sanguo 条目应带 selected 态
  await page.locator("#select-map-btn").click();
  await expect(page.locator('.map-list .map-item[data-map-id="sanguo"].selected')).toBeVisible();
});

test("选图后起兵能正常进入对局(snapshot 健康)", async ({ page }) => {
  await page.goto("/?seed=99", GOTO_OPTS);
  await page.locator("#select-map-btn").click();
  await page.locator('.map-list .map-item[data-map-id="zhongyuan"]').click();
  await page.locator("#map-confirm-btn").click();
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });
  // 快照可读且 phase 推进到 Setup(选都阶段)
  const s = await snap(page);
  expect(s.phase).toBe("Setup");
  expect(s.players.length).toBe(2);
});

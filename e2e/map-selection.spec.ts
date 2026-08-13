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

// ── 自建图(ticket 03):编辑器保存 → 图库 → 菜单可选可玩 ──

/** 编辑器里保存一张自建图到 localStorage 图库。返回保存用的图名。 */
async function saveCustomMapInEditor(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.goto("/", GOTO_OPTS);
  await page.locator("#edit-btn").click();
  await page.locator("[data-tile]").first().waitFor({ state: "attached", timeout: 10000 });
  // 「保存」会触发 prompt,接受并填入名字
  page.once("dialog", (d) => d.accept(name));
  await page.getByRole("button", { name: "保存" }).click();
  // 等保存反馈(按钮文案变为「已存!…」)
  await expect(page.getByRole("button", { name: /已存/ })).toBeVisible({ timeout: 5000 });
}

test("编辑器保存的自建图出现在「选择地图」菜单", async ({ page }) => {
  const name = `我的自建图${Date.now()}`;
  await saveCustomMapInEditor(page, name);
  // 退出编辑器回设置屏
  await page.getByRole("button", { name: /返回/ }).click();
  // 打开「选择地图」:自建图条目应出现(custom- id 前缀 + 自定义名)
  await page.locator("#select-map-btn").click();
  const customItem = page.locator(".map-list .map-item").filter({ hasText: name });
  await expect(customItem).toBeVisible({ timeout: 10000 });
  // id 为 custom- 前缀
  const customId = await customItem.getAttribute("data-map-id");
  expect(customId).toMatch(/^custom-/);
  // 描述为「自建地图」
  await expect(customItem).toContainText("自建地图");
});

test("自建图可选可玩:选它起兵,棋盘用的是该图(snapshot 健康)", async ({ page }) => {
  const name = `可玩自建图${Date.now()}`;
  await saveCustomMapInEditor(page, name);
  // 返回设置屏 → 选择地图 → 选自建图 → 确认
  await page.getByRole("button", { name: /返回/ }).click();
  await page.locator("#select-map-btn").click();
  const customItem = page.locator(".map-list .map-item").filter({ hasText: name });
  await expect(customItem).toBeVisible({ timeout: 10000 });
  await customItem.click();
  await page.locator("#map-confirm-btn").click();
  // 回设置屏:当前地图名应刷新为自建图名
  await expect(page.locator("#selected-map-name")).toHaveText(name);
  // 起兵(2 诸侯,确定性 seed)
  await page.locator("#seat-count").selectOption("2");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });
  // 起兵用的是自建图:dafung-selected-map 应为 custom- 前缀
  const stored = await page.evaluate(() => localStorage.getItem("dafung-selected-map"));
  expect(stored).toMatch(/^custom-/);
  // 快照健康(选都阶段)
  const s = await snap(page);
  expect(s.phase).toBe("Setup");
  expect(s.players.length).toBe(2);
});

test("自建图持久化到 localStorage 图库(dafung-custom-maps 数组)", async ({ page }) => {
  const name = `持久自建图${Date.now()}`;
  await saveCustomMapInEditor(page, name);
  // 图库数组应包含刚存的图(id custom- + 名字匹配)
  const raw = await page.evaluate(() => localStorage.getItem("dafung-custom-maps"));
  expect(raw).not.toBeNull();
  const lib = JSON.parse(raw!) as Array<{ id: string; name: string }>;
  const found = lib.find((e) => e.name === name);
  expect(found).toBeTruthy();
  expect(found!.id).toMatch(/^custom-/);
});

test("自建图能选可玩并预览:点开自建图项展开 SVG 棋盘预览", async ({ page }) => {
  const name = `预览自建图${Date.now()}`;
  await saveCustomMapInEditor(page, name);
  await page.getByRole("button", { name: /返回/ }).click();
  await page.locator("#select-map-btn").click();
  const customItem = page.locator(".map-list .map-item").filter({ hasText: name });
  await expect(customItem).toBeVisible({ timeout: 10000 });
  await customItem.click();
  // 预览容器内出现棋盘 SVG(id=board);自建图数据从 localStorage 读,异步加载
  const previewSvg = page.locator(".map-preview #board");
  await expect(previewSvg).toBeVisible({ timeout: 10000 });
});

// React 重构 · 地图编辑器(阶段 11)。
// 意图来源:旧 editor.spec(打开/重置/试玩)+ map-selection.spec 的自建图四条
// (保存进图库 localStorage / 出现在选图菜单 / 可选可玩 / 预览)+ 编辑器 undo/redo
// (React 新增能力)与拖拽改坐标。
import { test, expect, type Page } from "@playwright/test";
import { snap, waitForEngine, openSoloSetup } from "./react-helpers";

async function openEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("home-edit-map").click();
  await expect(page.getByTestId("editor-screen")).toBeVisible();
  await page.locator("[data-tile]").first().waitFor({ state: "attached", timeout: 10_000 });
}

/** 读取表单里当前选中城的坐标文本(如「坐标:[120, 80]」)。 */
function posText(page: Page) {
  return page.getByTestId("editor-tile-form").getByText(/^坐标:\[/).textContent();
}

test("打开编辑器:棋盘渲染 + 属性表单就位", async ({ page }) => {
  await openEditor(page);
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
  await expect(page.getByTestId("editor-tile-form")).toBeVisible();
  await expect(page.getByTestId("editor-undo")).toBeDisabled();
  await expect(page.getByTestId("editor-redo")).toBeDisabled();
});

test("表单改属性:改城名 → undo 撤销 → redo 重做", async ({ page }) => {
  await openEditor(page);
  const nameField = page.getByTestId("editor-field-name");
  const before = await nameField.inputValue();
  await nameField.fill("测试城");
  await nameField.blur();
  await expect(nameField).toHaveValue("测试城");
  await expect(page.getByTestId("editor-undo")).toBeEnabled();
  // 撤销:回到原名
  await page.getByTestId("editor-undo").click();
  await expect(nameField).toHaveValue(before);
  // 重做:再次生效
  await page.getByTestId("editor-redo").click();
  await expect(nameField).toHaveValue("测试城");
});

test("拖拽城池改坐标:坐标文本变化,可撤销还原", async ({ page }) => {
  await openEditor(page);
  // 点选 3 号城(选中 + 表单显示其坐标)
  const tile = page.locator("[data-tile='3']");
  const box = (await tile.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const pos0 = await posText(page);
  // 拖拽:按下 → 挪动 → 松手(坐标按 viewBox 换算写回,四舍五入)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  // TODO #13:坐标写回是拖拽后异步生效,原固定 200ms 改为轮询坐标文本真的变化(5s 余量)
  await expect.poll(() => posText(page), { timeout: 5_000 }).not.toBe(pos0);
  // 撤销拖拽:坐标还原
  await page.getByTestId("editor-undo").click();
  await expect.poll(() => posText(page)).toBe(pos0);
});

test("另存新图:写入 localStorage 图库(dafung-custom-maps)", async ({ page }) => {
  await openEditor(page);
  const name = `自建图${Date.now()}`;
  page.once("dialog", (d) => d.accept(name));
  await page.getByTestId("editor-save-as").click();
  const raw = await page.evaluate(() => localStorage.getItem("dafung-custom-maps"));
  expect(raw).toBeTruthy();
  const lib = JSON.parse(raw!) as Array<{ id: string; name: string }>;
  const found = lib.find((e) => e.name === name);
  expect(found).toBeTruthy();
  expect(found!.id).toMatch(/^custom-/);
});

test("自建图出现在选图菜单(custom- 前缀 + 预览可展开)", async ({ page }) => {
  await openEditor(page);
  const name = `菜单自建图${Date.now()}`;
  page.once("dialog", (d) => d.accept(name));
  await page.getByTestId("editor-save-as").click();
  await page.getByTestId("editor-exit").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await page.getByTestId("home-select-map").click();
  const customItem = page.locator('[data-testid^="map-item-custom-"]').filter({ hasText: name });
  await expect(customItem).toBeVisible({ timeout: 10_000 });
  await expect(customItem).toContainText("自建地图");
  const customId = await customItem.getAttribute("data-testid");
  expect(customId).toMatch(/^map-item-custom-/);
  // 点选展开预览(自建图从 localStorage 异步读)
  await customItem.click();
  await expect(page.getByTestId("map-preview")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("map-confirm").click();
  await expect(page.getByTestId("current-map-name")).toHaveText(name);
  expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toMatch(/^custom-/);
});

// 自建图可玩回归:曾因 App.handleStart 单用 FetchMapSource 抛「内置图清单中无此 id」
//(e2e 巡检发现,已修复为组合源 getMapSource),此用例锚定该修复。
test("自建图入选图菜单,可选可玩:选它起兵进对局(快照健康)", async ({ page }) => {
  await openEditor(page);
  const name = `可玩自建图${Date.now()}`;
  page.once("dialog", (d) => d.accept(name));
  await page.getByTestId("editor-save-as").click();
  // 退出编辑器 → 选图菜单出现自建图条目(custom- 前缀 + 「自建地图」描述)
  await page.getByTestId("editor-exit").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await page.getByTestId("home-select-map").click();
  const customItem = page.locator('[data-testid^="map-item-custom-"]').filter({ hasText: name });
  await expect(customItem).toBeVisible({ timeout: 10_000 });
  await expect(customItem).toContainText("自建地图");
  // 点选展开预览(自建图从 localStorage 异步读)
  await customItem.click();
  await expect(page.getByTestId("map-preview")).toBeVisible({ timeout: 10_000 });
  // 确认 → 当前地图名刷新 → 起兵进入对局
  await page.getByTestId("map-confirm").click();
  await expect(page.getByTestId("current-map-name")).toHaveText(name);
  expect(await page.evaluate(() => localStorage.getItem("dafung.mapId"))).toMatch(/^custom-/);
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await waitForEngine(page);
  // 自建图 = sanguo 副本:30 主路城,进入选都阶段
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
  expect((await snap(page)).phase).toBe("Setup");
});

test("试玩这局:编辑器直接以编辑中数据开局", async ({ page }) => {
  await openEditor(page);
  await page.getByTestId("editor-try-play").click();
  await expect(page.getByTestId("hand-panel")).toBeVisible({ timeout: 20_000 });
  // 试玩固定 1 真人 + 3 电脑
  const s = await snap(page);
  expect(s.players).toHaveLength(4);
  expect(s.players.filter((p: any) => p.isBot)).toHaveLength(3);
});

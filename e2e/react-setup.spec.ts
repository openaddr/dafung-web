// React 重构 · 设置屏与开局配置(阶段 11)。
// 意图来源(旧 spec → 此处):solo-mode.spec(座位/国号校验)、play.spec(开局渲染/选都就位)、
// click.spec(点城选都的点击可靠性——React 版点城即定都,无确认框)。
import { test, expect } from "@playwright/test";
import { snap, waitForEngine, openSoloSetup, pickCapital } from "./react-helpers";

test("设置屏渲染:三配置控件 + 座位表(首行真人,其余电脑)", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  const screen = page.getByTestId("solo-setup-screen");
  await expect(screen).toBeVisible();
  await expect(page.getByTestId("setup-seat-count")).toHaveValue("4");
  await expect(page.getByTestId("setup-target")).toHaveValue("30000");
  await expect(page.getByTestId("setup-difficulty")).toHaveValue("Normal");
  await expect(page.getByTestId("current-map-name")).toHaveText("棋盘天下", { timeout: 10_000 });

  // 默认 4 座:0 真人(国号可编、默认「魏」),1-3 电脑(国号占位「电脑」,S-7 改语义)
  await expect(page.getByTestId("setup-seat-0-guohao")).toBeEditable();
  await expect(page.getByTestId("setup-seat-0-guohao")).toHaveValue("魏");
  for (let i = 1; i < 4; i++) {
    await expect(page.getByTestId(`setup-seat-${i}-guohao`)).toHaveText("电脑");
    await expect(page.getByTestId(`setup-seat-${i}-type`)).toHaveText("电脑");
  }
  await expect(page.getByTestId("setup-seat-0-type")).toHaveText("你");

  // 诸侯数切换:座位行数跟随
  await page.getByTestId("setup-seat-count").selectOption("2");
  await expect(page.getByTestId("setup-seat-1")).toBeVisible();
  await expect(page.getByTestId("setup-seat-2")).toHaveCount(0);
});

test("字盘快选国号:点字更新真人国号", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId("guohao-char-蜀").click();
  await expect(page.getByTestId("setup-seat-0-guohao")).toHaveValue("蜀");
});

test("国号非法(清空)起兵被拦:内联红字 + 按钮禁用,未开局", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId("setup-seat-0-guohao").fill("");
  // S8:onChange 即校验 —— 红边 + 框下红字即时出现,不必等起兵
  await expect(page.getByTestId("setup-guohao-error")).toContainText("单个汉字");
  await expect(page.getByTestId("setup-seat-0-guohao")).toHaveClass(/border-danger/);
  // 评审二轮 S-2:国号非法时起兵按钮直接禁用(可点不动 → 不可点),hint 兜底退役
  await expect(page.getByTestId("start-game")).toBeDisabled();
  await expect(page.getByTestId("solo-setup-screen")).toBeVisible();
  await expect(
    page.evaluate(() => !!(window as any).__dafung?.getEngine?.()),
  ).resolves.toBe(false);
});

test("起兵 → 点城定都 → 进入对局:p0 人类 + 其余电脑,国号无重号", async ({ page }) => {
  await page.goto("/?seed=20260815");
  await openSoloSetup(page);
  await page.getByTestId("setup-seat-count").selectOption("3");
  await page.getByTestId("start-game").click();
  await waitForEngine(page);

  // 选都引导 hint + 二次确认框(需求1:点城先弹「定都于此?」再确认筑城)
  await expect(page.getByTestId("hint")).toContainText("择一空城建都");
  await pickCapital(page);

  // 等轮到人类(bot 选都 + 首回合自动推进)
  await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 30_000 });
  const s = await snap(page);
  expect(s.phase).toBe("Playing");
  expect(s.players).toHaveLength(3);
  expect(s.players[0].isBot).toBe(false);
  expect(s.players.filter((p: any) => p.isBot)).toHaveLength(2);
  expect(s.players.every((p: any) => p.capitalIndex >= 0)).toBe(true);
  const gh = s.players.map((p: any) => p.guohao);
  expect(gh.every((g: string) => g.length > 0)).toBe(true);
  expect(new Set(gh).size).toBe(3);
  // 默认 sanguo 图 30 主路城(另渲染辅路格,总数 ≥ 30)
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
});

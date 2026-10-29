// React 重构 · 设置屏与开局配置(阶段 11)。
// 意图来源(旧 spec → 此处):solo-mode.spec(座位/国号校验)、play.spec(开局渲染/选都就位)、
// click.spec(点城选都的点击可靠性——React 版点城即定都,无确认框)。
import { test, expect } from "./fixtures";
import { snap, waitForEngine, openSoloSetup, pickCapital, waitMyRollDone } from "./react-helpers";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { TESTIDS } from "../src/app/screens/game/testids";

test("设置屏渲染:三配置控件 + 座位表(首行真人,其余电脑)", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  const screen = page.getByTestId(SETUP_TID.screen);
  await expect(screen).toBeVisible();
  // X10(#29):select → stepper/分段选择器,断言改为数值文本 + 选项 aria-pressed
  // (#613 难度档退役:难度选择器随删,原 setup-difficulty-Normal 断言退役)
  await expect(page.getByTestId(SETUP_TID.seatCount)).toHaveText("4");
  await expect(page.getByTestId(`${SETUP_TID.target}-30000`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // #249:默认图换「环游图」(index.json 首项),断言跟默认名单源
  await expect(page.getByTestId(SETUP_TID.currentMapName)).toHaveText("环游图", {
    timeout: 10_000,
  });

  // 默认 4 座:0 真人(国号可编、默认「魏」),1-3 电脑(国号列占位「待分配」,R3-A4 #67 去重;
  // #751/S3:类型列改短签印,bot=「机」/真人=「你」)
  await expect(page.getByTestId(SETUP_TID.seatGuohaoInput(0))).toBeEditable();
  await expect(page.getByTestId(SETUP_TID.seatGuohaoInput(0))).toHaveValue("魏");
  for (let i = 1; i < 4; i++) {
    await expect(page.getByTestId(`setup-seat-${i}-guohao`)).toHaveText("待分配");
    await expect(page.getByTestId(`setup-seat-${i}-type`)).toHaveText("机");
  }
  await expect(page.getByTestId(SETUP_TID.seatType(0))).toHaveText("你");

  // 诸侯数切换:座位行数跟随(X10 stepper:4 −→ 3 −→ 2)
  await page.getByTestId(`${SETUP_TID.seatCount}-minus`).click();
  await page.getByTestId(`${SETUP_TID.seatCount}-minus`).click();
  await expect(page.getByTestId(SETUP_TID.seatCount)).toHaveText("2");
  await expect(page.getByTestId(SETUP_TID.seatRow(1))).toBeVisible();
  await expect(page.getByTestId(SETUP_TID.seatRow(2))).toHaveCount(0);
});

test("字盘快选国号:点字更新真人国号", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.guohaoChar("蜀")).click();
  await expect(page.getByTestId(SETUP_TID.seatGuohaoInput(0))).toHaveValue("蜀");
});

test("国号非法(清空)起兵被拦:内联红字 + 按钮禁用,未开局", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.seatGuohaoInput(0)).fill("");
  // S8:onChange 即校验 —— 红边 + 框下红字即时出现,不必等起兵
  await expect(page.getByTestId(SETUP_TID.guohaoError)).toContainText("单个汉字");
  await expect(page.getByTestId(SETUP_TID.seatGuohaoInput(0))).toHaveClass(/border-danger/);
  // 评审二轮 S-2:国号非法时起兵按钮直接禁用(可点不动 → 不可点),hint 兜底退役
  await expect(page.getByTestId(SETUP_TID.startGame)).toBeDisabled();
  await expect(page.getByTestId(SETUP_TID.screen)).toBeVisible();
  await expect(page.evaluate(() => !!(window as any).__dafung?.getEngine?.())).resolves.toBe(false);
});

test("起兵 → 点城定都 → 进入对局:p0 人类 + 其余电脑,国号无重号", async ({ page }) => {
  await page.goto("/?seed=20260815");
  await openSoloSetup(page);
  await page.getByTestId(`${SETUP_TID.seatCount}-minus`).click(); // X10 stepper:4 → 3
  await page.getByTestId(SETUP_TID.startGame).click();
  await waitForEngine(page);

  // 选都引导 hint(dogfood 2026-09-28 起文案按 turn 分化:轮到玩家=「轮到你定都…」)
  // + 二次确认框(需求1:点城先弹「定都于此?」再确认筑城)
  await expect(page.getByTestId(TESTIDS.hint)).toContainText("定都");
  await pickCapital(page);

  // 等开局放行 + 人类首手自动走完(#188 行军自动化;替代旧「等 roll-button 可用」)
  await waitMyRollDone(page, 0, 30_000);
  const s = await snap(page);
  expect(s.phase).toBe("Playing");
  expect(s.players).toHaveLength(3);
  expect(s.players[0].isBot).toBe(false);
  expect(s.players.filter((p: any) => p.isBot)).toHaveLength(2);
  expect(s.players.every((p: any) => p.capitalIndex >= 0)).toBe(true);
  const gh = s.players.map((p: any) => p.guohao);
  expect(gh.every((g: string) => g.length > 0)).toBe(true);
  expect(new Set(gh).size).toBe(3);
  // 默认 huanyou 图 45 格
  expect(await page.locator("[data-tile]").count()).toBeGreaterThanOrEqual(30);
});

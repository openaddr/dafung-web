// 战报抽屉性能窗口化回归(2026-09「越玩越卡」排查):抽屉开着时每次引擎 sync 都重渲
// 本件,全量渲染日志曾使帧尖峰随条数线性涨(n=8000 实测 717ms/帧)。本 spec 锁三件事:
// ① 长日志只渲最近 WAR_WINDOW(100)条;② 截断态下引擎继续追加,DOM 行数恒一窗
// 不随日志涨;③ 「加载更早」按窗放开、放完按钮消失。
// 断言全部走 DOM 计数/存在性,不设耗时阈值(CI 机台差异大,性能数值由 tmp/ 探针管)。
import { test, expect, type Page } from "./fixtures";
import { quickStart, force, actIfCan } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 与 WarReportDrawer.WAR_WINDOW 对齐(改动窗口时同步改这里)。 */
const WAR_WINDOW = 100;

const synthLine = `({
  ts: Date.now(), round: e.round, turn: e.turnNumber, player: "魏",
  brief: "合成战报" + i + "号事件", detail: "act=synth i=" + i, category: "roll",
})`;

/** 开局后人类决策卷轴可能在场(弹层会挡住把手):toPass 轮询体内「清决策点 + 点把手
 *  + 验抽屉可见」整块重试(原 6 轮 for + 400ms 固定采样换状态轮询,负载下自愈),
 *  抽屉可见即收。对局随后继续自走,断言一律不依赖「最新一条是谁」。 */
async function openDrawerRobustly(page: Page): Promise<void> {
  await expect(async () => {
    if (
      await page
        .getByTestId(TESTIDS.logDrawer)
        .isVisible()
        .catch(() => false)
    )
      return;
    await actIfCan(page);
    await page
      .getByTestId(TESTIDS.logTab)
      .click({ timeout: 2_000 })
      .catch(() => {});
    await expect(page.getByTestId(TESTIDS.logDrawer)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test("战报抽屉窗口化:长日志只渲一窗,截断态追加不涨行数,加载更早按窗放开", async ({ page }) => {
  // 内部预算 quickStart + 开抽屉 toPass(20s)+ 放开循环轮询(4×5s),90s 外层对齐
  // 同族重例(encounters/scrolls);原 120s 是硬等待时代的残值,轮询化后收紧。
  test.setTimeout(90_000);
  await quickStart(page, 49);
  // 膨胀 350 条玩法事件(roll 全入白名单),叠加开局存量后总战报条数 > 2 窗。
  await force(page, `e.log.push(...Array.from({ length: 350 }, (_, i) => ${synthLine}));`);
  await openDrawerRobustly(page);

  // ① 只渲最近一窗。
  await expect(page.locator(".war-item")).toHaveCount(WAR_WINDOW);

  // ② 截断态下追加(真 bot 步也在并行跑):行数恒一窗,新条目在窗内可见——
  //    「越玩越卡」的根源就是这里当年会随日志涨到全量。
  await force(
    page,
    `e.log.push({ ts: Date.now(), round: e.round, turn: e.turnNumber, player: "魏",
      brief: "合成战报999号追加事件", detail: "act=synth i=999", category: "roll" });`,
  );
  await expect(page.locator(".war-item")).toHaveCount(WAR_WINDOW);
  await expect(page.locator(".war-item", { hasText: "合成战报999号追加事件" })).toHaveCount(1);

  // ③ 「加载更早」每次放开一窗;放到见底按钮消失,行数 = 全部战报条数(> 2 窗)。
  await page.getByTestId(TESTIDS.logEarlier).click();
  await expect(page.locator(".war-item")).toHaveCount(WAR_WINDOW * 2);
  for (let i = 0; i < 4; i++) {
    const btn = page.getByTestId(TESTIDS.logEarlier);
    if (!(await btn.isVisible().catch(() => false))) break;
    const before = await page.locator(".war-item").count();
    await btn.click();
    // 原固定 100ms 采样换状态轮询:每放开一次行数必须真的涨一窗,到位才进下轮(5s 余量)
    await expect
      .poll(async () => await page.locator(".war-item").count(), {
        timeout: 5_000,
        message: `「加载更早」第 ${i + 1} 次放开一窗后行数上涨`,
      })
      .toBeGreaterThan(before);
  }
  await expect(page.getByTestId(TESTIDS.logEarlier)).toHaveCount(0);
  expect(await page.locator(".war-item").count()).toBeGreaterThan(WAR_WINDOW * 2);
});

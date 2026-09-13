// 锦囊使用回路(#122/T2):卷轴弹出、今不用、用免战金牌(盾)、用求贤令(招贤/折现)。
// seed 49=真人首动且起手免战金牌、seed 59=求贤令(真实引擎流程离线核算:含 doDraftRoll 骰流)。
// 不走 pickCapital 共享助手(其收尾会自动「今不用」),本 spec 自行点城+确认以保留卷轴。
import { test, expect } from "./fixtures";
import { openSoloSetup, waitSettled, waitMyRollDone } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

async function startWithScroll(page: Page, seed: number): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变候选城/发牌序列
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-sanguo").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
}

test.describe("锦囊使用回路(T2)", () => {
  test("seed2 免战金牌:卷轴弹出→用牌→盾落账→收卷进 Roll", async ({ page }) => {
    await startWithScroll(page, 49);
    const scroll = page.getByTestId("scroll-jinnang");
    await expect(scroll).toBeVisible();
    // 卷轴列出手牌(免战金牌,守标签)+ 今不用
    await expect(page.getByTestId("scroll-jinnang-option-免战金牌")).toBeVisible();
    await expect(page.getByTestId("scroll-jinnang-pass")).toBeVisible();
    await page.getByTestId("scroll-jinnang-option-免战金牌").click();
    await expect(scroll).toBeHidden();
    // 引擎缝:盾立、牌入弃牌堆、标签占名额。#188:用牌收卷后引擎自动起摇,phase==="Roll"
    // 只存在 ~1s 窗口(加速后 ~250ms)不可再断言,改以「已掷骰」作收卷后续行的证据。
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        shield: e.players[0].jinnangShield,
        hand: e.players[0].jinnangHand,
        used: e.jinnangUsedTags,
        discard: e.jinnangDiscard,
        rolled: (window as any).__dafung.snapshot().lastRoll != null,
      };
    });
    expect(probe).toMatchObject({ shield: true, hand: [], used: ["守"], rolled: true });
    expect(probe.discard).toContain("免战金牌");
    // 侧栏己方手牌区清空(牌已用出)
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toHaveCount(0);
  });

  test("seed2 今不用:手牌保留,自动行军照常起摇(#188)", async ({ page }) => {
    await startWithScroll(page, 49);
    await page.getByTestId("scroll-jinnang-pass").click();
    await expect(page.getByTestId("scroll-jinnang")).toBeHidden();
    // #188 行军自动化:「今不用」放行后引擎自动起摇,等这一手走完再验账
    await waitMyRollDone(page, 0);
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        hand: e.players[0].jinnangHand,
        used: e.jinnangUsedTags,
        rolled: (window as any).__dafung.snapshot().lastRoll != null,
      };
    });
    expect(probe.hand).toEqual(["免战金牌"]); // 今不用:牌还在手里
    expect(probe.used).toEqual([]);
    expect(probe.rolled).toBe(true); // 放行后自动起摇确实发生了(#188)
  });

  test("seed4 求贤令:用牌招贤/折现,事件公开入战报", async ({ page }) => {
    await startWithScroll(page, 59);
    await expect(page.getByTestId("scroll-jinnang-option-求贤令")).toBeVisible();
    await page.getByTestId("scroll-jinnang-option-求贤令").click();
    await expect(page.getByTestId("scroll-jinnang")).toBeHidden();
    await waitSettled(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      const p0 = e.players[0];
      return { heroes: p0.heroes.length, cash: p0.cash, log: JSON.stringify(e.log) };
    });
    expect(probe.heroes === 1 || probe.log.includes("转得 300 两")).toBe(true);
    expect(probe.log).toContain("求贤令"); // 用牌公开
  });
});

// 机遇系统冒烟(#126):声望渲染 + 机遇卷轴弹出与结算。
// 配置:触发率 100%、中性 100%(三档全中性;中性 4 条里 3 条带抉择卷轴、
// 结盟互市单选项自动执行)→ 每次落格必遇机遇,≤6 掷内必见抉择卷轴(同档 78%)。
// 既有 spec 的机遇隔离在 openSoloSetup 内统一归零,本 spec 自行覆写非零参数。
import { test, expect } from "./fixtures";
import { actIfCan, openSoloSetup, pickCapital, waitSettled } from "./react-helpers";

test.describe("机遇系统冒烟", () => {
  test("声望渲染 + 抉择机遇卷轴弹出并结算", async ({ page }) => {
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId("setup-encounter-toggle").click();
    await page.getByTestId("setup-encounter-trigger").fill("100");
    await page.getByTestId("setup-encounter-good").fill("0");
    await page.getByTestId("setup-encounter-neutral").fill("100");
    await page.getByTestId("setup-encounter-bad").fill("0");
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    // 负载下 30s 窗可爆(#217①,与 #191 同族):改「轮到我」显式条件,预算 90s。
    const mine = await page.waitForSelector(
      '[data-testid="scroll-jinnang-pass"], [data-testid="roll-button"]:not([disabled])',
      { timeout: 90_000 },
    );
    if ((await mine.getAttribute("data-testid")) === "scroll-jinnang-pass") {
      await page.getByTestId("scroll-jinnang-pass").click();
    }
    await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 10_000 });
    await waitSettled(page);

    // 引擎配置 fail-fast:机遇参数没进引擎时,后续断言全是废话
    const engCfg = await page.evaluate(() => JSON.stringify((window as any).__dafung.getEngine().encounter));
    expect(JSON.parse(engCfg), `引擎机遇配置=${engCfg}`).toEqual({ triggerRate: 100, shares: { good: 0, neutral: 100, bad: 0 } });

    // 声望渲染:状态卡/诸侯列表至少一处出现「声望」字样,初值 0
    await expect(page.getByText(/声望/).first()).toBeVisible();

    const scroll = page.getByTestId("scroll-encounter");
    // 每步经 actIfCan 驱动(掷骰/购地卷轴统一处理);遇机遇卷轴则点第一选项收卷。
    // 中性 100% → 每次落格必遇机遇,同档抉择型 78%/次。bot 回合的空步也烧预算
    // (#217① 实测 24 步曾全部走完仍未撞上),60 步把人类落格采样加厚到 ~10 次。
    let resolved = false;
    for (let step = 0; step < 60 && !resolved; step++) {
      if (await scroll.isVisible().catch(() => false)) {
        await page.locator('[data-testid^="scroll-encounter-option-"]').first().click();
        await expect(scroll).toBeHidden({ timeout: 20_000 });
        resolved = true;
        break;
      }
      await actIfCan(page);
      await waitSettled(page);
    }
    expect(resolved).toBe(true);
    await expect(page.getByText(/声望/).first()).toBeVisible();
  });
});

// 机遇系统冒烟(#126):声望渲染 + 机遇卷轴弹出与结算。
// 配置:触发率 100%、中性 100%(三档全中性;中性 4 条里 3 条带抉择卷轴、
// 结盟互市单选项自动执行)→ 每次落格必遇机遇,≤6 掷内必见抉择卷轴(同档 78%)。
// 既有 spec 的机遇隔离在 openSoloSetup 内统一归零,本 spec 自行覆写非零参数。
import { test, expect } from "./fixtures";
import { actIfCan, openSoloSetup, pickCapital, waitSettled, waitMyRollDone } from "./react-helpers";

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
    // 负载下 30s 窗可爆(#217①,与 #191 同族):等人类的当前一手自动走完,预算 90s。
    // #188:轮询体内逐拍放行锦囊卷轴 + 等自动起摇推进(等 roll-button 可用的旧出口已随
    // 行军按钮移除退役)。
    await waitMyRollDone(page, 0, 90_000);
    await waitSettled(page);

    // 引擎配置 fail-fast:机遇参数没进引擎时,后续断言全是废话
    const engCfg = await page.evaluate(() => JSON.stringify((window as any).__dafung.getEngine().encounter));
    expect(JSON.parse(engCfg), `引擎机遇配置=${engCfg}`).toEqual({ triggerRate: 100, shares: { good: 0, neutral: 100, bad: 0 } });

    // 声望渲染:状态卡/诸侯列表至少一处出现「声望」字样,初值 0
    await expect(page.getByText(/声望/).first()).toBeVisible();

    const scroll = page.getByTestId("scroll-encounter");
    // 每拍经 actIfCan 清决策点(购地卷轴统一处理),遇机遇卷轴则点第一选项收卷。
    // 中性 100% → 每次落格必遇机遇,同档抉择型 78%/次。#188 行军自动化 + #217①:
    // bot 回合/自动起摇期间 actIfCan 恒 false,按步计数会空转烧预算——改时间预算
    // (120s,人类落格采样 ~10 次以上),机遇卷轴出现即收。
    let resolved = false;
    const deadline = Date.now() + 120_000;
    while (!resolved && Date.now() < deadline) {
      if (await scroll.isVisible().catch(() => false)) {
        await page.locator('[data-testid^="scroll-encounter-option-"]').first().click();
        await expect(scroll).toBeHidden({ timeout: 20_000 });
        resolved = true;
        break;
      }
      await actIfCan(page);
      await page.waitForTimeout(300);
    }
    expect(resolved).toBe(true);
    await expect(page.getByText(/声望/).first()).toBeVisible();
  });
});

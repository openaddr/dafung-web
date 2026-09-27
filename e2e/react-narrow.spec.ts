// 窄屏 / Android 短横屏形态(#276,纠偏定案:移动端只做横屏形态)——
// 竖屏手机 390×844(pointer: coarse):「请横屏」提示层全屏接管,对局被挡;
// 短横屏 844×390:仪表条进入 132px 紧凑档(<150px)、席位卡仍住右缘列;
// 桌面 1280×720 对照:席位住右缘竖列(x > 视口宽 60%)——锁「断点互串」回归。
// 断言全走几何与结构(quickStart 内部状态轮询),零固定 sleep。
// isMobile+hasTouch 让 Chromium 设备仿真把 pointer 媒询判成 coarse(桌面窄窗口
// pointer: fine 不触发提示层,红线保持)。
import { test, expect } from "./fixtures";
import { quickStart, openSoloSetup } from "./react-helpers";

test.describe("竖屏手机 390×844(coarse pointer)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("「请横屏」提示层全屏接管,对局被挡", async ({ page }) => {
    // 提示层的职责就是挡住对局屏(连选都点击都会被拦),quickStart 的完整流程在竖屏
    // 下走不完——走到对局屏挂载(start-game)即断言:提示层可见、全屏覆盖,
    // 对局 UI(dashboard-bar)在其身后挂载。
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("dashboard-bar")).toBeAttached();
    const hint = page.getByTestId("rotate-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("请横屏游玩");
    const hb = (await hint.boundingBox())!;
    expect(hb.x).toBeLessThanOrEqual(0);
    expect(hb.y).toBeLessThanOrEqual(0);
    expect(hb.width).toBeGreaterThanOrEqual(390);
    expect(hb.height).toBeGreaterThanOrEqual(844);
  });
});

test.describe("短横屏 844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("仪表条进入紧凑档(<150px),席位卡仍住右缘列、在仪表条上方", async ({ page }) => {
    await quickStart(page);
    const dash = page.getByTestId("dashboard-bar");
    await expect(dash).toBeVisible();
    const db = (await dash.boundingBox())!;
    expect(db.height).toBeLessThan(150);
    const seats = page.locator('[data-testid="seat-rail"] .seat');
    await expect(seats.first()).toBeAttached();
    const seatCount = await seats.count();
    for (let i = 0; i < seatCount; i++) {
      const bb = (await seats.nth(i).boundingBox())!;
      expect(bb.x).toBeGreaterThan(844 * 0.6); // 右列保留(不收成横排 chip 条)
      expect(bb.y + bb.height).toBeLessThan(db.y); // 卡在仪表条上方的中带
    }
  });
});

test.describe("桌面对照 1280×720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("席位仍住右缘竖列(x > 视口宽 60%)——断点互串对照", async ({ page }) => {
    await quickStart(page);
    const seats = page.locator('[data-testid="seat-rail"] .seat');
    await expect(seats.first()).toBeAttached();
    const seatCount = await seats.count();
    for (let i = 0; i < seatCount; i++) {
      const bb = (await seats.nth(i).boundingBox())!;
      expect(bb.x).toBeGreaterThan(1280 * 0.6);
    }
  });
});

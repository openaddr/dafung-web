// 形态分档(#276 纠偏定案:移动端只做横屏;#700 全浮层骨架改写;#703 桌面档收口)
// ——竖屏手机 390×844(pointer: coarse):「请横屏」提示层全屏接管,对局被挡;
// 矮横屏 844×390:全浮层件就位(顶部两钮/顶中 chip/席位右列/手牌区/右下三圆钮),
// 席位列与三圆钮互不重叠(列区下界=钮区上缘);桌面档 1280×800/1024×768 对照:
// 席位住右缘竖列(x > 视口宽 60%)、三圆钮舒展 52px 贴右下、手牌卡放大——
// 锁「断点互串」回归(两个方向都不串)。
// 断言全走几何与结构(quickStart 内部状态轮询),零固定 sleep。
// isMobile+hasTouch 让 Chromium 设备仿真把 pointer 媒询判成 coarse(桌面窄窗口
// pointer: fine 不触发提示层,红线保持)。
import { test, expect } from "./fixtures";
import { quickStart, openSoloSetup } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("竖屏手机 390×844(coarse pointer)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("「请横屏」提示层全屏接管,对局被挡", async ({ page }) => {
    // 提示层的职责就是挡住对局屏(连选都点击都会被拦),quickStart 的完整流程在竖屏
    // 下走不完——走到对局屏挂载(start-game)即断言:提示层可见、全屏覆盖,
    // 对局 UI(席位格列)在其身后挂载。
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId(SETUP_TID.startGame).click();
    await expect(page.getByTestId(TESTIDS.seatRail)).toBeAttached();
    const hint = page.getByTestId(TESTIDS.rotateHint);
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("请横屏游玩");
    // 全屏接管按 1px 容差判:移动仿真视口有亚像素抖动(Windows 本机实测 0.01~0.07px,
    // master 基线同挂、CI Linux 无)——语义是「无缝隙露对局」,不是数学意义的零。
    // 几何断言收进 toPass:换屏瞬间 .screen-in 外壳播「8px 上移落定」入场(提示层在壳内,
    // 动画进行中量盒会吃进瞬时 transform——#361 前后量测拍点漂移实证 0.01~1.07px 全带),
    // 落定后重试即稳;容差本身不放宽。
    await expect(async () => {
      const hb = (await hint.boundingBox())!;
      expect(hb.x).toBeLessThanOrEqual(1);
      expect(hb.y).toBeLessThanOrEqual(1);
      expect(hb.width).toBeGreaterThanOrEqual(389);
      expect(hb.height).toBeGreaterThanOrEqual(843);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("矮横屏 844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("全浮层件就位:席位右列在上、三圆钮右下,列与钮区互不重叠", async ({ page }) => {
    await quickStart(page);
    const buttons = page.getByTestId(TESTIDS.pileButtons);
    await expect(buttons).toBeVisible();
    const fb = (await buttons.boundingBox())!;
    // 三圆钮贴右下角(44px 圆钮 + 8px 右距 + 10px 底距)
    expect(fb.y + fb.height).toBeGreaterThanOrEqual(390 - 56);
    expect(fb.x + fb.width).toBeGreaterThanOrEqual(844 - 56);
    // 席位格全列零滚动:每格下缘 ≤ 三圆钮上缘(列区下界=钮区上缘,#700 几何不变量)
    const seats = page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`);
    await expect(seats.first()).toBeAttached();
    const seatCount = await seats.count();
    expect(seatCount).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < seatCount; i++) {
      const bb = (await seats.nth(i).boundingBox())!;
      expect(bb.x).toBeGreaterThan(844 * 0.6); // 右列保留(不收成横排 chip 条)
      expect(bb.y + bb.height).toBeLessThanOrEqual(fb.y + 1); // 列在钮区上方,零重叠
    }
    // 手牌区(透明浮置)在场:与右缘席位列不相侵(区右缘 ≤ 席位格左缘)
    const zone = page.getByTestId(TESTIDS.handZone);
    await expect(zone).toBeVisible();
    const zb = (await zone.boundingBox())!;
    const firstSeat = (await seats.first().boundingBox())!;
    expect(zb.x + zb.width).toBeLessThanOrEqual(firstSeat.x + 1);
  });
});

test.describe("桌面对照 1280×800(#703 桌面档:密度舒展,布局零重排)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("席位右缘满列;三圆钮舒展贴右下,列与钮区互不重叠;手牌卡放大", async ({ page }) => {
    await quickStart(page);
    const buttons = page.getByTestId(TESTIDS.pileButtons);
    await expect(buttons).toBeVisible();
    const fb = (await buttons.boundingBox())!;
    // 桌面档舒展生效:52px 圆钮(基准 44px)——锁桌面档断点命中(矮横屏档不串上桌面)
    expect(fb.height).toBeGreaterThanOrEqual(50);
    // 三圆钮贴右下角(52px 圆钮 + 8px 右距 + 10px 底距)
    expect(fb.y + fb.height).toBeGreaterThanOrEqual(800 - 64);
    expect(fb.x + fb.width).toBeGreaterThanOrEqual(1280 - 64);
    // 席位格全列零滚动:每格下缘 ≤ 三圆钮上缘(列区下界=钮区上缘,#700 几何不变量
    // 桌面档随钮径舒展:62px 预算),列仍在右缘(x > 视口宽 60%,断点互串对照)
    const seats = page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`);
    await expect(seats.first()).toBeAttached();
    const seatCount = await seats.count();
    expect(seatCount).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < seatCount; i++) {
      const bb = (await seats.nth(i).boundingBox())!;
      expect(bb.x).toBeGreaterThan(1280 * 0.6);
      expect(bb.y + bb.height).toBeLessThanOrEqual(fb.y + 1); // 列在钮区上方,零重叠
    }
    // 手牌区(透明浮置)在场:与右缘席位列不相侵(区右缘 ≤ 席位格左缘)
    const zone = page.getByTestId(TESTIDS.handZone);
    await expect(zone).toBeVisible();
    const zb = (await zone.boundingBox())!;
    const firstSeat = (await seats.first().boundingBox())!;
    expect(zb.x + zb.width).toBeLessThanOrEqual(firstSeat.x + 1);
    // 手牌卡舒展生效:桌面 em 基 9.6px → 牌面宽 144px(基准 120px;起手 ≥1 张恒在场)
    const card = page.locator(".hand-rack-hand .jinnang-card").first();
    await expect(card).toBeAttached();
    const cb = (await card.boundingBox())!;
    expect(cb.width).toBeGreaterThanOrEqual(140);
  });
});

test.describe("桌面对照 1024×768(#703 第二典型视口:同形不破格)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("席位右缘满列、三圆钮右下、手牌区不相侵——与 1280×800 同形", async ({ page }) => {
    await quickStart(page);
    const buttons = page.getByTestId(TESTIDS.pileButtons);
    await expect(buttons).toBeVisible();
    const fb = (await buttons.boundingBox())!;
    expect(fb.height).toBeGreaterThanOrEqual(50);
    expect(fb.y + fb.height).toBeGreaterThanOrEqual(768 - 64);
    expect(fb.x + fb.width).toBeGreaterThanOrEqual(1024 - 64);
    const seats = page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`);
    await expect(seats.first()).toBeAttached();
    const seatCount = await seats.count();
    for (let i = 0; i < seatCount; i++) {
      const bb = (await seats.nth(i).boundingBox())!;
      expect(bb.x).toBeGreaterThan(1024 * 0.6);
      expect(bb.y + bb.height).toBeLessThanOrEqual(fb.y + 1);
    }
    const zone = page.getByTestId(TESTIDS.handZone);
    await expect(zone).toBeVisible();
    const zb = (await zone.boundingBox())!;
    const firstSeat = (await seats.first().boundingBox())!;
    expect(zb.x + zb.width).toBeLessThanOrEqual(firstSeat.x + 1);
  });
});

// 全浮层骨架(#700)专项:① 顶部浮层几何(#732 顶左行序:设置→详情→「N 轮」chip
// 同排避 safe-area,顶中让给知会横幅槽);② 核心几何不变量(满编 8 席 @844×390 矮横屏:
// 第 8 格下缘 ≤ 右下三圆钮上缘,全列零滚动——spec #697 ③ 的交付判据);③ 锦囊手牌开关
// (收起/展开 + localStorage 对局内记忆、重进恢复);④ 设置弹层(音效开关接
// AudioProvider、战报›入口降级、版本戳、回到主页弃局离屏)。断言全走 testid 单源 +
// 调试钩子/快照,几何断言收进单次 evaluate。
import { test, expect } from "./fixtures";
import {
  quickStart,
  openSoloSetup,
  pickCapital,
  waitMyPause,
  waitSettled,
  dismissJinnangIfUp,
  actIfCan,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

test.describe("顶部浮层几何(#700 ①)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("顶左行序 设置→详情→「N 轮」:两钮 32×32 避 safe-area、chip 与钮行同排;三圆钮 44px 贴右下,锦囊默认亮", async ({
    page,
  }) => {
    test.slow(); // quickStart 全链(对局自走),预算放宽同族口径
    await quickStart(page);
    const geo = await page.evaluate(
      ({ overview, settings, round, buttons, toggle }) => {
        const rect = (id: string) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el == null) return null;
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            cx: r.x + r.width / 2,
            cy: r.y + r.height / 2,
          };
        };
        const vw = document.documentElement.clientWidth;
        const on = document.querySelector(`[data-testid="${toggle}"]`)?.classList.contains("on");
        return {
          overview: rect(overview),
          settingsBtn: rect(settings),
          round: rect(round),
          buttons: rect(buttons),
          toggleOn: on,
          vw,
        };
      },
      {
        overview: TESTIDS.topbarOverview,
        settings: TESTIDS.settingsButton,
        round: TESTIDS.topbarRound,
        buttons: TESTIDS.pileButtons,
        toggle: TESTIDS.jinnangToggle,
      },
    );
    // 顶左行序(#732):设置 ⚙ 最左,详情 ☰ 其次——两钮 32×32 贴左上
    // (测试环境 safe-area=0,实现口径 = safe + 8px),同一行(y 互齐)
    expect(geo.settingsBtn).not.toBeNull();
    expect(Math.abs(geo.settingsBtn!.w - 32)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geo.settingsBtn!.h - 32)).toBeLessThanOrEqual(0.5);
    expect(geo.settingsBtn!.x).toBeLessThanOrEqual(9);
    expect(geo.settingsBtn!.y).toBeLessThanOrEqual(9);
    expect(geo.overview).not.toBeNull();
    expect(Math.abs(geo.overview!.w - 32)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geo.overview!.h - 32)).toBeLessThanOrEqual(0.5);
    expect(geo.overview!.x).toBeGreaterThan(geo.settingsBtn!.x + geo.settingsBtn!.w);
    expect(Math.abs(geo.overview!.y - geo.settingsBtn!.y)).toBeLessThanOrEqual(1);
    // 「N 轮」chip:行内第三件(详情钮之后),与钮行垂直居中互齐;顶左半场,
    // 不再浮置视口中线(旧断言 |cx − vw/2| ≤ 1 随 #732 翻面)
    expect(geo.round!.x).toBeGreaterThan(geo.overview!.x + geo.overview!.w);
    expect(Math.abs(geo.round!.cy - geo.settingsBtn!.cy)).toBeLessThanOrEqual(3);
    expect(geo.round!.cx).toBeLessThan(geo.vw / 2);
    // 三圆钮:贴右下(44 + 8 右距 + 10 底距),锦囊钮默认亮(=显示)
    expect(Math.abs(geo.buttons!.h - 44)).toBeLessThanOrEqual(0.5);
    expect(geo.buttons!.y + geo.buttons!.h).toBeGreaterThanOrEqual(390 - 55);
    expect(geo.buttons!.x + geo.buttons!.w).toBeGreaterThanOrEqual(844 - 55);
    expect(geo.toggleOn).toBe(true);
  });
});

test.describe("核心几何不变量(#700 ②:满编 8 席全列零滚动)", () => {
  test("8 席 @844×390:第 8 格下缘 ≤ 三圆钮上缘(8×38+7×2=318 ≤ 326),格高 38", async ({ page }) => {
    test.slow(); // 人类首回合前最多 7 个 bot 回合,预算放宽(react-seat-cells 同口径)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    await waitSettled(page);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(真机即此重排路径)
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByTestId(TESTIDS.seatRail).waitFor();
    const geo = await page.evaluate((containerId) => {
      const col = document.querySelector(".seat-rail .seatcol")!;
      const cells = [...col.querySelectorAll<HTMLElement>(".seat")];
      const fab = document.querySelector(`[data-testid="${containerId}"]`)!;
      const fabTop = fab.getBoundingClientRect().top;
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      return {
        count: cells.length,
        cellH: cells[0]!.getBoundingClientRect().height,
        lastBottom: last.bottom,
        fabTop,
        overflow: (col as HTMLElement).scrollHeight - (col as HTMLElement).clientHeight,
      };
    }, TESTIDS.pileButtons);
    expect(geo.count).toBe(8);
    expect(Math.abs(geo.cellH - 38)).toBeLessThanOrEqual(0.5);
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.fabTop + 0.5); // 第 8 格下缘 ≤ 三圆钮上缘
    expect(geo.overflow).toBeLessThanOrEqual(0); // 全列零滚动
  });
});

test.describe("锦囊手牌开关(#700 ③)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("收起:手牌区卸载、钮灭、localStorage 记账;重进恢复;展开还原", async ({ page }) => {
    test.slow();
    test.setTimeout(180_000); // 双 quickStart + 两段 toPass,60s 默认档必超(链路预算,同族口径)
    await quickStart(page);
    const zone = page.getByTestId(TESTIDS.handZone);
    const toggle = page.getByTestId(TESTIDS.jinnangToggle);
    await expect(toggle).toHaveClass(/on/);
    // 收起:手牌区卸载(战斗区最大化),钮亮态退,偏好落账
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await toggle.click({ timeout: 3_000 });
      await expect(zone).toHaveCount(0);
    }).toPass({ timeout: 15_000 });
    await expect(toggle).not.toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem("dafung.handVisible"))).toBe("0");
    // 重进恢复:新开一局(同源),偏好读回——手牌区开局即收
    await page.goto("/");
    await openSoloSetup(page);
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await expect(page.getByTestId(TESTIDS.jinnangToggle)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.jinnangToggle)).not.toHaveClass(/on/);
    // 展开还原:点钮亮、手牌区回场、偏好回「显示」
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangToggle)).toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem("dafung.handVisible"))).toBe("1");
  });
});

test.describe("设置弹层(#700 ⑥)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("音效开关接静音账本;战报›开抽屉;版本戳在;回到主页弃局离屏", async ({ page }) => {
    test.slow();
    await quickStart(page);
    await expect(async () => {
      await dismissJinnangIfUp(page);
      await actIfCan(page).catch(() => false);
      await page.getByTestId(TESTIDS.settingsButton).click({ timeout: 3_000 });
      await expect(page.getByTestId(TESTIDS.settingsDialog)).toBeVisible();
    }).toPass({ timeout: 15_000 });
    // 降级入口齐:演出加速(信息行「标准」)/ 版本戳(v年.月.日)
    const dialog = page.getByTestId(TESTIDS.settingsDialog);
    await expect(dialog).toContainText("演出加速");
    await expect(dialog).toContainText("标准");
    await expect(dialog).toContainText(/v\d{4}\.\d+\.\d+/);
    // 音效开关:开=有声(Base UI Switch data-checked 翻转 = AudioProvider 静音账本翻转)
    const sfx = page.getByTestId(TESTIDS.settingsSfx);
    const before = (await sfx.getAttribute("data-checked")) != null;
    await sfx.click();
    await expect
      .poll(async () => ((await sfx.getAttribute("data-checked")) != null) !== before)
      .toBe(true);
    // 战报›:本弹层先收,抽屉开(数据照记,入口降级);Esc 收抽屉
    await page.getByTestId(TESTIDS.settingsWarReport).click();
    await expect(page.getByTestId(TESTIDS.settingsDialog)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.logDrawer)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(TESTIDS.logDrawer)).toHaveCount(0);
    // 回到主页:弃局离屏(控制器销毁),回 setup 首页
    await page.getByTestId(TESTIDS.settingsButton).click();
    await page.getByTestId(TESTIDS.settingsHome).click();
    await expect(page.getByTestId(HOME_TID.solo)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.seatRail)).toHaveCount(0);
  });
});

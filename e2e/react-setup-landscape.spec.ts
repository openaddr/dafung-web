// #751/E 批:准备页矮横屏双列重排(844×390 移动横屏标准档,#742 判词 S1)。
// 判词现状:560px 单列卡在 390 高视口 scrollHeight=734,「起兵」CTA 折叠线下 273px,
// 8 诸侯首屏与 4 诸侯逐像素相同——全图唯一功能性硬伤。
// 重排后口径:左列配置 ≈300px / 右列座位表+操作 ≈440px,卡宽 780 居中;
//   ① 4 诸侯根容器零滚动(根 + document 双断);
//   ② 「起兵」CTA 首屏全程在场(scrollHeight 量测自证,判词 S1-B 钉底);
//   ③ 8 诸侯右列内部滚(根仍零滚),CTA 恒在场——加人反馈不再为零(S5 随之消解)。
// 断言全走几何(scrollHeight/getBoundingClientRect),零固定 sleep;
// 入场 scroll-anim-unroll 播放期间量盒有瞬时值,统一收进 toPass(react-narrow 同法)。
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

test.describe("准备页矮横屏 844×390(双列档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 根容器零滚动 + CTA/返回钮完整落视口内(重试吸收入场动画期间的瞬时盒)。 */
  async function expectNoScrollAndCtaOnScreen(page: Page): Promise<void> {
    await expect(async () => {
      const m = await page.evaluate(
        ([screenTid, ctaTid, backTid]) => {
          const root = document.querySelector(`[data-testid="${screenTid}"]`);
          const cta = document.querySelector(`[data-testid="${ctaTid}"]`);
          const back = document.querySelector(`[data-testid="${backTid}"]`);
          if (!root || !cta || !back) throw new Error("setup screen / start-game / back 未挂载");
          const r = cta.getBoundingClientRect();
          return {
            rootDx: root.scrollHeight - root.clientHeight,
            docDx: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            ctaTop: r.top,
            ctaBottom: r.bottom,
            backTop: back.getBoundingClientRect().top,
            vh: window.innerHeight,
          };
        },
        [SETUP_TID.screen, SETUP_TID.startGame, SETUP_TID.backTop] as const,
      );
      expect(m.rootDx, "根容器出现滚动(双列重排失守)").toBeLessThanOrEqual(1);
      expect(m.docDx, "document 出现滚动").toBeLessThanOrEqual(1);
      expect(m.ctaTop, "起兵钮顶缘出视口上界").toBeGreaterThanOrEqual(0);
      expect(m.ctaBottom, "起兵钮底缘出视口下界(CTA 不在场)").toBeLessThanOrEqual(m.vh);
      // #839 刀②:返回钮 40px 命中盒上溢 30px 标题行,顶垫不足时顶缘被视口裁发丝
      expect(m.backTop, "返回钮顶缘出视口上界").toBeGreaterThanOrEqual(0);
    }).toPass({ timeout: 15_000 });
  }

  test("4 诸侯零滚动+起兵首屏在场;8 诸侯右列内滚 CTA 恒在场", async ({ page }) => {
    await page.goto("/");
    // 首页(矮横屏条带档)→ 单机入口进准备页
    await page.getByTestId(HOME_TID.solo).click();
    await expect(page.getByTestId(SETUP_TID.screen)).toBeVisible();

    // 4 诸侯(默认):零滚动 + CTA 首屏在场
    await expectNoScrollAndCtaOnScreen(page);

    // 8 诸侯:加人后根容器仍零滚动(右列内部滚承接),CTA 依旧全程在场
    for (let i = 0; i < 4; i++) {
      await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click();
    }
    await expect(page.getByTestId(SETUP_TID.seatCount)).toHaveText("8");
    await expectNoScrollAndCtaOnScreen(page);

    // 8 诸侯右列确实在内部滚(内滚通路成立的前提,防「全塞下了」假阳性)
    const col = await page.evaluate(() => {
      const el = document.querySelector(".su-col-right");
      if (!el) throw new Error("su-col-right 未挂载(矮横屏档未命中?)");
      return { dx: el.scrollHeight - el.clientHeight };
    });
    expect(col.dx).toBeGreaterThan(1);
  });

  test("机遇折叠展开:左列底缘墨纱渐隐暗示可滚,说明段玩家语(#839 刀①)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId(HOME_TID.solo).click();
    await expect(page.getByTestId(SETUP_TID.screen)).toBeVisible();
    // 展开机遇折叠(默认收起):说明段=折叠内最后一个 <p>
    await page.getByTestId(SETUP_TID.encounterToggle).locator("summary").click();
    // 渐隐有意义的前提:左列确实溢出;mask 挂列本体(#839 刀①交付本体)
    await expect(async () => {
      const m = await page.evaluate(() => {
        const col = document.querySelector(".su-col-left");
        if (!col) throw new Error("su-col-left 未挂载(矮横屏档未命中?)");
        return {
          dx: col.scrollHeight - col.clientHeight,
          mask: getComputedStyle(col).maskImage,
        };
      });
      expect(m.dx, "左列无溢出(渐隐前提失守)").toBeGreaterThan(1);
      expect(m.mask, "左列底缘渐隐 mask 未挂").not.toBe("none");
    }).toPass({ timeout: 15_000 });
    // 说明段玩家语(#839):「三档占比自动归一,不必凑满 100」口径在场
    await expect(page.getByTestId(SETUP_TID.encounterToggle).locator("p").last()).toContainText(
      "不必凑满 100",
    );
  });

  test("定都确认卷轴:正文井上下缘渐隐暗示(#839 刀③)", async ({ page }) => {
    await page.goto("/?seed=49");
    await page.getByTestId(HOME_TID.solo).click();
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.locator(".bv-tile.bv-selectable").first().waitFor({ timeout: 30_000 });
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(SCROLL_TESTIDS.tileDetailScroll).waitFor({ timeout: 15_000 });
    // 井溢出为前提(价值表被井缘裁行),渐隐 mask 挂正文井本体(#839 刀③交付本体)
    await expect(async () => {
      const m = await page.evaluate(
        ([shellTid]) => {
          const body = document.querySelector(`[data-testid="${shellTid}"] .banner-body`);
          if (!body) throw new Error("正文井未挂载");
          return {
            dx: body.scrollHeight - body.clientHeight,
            mask: getComputedStyle(body).maskImage,
          };
        },
        [SCROLL_TESTIDS.tileDetailScroll] as const,
      );
      expect(m.dx, "正文井无溢出(渐隐前提失守)").toBeGreaterThan(1);
      expect(m.mask, "正文井渐隐 mask 未挂").not.toBe("none");
    }).toPass({ timeout: 15_000 });
  });
});

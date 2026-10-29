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

test.describe("准备页矮横屏 844×390(双列档)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** 根容器零滚动 + CTA 完整落视口内(重试吸收入场动画期间的瞬时盒)。 */
  async function expectNoScrollAndCtaOnScreen(page: Page): Promise<void> {
    await expect(async () => {
      const m = await page.evaluate(
        ([screenTid, ctaTid]) => {
          const root = document.querySelector(`[data-testid="${screenTid}"]`);
          const cta = document.querySelector(`[data-testid="${ctaTid}"]`);
          if (!root || !cta) throw new Error("setup screen / start-game 未挂载");
          const r = cta.getBoundingClientRect();
          return {
            rootDx: root.scrollHeight - root.clientHeight,
            docDx: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            ctaTop: r.top,
            ctaBottom: r.bottom,
            vh: window.innerHeight,
          };
        },
        [SETUP_TID.screen, SETUP_TID.startGame] as const,
      );
      expect(m.rootDx, "根容器出现滚动(双列重排失守)").toBeLessThanOrEqual(1);
      expect(m.docDx, "document 出现滚动").toBeLessThanOrEqual(1);
      expect(m.ctaTop, "起兵钮顶缘出视口上界").toBeGreaterThanOrEqual(0);
      expect(m.ctaBottom, "起兵钮底缘出视口下界(CTA 不在场)").toBeLessThanOrEqual(m.vh);
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
});

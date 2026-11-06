// 弹层族矮屏规范(#708,#687 定案施工):780×360 矮横屏实拍断口的通路守卫——
// PileShell 壳夹高(最大高=视口−64px)、体部内滚可达末行。视觉终证走 shot.mjs 实拍。
// #987 清退(2026-11-06,#1096 收口):「名将弹层壳夹高」「城池清单内滚」两例跨轮游走
// 挂(池挂 :64/串行挂 :31,城池清单例换开局路径后复验又换例)——概率性不可靠,删例
// 不留台账;购地卷轴钉底哨兵两轮全绿保留。城池钻入通路覆盖归 react-warlords-overview。
// #729 决策卷轴哨兵:844×390 下 BannerShell 三段式(题行钉顶+正文井内滚+拍板钮
// 钉底 footer 槽)——「购地/不取」恒在视口内(Playwright 点击自动滚入视口,点击型
// 断言测不出滚出视口,须几何断言钉住)。
import { test, expect, type Page } from "./fixtures";
import { useHalfScale, disableEncounters } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

test.describe("决策卷轴拍板钮钉底(#729)", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  /** seed 1010 拦检链到购地卷轴(#949 关中重钓:换图后原 50 链作废,
   *  react-short-stage startShort 同源配方:关中条带选图 + 机遇归零 + 选都,
   *  人类首个落格即购地抉择)。 */
  async function startBuyScroll(page: Page): Promise<void> {
    await useHalfScale(page);
    await page.goto(`/?seed=1010`);
    await page.getByTestId(HOME_TID.mapStripItem("guanzhong")).click();
    await page.getByTestId(HOME_TID.solo).click();
    await page.getByTestId(SETUP_TID.screen).waitFor();
    await disableEncounters(page);
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(TESTIDS.confirmCapitalOk).click();
    await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
  }

  test("购地卷轴:拍板两钮恒在视口内、壳高 ≤86dvh、钮盒全落壳盒内(#729)", async ({ page }) => {
    await startBuyScroll(page);
    // 入场 banner-drop 带整体位移:几何断言包 toPass 吸收动画中的瞬时盒
    // (react-short-stage 拼点签面同法);种植式断言,零固定 sleep
    await expect(async () => {
      const shell = (await page.getByTestId(SCROLL_TESTIDS.buyScroll).boundingBox())!;
      const buy = (await page.getByTestId(TESTIDS.actionButton("buy")).boundingBox())!;
      const skip = (await page.getByTestId(TESTIDS.actionButton("skip")).boundingBox())!;
      // 壳夹高:横幅系 86dvh 口径不动(390×0.86≈335.4;.5 容亚像素舍入)
      expect(shell.height).toBeLessThanOrEqual(390 * 0.86 + 0.5);
      for (const [label, box] of [
        ["购地", buy],
        ["不取", skip],
      ] as const) {
        // 拍板钮恒在视口内(#729 根因:钮原在正文井内,矮横屏随表滚出视口,
        // 点击型断言被自动滚入遮蔽,须几何断言钉住)
        expect(box.x, `${label}钮左缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label}钮上缘出视口`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label}钮右缘出视口`).toBeLessThanOrEqual(844);
        expect(box.y + box.height, `${label}钮下缘出视口`).toBeLessThanOrEqual(390);
        // 钮盒完全在壳盒内:钉底段是壳的第三段,不漂出壳外
        expect(box.x, `${label}钮左缘出壳`).toBeGreaterThanOrEqual(shell.x - 0.5);
        expect(box.y, `${label}钮上缘出壳`).toBeGreaterThanOrEqual(shell.y - 0.5);
        expect(box.x + box.width, `${label}钮右缘出壳`).toBeLessThanOrEqual(
          shell.x + shell.width + 0.5,
        );
        expect(box.y + box.height, `${label}钮下缘出壳`).toBeLessThanOrEqual(
          shell.y + shell.height + 0.5,
        );
      }
    }).toPass({ timeout: 5_000 });
  });
});

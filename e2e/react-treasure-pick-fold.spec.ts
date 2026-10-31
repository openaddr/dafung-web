// 选宝弹层首帧几何(#833,UI二轮02)@844×390 移动横屏标准档:
// 病灶(r4/r6 审计 12b/14/16 实拍):坐地双行价签格 176px、变卖单行格 156px,首帧
// 全部折在体部视口(172px)之外——玩家可以没见过任何价签就成交;变卖选中/武装时
// 进度区(还欠多少)恰随滚离场。修复:语境区随档并入 footer(matchMedia 分档渲染,
// 高档变卖进度 sticky 钉体部视口顶)、矮档卡基 6.4→5.8px、矮档让位收档。
// 断言走真渲染几何(零语义放宽):首个价签 rect 全须落在视口内且不被体部下缘裁切;
// 变卖武装态进度区恒在(选中+武装+滚底三拍同测)。种植配方照抄 react-scrolls
// plantTrade/破产清算例与 tmp/audit-r4-*.mjs 审计现场。
import { test, expect, type Page } from "./fixtures";
import { freezeClock, force, quickStart } from "./react-helpers";
import { SCROLL_TESTIDS as T } from "../src/app/screens/game/scroll/testids";

/** 首个价签格完整在视口内的几何断言:rect 全落在标准档视口内,且底缘不越过体部
 *  视口下缘(防「在屏内但被渐隐带/钉底行罩住」的假绿)。 */
async function expectFirstTagInViewport(page: Page): Promise<void> {
  const box = (await page.locator(".pile-price").first().boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vh);
  const body = (await page
    .locator('.treasure-pick [data-slot="scroll-area-viewport"]')
    .boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height + 1);
}

test.describe("选宝弹层首帧几何(#833)@844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("交涉坐地起价:首帧第一排卡+双行价签完整在视口内", async ({ page }) => {
    // 城主=人类座位 0,访客=bot 座位 1;5 件珍宝复刻审计 12b 现场(#188 钉决策方)
    await quickStart(page);
    await force(
      page,
      `
      e.phase = "Playing";
      e.activeIndex = 1;
      const owner = e.players[0];
      owner.treasures = e.treasureDeck.slice(0, 5);
      const tile = e.board.tiles.find((t) => t.propertyId && !e.findOwner(t.propertyId));
      owner.properties.push({
        propertyId: tile.propertyId,
        level: 1,
        maxLevel: 3,
        group: tile.group ?? "a",
      });
      e.treasureVisitor = { def: e.catalog.get(tile.propertyId), ownerIdx: 0 };
      e.players[1].cash = Math.max(e.players[1].cash, 5000);
      e.turnPhase = "AwaitingTreasureOwner";
    `,
    );
    await page.getByTestId(T.treasureModePremium).click();
    await expect(page.getByTestId(T.treasurePick)).toBeVisible();
    // 坐地双行价签(指导价+要价)是本档最挤格型——首签完整在视口内即守住整排
    await expectFirstTagInViewport(page);
  });

  test("破产变卖:首帧价签在视口内;选中+武装+滚底进度区恒在", async ({ page }) => {
    await quickStart(page);
    // 冻结推进再动刀(#421/#799 同口径):种植后到断言间看门狗回调不得动 p0 现金
    await freezeClock(page);
    await force(
      page,
      `
      e.phase = "Playing";
      e.activeIndex = 0;
      const me = e.activePlayer;
      me.treasures = e.treasureDeck.slice(0, 6);
      e.pendingDebt = { amount: 1500, creditor: null };
      e.turnPhase = "AwaitingBankruptcySettle";
    `,
    );
    await page.getByTestId(T.bankruptcySellTreasureOpen).click();
    await expect(page.getByTestId(T.bankruptcyTreasurePick)).toBeVisible();
    await expectFirstTagInViewport(page);

    // 进度区(已凑/债务/尚欠)在选中→武装→滚底全程恒在:
    // 病根复现链=点卡选中(视口内滚动)→点变卖武装→体部滚到底,三拍后进度区 rect
    // 仍须完整落在视口内(矮档副本恒钉 footer;高档 sticky 钉体部顶,同一断言守两档)
    const progress = page.getByTestId(T.bankruptcyPickProgress);
    await page
      .locator('.treasure-pick [data-testid^="scroll-bankruptcy-sell-treasure-"]')
      .first()
      .click();
    const confirm = page.getByTestId(T.bankruptcySellTreasureConfirm);
    await confirm.click();
    await expect(confirm).toHaveText("确认变卖");
    await page.evaluate(() => {
      const vp = document.querySelector('.treasure-pick [data-slot="scroll-area-viewport"]');
      if (vp == null) throw new Error("体部视口不在场(弹层结构变了)");
      vp.scrollTop = vp.scrollHeight;
    });
    const box = (await progress.boundingBox())!;
    const vh = page.viewportSize()!.height;
    await expect(progress).toBeVisible();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
  });
});

// 选宝弹层首帧几何(#833,UI二轮02)@844×390 移动横屏标准档:
// 病灶(r4/r6 审计 12b/14/16 实拍):坐地双行价签格 176px、变卖单行格 156px,首帧
// 全部折在体部视口(172px)之外——玩家可以没见过任何价签就成交;变卖选中/武装时
// 进度区(还欠多少)恰随滚离场。修复:语境区随档并入 footer(matchMedia 分档渲染,
// 高档变卖进度 sticky 钉体部视口顶)、矮档卡基 6.4→5.8px、矮档让位收档。
// 断言走真渲染几何(零语义放宽):首个价签 rect 全须落在视口内且不被体部下缘裁切;
// 变卖武装态进度区恒在(选中+武装+滚底三拍同测)。种植配方照抄 react-scrolls
// plantTrade/破产清算例与 tmp/audit-r4-*.mjs 审计现场。
// #1217 波4 直通形制(ADR-0058):两例真实段=真渲染几何断言即被测环(无操作链);
// 前置布场种植(判词见各例),开局停走 quickStart 直达首停靠(族种 1486)。
// #1221 L1 残油包:两例改 quickStart({advance:"preRoll"})——布场不依赖行军日志/
// 已推进回合,落都即冻结,显式 freezeClock 随通路退役。
import { test, expect, type Page } from "./fixtures";
import { quickStart, snap, engineState } from "./react-helpers";
import { plant } from "./helpers/drivers";
import { SCROLL_TESTIDS as T } from "../src/app/screens/game/scroll/testids";

/** 首个价签格完整在视口内的几何断言:rect 全落在标准档视口内,且底缘不越过体部
 *  视口下缘(防「在屏内但被渐隐带/钉底行罩住」的假绿)。 */
async function expectFirstTagInViewport(page: Page): Promise<void> {
  // 入场动画(translate/scale ~250ms)落定后再量几何——采样落进动画相位窗会
  // 误报折切(#879 图像字节改变首帧绘制时机后暴露);600ms 兜底防 infinite 挂死。
  await page.locator(".pile-modal").evaluate(async (root) => {
    const running = root
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === "running")
      .map((a) => a.finished.catch(() => undefined));
    await Promise.race([Promise.allSettled(running), new Promise((r) => setTimeout(r, 600))]);
  });
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

  // 真实段(波4 #1217):坐地模式 → 选宝层真渲染首帧几何(双行价签格完整在视口内,
  // 墩住整排)——几何断言即被测环,无操作链。
  // 种植判词:5 件珍宝=giveTreasureFromDeck(牌堆源,真 TreasureDef 实例保价签 def
  // 现算真实;终态替换)、授产=grantProperty(城池归属由购地结算产出,无授产公共
  // 命令;选址=测试侧读现值)——均 #1300;钉相位/活跃方/交涉停相位=armPhase——
  // 均 #1301,判词单源 src/core/planter.ts。交涉挂起载荷(treasureVisitor)仅落格
  // 结算内部挂起,无种植件,直写内联判词(#1303 收口缺口盘点)。
  test("交涉坐地起价:首帧第一排卡+双行价签完整在视口内", async ({ page }) => {
    // 城主=人类座位 0,访客=bot 座位 1;5 件珍宝复刻审计 12b 现场(#188 钉决策方)。
    // 冻结推进再动刀(#421/#799/#879 同口径):种植后到断言间看门狗回调不得动现金/牌
    // ——#1221 L1:preRoll 落都即冻结(点火前已冻),显式 freezeClock 退役。
    await quickStart(page, 1486, { advance: "preRoll" });
    // 访客(买家)垫足现金走 setCash 种植件(#1299,判词单源 src/core/planter.ts):
    // 防 payOrLiquidate 走清算自救支线劫持交涉结算断言(语义同旧 Math.max 直写)。
    const visitorCash = (await snap(page)).players[1].cash as number;
    await plant(page, {
      kind: "setCash",
      seat: 1,
      cash: Math.max(visitorCash, 5000),
    });
    await plant(page, { kind: "giveTreasureFromDeck", seat: 0, count: 5 });
    const pid: string = await engineState(
      page,
      `(e.board.tiles.find((t) => t.propertyId && !e.findOwner(t.propertyId))).propertyId`,
    );
    await plant(page, {
      kind: "grantProperty",
      seat: 0,
      propertyId: pid,
      level: 1,
    });
    await plant(page, { kind: "armVisitor", propertyId: pid, ownerSeat: 0 });
    await plant(page, {
      kind: "armPhase",
      phase: "Playing",
      activeIndex: 1,
      turnPhase: "AwaitingTreasureOwner",
    });
    await page.getByTestId(T.treasureModePremium).click();
    await expect(page.getByTestId(T.treasurePick)).toBeVisible();
    // 坐地双行价签(指导价+要价)是本档最挤格型——首签完整在视口内即守住整排
    await expectFirstTagInViewport(page);
  });

  // 真实段(波4 #1217):变卖弹层首帧价签几何 + 选中→武装→滚底三拍进度区恒在的
  // 真渲染几何——几何断言即被测环。
  // 种植判词:6 件珍宝=giveTreasureFromDeck(牌堆源,真 TreasureDef 实例保变卖清单
  // def 现算真实;终态替换,#1300,判词单源 src/core/planter.ts);破产态走 armDebt、
  // 钉相位/活跃方走 armPhase(#1301,判词单源 src/core/planter.ts 破产终局族/armPhase
  // 头注:破产态(pendingDebt)由缴支结算产生、债务数值不可钉)。
  test("破产变卖:首帧价签在视口内;选中+武装+滚底进度区恒在", async ({ page }) => {
    // 冻结推进再动刀(#421/#799 同口径):种植后到断言间看门狗回调不得动 p0 现金
    // ——#1221 L1:preRoll 落都即冻结(点火前已冻),显式 freezeClock 退役。
    await quickStart(page, 1486, { advance: "preRoll" });
    await plant(page, { kind: "giveTreasureFromDeck", seat: 0, count: 6 });
    await plant(page, { kind: "armPhase", phase: "Playing", activeIndex: 0 });
    await plant(page, { kind: "armDebt", amount: 1500, creditor: null });
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

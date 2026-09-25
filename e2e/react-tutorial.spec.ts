// 教程防漂移守卫:docs/tutorials/新手第一局.md 的每句「你会看到什么/点什么」
// 与真实 UI 对齐——文案/交互改动会在这里先炸,文档不许悄悄过期(#169 走查的机器层)。
import { test, expect } from "./fixtures";
import { actIfCan, waitSettled, snap } from "./react-helpers";

test("教程走查:起兵→选都→自动行军→军师幕→托管的每句 UI 断言", async ({ page }) => {
  await page.goto("/");
  // 「开一局单机」:首页四入口
  await page.getByTestId("home-solo").click();
  await page.getByTestId("solo-setup-screen").waitFor();
  // 「起兵」节:三档身价 + 难度两档 + 国号字盘
  await expect(page.getByText("速战")).toBeVisible();
  await expect(page.getByText("鏖战")).toBeVisible();
  await expect(page.getByText("智将(EV)")).toBeVisible();
  await expect(page.getByText("庸才(随机)")).toBeVisible();
  await expect(page.getByText("字盘快选国号")).toBeVisible();
  // 「起兵」按钮 → 选都(「调兵遣将中…」为瞬态,静态 grep 已核,此处验证点击后进选都)
  await page.getByTestId("start-game").click();
  // 「三选一选都」:横幅文案 + 三候选金圈 + 详情卷轴两钮
  await expect(page.getByText(/三选一:于候选城中择一定都/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".bv-tile.bv-selectable")).toHaveCount(3);
  await page.locator(".bv-tile.bv-selectable").first().click();
  const detail = page.getByTestId("scroll-tile-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("定都于此")).toBeVisible();
  await expect(detail.getByText("再想想")).toBeVisible();
  await page.getByTestId("confirm-capital-ok").click();
  // 「军师窗态」(#256 军师幕弹窗退役,教程断言改架中口径):起手是否停窗随牌库
  // 洗序,条件断言——窗态在场 = 架中可用牌 + 动作条,「不出」放行(原「今不用」
  // 语义平移,牌不消耗;窗态无弹窗文案可断)
  const ab = page.getByTestId("actionbar");
  if (await ab.isVisible().catch(() => false)) {
    await expect(page.getByTestId("jinnang-rack")).toBeVisible();
    await page.getByTestId("actionbar-pass").click();
  }
  // 「行军自动化」:无行军按钮 + 不点任何东西对局自己推进(turnNumber 前进)
  await expect(page.locator('[data-testid="roll-button"]')).toHaveCount(0);
  await waitSettled(page);
  const before = await snap(page);
  // 落格卷轴(购地/扩军等)会等人类作答——教程口径「读文案、挑一条」,走查代答直到回合推进
  await expect
    .poll(
      async () => {
        await actIfCan(page);
        // 招贤卷轴(actIfCan 只认 action-*,招贤选项是独立 testid 族):教程「点一位名将收下」
        const hero = page.locator('[data-testid^="scroll-hero-option-"]').first();
        if (await hero.isVisible().catch(() => false))
          await hero.click({ timeout: 5_000 }).catch(() => {});
        // 珍宝交涉·城主视角(教程「暂不交易(无事发生)」):bot 落我城且我有珍宝时弹出
        const tSkip = page.getByTestId("scroll-treasure-skip");
        if (await tSkip.isVisible().catch(() => false))
          await tSkip.click({ timeout: 5_000 }).catch(() => {});
        await waitSettled(page);
        return (await snap(page)).turnNumber;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(before.turnNumber);
  // bot 接手:「智将运筹中…」等待条(与 bot 决策归属联合轮询——卷轴等人类作答时
  // interactive=true 条不渲染,单等文案会撞上人类决策窗的静默期)。
  // 轮询体内必须 actIfCan 代答:回合推进后新回合的军师幕/购地卷轴会再弹,决策权
  // 钉在人类身上时 owner?.isBot 恒 false——单等会 90s 空转超时(#240 收口实测复现)。
  await expect
    .poll(
      async () => {
        await actIfCan(page);
        const s = await snap(page);
        const owner = s.players[s.decisionOwner];
        if (!owner?.isBot) return false;
        return page
          .getByText("智将运筹中…")
          .first()
          .isVisible()
          .catch(() => false);
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  // 「托管」入口在手牌区
  await expect(page.getByTestId("autopilot-button")).toBeVisible();
  await waitSettled(page);
});

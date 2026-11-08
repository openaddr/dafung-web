// 教程防漂移守卫:docs/tutorials/新手第一局.md 的每句「你会看到什么/点什么」
// 与真实 UI 对齐——文案/交互改动会在这里先炸,文档不许悄悄过期(#169 走查的机器层)。
import { test, expect } from "./fixtures";
import { actIfCan, waitSettled, snap, waitMyPause } from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

// 真实段(脊柱⑤全链声明,ADR-0058):教程文档每句 UI 断言的全链走查——起兵→选都
// →详情卷轴两钮→出牌放行→自动行军→回合推进→托管入口,逐环真实点击;种植零冻结
// (「运筹中」文案契约钉 bot 活跃方走 armPhase 种植件 #1301,链前存量机制替换非
// 本链新增种植化改造);卷轴代答(招贤/珍宝跳过)是教程口径「读文案、挑一条」
// 的真实操作链本体。
// 相位族判词(单源 src/core/planter.ts armPhase 头注):「运筹中…」等待条按 bot 归属
// 渲染——#398 单机统一后 bot 决策归属在两次下行拍之间不可观察(decisionOwner 恒
// 人类),文案契约只能种 bot 活跃方钉住(armPhase 写后控制器 sync 广播,第二刀还原);
// 种植是到达手段,等待条对归属状态的响应链全真。
test("教程走查:起兵→选都→自动行军→出牌阶段→托管的每句 UI 断言", async ({ page }) => {
  // 预算 120s(scoped,#1309 池载实录):全链最长例,串行 ~20s,W4 满载 3× 退化撞 60s
  // 全局预算两度超时(负载族签名,零种植零交集)——脊柱⑤不可删(ADR-0058 决策3),
  // #987 例外条款=一两行确定性改造,scoped 预算复位,快跑零成本。
  test.setTimeout(120_000);
  await page.goto("/");
  // 「开一局单机」:首页四入口
  await page.getByTestId(HOME_TID.solo).click();
  await page.getByTestId(SETUP_TID.screen).waitFor();
  // 「起兵」节:三档身价 + 国号字盘(#613 难度档退役,两档断言随删)
  await expect(page.getByText("速战")).toBeVisible();
  await expect(page.getByText("鏖战")).toBeVisible();
  await expect(page.getByText("字盘快选国号")).toBeVisible();
  // 「起兵」按钮 → 选都(「调兵遣将中…」为瞬态,静态 grep 已核,此处验证点击后进选都)
  await page.getByTestId(SETUP_TID.startGame).click();
  // 「选都」:横幅文案(#297 起按 turn 分化,轮到玩家=「轮到你定都…」)+ 三候选金圈 + 详情卷轴两钮
  await expect(page.getByText(/轮到你定都:点选一座候选城/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".bv-tile.bv-selectable")).toHaveCount(3);
  await page.locator(".bv-tile.bv-selectable").first().click();
  const detail = page.getByTestId(SCROLL_TESTIDS.tileDetailScroll);
  await expect(detail).toBeVisible();
  await expect(detail.getByText("定都于此")).toBeVisible();
  await expect(detail.getByText("再想想")).toBeVisible();
  // #671:选都候选按「将成为都城」显示补给列(变卖价对都城是死信息)
  await expect(detail.getByText("交易加成")).toBeVisible();
  await expect(detail.getByText("都城补给")).toBeVisible();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  // 「出牌阶段态」(#256 旧弹窗退役,教程断言改架中口径):起手是否停窗随牌库
  // 洗序,条件断言——窗态在场 = 架中可用牌 + 动作条,「不出」放行(原「今不用」
  // 语义平移,牌不消耗;窗态无弹窗文案可断)
  const ab = page.getByTestId(TESTIDS.actionbar);
  if (await ab.isVisible().catch(() => false)) {
    await expect(page.getByTestId(TESTIDS.jinnangRack)).toBeVisible();
    await page.getByTestId(TESTIDS.actionbarPass).click();
  }
  // 「行军自动化」:无行军按钮 + 不点任何东西对局自己推进(turnNumber 前进)
  await expect(page.locator('[data-testid="roll-button"]')).toHaveCount(0); // testids:allow 退役 testid 零残留断言——roll-button 已随 #188 行军自动化删除,无单源可引
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
        const tSkip = page.getByTestId(SCROLL_TESTIDS.treasureSkip);
        if (await tSkip.isVisible().catch(() => false))
          await tSkip.click({ timeout: 5_000 }).catch(() => {});
        await waitSettled(page);
        return (await snap(page)).turnNumber;
      },
      { timeout: 90_000 },
    )
    .toBeGreaterThan(before.turnNumber);
  // bot 接手:#398 单机统一后房间编排一拍跑完整条 bot 链(状态即时落、动画排队播),
  // 引擎不在 bot 决策点停靠——「运筹中…」的自然瞬态不复存在(单跑实测:decisionOwner
  // 恒为人类,bot 决策归属在两次下行拍之间不可观察)。文档句子「底部显示运筹中…」
  // 的文案与挂载点改走 react-solo 思考态同款调试钩子种植(钉文案契约,不钉时序);
  // 「电脑接手其余玩家」的实质(bot 一拍走完整轮、回合照常推进)已由上一 poll 的
  // turnNumber 前进覆盖—— turnNumber 只能在全部 bot 座位走完后回到人类。
  await waitMyPause(page, 0); // 停在人类 Awaiting* 决策点再种植:避开 Roll 自动起摇看门狗竞速
  const botIdx = (await snap(page)).players.findIndex((p: { isBot: boolean }) => p.isBot);
  // decisionOwner=activeIndex(非交涉相位)→ 等待条按 bot 归属渲染(armPhase 越界座位
  // 当场炸,原「无 bot 座位」显式抛错由种植件界检查接管)
  await plant(page, { kind: "armPhase", activeIndex: botIdx });
  await expect(page.getByTestId(TESTIDS.waitingBar)).toBeVisible();
  await expect(page.getByTestId(TESTIDS.thinking)).toContainText("运筹中…");
  // 还原活跃方:人类命令按 decisionOwner 校验,不得带着 bot 活跃方交命令
  await plant(page, { kind: "armPhase", activeIndex: 0 });
  // 「托管」入口在设置弹层(#1097 收编,#1096 决议2;原 #701 自机格弹层通路随格
  //  tap 退役):设置钮 DOM 直派(决策卷轴 z-30 遮罩在挂时真点击会被吞,直派照进
  //  真实 React onClick);Esc 收净再收尾
  await page.getByTestId(TESTIDS.settingsButton).dispatchEvent("click");
  await expect(page.getByTestId(TESTIDS.settingsAutopilot)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(TESTIDS.settingsDialog)).toBeHidden();
  await waitSettled(page);
});

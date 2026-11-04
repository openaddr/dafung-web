// 扩展系统骨架 e2e(#378,ADR-0022):示例名将包(extensions/hero-taishici)权威侧
// 全链路——启动装载(贡献进名将池)→ 对局招贤可选到示例名将 → 选定后被动技「义从」
// 权威结算(+100 两)→ 主动技「破阵」复用 warDrum 结算(步数 +1)。客户端半边断言
// (动画/将旗/呈现意图)已随客户端扩展面退役删除(#1064);定制问询「信义盲选」
// 对局断言已随问询线退役删除(#1065)。断言口径:状态断言走引擎 god view(与既有 spec 同款)。
import { test, expect } from "./fixtures";
import {
  quickStart,
  force,
  snap,
  engineState,
  waitSettled,
  useHalfScale,
  waitFxIdle,
  freezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS as T } from "../src/app/screens/game/scroll/testids";
import type { Page } from "@playwright/test";

/** 种植招贤候选(示例名将居中位)+ 摆 AwaitingHeroPick:候选取 heroDefs 全量定义
 *  (#378 调试钩子),按 #787 候选行形状 {def, skillIds(预掷授技)} 直写种植——
 *  种植者定预掷结果(e2e 给整池),引擎落定原样入槽不重掷。 */
async function plantHeroPick(page: Page): Promise<void> {
  // #987 冻结闸(#943 竞速点清偿):排空演出→冻结,种植的 AwaitingHeroPick 假相位
  // 不被停靠点残留的已到点链步进覆盖(冻结挂起时钟驱动收幕,fx 在途时冻结=死等)。
  await waitFxIdle(page);
  await freezeClock(page);
  await force(
    page,
    `
    {
      const defs = window.__dafung.heroDefs();
      const taishici = defs.find((h) => h.id === "taishici");
      if (!taishici) throw new Error("扩展包未装载:名将池无 taishici(#378 装载断言)");
      e.phase = "Playing";
      e.activeIndex = 0;
      const row = (id) => { const d = defs.find((h) => h.id === id); return { def: d, skillIds: [...d.skillPool] }; };
      e.offeredHeroes = [row("zhouyu"), row("taishici"), row("huatuo")];
      e.turnPhase = "AwaitingHeroPick";
    }
  `,
  );
}

test.describe("扩展系统骨架(#378 示例名将包全链)", () => {
  test("装包→装载→招贤可选→选定权威结算(义从 +100)", { tag: "@slow" }, async ({ page }) => {
    // 慢池(#1026):单例实测 >30s——快池门禁 --grep-invert @slow 跳过。
    await quickStart(page, 7);
    await plantHeroPick(page);

    // 装载断言:招贤卷轴候选含示例名将(权威贡献进名将池的消费面)
    const scroll = page.getByTestId(T.heroPickScroll);
    await expect(scroll).toBeVisible();
    await expect(scroll.getByTestId(T.heroPickOption(1))).toContainText("太史慈");

    // 选定太史慈(候选中位):被动技「义从」权威结算 +100 两
    const before = await snap(page);
    const cashBefore = before.players[0].cash;
    // 先看后选(2026-11-01 拍板):点卡开全览详情弹框,弹框「收为麾下」拍板
    await scroll.locator(`[data-testid="${T.heroPickOption(1)}"]`).click();
    const pick = page.getByTestId(TESTIDS.skillGlossary).getByTestId(TESTIDS.skillGlossaryPick);
    await expect(pick).toBeVisible();
    await pick.click();
    await expect(scroll).toBeHidden();
    await expect
      .poll(async () => engineState(page, "e.players[0].cash"), { timeout: 10_000 })
      .toBe(cashBefore + 100);
    expect(await engineState(page, "e.players[0].heroes.map((h) => h.heroId)")).toContain(
      "taishici",
    );
    await waitSettled(page);
  });

  test(
    "主动技「破阵」:出牌阶段可发,复用 warDrum 结算步数 +1",
    { tag: "@slow" },
    async ({ page }) => {
      // 慢池(#1026):单例实测 >30s——快池门禁 --grep-invert @slow 跳过。
      await useHalfScale(page); // 放缓演出:发技后自动起摇前留足断言窗(heroDiceBonus 消费前)
      await quickStart(page, 7);
      // #987 冻结闸(同 plantHeroPick):排空演出→冻结,种植的出牌窗不被迟到链步进覆盖
      await waitFxIdle(page);
      await freezeClock(page);
      // 种植:人类麾下带示例名将,停出牌阶段(技能卡承载 SkillCardFace 单技装配,#818)
      await force(
        page,
        `
      {
        const taishici = window.__dafung.heroDefs().find((h) => h.id === "taishici");
        if (!taishici) throw new Error("扩展包未装载:名将池无 taishici");
        e.phase = "Playing";
        e.activeIndex = 0;
        // 麾下槽位行(#785):def 入槽 = {heroId, 已授技(全池), 冷却账},引擎直写种植是既有 e2e 口径
        e.players[0].heroes.push({ heroId: taishici.id, skillIds: [...taishici.skillPool], lastFired: {} });
        e.players[0].jinnangHand = [];
        e.players[0].jinnangHandCount = 0;
        e.turnPhase = "AwaitingJinnang";
      }
    `,
      );
      // testid=选项 id 实例形状 skill:<heroId>:<skillId>(#817)
      const ji = page.getByTestId(TESTIDS.jinnangCard("skill:taishici:taishici-pozhen"));
      await expect(ji).toBeVisible();
      await ji.click();
      await page.getByTestId(TESTIDS.actionbarPlay).click();
      // 权威结算复用 warDrum 案:本回合步数加成挂账;发技事件随同批产出
      // (自动起摇开启新批前的事件窗内采样,0.5 倍率下窗口充裕)
      await expect
        .poll(
          () =>
            engineState(
              page,
              "({ bonus: e.heroDiceBonus, fired: e.gameEvents.some((x) => x.kind === 'heroSkillActivated') })",
            ),
          { timeout: 10_000, intervals: [50] },
        )
        .toEqual({ bonus: 1, fired: true });
    },
  );
});

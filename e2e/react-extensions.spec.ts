// 扩展系统骨架 e2e(#378,ADR-0022):示例名将包(extensions/hero-taishici)浏览器侧
// 装载与招贤接线——启动装载(贡献进名将池)→ 对局招贤可选到示例名将 → 选定后被动技
// 「义从」结算接线。客户端半边断言(动画/将旗/呈现意图)已随客户端扩展面退役删除
// (#1064);定制问询「信义盲选」对局断言已随问询线退役删除(#1065)。
// #1165 瘦身:原「主动技破阵步数 +1」例整删——引擎结算(+1/事件随批/选项可见)与
// 技能卡交互形制分别由 test/extension-taishici.test.ts「破阵」例与 react-jinnang-use
// 技能卡例钉死,本文件该例零独占断言面;义从 +100 的结算细则同样归
// test/extension-taishici.test.ts「义从」例,本文件只留浏览器侧装载可见性(招贤卷轴
// 陈列太史慈=main.tsx 顶层注册的消费面,无头整局层刻意不装扩展包,替代不了)。
import { test, expect } from "./fixtures";
import {
  quickStart,
  force,
  snap,
  engineState,
  waitSettled,
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
});

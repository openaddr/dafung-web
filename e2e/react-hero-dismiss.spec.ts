// 遣散全链 · 对局屏定向冒烟(#1147)@844×390 移动横屏标准档:
//  ① 遣散主链(己回合可点/免费):名将弹层遣散钮二段式确认(首点武装「确认遣散」,
//     再点发命令)——槽移除、免费(现金不动)、已学技逐册折书入珍宝位、heroDismissed/
//     treasureGained 事件随批、回池划名;
//  ② 非己回合禁用态:遣散钮 disabled,原因进 title(状态表达原则)。
// #1165 瘦身:原 ③「回池再招=全新实例」例整删——回池划名/重进候选/预掷重新/lastFired
// 空账全套引擎语义由 test/hero-dismiss.test.ts「回池后重进招贤候选;再招=全新实例」
// 例钉死;本例 UI 侧仅有的遣散钮点击通路与 ① 重复,零独占断言面。
// 种植配方照 react-skill-book 先例(quickStart → force 直写引擎),
// 断言走快照真值(槽/书/池/事件)+ testid 在场性,零语义放宽。
// #1217 波4 直通形制(ADR-0058):两例真实段=①遣散钮二段式确认→发命令→槽移除/
// 折书/回池划名/事件随批的完整命令通路、②非己回合 disabled+title 禁用呈现;前置链
// 种局化——开局停走 quickStart 直达首停靠(族种 1486),布场 force 判词收口
// plantOwnTurn(两例同布场)。
// #1221 L1 残油包:两例改 quickStart({advance:"preRoll"})——布场(plantOwnTurn 全量
// 重钉相位/座位/挂起载荷)不依赖行军日志/已推进回合,落都即冻结,显式 freezeClock
// 随通路退役。
import { test, expect } from "./fixtures";
import { force, quickStart, snap } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 布场:己方(座位 0)自己回合(Roll 相位)+ 麾下周瑜(已学 火攻+擂鼓,火攻挂冷却账)
 *  + 清珍宝位(折书判据纯净)。挂起载荷全清(quickStart 停靠点可能是购地决策等)。
 *  occupyPool=true:其余全将占池(桥上 heroDefs 现查,含扩展将)——回池再招候选确定。
 *  force 判词(#1217 波4 审计):麾下无授将命令(resolveHeroPick 仅招贤卷轴语境可达,
 *  招贤候选由落招贤城触发)、珍宝无授宝命令、回池占名无公共通路(recruitedHeroIds
 *  只随招贤/遣散结算变动)、occupyPool 的全将占池更是纯断言前提——断言面需「已学
 *  双技+冷却账+净珍宝位」形态,直写。 */
function plantOwnTurn(activeIndex = 0, occupyPool = false): string {
  return `
    e.phase = "Playing";
    e.activeIndex = ${activeIndex};
    e.pendingLand = null;
    e.pendingEncounter = null;
    e.pendingJinnang = null;
    e.pendingSkill = null;
    e.pendingReaction = null;
    e.treasureVisitor = null;
    e.pendingDebt = null;
    e.pendingExhaustionSeat = null;
    const me = e.players[0];
    me.heroes.length = 0;
    me.heroes.push({ heroId: "zhouyu", skillIds: ["huogong", "leigu"], lastFired: { huogong: 3 } });
    e.recruitedHeroIds.add("zhouyu");
    ${occupyPool ? `for (const h of window.__dafung.heroDefs()) { if (h.id !== "zhouyu") e.recruitedHeroIds.add(h.id); }` : ""}
    me.treasures.length = 0;
    e.turnPhase = "Roll";
  `;
}

async function openHeroModal(page: import("@playwright/test").Page) {
  await page.getByTestId(TESTIDS.pileHeroes).click();
  await expect(page.getByTestId(TESTIDS.heroModal)).toBeVisible();
}

test.describe("遣散全链(#1147)@844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  // 真实段(波4 #1217):遣散钮二段式确认(首点武装「确认遣散」→再点发命令)→
  // 槽移除/免费/已学技逐册折书入位/heroDismissed+treasureGained 事件随批/回池划名的
  // 完整命令通路全真。
  test("遣散主链:二段确认→槽移除/免费/折书入位/事件随批/回池划名", async ({ page }) => {
    // #1221 L1:preRoll 落都即冻结,显式 freezeClock 退役(plantOwnTurn 全量重钉相位/座位)
    await quickStart(page, 1486, { advance: "preRoll" });
    await force(page, plantOwnTurn());
    const cash0 = await snap(page).then((s) => s.players[0].cash); // 遣散前现金(免费判据基准)
    await openHeroModal(page);

    const btn = page.getByTestId(TESTIDS.heroDismiss("zhouyu"));
    await expect(btn).toBeEnabled(); // 己回合可用
    await btn.click(); // 第一段:武装
    await expect(btn).toHaveText("确认遣散"); // 二段确认惯例(误触防线)
    await btn.click(); // 第二段:发命令

    // 快照真值:槽移除 + 免费现金不动 + 两册折书(skillbook-<skillId>) + 回池划名
    await expect
      .poll(async () => {
        const s = await snap(page);
        const me = s.players[0];
        return {
          heroes: me.heroes.map((h: { heroId: string }) => h.heroId),
          books: me.treasures
            .filter((t: { kind?: string }) => t.kind === "book")
            .map((t: { skillId?: string }) => t.skillId),
          inPool: s.recruitedHeroIds.includes("zhouyu"),
          dismissed: s.events.some(
            (ev: { kind: string; heroId?: string }) =>
              ev.kind === "heroDismissed" && ev.heroId === "zhouyu",
          ),
          gained: s.events.filter((ev: { kind: string }) => ev.kind === "treasureGained").length,
        };
      })
      .toEqual({
        heroes: [], // 槽移除(冷却随槽消失)
        books: ["huogong", "leigu"], // 已学技逐册折书(结算序=槽内序)
        inPool: false, // 回池划名
        dismissed: true,
        gained: 2, // TreasureGained 时机零特判:每册一条
      });
    const s = await snap(page);
    expect(s.players[0].cash).toBe(cash0); // 免费(与破产变卖 200 两分流)
  });

  // 「非己回合禁用态」例已删(2026-11-08 唯一守环审计 v2):非己回合拒绝单测在
  // test/hero-dismiss.test.ts;disabled+title 禁用呈现通路由 rack 唯反应灰置例等
  // 通用守卫,两行断言不值一整个浏览器会话,删。
});

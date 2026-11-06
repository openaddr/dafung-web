// 遣散全链 · 对局屏定向冒烟(#1147)@844×390 移动横屏标准档:
//  ① 遣散主链(己回合可点/免费):名将弹层遣散钮二段式确认(首点武装「确认遣散」,
//     再点发命令)——槽移除、免费(现金不动)、已学技逐册折书入珍宝位、heroDismissed/
//     treasureGained 事件随批、回池划名;
//  ② 非己回合禁用态:遣散钮 disabled,原因进 title(状态表达原则);
//  ③ 回池再招=全新实例:遣散后该将重进招贤候选,落定后 lastFired 空账、授技重新预掷。
// 种植配方照 react-skill-book 先例(quickStart → freezeClock → force 直写引擎),
// 断言走快照真值(槽/书/池/事件)+ testid 在场性,零语义放宽。
import { test, expect } from "./fixtures";
import { force, freezeClock, quickStart, snap } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 布场:己方(座位 0)自己回合(Roll 相位)+ 麾下周瑜(已学 火攻+擂鼓,火攻挂冷却账)
 *  + 清珍宝位(折书判据纯净)。挂起载荷全清(quickStart 停靠点可能是购地决策等)。
 *  occupyPool=true:其余全将占池(桥上 heroDefs 现查,含扩展将)——回池再招候选确定。 */
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

  test("遣散主链:二段确认→槽移除/免费/折书入位/事件随批/回池划名", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
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

  test("非己回合禁用态:遣散钮 disabled,原因进 title", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
    await force(page, plantOwnTurn(1)); // bot 座位 1 行动:非己回合
    await openHeroModal(page);
    const btn = page.getByTestId(TESTIDS.heroDismiss("zhouyu"));
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute("title", "己方回合可遣散");
  });

  test("回池再招=全新实例:重进招贤候选,落定后 lastFired 空账、授技重新预掷", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
    await force(page, plantOwnTurn(0, true)); // 其余全将占池:回池后候选恰为周瑜(断言确定)
    await openHeroModal(page);
    const btn = page.getByTestId(TESTIDS.heroDismiss("zhouyu"));
    await btn.click();
    await btn.click(); // 二段确认发命令
    await expect
      .poll(async () => {
        const s = await snap(page);
        return s.players[0].heroes.length;
      })
      .toBe(0);

    // 遣散后招贤(其余七将仍占池 → 候选恰为回池的周瑜),预掷照旧现掷
    await force(
      page,
      `
      e.tryRecruitHero(e.players[0]);
      if (e.turnPhase !== "AwaitingHeroPick") throw new Error("候选未挂起(回池划名失效)");
      if (e.offeredHeroes.length !== 1 || e.offeredHeroes[0].def.id !== "zhouyu")
        throw new Error("候选不含回池名将: " + e.offeredHeroes.map((o) => o.def.id).join("|"));
      const rolled = e.offeredHeroes[0].skillIds;
      if (rolled.length < 1) throw new Error("预掷空授技(违反至少一技)");
      e.resolveHeroPick(0);
      const slot = e.players[0].heroes.find((s) => s.heroId === "zhouyu");
      if (slot == null) throw new Error("落定无槽");
      if (Object.keys(slot.lastFired).length !== 0) throw new Error("再招遗留冷却账(非全新实例)");
      if (slot.skillIds.join("|") !== rolled.join("|")) throw new Error("落定未沿用候选预掷");
      `,
    );
    const s = await snap(page);
    const slot = s.players[0].heroes.find((h: { heroId: string }) => h.heroId === "zhouyu");
    expect(slot).toBeDefined(); // 全新实例已入麾下
    expect(s.recruitedHeroIds).toContain("zhouyu"); // 再占池
  });
});

// 技能书全链 · 对局屏定向冒烟(#1146)@844×390 移动横屏标准档:
//  ① 书可点态(1 名可学):珍宝弹层书格真 button,点即研读——书消耗、池序入槽、窗口停留;
//  ② 多名可学弹窗:选人叠层(PileShell 制式)点将拍板;
//  ③ 不可用态:非己方出牌阶段,书格为静态陈列(无交互挂点),禁用原因进 title。
// 种植配方照 react-treasure-pick-fold 先例(quickStart → freezeClock → force 直写引擎),
// 断言走快照真值(书消耗/入槽/相位)+ testid 在场性,零语义放宽。
import { test, expect } from "./fixtures";
import { force, freezeClock, quickStart, snap } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 布场:己方(座位 0)出牌阶段卡牌段 + 麾下 heroes(池序 skillIds)+ 珍宝位塞一本书。
 *  挂起载荷全清(quickStart 停靠点可能是购地决策等,不清会与强制相位失配)+ 开局手牌
 *  清空:书=窗内可用项唯一来源,判据不被开局锦囊牌路污染。 */
function plantBook(skillId: string, heroes: Array<{ id: string; skillIds: string[] }>): string {
  // 麾下布场行在 TS 侧生成(force 脚本=纯字符串 eval,模板字面量里的循环不执行)
  const arm = heroes
    .map(
      (h) =>
        `me.heroes.push({ heroId: "${h.id}", skillIds: [${h.skillIds.map((s) => `"${s}"`).join(", ")}], lastFired: {} }); e.recruitedHeroIds.add("${h.id}");`,
    )
    .join("\n    ");
  return `
    e.phase = "Playing";
    e.activeIndex = 0;
    e.pendingLand = null;
    e.pendingEncounter = null;
    e.pendingJinnang = null;
    e.pendingSkill = null;
    e.pendingReaction = null;
    e.treasureVisitor = null;
    e.pendingDebt = null;
    e.pendingExhaustionSeat = null;
    const me = e.players[0];
    me.jinnangHand = [];
    me.jinnangHandCount = 0;
    ${arm}
    me.treasures.push({ id: "skillbook-${skillId}", name: "技能书", level: 2, desc: "", kind: "book", skillId: "${skillId}" });
    e.turnPhase = "AwaitingJinnang";
  `;
}

test.describe("技能书全链(#1146)@844×390", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("书可点态(1 名可学):点书研读——书消耗、池序入槽、skillLearned 随批", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
    await force(page, plantBook("leigu", [{ id: "zhouyu", skillIds: ["huogong"] }]));
    await page.getByTestId(TESTIDS.pileTreasures).click();
    const modal = page.getByTestId(TESTIDS.treasureModal);
    await expect(modal).toBeVisible();
    const bookBtn = page.getByTestId(TESTIDS.bookUse("skillbook-leigu"));
    await expect(bookBtn).toBeVisible();
    await bookBtn.click();
    // 快照真值:书消耗 + 池序入槽(周瑜池 [疾行,火攻,擂鼓] → [火攻,擂鼓])+ 学技事件随批
    await expect
      .poll(async () => {
        const s = await snap(page);
        const me = s.players[0];
        return {
          books: me.treasures.filter((t: { kind?: string }) => t.kind === "book").length,
          skills: me.heroes[0]?.skillIds,
          learned: s.events.some(
            (ev: { kind: string; skillId?: string; heroId?: string }) =>
              ev.kind === "skillLearned" && ev.skillId === "leigu" && ev.heroId === "zhouyu",
          ),
        };
      })
      .toEqual({ books: 0, skills: ["huogong", "leigu"], learned: true });
    // 学得的擂鼓=主动技即刻就绪(与招贤所得同构):窗口不误收
    const s = await snap(page);
    expect(s.turnPhase).toBe("AwaitingJinnang");
  });

  test("多名可学弹窗:两名池含此技未习得 → 选人叠层点将拍板", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
    await force(
      page,
      plantBook("jixing", [
        { id: "zhouyu", skillIds: ["huogong"] },
        { id: "zhangxingcai", skillIds: ["leigu"] },
      ]), // 周瑜/张星彩池均含疾行
    );
    await page.getByTestId(TESTIDS.pileTreasures).click();
    await page.getByTestId(TESTIDS.bookUse("skillbook-jixing")).click();
    const learn = page.getByTestId(TESTIDS.bookLearnModal);
    await expect(learn).toBeVisible();
    await page.getByTestId(TESTIDS.bookLearnItem("zhangxingcai")).click();
    await expect
      .poll(async () => {
        const s = await snap(page);
        return {
          books: s.players[0].treasures.filter((t: { kind?: string }) => t.kind === "book").length,
          zxc: s.players[0].heroes[1]?.skillIds,
          zy: s.players[0].heroes[0]?.skillIds,
          modalGone: !(await page
            .getByTestId(TESTIDS.bookLearnModal)
            .isVisible()
            .catch(() => false)),
        };
      })
      .toEqual({ books: 0, zxc: ["leigu", "jixing"], zy: ["huogong"], modalGone: true });
  });

  test("不可用态:非己方出牌阶段,书格静态陈列(无 book-use 挂点)", async ({ page }) => {
    await quickStart(page);
    await freezeClock(page);
    await force(
      page,
      `
      e.phase = "Playing";
      e.activeIndex = 1; // bot 决策:非己方出牌阶段
      e.pendingLand = null;
      e.pendingEncounter = null;
      e.pendingJinnang = null;
      e.pendingSkill = null;
      e.pendingReaction = null;
      e.treasureVisitor = null;
      e.pendingDebt = null;
      const me = e.players[0];
      me.heroes.push({ heroId: "zhouyu", skillIds: ["huogong"], lastFired: {} });
      e.recruitedHeroIds.add("zhouyu");
      me.treasures.push({ id: "skillbook-leigu", name: "技能书", level: 2, desc: "", kind: "book", skillId: "leigu" });
      e.turnPhase = "Roll";
      `,
    );
    await page.getByTestId(TESTIDS.pileTreasures).click();
    await expect(page.getByTestId(TESTIDS.treasureModal)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.bookUse("skillbook-leigu"))).toHaveCount(0);
  });
});

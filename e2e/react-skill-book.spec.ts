// 技能书全链 · 对局屏定向冒烟(#1146)@844×390 移动横屏标准档:
//  ① 书可点态(1 名可学):珍宝弹层书格真 button,点即研读——书消耗、池序入槽、窗口停留;
//  ② 多名可学弹窗:选人叠层(PileShell 制式)点将拍板;
//  ③ 不可用态:非己方出牌阶段,书格为静态陈列(无交互挂点),禁用原因进 title。
// 种植配方照 react-treasure-pick-fold 先例(quickStart → force 直写引擎),
// 断言走快照真值(书消耗/入槽/相位)+ testid 在场性,零语义放宽。
// #1217 波4 直通形制(ADR-0058):三例真实段=①书格真 button 点击→书消耗/池序入槽/
// skillLearned 事件随批的研读命令通路、②选人叠层点将拍板交互链、③非己方回合禁用
// 呈现;前置链种局化——开局停走 quickStart 直达首停靠(族种 1486),布场
// force 判词收口 plantBook(三例同布场)。
// #1221 L1 残油包:三例改 quickStart({advance:"preRoll"})——布场(plantBook 全量
// 重钉相位/座位/挂起载荷)不依赖行军日志/已推进回合,落都即冻结,显式 freezeClock
// 随通路退役。
import { test, expect } from "./fixtures";
import { force, quickStart, snap } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 布场:己方(座位 0)出牌阶段卡牌段 + 麾下 heroes(池序 skillIds)+ 珍宝位塞一本书。
 *  挂起载荷全清(quickStart 停靠点可能是购地决策等,不清会与强制相位失配)+ 开局手牌
 *  清空:书=窗内可用项唯一来源,判据不被开局锦囊牌路污染。
 *  force 判词(#1217 波4 审计):布场四件套无公共命令可达——麾下无授将命令(招贤
 *  候选由落招贤城触发)、珍宝无授宝命令(技能书只随事件入手)、出牌阶段态与挂起
 *  载荷由引擎内部流转钉不住;断言面需「书在位+麾下池序」形态,直写后走控制器 sync。 */
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

  // 真实段(波4 #1217):珍宝弹层书格真 button 点击 → 书消耗 + 池序入槽 +
  // skillLearned 事件随批的研读命令通路全真(resolveBookSkill 走命令流)。
  test("书可点态(1 名可学):点书研读——书消耗、池序入槽、skillLearned 随批", async ({ page }) => {
    // #1221 L1:preRoll 落都即冻结,显式 freezeClock 退役(plantBook 全量重钉相位/座位)
    await quickStart(page, 1486, { advance: "preRoll" });
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

  // 真实段(波4 #1217):两名可学 → 选人叠层(PileShell 制式)点将拍板的交互链与
  // 学技落账(书消耗/指定将池序入槽/层随结算收口)全真。
  test("多名可学弹窗:两名池含此技未习得 → 选人叠层点将拍板", async ({ page }) => {
    // #1221 L1:preRoll 落都即冻结,显式 freezeClock 退役(同上例)
    await quickStart(page, 1486, { advance: "preRoll" });
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

  // 「不可用态」例已删(2026-11-08 唯一守环审计 v2):非出牌阶段命令拒绝单测在
  // test/skill-book.test.ts「非出牌阶段:引擎拒绝」;「书格无挂点」的禁用呈现映射
  // 与 rack 唯反应灰置例同构(aria/disabled 呈现通路已有通用守卫),单条否定断言
  // 不值一整个浏览器会话,删。
});

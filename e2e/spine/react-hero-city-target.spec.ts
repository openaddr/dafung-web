// 地板名册(ADR-0062):脊柱补例×2(#1388 T2 城目标段选城回路钉)。
// 判层自查:候选点亮(氛围层 crown 呼吸+Tile data 标记)与选中实金停持环是真渲染
// 视觉态(层④禁像素/演出泵/几何,无真值);选火攻→点亮→点选/改选→动作条「出」
// →事件/战报→冷却灰置是「点击→命令→UI 更新」的完整回路(新交互首例,脊柱补例
// 惯例),永留浏览器。布景=种植件(placePlayer/armHero/grantProperty,判词单源
// src/core/planter.ts:摆位/授将/授城无公共命令通路),断言链操作段全真,前置种植
// 只造「射程(双向 ≤5)内两座他人 Lv1 城」;候选合法性单源引擎(choices 城选项),
// UI 只装配,本 spec 不自算谓词(断言读 data 标记与引擎账,不镜像射程算式)。
// 截图 4 张随跑落 tmp/ui-shots/1388/(844×390 移动横屏标准档,主线亲审)。
import { test, expect } from "../fixtures";
import { quickStart, engineState, waitFxIdle, waitSettled } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 布景:开局出牌窗(seed 67×关中,#1317 同款稳定停靠)→ 周瑜单持火攻 → 摆位格 0
 *  → 前向 1..5 窗内授两座非都城给 bot 1(等级 1,火攻目标门:他人+Lv>0+射程内;
 *  都城排除只是布景避讳——都城在域内合法,可降不可失)。候选不足=响亮炸(重钉)。 */
async function seedFireTarget(
  page: Page,
): Promise<{ a: number; b: number; pa: string; pb: string }> {
  await page.setViewportSize({ width: 844, height: 390 }); // 移动横屏标准档(截图同档)
  await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true });
  await plant(page, { kind: "armHero", seat: 0, heroId: "zhouyu", skillIds: ["huogong"] });
  await plant(page, { kind: "placePlayer", seat: 0, position: 0 });
  const picks: Array<{ tileIndex: number; propertyId: string }> = await engineState(
    page,
    `(() => {
      const capitals = new Set(e.players.map((p) => p.capitalIndex));
      const out = [];
      for (let k = 1; k <= 5 && out.length < 2; k++) {
        const t = e.board.at(k);
        if (t.propertyId && !capitals.has(t.index) && !e.findOwner(t.propertyId))
          out.push({ tileIndex: t.index, propertyId: t.propertyId });
      }
      if (out.length < 2) throw new Error("种植失败:射程窗内不足两座可授城(seed/图漂移,重钉)");
      return out;
    })()`,
  );
  for (const p of picks)
    await plant(page, { kind: "grantProperty", seat: 1, propertyId: p.propertyId, level: 1 });
  return {
    a: picks[0]!.tileIndex,
    b: picks[1]!.tileIndex,
    pa: picks[0]!.propertyId,
    pb: picks[1]!.propertyId,
  };
}

test.describe("主动技目标段选城(#1388 T2 城目标段形制)", () => {
  // 全链正路:点亮断言→#417 三态(首点选中/再点取消/点他城改选)→「出」提交→
  // heroSkillActivated 判别联合体断言(城目标域必带目标城,无 targetSeat)→战报
  // (施展/heroFire 明细)→防御值落账→冷却灰置(回出牌窗,不另种相位:出技后
  // 手牌尚有可用牌,turnPhase 留 AwaitingJinnang,窗自然回到卡牌段)。
  test("选火攻→候选点亮→点选/改选→出→事件锚城+战报→冷却灰置", async ({ page }) => {
    const { a, b, pb } = await seedFireTarget(page);
    const skillCard = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:huogong"));
    await expect(skillCard).toBeEnabled();
    await skillCard.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 候选点亮:恰好两候选带 data-city-target(金环呼吸在氛围层 crown,标记即契约)
    await expect(page.locator(TESTIDS.skillCityTarget(a))).toBeVisible();
    await expect(page.locator(TESTIDS.skillCityTarget(b))).toBeVisible();
    await expect(page.locator(TESTIDS.skillCityTargetAny)).toHaveCount(2);
    await page.screenshot({ path: "tmp/ui-shots/1388/candidates-lit.png" });
    // 首点选中(实金停持环+动作条「出」点亮)→ 再点同格取消(回禁用)→ 再点回选
    await page.locator(TESTIDS.skillCityTarget(a)).click();
    await expect(page.locator(TESTIDS.skillCityTargetPicked(a))).toBeVisible();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeEnabled();
    await page.locator(TESTIDS.skillCityTarget(a)).click();
    await expect(page.locator(TESTIDS.skillCityTargetPickedAny)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeDisabled();
    await page.locator(TESTIDS.skillCityTarget(a)).click();
    // 点他城改选:选中环 A 落 B 起,全场恒至多一个选中
    await page.locator(TESTIDS.skillCityTarget(b)).click();
    await expect(page.locator(TESTIDS.skillCityTargetPicked(b))).toBeVisible();
    await expect(page.locator(TESTIDS.skillCityTargetPickedAny)).toHaveCount(1);
    await page.screenshot({ path: "tmp/ui-shots/1388/picked.png" });
    // 动作条「出」提交(城目标域提交通道=targets=[tileIndex],引擎复验单源选项集)
    await page.getByTestId(TESTIDS.actionbarTarget).click();
    // heroSkillActivated 事件断言(出技后手牌尚有可用牌,批停在场无后续转移)
    await expect
      .poll(
        async () =>
          (
            await engineState(
              page,
              `e.snapshot().events.filter((v) => v.kind === "heroSkillActivated")`,
            )
          ).length,
        { timeout: 15_000 },
      )
      .toBe(1);
    const fired: Array<Record<string, unknown>> = await engineState(
      page,
      `e.snapshot().events.filter((v) => v.kind === "heroSkillActivated")`,
    );
    expect(fired[0]).toMatchObject({
      heroId: "zhouyu",
      skillId: "huogong",
      skillKind: "fireBlast",
      targetPropertyId: pb,
      targetTileIndex: b,
    });
    expect("targetSeat" in fired[0]).toBe(false); // 城目标域不带座位字段
    // 战报与账:施展宣告 + heroFire 明细(prop/tile/defense);防御值 4→3(1 点火焰)
    const logText: string = await engineState(
      page,
      `e.log.map((l) => l.brief + "|" + (l.detail ?? "")).join("\\n")`,
    );
    expect(logText).toContain("施展主动技【火攻】");
    expect(logText).toContain("heroFire");
    expect(logText).toContain(`prop=${pb} tile=${b}`);
    expect(logText).toContain("defense=3");
    const account = await engineState(
      page,
      `(() => {
        const victim = e.findOwner("${pb}");
        const h = victim.properties.find((x) => x.propertyId === "${pb}");
        return {
          defense: h.defense,
          lastFired: e.players[0].heroes[0].lastFired["huogong"] ?? null,
          round: e.round,
        };
      })()`,
    );
    expect(account.defense).toBe(3);
    expect(account.lastFired).toBe(account.round); // 冷却入槽(#785)
    // 战报抽屉亲见(截图证据)
    await waitFxIdle(page);
    await page.getByTestId(TESTIDS.settingsButton).click();
    await page.getByTestId(TESTIDS.settingsWarReport).click();
    await expect(page.getByTestId(TESTIDS.logDrawer)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.logDrawer)).toContainText("施展主动技【火攻】");
    await page.screenshot({ path: "tmp/ui-shots/1388/war-report.png" });
    await page.keyboard.press("Escape");
    // 冷却灰置:窗回卡牌段,技能卡原生 disabled(技卡灰置形,HandRack 技卡钮)+ 原因印条
    await waitSettled(page);
    await expect(skillCard).toBeDisabled();
    await expect(skillCard.locator(".reason")).toContainText("冷却中");
    await page.screenshot({ path: "tmp/ui-shots/1388/cooldown-greyed.png" });
  });

  // 作罢路径(#417 同一口径):目标段「作罢」=不记冷却退回出牌窗——技能卡仍可用、
  // 无火攻事件/无 heroFire 战报、冷却账空;对局日志留「作罢【火攻】」行。
  test("作罢路径:退回出牌窗,不记冷却、无火攻战报", async ({ page }) => {
    const { a } = await seedFireTarget(page);
    const skillCard = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:huogong"));
    await expect(skillCard).toBeEnabled();
    await skillCard.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.locator(TESTIDS.skillCityTarget(a))).toBeVisible();
    await page.locator(TESTIDS.skillCityTarget(a)).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeEnabled();
    await page.getByTestId(TESTIDS.actionbarCancel).click(); // 作罢
    // 回卡牌段:目标段标记全撤,技能卡仍可用(不记冷却)
    await expect(page.getByTestId(TESTIDS.actionbarPlay)).toBeVisible();
    await expect(page.locator(TESTIDS.skillCityTargetAny)).toHaveCount(0);
    await expect(skillCard).toBeEnabled();
    const state = await engineState(
      page,
      `(() => ({
        fired: e.players[0].heroes[0].lastFired["huogong"] ?? null,
        fireEvents: e.snapshot().events.filter((v) => v.kind === "heroSkillActivated").length,
        logText: e.log.map((l) => l.brief + "|" + (l.detail ?? "")).join("\\n"),
      }))()`,
    );
    expect(state.fired).toBe(null);
    expect(state.fireEvents).toBe(0);
    expect(state.logText).not.toContain("heroFire");
    expect(state.logText).toContain("作罢【火攻】");
  });
});

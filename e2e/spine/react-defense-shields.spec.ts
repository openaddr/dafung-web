// 地板名册(ADR-0062):脊柱补例×3(#1391 T5 防御盾排)。
// 判层自查:盾排是真渲染视觉态(格底行 SVG 盾件,层④禁像素/演出泵/几何,无真值);
// 火攻全链(选技→点亮→定靶→出→盾排实时减)是「点击→命令→UI 更新」完整回路
// (T2 同款新交互补例惯例,永留浏览器)。布景=种植件(grantProperty/setDefense/
// placePlayer/armHero,判词单源 src/core/planter.ts:授城/种受损态/摆位无公共命令
// 通路);满排断言读 data-shield 计数与引擎账,不自算满值表(单源 core/defense.ts,
// 镜像即假覆盖)。
// 截图 4 张随跑落 tmp/ui-shots/1391/(844×390 移动横屏标准档,主线亲审):
// 满排四档 / 受损+打空都城 / 详情防御值行 / 火攻后实时减盾。
import { test, expect } from "../fixtures";
import { quickStart, engineState, waitSettled } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../../src/app/screens/game/scroll/testids";
import type { Page } from "@playwright/test";

/** 布景(盾排呈现/受损两案共用):开局出牌窗(seed 67×关中,T2 同款稳定停靠)→
 *  全图扫非都城无主城,首四格授 bot 座位 1(等级 0..3=满值 5/4/3/2,grantProperty
 *  入册即满值),第五格留无主当零盾排见证。候选不足=响亮炸(重钉)。 */
async function seedShields(
  page: Page,
): Promise<{ tiles: number[]; props: string[]; witness: number }> {
  await page.setViewportSize({ width: 844, height: 390 }); // 移动横屏标准档(截图同档)
  await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true });
  const picks: Array<{ tileIndex: number; propertyId: string }> = await engineState(
    page,
    `(() => {
      const capitals = new Set(e.players.map((p) => p.capitalIndex));
      const out = [];
      for (let k = 0; k < e.board.count && out.length < 5; k++) {
        const t = e.board.at(k);
        if (t.propertyId && !capitals.has(t.index) && !e.findOwner(t.propertyId))
          out.push({ tileIndex: t.index, propertyId: t.propertyId });
      }
      if (out.length < 5) throw new Error("种植失败:非都城无主城不足五格(seed/图漂移,重钉)");
      return out;
    })()`,
  );
  for (let i = 0; i < 4; i++)
    await plant(page, {
      kind: "grantProperty",
      seat: 1,
      propertyId: picks[i]!.propertyId,
      level: i,
    });
  return {
    tiles: picks.slice(0, 4).map((p) => p.tileIndex),
    props: picks.slice(0, 4).map((p) => p.propertyId),
    witness: picks[4]!.tileIndex,
  };
}

test.describe("防御盾排(#1391 T5 城池格常显形制)", () => {
  // 满排四档:授城即满值(grantProperty 入册 resetToFull 同口径)——盾数=满值表
  // 5/4/3/2(等级 0..3),无主城整排不渲染;另验人类都城(Lv0 建都满防)同显 5 盾
  // (有主即显,不分人/bot)。
  test("满排呈现:四档满值盾数正确,无主城零盾排", async ({ page }) => {
    const { tiles, witness } = await seedShields(page);
    const fulls = [5, 4, 3, 2];
    for (let i = 0; i < tiles.length; i++)
      await expect(page.locator(TESTIDS.cityShield(tiles[i]!))).toHaveCount(fulls[i]!);
    // 无主城:排与盾件全无(免疫,无防御语义)
    await expect(page.locator(TESTIDS.cityShieldRow(witness))).toHaveCount(0);
    await expect(page.locator(TESTIDS.cityShield(witness))).toHaveCount(0);
    // 人类都城(Lv0 建都满防):同为满排 5 盾
    const myCapital: number = await engineState(
      page,
      `e.board.at(e.players[0].capitalIndex).index`,
    );
    await expect(page.locator(TESTIDS.cityShield(myCapital))).toHaveCount(5);
    await waitSettled(page);
    await page.screenshot({ path: "tmp/ui-shots/1391/full-rows.png" });
  });

  // 受损减盾:中间值=缩短排列;打空都城(absorbed 态)=排在盾零;详情弹层同步显
  // 「防御 当前/满值」。(0 级非都城打空不可种=引擎失城通路,不在布景域。)
  test("受损减盾+打空都城:盾数随账面缩短,详情显当前/满值", async ({ page }) => {
    const { tiles, props } = await seedShields(page);
    const hurt = tiles[1]!; // Lv1 满防 4 → 种中间值 2(缩短排列)
    await plant(page, { kind: "setDefense", seat: 1, propertyId: props[1]!, defense: 2 });
    await expect(page.locator(TESTIDS.cityShield(hurt))).toHaveCount(2);
    // 打空都城:座位 1 都城 Lv0 满防 5 → 种 0(absorbed 态,排标记在、盾件为零)
    const capitalTile: number = await engineState(page, `e.players[1].capitalIndex`);
    const capitalProp: string = await engineState(
      page,
      `e.board.at(e.players[1].capitalIndex).propertyId`,
    );
    await plant(page, { kind: "setDefense", seat: 1, propertyId: capitalProp, defense: 0 });
    await expect(page.locator(TESTIDS.cityShield(capitalTile))).toHaveCount(0);
    await expect(page.locator(TESTIDS.cityShieldRow(capitalTile))).toHaveCount(1);
    await waitSettled(page);
    await page.screenshot({ path: "tmp/ui-shots/1391/damaged-and-drained.png" });
    // 详情弹层:受损城防御值行「当前/满值」(满值表单源引擎,断言读值不镜像)
    await page.locator(`[data-tile="${hurt}"]`).click();
    const detail = page.getByTestId(SCROLL_TESTIDS.tileDetailScroll);
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId(SCROLL_TESTIDS.tileDetailDefense)).toHaveText("2/4");
    await page.screenshot({ path: "tmp/ui-shots/1391/detail-defense.png" });
    await page.keyboard.press("Escape");
  });

  // 联动全链(T2 同款手法):火攻目标段出技→目标城盾排实时减(账面/盾排同拍);
  // 邻城不受波及(火攻单体)。选技→点亮→点选→「出」→盾排 4→3。
  test("火攻出技全链:目标城盾排实时减,邻城不动", async ({ page }) => {
    const { a, b } = await seedFire(page);
    const skillCard = page.getByTestId(TESTIDS.jinnangCard("skill:zhouyu:huogong"));
    await expect(skillCard).toBeEnabled();
    await skillCard.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    await expect(page.locator(TESTIDS.cityTarget(a))).toBeVisible();
    await page.locator(TESTIDS.cityTarget(a)).click();
    await expect(page.getByTestId(TESTIDS.actionbarTarget)).toBeEnabled();
    // 出技前基线:两城均满排 4 盾(Lv1)
    await expect(page.locator(TESTIDS.cityShield(a))).toHaveCount(4);
    await expect(page.locator(TESTIDS.cityShield(b))).toHaveCount(4);
    await page.getByTestId(TESTIDS.actionbarTarget).click();
    // 盾排实时减:heroFire 落账(防御 4→3)与格上盾数同拍收缩
    await expect
      .poll(
        async () =>
          await engineState(
            page,
            `(() => {
              const pid = e.board.at(${a}).propertyId;
              const victim = e.findOwner(pid);
              return victim.properties.find((x) => x.propertyId === pid).defense;
            })()`,
          ),
        { timeout: 15_000 },
      )
      .toBe(3);
    await expect(page.locator(TESTIDS.cityShield(a))).toHaveCount(3);
    await expect(page.locator(TESTIDS.cityShield(b))).toHaveCount(4); // 邻城不受波及
    await waitSettled(page);
    await page.screenshot({ path: "tmp/ui-shots/1391/after-fire.png" });
  });
});

/** 布景(联动案,T2 seedFireTarget 同款):开局出牌窗→周瑜单持火攻→摆位格 0→
 *  前向 1..5 窗内授两座非都城给 bot 1(等级 1,火攻目标门:他人+Lv>0+射程内)。 */
async function seedFire(page: Page): Promise<{ a: number; b: number }> {
  await page.setViewportSize({ width: 844, height: 390 });
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
  return { a: picks[0]!.tileIndex, b: picks[1]!.tileIndex };
}

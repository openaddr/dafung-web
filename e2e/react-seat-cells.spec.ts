// 席位格列(#698 席位条重形:96×38 双行八项格,仪表徽章行随席位卡退役)——
// ① 满编 8 席与 4 席局:行1 现金主数(无千分位裸数)+ 行2 六图标计数与投影逐席一致;
// ② 五状态挂点:活跃金圈呼吸(.active)/目标段候选呼吸(.candidate)与选中停持
//    (.picked)/濒耗竭色条朱砂(.low)/破产降透明印灰(.bankrupt)+ 自机金样式挂点
//    (seat-self .self,无「你」字);③ 旧席位卡形态退役核销(左右两列/顶行缩微/
//    属性两行格/「运筹中」微标/血条刻度零残留)。断言走 testid 单源 + 调试钩子
//    直写(react-layout/react-jinnang-use 同款通路),几何断言收进单次 evaluate。
import { test, expect } from "./fixtures";
import {
  quickStart,
  waitMyPause,
  waitSettled,
  openSoloSetup,
  pickCapital,
  force,
  freezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

/** 行1 现金 + 行2 六计数逐席与快照一致(单次 evaluate 原子采样:DOM 与快照同拍)。 */
function cellsMatchSnapshot(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const s = (window as any).__dafung.snapshot();
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
    return s.players.every(
      (p: any, seat: number) =>
        q(`seat-cash-${seat}`) === String(p.cash) &&
        q(`seat-attr-city-${seat}`) === String(p.properties.length) &&
        q(`seat-attr-hand-${seat}`) === String(p.jinnangHandCount) &&
        q(`seat-attr-hero-${seat}`) === String(p.heroes.length) &&
        q(`seat-attr-gem-${seat}`) === String(p.treasures.length) &&
        q(`seat-attr-rep-${seat}`) === String(p.reputation) &&
        q(`seat-attr-warrant-${seat}`) === String(p.warrants),
    );
  });
}

test.describe("席位格行2 计数与投影一致(#698 ①)", () => {
  test("4 席局:现金主数(裸数无千分位)+ 六图标计数逐席一致", async ({ page }) => {
    await quickStart(page);
    await expect.poll(() => cellsMatchSnapshot(page)).toBe(true);
    // 一人一格(自机入列):4 席局 = 4 张格,全部在单一 seatcol 内
    const cells = page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`);
    await expect(cells).toHaveCount(4);
    await expect(page.locator(`[data-testid=${TESTIDS.seatRail}] .seatcol .seat`)).toHaveCount(4);
  });

  test("满编 8 席(844×390 矮横屏):计数逐席一致,格高 38、列零滚动", async ({ page }) => {
    test.slow(); // 人类首回合前最多 7 个 bot 回合,预算放宽(react-layout 8 席例同口径)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    await waitSettled(page);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(真机即此重排路径)
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => cellsMatchSnapshot(page)).toBe(true);
    await expect(page.locator(`[data-testid=${TESTIDS.seatRail}] .seat`)).toHaveCount(8);
    // 零滚动几何:格高 clamp 到 38 上限,8×38+7×2=318 ≤ 可用高 328(390−8−54)
    const geo = await page.evaluate(() => {
      const col = document.querySelector(".seat-rail .seatcol")!;
      const cells = [...col.querySelectorAll<HTMLElement>(".seat")];
      const last = cells[cells.length - 1]!.getBoundingClientRect();
      return {
        cellH: cells[0]!.getBoundingClientRect().height,
        lastBottom: last.bottom,
        overflow: (col as HTMLElement).scrollHeight - (col as HTMLElement).clientHeight,
        colBottomLimit: document.documentElement.clientHeight - 54,
      };
    });
    expect(Math.abs(geo.cellH - 38)).toBeLessThanOrEqual(0.5);
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.colBottomLimit + 0.5);
    expect(geo.overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("席位格五状态与自机挂点(#698 ②)", () => {
  test("活跃金圈呼吸/濒耗竭朱砂条/破产印灰挂点,自机=金样式无文字章", async ({ page }) => {
    await quickStart(page);
    // 冻结房间时钟再动刀(#421:直写状态类断言不与自动起摇/bot 链赛跑;快照类
    // 挂点断言钉 CSS 契约,react-layout 活跃例同款,此处加冻结消 activeIndex 漂移)
    await freezeClock(page);
    // 活跃:调试钩子先把行动方钉到 bot 席(quickStart 停靠点随骰子落在「自机落格
    // 抉择卷轴」或 bot 等待,自机可能真在活跃——钉死行动方,挂点断言才有钉住的
    // 前提;时钟已冻,无自动推进)→ 该格 .active
    await force(page, `e.activeIndex = 1;`);
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/active/);
    // 自机格:seat-self 挂点 + .self 类;活跃已钉在 bot 席 → 自机格无 .active/.picked;
    // seat-N 族不含自机(对手席专用族不变)
    const selfCell = page.getByTestId(TESTIDS.seatSelf);
    await expect(selfCell).toBeVisible();
    await expect(selfCell).toHaveClass(/self/);
    await expect(selfCell).not.toHaveClass(/active/);
    await expect(selfCell).not.toHaveClass(/picked/);
    await expect(page.getByTestId(TESTIDS.seat(0))).toHaveCount(0);
    // 濒耗竭:体力压到 20(<三成)→ 色条挂 .low(转朱砂)
    await force(page, `e.addStamina(1, -80);`);
    await expect(page.getByTestId(TESTIDS.seatStamina(1)).locator(".strack")).toHaveClass(/low/);
    // 破产:直写 isBankrupt → 整格降透明印灰挂点
    await force(page, `e.players[2].isBankrupt = true;`);
    await expect(page.getByTestId(TESTIDS.seat(2))).toHaveClass(/bankrupt/);
  });

  test("目标段:候选格金圈呼吸(.candidate),点选实金停持(.picked)再点取消", async ({ page }) => {
    // seed63 环游图开局链停在出牌阶段态(react-jinnang-use startJunshi 同款通路,
    // 链路内联本 spec:helpers 帮手非本票所有物;seed 63 起手横征暴敛恒可用,窗必升)。
    // 军情密探目标段同款:给 seat1 挂珍宝凑目标门槛,直写替换手牌。
    await page.goto("/?seed=63");
    await page.getByTestId(HOME_TID.selectMap).click();
    await page.getByTestId(SETUP_TID.mapItem("huanyou")).click();
    await page.getByTestId(SETUP_TID.mapConfirm).click();
    await openSoloSetup(page);
    await page.getByTestId(SETUP_TID.startGame).click();
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId(TESTIDS.confirmCapitalOk).click();
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    await freezeClock(page);
    await force(
      page,
      `
      e.players[1].treasures = [{ id: "gem-1", name: "夜明珠", level: 5 }];
      e.players[0].jinnangHand = ["军情密探"];
    `,
    );
    const opt = page.getByTestId(TESTIDS.jinnangCard("军情密探"));
    await expect(opt).toBeVisible();
    await opt.click();
    await page.getByTestId(TESTIDS.actionbarPlay).click();
    // 目标段:候选格金圈呼吸挂点
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/candidate/);
    // 点格=选中(.picked 实金停持),再点同格=取消(#417 统一口径)
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).toHaveClass(/picked/);
    await page.getByTestId(TESTIDS.seatTarget(1)).click();
    await expect(page.getByTestId(TESTIDS.seat(1))).not.toHaveClass(/picked/);
  });
});

test.describe("旧席位卡形态退役核销(#698 ③)", () => {
  test("左右两列/顶行缩微/属性两行格/「运筹中」微标/血条刻度零残留", async ({ page }) => {
    await quickStart(page);
    const rail = page.locator(`[data-testid=${TESTIDS.seatRail}]`);
    // 旧三槽位制退役:单列格列,无左列、无顶行缩微
    await expect(rail.locator(".seatcol")).toHaveCount(1);
    await expect(page.locator(".seatcol.left")).toHaveCount(0);
    await expect(page.locator(".seatrow-top")).toHaveCount(0);
    // 旧卡件退役:属性两行格(vgrid)/「运筹中」微标(think)/带刻度血条(hpbar)
    await expect(rail.locator(".vgrid")).toHaveCount(0);
    await expect(rail.locator(".think")).toHaveCount(0);
    await expect(rail.locator(".hpbar")).toHaveCount(0);
    await expect(rail.getByText("运筹中")).toHaveCount(0);
    // 格上无「你」字章(自机=纯视觉金样式,§4.6)
    await expect(rail.getByText("你")).toHaveCount(0);
  });
});

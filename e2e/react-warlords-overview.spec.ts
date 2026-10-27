// 诸侯总览弹窗(#702,spec #697 ⑥):①行数据与投影逐字一致(城池名/名将名直读,
// 种植式断言,react-city-ledger 同口径);②城池列点击开对应诸侯 #622 名下城池清单
// (单层互斥:总览先关清单再开);③状态挂点(自机行 .self 金描边/破产行 .dead 灰化/
// 活跃方 .is-active 印金圈);④打开不暂停(冻时钟外对局推进留痕,弹层恒开);
// ⑤满编 8 行 @844×390 零滚动零截断。
// 停靠纪律(react-seat-pop 同款):quickStart 可能在行军演出在播时归还——清卷轴必须
// 「等 fx 排空→再探→无动作」循环收敛,冻结后再补一刀;钉 seed 49(实测停靠干净,
// react-seat-pop 同款确定性)。总览行无浮签触发元(title 静态浮签除外),无 #704
// 残影风险;关闭走 Esc/点外/X 三路(ui/dialog 底件白拿)。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  openSoloSetup,
  pickCapital,
  waitMyPause,
  waitMyRollDone,
  snap,
  actIfCan,
  waitFxIdle,
  force,
  freezeClock,
  unfreezeClock,
  waitForSnapChanged,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

// 本 spec 各例都是「整局 boot + 种植 + 弹层链」重例(react-seat-pop 同因):60s 缺省
// 超时装不下,显式放宽——放宽语句必须落在测试体首行(文件顶层调用不生效)。

/** 清决策卷轴到「演出排空且无可用动作」(react-seat-pop settleForTap 同法)。 */
async function settleForOverview(page: Page) {
  for (let i = 0; i < 10; i++) {
    await waitFxIdle(page);
    if (!(await actIfCan(page))) break;
  }
  await waitFxIdle(page);
}

/** 冻结停靠:清卷轴→冻结→补一刀(挡不住的挂载窗口在此排空)。 */
async function freezeForOverview(page: Page) {
  await settleForOverview(page);
  await freezeClock(page);
  await settleForOverview(page);
}

/** 开总览弹层(触发钮真点击;按钮在顶栏 z-6,无遮挡)。 */
async function openOverview(page: Page) {
  await page.getByTestId(TESTIDS.topbarOverview).click();
  const modal = page.getByTestId(TESTIDS.warlordsOverview);
  await expect(modal).toBeVisible();
  return modal;
}

/** 种植对手席(座位 1)名录载荷:三座无主城 + 一名将 + 两珍宝(真身份,react-seat-pop
 *  同规——陈列按 id 回查目录,假 id 当场炸)。返回逐字期望值(读自引擎 board/hero)。 */
async function plantSeat1Roster(page: Page) {
  await force(
    page,
    `
    const p1 = e.players[1];
    const owned = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
    const free = e.board.tiles.filter((t) => t.propertyId && !owned.has(t.propertyId));
    if (free.length < 3) throw new Error("种植失败:无主城不足 3 座(地图/开局变了)");
    p1.plantedIds = free.slice(0, 3).map((t) => t.propertyId);
    for (const t of free.slice(0, 3)) {
      p1.properties.push({ propertyId: t.propertyId, level: 0, group: t.group ?? "a", maxLevel: 3 });
    }
    const def = window.__dafung.heroDefs()[0];
    p1.heroes = [{ id: def.id, name: def.name, title: def.title, image: def.image }];
    const deck = window.__dafung.snapshot().treasureDeck;
    p1.treasures = deck.slice(0, 2).map((r) => ({ id: r.id, name: r.name, level: r.level }));
  `,
  );
  return page.evaluate(() => {
    const e = (window as any).__dafung.getEngine();
    const p1 = e.players[1];
    // 城池名逐字期望:按棋盘 index 序(行军顺序,与 #622 清单行序/总览 chips 同源)
    const names = p1.properties
      .map((h: any) => {
        const i = e.board.tiles.findIndex((t: any) => t.propertyId === h.propertyId);
        return { name: e.board.tiles[i].name, i };
      })
      .sort((a: any, b: any) => a.i - b.i)
      .map((r: any) => r.name);
    return {
      guohao: p1.guohao as string,
      names: names as string[],
      plantedIds: p1.plantedIds as string[],
      hero: p1.heroes[0].name as string,
    };
  });
}

test.describe("总览行数据与投影一致(#702 ①)", () => {
  test("十列数值逐字对照;城池/名将名录直读,超 3 折叠 +N,空槽画空格", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForOverview(page);
    try {
      const planted = await plantSeat1Roster(page);
      const s = await snap(page);
      const modal = await openOverview(page);

      // 行集 = 座位集,座序即行序
      for (let seat = 0; seat < s.players.length; seat++) {
        const row = page.getByTestId(TESTIDS.warlordsRow(seat));
        await expect(row).toBeVisible();
        await expect(page.getByTestId(TESTIDS.warlordsCash(seat))).toHaveText(
          String(s.players[seat].cash),
        );
        await expect(page.getByTestId(TESTIDS.warlordsStamina(seat))).toHaveText(
          String(s.players[seat].stamina),
        );
        await expect(page.getByTestId(TESTIDS.warlordsHand(seat))).toHaveText(
          String(s.players[seat].jinnangHandCount),
        );
        await expect(page.getByTestId(TESTIDS.warlordsRep(seat))).toHaveText(
          String(s.players[seat].reputation),
        );
        await expect(page.getByTestId(TESTIDS.warlordsWarrant(seat))).toHaveText(
          String(s.players[seat].warrants),
        );
      }

      // 空槽画空格:自机麾下 0 将 = 三空槽(HERO_CAPACITY 制式)
      await expect(page.getByTestId(TESTIDS.warlordsHeroes(0))).toHaveText("···");

      // 种植席:名将名逐字(朱砂 chips)+ 两空槽;珍宝计数槽 3 槽 2 满
      const heroes1 = page.getByTestId(TESTIDS.warlordsHeroes(1));
      await expect(heroes1.locator(".zl-hnslot:not(.zl-empty)")).toHaveText([planted.hero]);
      await expect(heroes1.locator(".zl-hnslot.zl-empty")).toHaveCount(2);
      const gems1 = page.getByTestId(TESTIDS.warlordsGems(1));
      await expect(gems1.locator(".zl-slot")).toHaveCount(3);
      await expect(gems1.locator(".zl-slot.zl-full")).toHaveCount(2);

      // 城池名录直读:capital+3 种植 = 4 城 → 前 3 chips 逐字(棋盘 index 序)+ 折叠「+1」
      const cities1 = page.getByTestId(TESTIDS.warlordsCities(1));
      await expect(cities1.locator(".zl-cityslot:not(.zl-more)")).toHaveText(
        planted.names.slice(0, 3),
      );
      await expect(cities1.locator(".zl-cityslot.zl-more")).toHaveText(
        `+${planted.names.length - 3}`,
      );

      // 题名行:轮次与快照一致
      await expect(modal.locator(".zl-round")).toHaveText(`${s.round} 轮`);

      // Esc 关闭(挂载不夺焦,Esc 直关由底件白拿)
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("城池列点击开对应诸侯清单(#702 ②)", () => {
  test("总览先关、#622 清单开到对应诸侯(国号题名+种植行),X 收清单", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForOverview(page);
    try {
      const planted = await plantSeat1Roster(page);
      await openOverview(page);

      await page.getByTestId(TESTIDS.warlordsCities(1)).click();
      // 单层互斥:总览先关,清单开到对应诸侯(react-seat-pop 城池徽章钻入同法)
      await expect(page.getByTestId(TESTIDS.warlordsOverview)).toHaveCount(0);
      const ledger = page.getByTestId(TESTIDS.cityLedger);
      await expect(ledger).toBeVisible();
      await expect(ledger.getByText(`${planted.guohao}名下城池`)).toBeVisible();
      for (const id of planted.plantedIds) {
        await expect(page.getByTestId(TESTIDS.cityLedgerRow(id))).toBeVisible();
      }
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(ledger).toHaveCount(0);
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("状态挂点(#702 ③)", () => {
  test("自机行 .self 金描边;破产行 .dead 灰化;活跃方 .is-active 印金圈", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForOverview(page);
    try {
      // 种植破产(对手席;照排灰化=行仍在,非性质抹除)
      await force(page, `e.players[1].isBankrupt = true;`);
      const s = await snap(page);
      await openOverview(page);
      await expect(page.getByTestId(TESTIDS.warlordsRow(0))).toHaveClass(/self/);
      await expect(page.getByTestId(TESTIDS.warlordsRow(1))).toHaveClass(/dead/);
      // 活跃方印金圈:Playing 相位下 activeIndex 行挂 .is-active(样式走 .zl-seal 后代)
      expect(s.phase).toBe("Playing");
      await expect(page.getByTestId(TESTIDS.warlordsRow(s.activeIndex))).toHaveClass(/is-active/);
      // 破产行照排:数值列仍逐字可读(灰化不藏数)
      await expect(page.getByTestId(TESTIDS.warlordsCash(1))).toHaveText(String(s.players[1].cash));
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("打开不暂停(#702 ④)", () => {
  test("冻时钟外弹层开着对局照走(快照推进留痕),弹层恒开", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    // 清掉人类当前一手,让 bot 接棒(否则停在我方决策点,快照不动是对局在等人,
    // 不是弹层暂停);清完立即开层读基线。
    for (let i = 0; i < 10 && (await actIfCan(page)); i++);
    await waitMyRollDone(page, 0);
    const modal = page.getByTestId(TESTIDS.warlordsOverview);
    // 三次尝试窗口:读基线恰逢轮次交接到人类停摆时,收层清一手换停靠点再来
    let advanced = false;
    for (let attempt = 0; attempt < 3 && !advanced; attempt++) {
      await page.getByTestId(TESTIDS.topbarOverview).click({ timeout: 5_000 });
      await expect(modal).toBeVisible();
      const before = JSON.stringify(await snap(page));
      try {
        await waitForSnapChanged(page, before, 9_000);
        advanced = true;
      } catch {
        await page.keyboard.press("Escape");
        await expect(modal).toHaveCount(0);
        for (let i = 0; i < 6 && (await actIfCan(page)); i++);
        await waitMyRollDone(page, 0);
      }
    }
    expect(advanced).toBe(true);
    // 推进留痕成立时弹层仍开(全窗口无 clockPause,bot 行动即「未暂停」的人证)
    await expect(modal).toBeVisible();
  });
});

test.describe("满编 8 行零滚动零截断(#702 ⑤)", () => {
  test("8 席 @844×390:8 行全见,容器无滚动,末行下缘不出窗", async ({ page }) => {
    test.setTimeout(240_000); // 8 人选都链路更重(react-seat-cells 满编例同因)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId("setup-seat-count-plus").click(); // 4 → 8
    await page.getByTestId("start-game").click();
    await pickCapital(page);
    await waitMyPause(page, 0, 150_000);
    // 配置与开局在桌面视口完成,再切矮横屏验收目标形态(react-float-skeleton 同法)
    await page.setViewportSize({ width: 844, height: 390 });
    await settleForOverview(page);
    await freezeClock(page);
    try {
      await openOverview(page);
      const geo = await page.evaluate((containerId) => {
        const dlg = document.querySelector(`[data-testid="${containerId}"]`)!;
        const rows = [...dlg.querySelectorAll(".zl-row")];
        const box = dlg.getBoundingClientRect();
        const last = (rows[rows.length - 1] as HTMLElement).getBoundingClientRect();
        return {
          count: rows.length,
          overflow: (dlg as HTMLElement).scrollHeight - (dlg as HTMLElement).clientHeight,
          lastBottom: last.bottom,
          dlgBottom: box.bottom,
          dlgW: box.width,
          vw: document.documentElement.clientWidth,
        };
      }, TESTIDS.warlordsOverview);
      expect(geo.count).toBe(8);
      expect(geo.overflow).toBeLessThanOrEqual(0); // 容器零滚动
      expect(geo.lastBottom).toBeLessThanOrEqual(geo.dlgBottom + 0.5); // 末行不截断
      expect(geo.dlgW).toBeLessThanOrEqual(geo.vw); // 近全屏不出视口
    } finally {
      await unfreezeClock(page);
    }
  });
});

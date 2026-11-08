// 诸侯详情弹窗(#702,#732 正名,spec #697 ⑥):①行数据与投影逐字一致(城池名/名将名直读,
// 种植式断言,react-city-ledger 同口径);②四元素钻入(#1096 决议3,#1097):城池 chips→
// #622 清单/名将 chips→名录/珍宝槽→列表/声列→声望明细,钻入式单层互斥(总览先关
// 再开目标弹层);③状态挂点(自机行 .self 金描边/破产行 .dead 灰化/
// 活跃方 .is-active 印金圈);
// ⑥声列三档概率条与声望明细终态(#1096 决议4/5,#1099):行内条结构性断言(高声望
// 好运段占优/零声望三等分,宽度比断言勿钉像素)、明细条+三档百分比明文逐字(吃
// core tierShares 同源现算)+零冗余负向断言(不含『献计』『里程碑』)。
// ⑤满编 8 行 @844×390 零滚动零截断。(原④「打开不暂停」例已按 #987 零容忍删除
// 2026-11-05:一日四挂两绿两种签名——点击拦截层修通后快照推进层又挂,时序竞速族;
// 「弹层开着对局照走」是架构事实(引擎不知弹层),不可靠守卫按纪律删不留台账,#1042 有案。)
// 停靠纪律:quickStart 可能在行军演出在播时归还——清卷轴必须
// 「等 fx 排空→再探→无动作」循环收敛,冻结后再补一刀;钉 seed 1010(#949 关中重钓:
// 原 49 × huanyou 停靠随换图作废,1010 实测开局停在购地决策、无招贤岔路)。总览行无浮签触发元(title 静态浮签除外),无 #704
// 残影风险;关闭走 Esc/点外/X 三路(ui/dialog 底件白拿)。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  openSoloSetup,
  pickCapital,
  waitMyPause,
  snap,
  actIfCan,
  waitFxIdle,
  force,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";
import { plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { tierShares } from "../src/core/encounters";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

// 本 spec 各例都是「整局 boot + 种植 + 弹层链」重例:60s 缺省
// 超时装不下,显式放宽——放宽语句必须落在测试体首行(文件顶层调用不生效)。

/** 清决策卷轴到「演出排空且无可用动作」(等 fx 排空→再探→无动作循环收敛)。 */
async function settleForOverview(page: Page) {
  for (let i = 0; i < 10; i++) {
    await waitFxIdle(page, 45_000);
    if (!(await actIfCan(page))) break;
  }
  await waitFxIdle(page, 45_000);
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

/** 声列概率条三段布局宽(#1099 结构断言原料;勿钉像素,断言一律吃宽度比)。 */
function repBarWidths(page: Page, testid: string) {
  return page
    .getByTestId(testid)
    .locator(".rep-prob-bar > i")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).getBoundingClientRect().width));
}

/** 种植对手席(座位 1)名录载荷:三座无主城 + 一名将 + 两珍宝 + 高声望 +210(#1099
 *  概率条好运段占优断言的种植面;真身份,陈列按 id 回查目录,假 id 当场炸)。
 *  返回逐字期望值(读自引擎 board/hero)。
 *  数值族种植(#1299,判词单源 src/core/planter.ts):高声望 +210/自机钉零=
 *  setReputation(概率条断言面需 softmax 极端形态,薄包 addReputation 唯一写口,
 *  ReputationChanged 时机随公共口广播、战报零染);2 珍宝=giveTreasure(终态替换,
 *  牌堆实例摘 {id,name,level} 与旧写同形)。
 *  force 判词:3 座无主城入册/1 将=引擎按购地/机遇效果通路发放、落点与时机不可控,
 *  无「授指定城/将」公共命令(名将槽位行经快照 restoreFromSnapshot 回灌,联机恢复
 *  同一条产线路径 #785);冻结(freezeClock)是到达手段非字段直改。 */
async function plantSeat1Roster(page: Page) {
  await plant(page, { kind: "setReputation", seat: 1, reputation: 210 });
  await plant(page, { kind: "setReputation", seat: 0, reputation: 0 }); // 自机钉零:softmax 零点三段等宽断言的种植面
  const deck = (await snap(page)).treasureDeck as { id: string; name: string; level: number }[];
  await plant(page, {
    kind: "giveTreasure",
    seat: 1,
    treasures: deck.slice(0, 2).map((r) => ({ id: r.id, name: r.name, level: r.level })),
  });
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
    p1.heroes = [{ heroId: def.id, skillIds: [...def.skillPool], lastFired: {} }]; // 槽位行(#785)
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
    // 名将名:槽位行(#785)只携 heroId,名按目录回查(与 UI 同源)
    const def = (window as any).__dafung.heroDefs().find((d: any) => d.id === p1.heroes[0].heroId);
    return {
      guohao: p1.guohao as string,
      names: names as string[],
      plantedIds: p1.plantedIds as string[],
      hero: def.name as string,
    };
  });
}

test.describe("总览行数据与投影一致(#702 ①)", () => {
  // 真实段(ADR-0058):真实开局链(seed1010 停靠)+总览真实点开,行数据与投影逐字
  // 对照/空槽画空格/概率条宽度比/Esc 关闭即被测环(真身份陈列按 id 回查目录,假 id
  // 当场炸)。force 判词见 plantSeat1Roster 注(声望极端形态+城将宝无授给公共命令)。
  test("十列数值逐字对照;城池/名将名录直读,超 3 折叠 +N,空槽画空格", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 1010);
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

      // 声列三档概率条(#1099):宽度比结构断言,勿钉像素——种植席 +210 好运段
      // 结构性占优(softmax 单调,>半条);自机钉零声望,softmax 零点三段等宽。
      const w1 = await repBarWidths(page, TESTIDS.warlordsRepCell(1));
      expect(w1).toHaveLength(3);
      expect(w1[0] / w1.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);
      const w0 = await repBarWidths(page, TESTIDS.warlordsRepCell(0));
      expect(w0).toHaveLength(3);
      expect(Math.abs(w0[0] - w0[1])).toBeLessThan(0.5);
      expect(Math.abs(w0[1] - w0[2])).toBeLessThan(0.5);

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

test.describe("四元素钻入(#1096 决议3,#1097)", () => {
  // 真实段(ADR-0058):四元素钻入真实点击链(chips/槽/声列→目标弹层,总览先关再开
  // 的单层互斥真实切换)+明细逐字吃 tierShares 同源现算即被测环。force 判词见
  // plantSeat1Roster 注(钻入陈列的种植前提同源)。
  test("城池 chips→清单/名将 chips→名录/珍宝槽→列表/声列→明细;单层互斥", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 1010);
    await freezeForOverview(page);
    try {
      const planted = await plantSeat1Roster(page);
      const s = await snap(page);

      // 城池 chips → #622 清单(单层互斥:总览先关,清单开到对应诸侯)
      await openOverview(page);
      await page.getByTestId(TESTIDS.warlordsCities(1)).click();
      await expect(page.getByTestId(TESTIDS.warlordsOverview)).toHaveCount(0);
      const ledger = page.getByTestId(TESTIDS.cityLedger);
      await expect(ledger).toBeVisible();
      await expect(ledger.getByText(`${planted.guohao}名下城池`)).toBeVisible();
      for (const id of planted.plantedIds) {
        await expect(page.getByTestId(TESTIDS.cityLedgerRow(id))).toBeVisible();
      }
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(ledger).toHaveCount(0);

      // 名将 chips → 名将名录(PileShell 名录,麾下 1 席,卡面出将名)
      await openOverview(page);
      await page.getByTestId(TESTIDS.warlordsHeroes(1)).click();
      await expect(page.getByTestId(TESTIDS.warlordsOverview)).toHaveCount(0);
      const heroModal = page.getByTestId(TESTIDS.seatHeroModal);
      await expect(heroModal).toBeVisible();
      await expect(heroModal.getByText("麾下名将 · 1 席")).toBeVisible();
      await expect(heroModal.getByText(planted.hero)).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(heroModal).toHaveCount(0);

      // 珍宝槽 → 珍宝列表(种植 2 件,陈列 2 卡)
      await openOverview(page);
      await page.getByTestId(TESTIDS.warlordsGems(1)).click();
      await expect(page.getByTestId(TESTIDS.warlordsOverview)).toHaveCount(0);
      const gemModal = page.getByTestId(TESTIDS.seatGemModal);
      await expect(gemModal).toBeVisible();
      await expect(gemModal.getByText("已持有 · 2 件")).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(gemModal).toHaveCount(0);

      // 声列 → 声望明细终态(#1099):大数+三段概率条+三档百分比明文(逐字吃
      // tierShares 同源现算,勿钉像素);零冗余负向断言:不含『献计』『里程碑』字样。
      await openOverview(page);
      await page.getByTestId(TESTIDS.warlordsRepCell(1)).click();
      await expect(page.getByTestId(TESTIDS.warlordsOverview)).toHaveCount(0);
      const repModal = page.getByTestId(TESTIDS.seatRepModal);
      await expect(repModal).toBeVisible();
      await expect(repModal.locator(".sdtl-bignum")).toHaveText(String(s.players[1].reputation));
      await expect(repModal.locator(".rep-prob-bar > i")).toHaveCount(3);
      const shares = tierShares(s.players[1].reputation);
      await expect(repModal.locator(".sdtl-tiers > span")).toHaveText([
        `好运 ${Math.round(shares.good)}%`,
        `中性 ${Math.round(shares.neutral)}%`,
        `霉运 ${Math.round(shares.bad)}%`,
      ]);
      await expect(repModal).not.toContainText("献计");
      await expect(repModal).not.toContainText("里程碑");
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(repModal).toHaveCount(0);
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("状态挂点(#702 ③)", () => {
  // 真实段(ADR-0058):总览真实点开后行状态挂点对引擎状态的 CSS 响应链(.self 金
  // 描边/.dead 灰化/.is-active 金圈)即被测环。force 判词:破产态开局不可达(破产
  // 清算引擎有专属通路但需整局推演到清算,无「即时破产」公共命令),断言面需破产行
  // 形态(直写 isBankrupt);.self/.is-active 是真实座位/活跃方的真渲染,零种植。
  test("自机行 .self 金描边;破产行 .dead 灰化;活跃方 .is-active 印金圈", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 1010);
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

test.describe("满编 8 行零滚动零截断(#702 ⑤)", () => {
  // 真实段(ADR-0058):真实 8 诸侯开局全链(准备页起兵→定都→对局自走停靠)+总览
  // 真实点开,8 行真渲染几何(零滚动/末行不截断/不出视口)即被测环——零 force
  // (冻结为到达手段,非字段直改)。
  test("8 席 @844×390:8 行全见,容器无滚动,末行下缘不出窗", async ({ page }) => {
    test.setTimeout(240_000); // 8 人选都链路更重(react-seat-cells 满编例同因)
    await page.goto("/");
    await openSoloSetup(page);
    for (let i = 4; i < 8; i++) await page.getByTestId(`${SETUP_TID.seatCount}-plus`).click(); // 4 → 8
    await page.getByTestId(SETUP_TID.startGame).click();
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

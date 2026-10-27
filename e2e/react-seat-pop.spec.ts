// 席位格交互(#701,spec #697 ④):①格 tap 单人格弹层——头/体力/声望委任/四徽章
// 内容与投影逐字一致,自机格带托管开关行、对手格无,Esc/点外关闭;②格上图标直达
// 五路各通(城楼→#622 清单、战盔→名将名录、玉璧→珍宝列表、墨竹→声望明细、卷轴→
// 委任明细),牌背=暗牌不可点;③弹层徽章可点/不可点视觉挂点(.click 金描边 vs 素底)
// 与徽章钻入;④托管开关接现役引擎通路(controller.autoPilotOn 回读)。
// 种植式断言(冻结→种植→点击→断言→恢复,react-city-ledger 同口径):字段期望值
// 读自引擎快照/单源函数,不落第二事实源;选择器一律 TESTIDS 单源。
// 停靠纪律(#701 实录):quickStart 可在行军演出在播时归还(waitSettled 只看引擎态)——
// 购地等决策卷轴在演出排空后才挂载,裸探一轮会漏,遮罩会吞格面 tap。清卷轴必须
// 「等 fx 排空→再探→无动作」循环收敛,冻结后再补一刀(卷轴挂载不吃时钟,冻结挡不住)。
// 另:掷骰/拼点全屏签面幕的收幕走房间时钟,#701 实录随机 seed 曾在「末次 fx 排空→
// freezeClock」微窗内起签,冻结把玄墨幕钉死在屏上(整屏压暗,后续断言全瞎)——
// 本 spec 钉 seed 49(实测停靠干净无演出在播,react-jinnang-use seed63 同款确定性)。
// 格面 tap 通路(列首格遮挡,#700 在途冲突):顶栏右端角钮带(z-5,.misc)压席位列
// 首格(z-4)——单机自机格恰在列首,tap 被缩小棋盘钮截胡(原型①「顶钮左移」未落地,
// 归 #700 GameTopBar 重形)。e2e 对列首格用 DOM 直派 click(照进真实 React onClick,
// answerReactionWindow 页面内直派同款);列二格起真点击,格面 tap 通路本身由其证实。
import { test, expect, type Page } from "./fixtures";
import {
  quickStart,
  snap,
  actIfCan,
  waitFxIdle,
  fmtMoney,
  force,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { guidePriceOf } from "../src/core/treasures";

// 本 spec 四例都是「整局 boot + 多弹层往返」重例(react-seat-cells 满编例 test.slow
// 同因):60s 缺省超时装不下 quickStart+两轮 settle+五路弹层链,显式放宽——放宽
// 语句必须落在测试体首行(文件顶层调用不生效,online-events/layout 前例同款)。

/** 清决策卷轴到「演出排空且无可用动作」:fx 排空后再探一轮,排空后才挂载的卷轴
 *  不漏(见文件头停靠纪律)。 */
async function settleForTap(page: Page) {
  for (let i = 0; i < 10; i++) {
    await waitFxIdle(page);
    if (!(await actIfCan(page))) break;
  }
  await waitFxIdle(page);
}

/** 格面 tap 开弹层:真点击打国号印(格上非按钮区——六个图标+体力条都是浮签触发元
 *  按钮,各自 claim 点击;印/现金区裸 span 才是格 tap 通路,也是真机最自然的落点)。
 *  first=列首格:顶栏角钮带遮挡(见文件头),DOM 直派 click 进真实 onClick 通路。 */
async function tapCell(page: Page, testid: string, first = false) {
  if (first) {
    await page.getByTestId(testid).dispatchEvent("click");
  } else {
    await page.getByTestId(testid).click({ position: { x: 11, y: 10 } });
  }
}

/** 冻结停靠(全 spec 共用前奏):清卷轴→冻结→补一刀(挡不住的挂载窗口在此排空)。 */
async function freezeForTap(page: Page) {
  await settleForTap(page);
  await freezeClock(page);
  await settleForTap(page);
}

/** 收残签(本票实测实录):浮签触发元点开弹层后,弹层存续期页面整体 inert——触发元
 *  的 pointerleave 被吞、焦点又因 initialFocus={false} 留在触发元上,弹层关后浮签面板
 *  残留在锚位,恰好盖住席位列相邻图标的命中点,下一个 click 被无限重试吃掉(真机首击
 *  同样会被吃,应用级待修票)。此处置:真实再悬停触发元再挪走,浏览器补发 leave,
 *  浮签随 open=false 摘除——五连链路逐步收签后才走得通。 */
async function settleTip(page: Page, testid: string) {
  await page.getByTestId(testid).hover();
  await page.mouse.move(640, 400);
}

test.describe("格 tap 单人格弹层(#701 ①)", () => {
  test("自机/对手内容与投影一致;托管行仅自机;Esc/点外关闭", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForTap(page);
    try {
      const s = await snap(page);

      // ── 自机格弹层:头/体力/声望委任/徽章与投影逐字一致 ──
      await tapCell(page, TESTIDS.seatSelf, true);
      const pop0 = page.getByTestId(TESTIDS.seatPop(0));
      await expect(pop0).toBeVisible();
      // 题名=国号(可达名同节点;印字符与题名同字,定位走 spop-nm 避双命中)
      await expect(pop0.locator(".spop-nm")).toHaveText(s.players[0].guohao);
      await expect(page.getByTestId(TESTIDS.seatPopCash(0))).toHaveText(
        `现金 ${fmtMoney(s.players[0].cash)}`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopStamina(0))).toHaveText(
        String(s.players[0].stamina),
      );
      await expect(page.getByTestId(TESTIDS.seatPopRep(0))).toHaveText(
        String(s.players[0].reputation),
      );
      await expect(page.getByTestId(TESTIDS.seatPopWarrant(0))).toHaveText(
        String(s.players[0].warrants),
      );
      // 徽章文本 = 数值 + 名词标(图标无文字);空麾下如实报 0(quickStart 开局 0 席)
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "city"))).toHaveText(
        `${s.players[0].properties.length}城池`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "hand"))).toHaveText(
        `${s.players[0].jinnangHandCount}手牌`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "hero"))).toHaveText(
        `${s.players[0].heroes.length === 0 ? 0 : s.players[0].heroes.map((h: any) => h.name).join("·")}名将`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "gem"))).toHaveText(
        `${s.players[0].treasures.length}珍宝`,
      );
      // 自机格:托管开关行在场(autopilotSupported 门卫与旧托管钮同款)
      await expect(page.getByTestId(TESTIDS.seatPopAutopilot(0))).toBeVisible();

      // Esc 关闭(挂载不夺焦,Esc 直关由底件白拿)
      await page.keyboard.press("Escape");
      await expect(pop0).toBeHidden();

      // ── 对手格弹层:同壳对照投影,托管行缺席 ──
      await tapCell(page, TESTIDS.seat(1));
      const pop1 = page.getByTestId(TESTIDS.seatPop(1));
      await expect(pop1).toBeVisible();
      await expect(page.getByTestId(TESTIDS.seatPopCash(1))).toHaveText(
        `现金 ${fmtMoney(s.players[1].cash)}`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopStamina(1))).toHaveText(
        String(s.players[1].stamina),
      );
      await expect(page.getByTestId(TESTIDS.seatPopBadge(1, "hand"))).toHaveText(
        `${s.players[1].jinnangHandCount}手牌`,
      );
      await expect(page.getByTestId(TESTIDS.seatPopAutopilot(1))).toHaveCount(0);

      // 点外关闭(遮罩拦指针,底件白拿;点外不落底层)
      await page.mouse.click(300, 200);
      await expect(pop1).toBeHidden();
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("格上图标直达五路(#701 ②)", () => {
  test("城楼→清单/战盔→名录/玉璧→列表/墨竹→声望/卷轴→委任;牌背不可点", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForTap(page);
    try {
      // 种植:对手席挂一名将(取自引擎名将目录单源)+一珍宝(取自牌堆真实行——
      // 陈列弹层按 id 回查 TREASURES 目录,假 id 当场炸,种植必须用真身份)+委任 4
      // +声望 45(addReputation 走引擎唯一写口,30 档里程碑顺带成立)
      const hero = await page.evaluate(() => {
        const def = (window as any).__dafung.heroDefs()[0];
        return { id: def.id, name: def.name };
      });
      const gem = await page.evaluate(() => {
        const row = (window as any).__dafung.snapshot().treasureDeck[0];
        return { id: row.id, name: row.name, level: row.level };
      });
      await force(
        page,
        `
        const row = window.__dafung.snapshot().treasureDeck[0];
        const def = window.__dafung.heroDefs()[0];
        e.players[1].heroes = [{ id: def.id, name: def.name, title: def.title, image: def.image }];
        e.players[1].treasures = [{ id: row.id, name: row.name, level: row.level }];
        e.players[1].warrants = 4;
        e.addReputation(1, 45);
      `,
      );
      const s = await snap(page);

      // 城楼→名下城池清单(#622 现役通路,标题带国号)
      await page.getByTestId(TESTIDS.seatAttr(1, "city")).click();
      const ledger = page.getByTestId(TESTIDS.cityLedger);
      await expect(ledger).toBeVisible();
      await expect(ledger.getByText(`${s.players[1].guohao}名下城池`)).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(ledger).toBeHidden();
      await settleTip(page, TESTIDS.seatAttr(1, "city"));

      // 战盔→名将名录(现役 PileShell 名录/卡面;麾下 1 席,卡面出将名)
      await page.getByTestId(TESTIDS.seatAttr(1, "hero")).click();
      const heroModal = page.getByTestId(TESTIDS.seatHeroModal);
      await expect(heroModal).toBeVisible();
      await expect(heroModal.getByText("麾下名将 · 1 席")).toBeVisible();
      await expect(heroModal.getByText(hero.name)).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(heroModal).toBeHidden();
      await settleTip(page, TESTIDS.seatAttr(1, "hero"));

      // 玉璧→珍宝列表(装裱卡陈列+指导价;指导价读单源 guidePriceOf)
      await page.getByTestId(TESTIDS.seatAttr(1, "gem")).click();
      const gemModal = page.getByTestId(TESTIDS.seatGemModal);
      await expect(gemModal).toBeVisible();
      await expect(gemModal.getByText("已持有 · 1 件")).toBeVisible();
      await expect(gemModal.getByText(gem.name)).toBeVisible();
      await expect(gemModal.getByText(`指导价 ${fmtMoney(guidePriceOf(gem.level))}`)).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(gemModal).toBeHidden();
      await settleTip(page, TESTIDS.seatAttr(1, "gem"));

      // 墨竹→声望数值明细(现值大数 + 献计里程碑章:30 已献金章,60/90 未献素章)
      await page.getByTestId(TESTIDS.seatAttr(1, "rep")).click();
      const repModal = page.getByTestId(TESTIDS.seatRepModal);
      await expect(repModal).toBeVisible();
      await expect(repModal.locator(".spop-bignum")).toHaveText("45");
      await expect(page.getByTestId(TESTIDS.seatRepMilestone(30))).toHaveClass(/claimed/);
      await expect(page.getByTestId(TESTIDS.seatRepMilestone(60))).not.toHaveClass(/claimed/);
      await expect(page.getByTestId(TESTIDS.seatRepMilestone(90))).not.toHaveClass(/claimed/);
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(repModal).toBeHidden();
      await settleTip(page, TESTIDS.seatAttr(1, "rep"));

      // 卷轴→委任明细(现值大数 + 口径一句)
      await page.getByTestId(TESTIDS.seatAttr(1, "warrant")).click();
      const warrantModal = page.getByTestId(TESTIDS.seatWarrantModal);
      await expect(warrantModal).toBeVisible();
      await expect(warrantModal.locator(".spop-bignum")).toHaveText("4");
      await expect(warrantModal.getByText("进驻城池时消耗;每过都城 +2")).toBeVisible();
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(warrantModal).toBeHidden();
      // 末位收签:残留的委任浮签面板恰好盖住手牌图标(下一 assertion 的点击靶)
      await settleTip(page, TESTIDS.seatAttr(1, "warrant"));

      // 牌背=暗牌不可点(ADR-0016):点击不开任何弹层(浮签触发元 claim 止泡),
      // 四明细容器与单人格弹层零浮现
      await page.getByTestId(TESTIDS.seatAttr(1, "hand")).click();
      await expect(page.getByTestId(TESTIDS.seatPop(1))).toHaveCount(0);
      await expect(page.getByTestId(TESTIDS.seatHeroModal)).toHaveCount(0);
      await expect(page.getByTestId(TESTIDS.seatGemModal)).toHaveCount(0);
      await expect(page.getByTestId(TESTIDS.seatRepModal)).toHaveCount(0);
      await expect(page.getByTestId(TESTIDS.seatWarrantModal)).toHaveCount(0);
      await expect(page.getByTestId(TESTIDS.cityLedger)).toHaveCount(0);
    } finally {
      await unfreezeClock(page);
    }
  });
});

test.describe("弹层徽章视觉挂点与钻入(#701 ③④)", () => {
  test("可点项 .click 金描边挂点(城池/名将),不可点素底(手牌/珍宝);钻入关本层", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForTap(page);
    try {
      const hero = await page.evaluate(() => {
        const def = (window as any).__dafung.heroDefs()[0];
        return def.name as string;
      });
      await force(
        page,
        `
        const def = window.__dafung.heroDefs()[0];
        e.players[0].heroes = [{ id: def.id, name: def.name, title: def.title, image: def.image }];
      `,
      );

      await tapCell(page, TESTIDS.seatSelf, true);
      const pop = page.getByTestId(TESTIDS.seatPop(0));
      await expect(pop).toBeVisible();
      // 视觉挂点:可点项金描边+尾「›」(.click),不可点素底淡字(无 .click)
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "city"))).toHaveClass(/spop-click/);
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "hero"))).toHaveClass(/spop-click/);
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "hand"))).not.toHaveClass(/spop-click/);
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "gem"))).not.toHaveClass(/spop-click/);
      // 名将徽章值=麾下名将名(信息公开,原型 ⑤「张辽」口径)
      await expect(page.getByTestId(TESTIDS.seatPopBadge(0, "hero"))).toHaveText(`${hero}名将`);

      // 城池徽章钻入 → #622 清单开、单人格层关(居中模态单层互斥)
      await page.getByTestId(TESTIDS.seatPopBadge(0, "city")).click();
      await expect(page.getByTestId(TESTIDS.cityLedger)).toBeVisible();
      await expect(pop).toHaveCount(0);
      await page.getByTestId(TESTIDS.modalClose).click();

      // 名将徽章钻入 → 名录开、单人格层关
      await tapCell(page, TESTIDS.seatSelf, true);
      await expect(pop).toBeVisible();
      await page.getByTestId(TESTIDS.seatPopBadge(0, "hero")).click();
      await expect(page.getByTestId(TESTIDS.seatHeroModal)).toBeVisible();
      await expect(pop).toHaveCount(0);
      await page.getByTestId(TESTIDS.modalClose).click();
      await expect(page.getByTestId(TESTIDS.seatHeroModal)).toBeHidden();
    } finally {
      await unfreezeClock(page);
    }
  });

  test("托管开关接现役引擎通路:切换写 controller.autoPilotOn,回读同步开关态", async ({ page }) => {
    test.setTimeout(180_000); // 重例放宽(见文件头注)
    await quickStart(page, 49);
    await freezeForTap(page); // 托管开后 bot 步进走时钟,冻结期不推进(到点回调挂起)
    try {
      await tapCell(page, TESTIDS.seatSelf, true);
      const sw = page.getByTestId(TESTIDS.seatPopAutopilot(0));
      await expect(sw).toBeVisible();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      // 开:引擎通路生效(单机=控制器本地标记,与旧托管钮同一 setAutoPilot 入口)
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__dafung.controller().autoPilotOn as boolean),
        )
        .toBe(true);
      // 关:收回(旧托管钮「托管/收回」同语义)
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__dafung.controller().autoPilotOn as boolean),
        )
        .toBe(false);
    } finally {
      await unfreezeClock(page);
    }
  });
});

// 军情密探即时窥探+窥探弹层(#575):打出且未被识破 → 窥方(viewer=本座,单机热座
// 恒 0)屏前弹 PileShell 窥探弹层——被窥者锦囊手牌竖笺牌面横排、牌背翻面入场,
// 点击任意处/X 关闭,关闭即逝、无任何残留;被识破则无弹层(窥探从未发生)。
// 结算/留痕/隐私归引擎与投影层单测(test/jinnang.test.ts、test/room.test.ts),
// 本 spec 只守呈现层接线(弹层出现/牌名可见/关闭无残留/识破不弹)。
// 种子离线核算(react-jinnang-use 同源,seed 63 × huanyou):人类先手,选都候选 DOM
// 首格=12 江陵,起手求贤令(自身域恒可用)→ 开局出牌阶段=稳定停靠点;军情密探进
// 目标段无附加门槛(#477 起卡级才查存活对手,恒可用),手牌内容全走 force 引擎直写。
import { test, expect } from "./fixtures";
import { force, snap, freezeClock, openSoloSetup, useHalfScale } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 开局收口(seed 63 × huanyou,react-jinnang-use 同款):选图/起兵/定都(候选 DOM
 *  首格)后停稳在人类开局出牌阶段——引擎直写种植的稳定停靠点。 */
async function startPeekStop(page: Page): Promise<void> {
  await useHalfScale(page);
  await page.goto("/?seed=63");
  await page.getByTestId("home-select-map").click();
  await page.getByTestId("map-item-huanyou").click();
  await page.getByTestId("map-confirm").click();
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId("confirm-capital-ok").click();
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

/** 出牌三连:点牌选中 → 动作条「出牌」进目标段 → 点 bot1 席位 → 动作条「出」打出
 *  (#417 两步目标口径,react-jinnang-use 同款交互链)。 */
async function playPeekAtSeat1(page: Page): Promise<void> {
  await page.getByTestId(TESTIDS.jinnangCard("军情密探")).click();
  await page.getByTestId(TESTIDS.actionbarPlay).click();
  await expect(page.getByTestId(TESTIDS.seatTarget(1))).toBeVisible();
  await page.getByTestId(TESTIDS.seatTarget(1)).click();
  await page.getByTestId(TESTIDS.actionbarTarget).click();
}

test.describe("军情密探即时窥探(#575)", () => {
  test("主路径:打出→窥探弹层出现→目标牌名可见→关闭后无残留", async ({ page }) => {
    await startPeekStop(page);
    // 种植:人类持军情密探;bot1 手牌钉两张(弹层内容断言口);被窥目标恒 seat 1
    await force(
      page,
      `
      e.players[0].jinnangHand = ["军情密探"];
      e.players[0].jinnangHandCount = 1;
      e.players[1].jinnangHand = ["火烧连营", "求贤令"];
      e.players[1].jinnangHandCount = 2;
    `,
    );
    await playPeekAtSeat1(page);
    // 弹层出现:目标牌名可见(竖笺牌面横排)
    const modal = page.getByTestId(TESTIDS.peekModal);
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekCard("火烧连营"))).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekCard("求贤令"))).toBeVisible();
    // 引擎侧:窥探零账本(持续窗口字段随 #575 删除,快照无此键)
    expect((await snap(page)).jinnangPeeks).toBeUndefined();
    await freezeClock(page); // 冻结推进,弹层内容与关闭断言不受 bot 链干扰
    // 关闭:点击弹层外任意处(遮罩)→ 弹层关闭
    await page.mouse.click(20, 20);
    await expect(modal).toBeHidden();
    // 无残留:关闭即清,零复现(窥探无任何客户端状态,引擎零账本)
    await page.waitForTimeout(400);
    await expect(page.getByTestId(TESTIDS.peekModal)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.peekCard("火烧连营"))).toHaveCount(0);
  });

  test("空手牌目标合法可窥:弹层「囊中空空」空态(目标有效性对手牌数无守卫)", async ({ page }) => {
    await startPeekStop(page);
    await force(
      page,
      `
      e.players[0].jinnangHand = ["军情密探"];
      e.players[0].jinnangHandCount = 1;
      e.players[1].jinnangHand = [];
      e.players[1].jinnangHandCount = 0;
    `,
    );
    await playPeekAtSeat1(page);
    const modal = page.getByTestId(TESTIDS.peekModal);
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekEmpty)).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekCard("火烧连营"))).toHaveCount(0);
  });

  test("被识破:无窥探弹层(识破只护份,窥探从未发生)", async ({ page }) => {
    await startPeekStop(page);
    // bot 识破口径(#281)对 peek 估损恒 0(不抵牌值底价)→ 永不拆——识破军情密探是
    // 人玩家政局玩法(联机对局),单机热座无第二真人。故本例在页面真引擎里走「被识破」
    // 命令序,呈现层断言 countered 序列零窥探信号(弹层从未打开)。要点:seat1 暂翻
    // isBot=false——bot 即席代答按 isBot 判定(reaction-window.ts,ADR-0017),全 bot
    // 被询问时窗在 resolveJinnang 调用内即闭且必「不用」;翻人后窗挂起,同拍
    // respondReaction 应答识破,再翻回(单拍 evaluate 全同步,无超时代答竞速)。
    await force(
      page,
      `
      e.players[0].jinnangHand = ["军情密探"];
      e.players[0].jinnangHandCount = 1;
      // 只给 seat1 识破诡计(queried 恰 [1]):清走其余座位反应牌,防其他 bot 被询问
      // 留窗拖尾(窗不闭则结算悬置,断言竞速)。
      for (let i = 1; i < e.players.length; i++) {
        e.players[i].jinnangHand = e.players[i].jinnangHand.filter((id) => id !== "识破诡计");
        e.players[i].jinnangHandCount = e.players[i].jinnangHand.length;
      }
      e.players[1].jinnangHand = ["识破诡计"];
      e.players[1].jinnangHandCount = 1;
      e.players[1].isBot = false; // 暂翻人:窗不即席代答,留给下面的应答
      e.resolveJinnang("军情密探");
      e.resolveJinnang("军情密探", [1]);
      e.respondReaction(1, true, "识破诡计", 1); // 识破自保生效,窗闭即结算
      e.players[1].isBot = true; // 翻回 bot(后续 bot 链照常)
    `,
    );
    await freezeClock(page); // 计被拆后回合照常收卷,冻结推进防 bot 链干扰断言
    // 引擎面:识破生效(战报公开面照旧),窥探事件零产出
    const s = await snap(page);
    expect(s.log.some((l: { detail: string }) => l.detail.includes("reactionCounter"))).toBe(true);
    expect(s.events.some((x: { kind: string }) => x.kind === "peekApplied")).toBe(false);
    // 呈现面:窥探弹层从未打开
    await expect(page.getByTestId(TESTIDS.peekModal)).toHaveCount(0);
  });
});

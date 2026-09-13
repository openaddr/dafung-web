// 锦囊系统冒烟(#122/T1):起手发牌、己方牌面可见、他人只见计数、日志不泄牌。
// T1 范围=拿在手里看得见藏得住;使用回路(T2 起)在此追加。
// 单机快照是 god view(引擎在本机),「他人只见计数」的投影逻辑由 room 层单测
// redactSnapshotForSeat 直测;本 spec 断言 UI 面不泄:他人牌面永不出现在 DOM。
import { test, expect } from "./fixtures";
import { openSoloSetup, quickStart, waitMyPause } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

test.describe("锦囊 T1:发牌与可见性", () => {
  test("起手各 1 张:侧栏见自己牌面;牌库余 11;诸侯行见计数章", async ({ page }) => {
    // seed 49 = 真人首动(jinnang-use 同款离线核算):首回合即人类,开局锦囊卷轴停下时
    // 恰「发牌后、任何掷骰前」,牌库 11 / 各手 1 不随对局自走漂移。
    await page.goto("/?seed=49");
    // 显式选图(#147 后地图是骰流变量):残留 localStorage 地图会改变候选城/发牌序列
    await page.getByTestId("home-select-map").click();
    await page.getByTestId("map-item-sanguo").click();
    await page.getByTestId("map-confirm").click();
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    // 不走 pickCapital(其收尾会「今不用」放行):自行点城+确认,保留开局卷轴。
    // #188:行军自动化后「发牌后、首次掷骰前」的停靠点=开局锦囊卷轴(AwaitingJinnang
    // 等输入,快照静止)。
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId("confirm-capital-ok").click();
    await waitMyPause(page, 0);
    // 引擎缝 fail-fast:发牌没进引擎,后面全是废话。
    const eng = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      return {
        hands: e.players.map((p: { jinnangHand: string[] }) => p.jinnangHand.length),
        deck: e.jinnangDeck.length,
        discard: e.jinnangDiscard.length as number,
      };
    });
    expect(eng.deck).toBe(11); // 15 − 4 起手(用牌只进弃牌堆不回库,牌库数即发牌证据)
    expect(eng.hands.reduce((a: number, b: number) => a + b, 0) + eng.discard).toBe(4); // 离库 4 张无一消失

    // 己方牌面:容器 + 恰好 1 张,testid 带牌名(目录中文 id)
    const hand = page.getByTestId(TESTIDS.jinnangHand);
    await expect(hand).toBeVisible();
    await expect(hand.locator("[data-testid^='jinnang-card-']")).toHaveCount(1);

    // bot 计数章可见(囊1),且整页不存在第二份锦囊牌面(他人内容不渲染)
    await expect(page.getByTestId(TESTIDS.jinnangCount(1))).toBeVisible();
    expect(await page.locator("[data-testid^='jinnang-card-']").count()).toBe(1);
  });

  test("对局日志与 UI 快照均不落他人牌名(ADR-0016 的 UI 面)", async ({ page }) => {
    await quickStart(page);
    const probe = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      // ADR-0016 口径(T2 起精确化):抽牌行不得落牌名(重放可推导);用牌/结算公开,牌名入战报是正确行为
      const names = ["连环计", "军情密探", "缓兵之计", "横征暴敛", "窃玉偷香", "火烧连营", "免战金牌", "求贤令"];
      return {
        drawRowLeaks: e.log.some((l: { detail: string }) => l.detail.includes("jinnangDraw") && names.some((c) => l.detail.includes(c))),
      };
    });
    expect(probe.drawRowLeaks).toBe(false);
  });
});

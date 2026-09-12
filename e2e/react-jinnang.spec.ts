// 锦囊系统冒烟(#122/T1):起手发牌、己方牌面可见、他人只见计数、日志不泄牌。
// T1 范围=拿在手里看得见藏得住;使用回路(T2 起)在此追加。
// 单机快照是 god view(引擎在本机),「他人只见计数」的投影逻辑由 room 层单测
// redactSnapshotForSeat 直测;本 spec 断言 UI 面不泄:他人牌面永不出现在 DOM。
import { test, expect } from "./fixtures";
import { quickStart } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

test.describe("锦囊 T1:发牌与可见性", () => {
  test("起手各 1 张:侧栏见自己牌面;牌库余 11;诸侯行见计数章", async ({ page }) => {
    await quickStart(page); // 单机 4 人(1 真人 + 3 bot)
    // 引擎缝 fail-fast:发牌没进引擎,后面全是废话。
    // 断言用守恒口径(#190):quickStart 返回后 bot 可能已合法用牌(如横征暴敛可用即用),
    // 手牌分布会被游戏本身改写——但「恰 4 张离库」+「离库者必在手或弃牌」不随竞改写。
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

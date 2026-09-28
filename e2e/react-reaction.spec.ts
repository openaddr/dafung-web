// 反应窗单机回路(#281,#234 P1-D 牌架即反应窗):识破自保、不用/超时、半路杀出
// 拦检(拦胜/平局/放行)、军师幕「唯反应」灰置、降噪口。权威侧兜底=LocalController
// 定时代发「不用」(与手点同一条命令路径);本 spec 反应窗走 E2E_TIME_SCALE 缩放后
// 的窗长(0.5 倍 → 1500ms,fixtures 先注入 0.25,此 spec 的 init 脚本后挂覆盖同键;
// #284 起窗长单源=view.windowMs,scaleReactionMs 缩放,数值行为不变)。
// 种子离线核算(seed 7):人类先手、起手火烧连营(军师窗停点=稳定种植点);种植后
// 人类改持目标牌,bot 手牌/位置/骰队列按用例直写。
// 条件性缺失元素一律单次 page.evaluate+querySelector 原子采样(仓库既有口径,防 locator 挂起)。
import { test, expect } from "./fixtures";
import {
  force,
  waitMyRollDone,
  openSoloSetup,
  skipUntilNextSeat,
  engineState,
  useHalfScale,
  startSolo,
  plantDemolishableCity,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 放行人类一手直到轮到 bot(骰由自动起摇;决策一律跳过——不买地保「城最多并列取
 *  最小座位」,bot 火烧连营目标恒人类)。 */
async function skipMyTurn(page: Page): Promise<void> {
  await page.getByTestId(TESTIDS.actionbarPass).click();
  await waitMyRollDone(page, 0);
  await skipUntilNextSeat(page, 0);
}

/** 骰队列补丁:接下来 n 次掷骰(rollDie)恒 6,耗尽自还原(局部确定性,种植用)。 */
const diceQueueForce = (n: number) => `
  (() => {
    const o = e.dice.rollDie.bind(e.dice);
    const q = Array.from({ length: ${n} }, () => 6);
    e.dice.rollDie = () => {
      const v = q.shift();
      if (q.length === 0) e.dice.rollDie = o;
      return v ?? o();
    };
  })()`;

/** 拦检窗就绪种植:人类持半路杀出;三 bot 全部落位人类都城前一格(掷 ≥2 即途经);
 *  人类在都城 +2..+4 内首个「有城非都」格挪为第二座城(同一份行程的第二道询问);
 *  骰队列 ${n} 连 6(人类+bot 行程全定)。 */
async function plantAmbush(page: Page, diceRolls: number): Promise<void> {
  await force(
    page,
    `
    e.players[0].jinnangHand = ["半路杀出"];
    for (let i = 1; i < e.players.length; i++)
      e.players[i].position =
        (e.players[0].capitalIndex + e.board.count - 1) % e.board.count;
    {
      const cap = e.players[0].capitalIndex, n = e.board.count;
      let idx = -1;
      for (const k of [2, 3, 4]) {
        const c = (cap + k) % n;
        const t = e.board.at(c);
        if (t?.propertyId && !e.players.some((p) => p.capitalIndex === c)) { idx = c; break; }
      }
      if (idx < 0) throw new Error("种植失败:都城 +2..+4 无可挪城池格");
      const pid = e.board.at(idx).propertyId;
      const owner = e.findOwner(pid);
      if (owner) owner.properties = owner.properties.filter((h) => h.propertyId !== pid);
      e.players[0].properties.push({
        propertyId: pid, group: e.board.at(idx).group ?? "a",
        purchasePrice: 1000, level: 1, maxLevel: 3,
      });
    }
    ${diceQueueForce(diceRolls)}
  `,
  );
}

/** 火烧连营窗种植:人类改持识破诡计 + 一座可失之城;bot 全持火烧连营(首个行动 bot
 *  在其回合开始即出,城最多者=人类)。 */
async function plantCounterScenario(page: Page): Promise<void> {
  await startSolo(page);
  await plantDemolishableCity(page);
  await force(
    page,
    `
    e.players[0].jinnangHand = ["识破诡计"];
    for (let i = 1; i < e.players.length; i++) e.players[i].jinnangHand = ["火烧连营"];
  `,
  );
  await skipMyTurn(page);
}

test.describe("反应窗(#281 单机)", () => {
  test("识破自保:火烧连营指定→横幅+倒计时弧+架上金边→点牌落印→计对这份失效", async ({ page }) => {
    await plantCounterScenario(page);
    // 反应窗横幅:事件文案 + 朱砂倒计时弧;架上识破诡计呼吸金边(.reactive)
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText("使用【火烧连营】");
    await expect(banner.getByTestId(TESTIDS.reactionTimer)).toBeVisible();
    const card = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(card).toHaveClass(/reactive/);
    const before = await engineState(
      page,
      "{ level: e.players[0].properties[0].level, cities: e.players[0].properties.length }",
    );
    // 点牌选中(.sel)→ 落印确认
    await card.click();
    await expect(card).toHaveClass(/sel/);
    await banner.getByTestId(TESTIDS.reactionConfirm).click();
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        bothGone: e.jinnangDiscard.includes("识破诡计") && e.jinnangDiscard.includes("火烧连营"),
        countered: e.log.some((l) => l.detail.includes("reactionCounter")),
        level: e.players[0].properties[0]?.level ?? -1,
        cities: e.players[0].properties.length,
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({
        bothGone: true,
        countered: true,
        level: before.level,
        cities: before.cities,
      });
    // 识破牌已耗出手牌(后续 bot 的火烧窗口与本断言无涉,不再点选)
    expect(await engineState(page, "e.players[0].jinnangHand.includes('识破诡计')")).toBe(false);
  });

  test("不用路径:点「不用」立即应答,计照常结算(城失/防降)", async ({ page }) => {
    await plantCounterScenario(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    const citiesBefore = await engineState(page, "e.players[0].properties.length");
    await banner.getByTestId(TESTIDS.reactionDecline).click();
    // 结算:0 级非都城被拆走(都城不可拆)——城数 -1,双牌皆耗
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        cities: e.players[0].properties.length,
        responded: e.log.some((l) => l.detail.includes("reactionRespond") && l.detail.includes("use=0")),
        huoshao: e.jinnangDiscard.includes("火烧连营"),
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ cities: citiesBefore - 1, responded: true, huoshao: true });
    // 不用:识破诡计保留在手(应答不耗牌)
    expect(await engineState(page, "e.players[0].jinnangHand")).toContain("识破诡计");
  });

  test("超时兜底:窗内不应答,LocalController 归零代发「不用」,计照常结算", async ({ page }) => {
    await plantCounterScenario(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    const citiesBefore = await engineState(page, "e.players[0].properties.length");
    // 窗长 1500ms(0.5 倍率):到点 UI 自动收回 + 权威侧代发——不点任何钮,等结算
    await expect(banner).not.toBeVisible({ timeout: 8_000 });
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        cities: e.players[0].properties.length,
        responded: e.log.some((l) => l.detail.includes("reactionRespond") && l.detail.includes("use=0")),
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ cities: citiesBefore - 1, responded: true });
  });

  test("半路杀出·拦胜:行人止步拦检城并照常落格;平局:牌白耗续走;点不用放行", async ({ page }) => {
    await startSolo(page);
    await plantAmbush(page, 0); // 不补骰:自然掷 ≥2 即途经(三 bot 连续尝试)
    await skipMyTurn(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    // 拦检窗文案:行军将过你的城池;可打的半路杀出金边亮出
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText("行军将过你的城池");
    await expect(page.getByTestId(TESTIDS.jinnangCard("半路杀出"))).toHaveClass(/reactive/);
    // 拦胜:骰队列补丁 城主 6 对行人 1 → 拼点胜 → 止步此城
    const mover = await engineState(page, "e.pendingReaction.view.userSeat");
    await force(
      page,
      `
      (() => {
        const o = e.dice.rollDie.bind(e.dice);
        const q = [6, 1];
        e.dice.rollDie = () => {
          const v = q.shift();
          if (q.length === 0) e.dice.rollDie = o;
          return v;
        };
      })()
    `,
    );
    await page.getByTestId(TESTIDS.jinnangCard("半路杀出")).click();
    await banner.getByTestId(TESTIDS.reactionConfirm).click();
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        stopped: e.log.some((l) => l.detail.includes("reactionAmbushStop")),
        atCap: e.players[${mover}].position === e.players[0].capitalIndex,
        consumed: !e.players[0].jinnangHand.includes("半路杀出")
          && e.jinnangDiscard.includes("半路杀出"),
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ stopped: true, atCap: true, consumed: true });
  });

  test("半路杀出·平局牌白耗续走;点不用放行", async ({ page }) => {
    await startSolo(page);
    await plantAmbush(page, 0);
    await skipMyTurn(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    const mover = await engineState(page, "e.pendingReaction.view.userSeat");
    // 平局:城主 3 对行人 3 → 拼点无胜 → 牌白耗,行人照常续走落原点
    await force(
      page,
      `
      (() => {
        const o = e.dice.rollDie.bind(e.dice);
        const q = [3, 3];
        e.dice.rollDie = () => {
          const v = q.shift();
          if (q.length === 0) e.dice.rollDie = o;
          return v;
        };
      })()
    `,
    );
    await page.getByTestId(TESTIDS.jinnangCard("半路杀出")).click();
    await banner.getByTestId(TESTIDS.reactionConfirm).click();
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        tie: e.log.some((l) => l.detail.includes("reactionAmbushFail") && l.detail.includes("winner=tie")),
        away: e.players[${mover}].position !== e.players[0].capitalIndex,
        consumed: e.jinnangDiscard.includes("半路杀出"),
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ tie: true, away: true, consumed: true });
  });

  test("半路杀出·点不用放行:行人照常落原落点,牌不耗", async ({ page }) => {
    await startSolo(page);
    await plantAmbush(page, 0);
    await skipMyTurn(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    const mover = await engineState(page, "e.pendingReaction.view.userSeat");
    await banner.getByTestId(TESTIDS.reactionDecline).click();
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        resumed: e.turnPhase !== "AwaitingReaction",
        keep: e.players[0].jinnangHand.includes("半路杀出"),
        wasted: !e.jinnangDiscard.includes("半路杀出"),
      }`,
          ),
        { timeout: 15_000 },
      )
      .toEqual({ resumed: true, keep: true, wasted: true });
    expect(await engineState(page, `e.players[${mover}].position`)).toBeDefined();
  });

  test("军师幕「唯反应」:两张反应牌不触发军师幕(持牌回合照常自动起摇)", async ({ page }) => {
    await useHalfScale(page);
    await page.goto("/?seed=7");
    await page.getByTestId("home-select-map").click();
    await page.getByTestId("map-item-sanguo").click();
    await page.getByTestId("map-confirm").click();
    await openSoloSetup(page);
    await page.getByTestId("start-game").click();
    await page.locator(".bv-tile.bv-selectable").first().click();
    await page.getByTestId("confirm-capital-ok").click();
    // 开局窗停点把人类手牌换成两张反应牌:军师窗不得开启(唯反应不入 choices 可用集)
    await force(page, `e.players[0].jinnangHand = ["识破诡计", "半路杀出"];`);
    await page.waitForTimeout(600); // 采样窗:军师窗若会被触发,此刻已在(原子采样防挂起)
    const up = await page.evaluate(
      () =>
        document.querySelector('[data-testid="actionbar"]') != null ||
        document.querySelector('[data-testid="actionbar-pass"]') != null,
    );
    expect(up).toBe(false);
    // 自动起摇照常:人类当前一手自动走完(#188)
    await waitMyRollDone(page, 0);
  });

  test("军师幕混排:反应牌灰置印「唯反应」,可用牌照常可出", async ({ page }) => {
    await startSolo(page); // 停稳开局军师窗
    await force(page, `e.players[0].jinnangHand = ["火烧连营", "识破诡计"];`);
    await page.waitForTimeout(300); // choices 重算一拍
    const huoshao = page.getByTestId(TESTIDS.jinnangCard("火烧连营"));
    const shipo = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(huoshao).toBeEnabled();
    await expect(shipo).toBeDisabled();
    await expect(shipo.locator(".reason")).toHaveText("唯反应(反应窗打出)");
  });

  test("降噪口:点「本回合不再询问」后同回合后续询问不弹横幅、下回合恢复", async ({ page }) => {
    await startSolo(page);
    await plantAmbush(page, 4); // 人类+bot 行程全 6:同一 mover 连开两道拦检窗
    await skipMyTurn(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    // 第一道窗:点降噪口=当前窗立即「不用」+本回合静默
    await banner.getByTestId(TESTIDS.reactionMute).click();
    // 第二道窗(同一 mover 途经第二座城)被静默自动代发不用:两份应答皆 use=0,
    // 且全程只有一次人工点击——第二份必出自静默代发;牌不耗(不用不消耗)
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        resp: e.log.filter((l) => l.detail.includes("reactionRespond")).length,
        keep: e.players[0].jinnangHand.includes("半路杀出"),
        wasted: !e.jinnangDiscard.includes("半路杀出"),
      }`,
          ),
        { timeout: 20_000 },
      )
      .toEqual({ resp: 2, keep: true, wasted: true });
    // 回合变更(bot 换位)自动解除静默:下一 mover 的拦检窗横幅恢复弹出
    await expect(banner).toBeVisible({ timeout: 45_000 });
    await banner.getByTestId(TESTIDS.reactionDecline).click(); // 收尾放行,不留悬窗
  });
});

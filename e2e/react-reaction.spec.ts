// 反应窗单机回路(#281,#234 P1-D 牌架即反应窗;#303 按 #292 决议改造):
// - 半路杀出三例(拦胜/平局/放行)合并为一例三分支走查(省两次建房);
// - 引擎结算断言接「反应窗应答流程」helper 下沉(单测已在守:reaction-window 22 例
//   全回路 + jinnang.test 唯反应),e2e 每例只留「横幅→点选/不用→结果」接线冒烟
//   + 视觉锚(倒计时弧 / 架上金边 / 灰置印「唯反应」);
// - 超时兜底与降噪口两例原样保留(#292 Q2 立照:守 LocalController 客户端定时代发 /
//   静默状态机,非引擎语义);超时例换 helper 的 timeout 模式;
// - 两处硬等待(军师窗采样窗 / choices 重算一拍)换条件 poll(#292 Q4)。
// 权威侧兜底=LocalController 定时代发「不用」(与手点同一条命令路径);本 spec 反应窗
// 走 E2E_TIME_SCALE 缩放后的窗长(0.5 倍 → 1500ms,fixtures 先注入 0.25,此 spec 的
// init 脚本后挂覆盖同键;#284 起窗长单源=view.windowMs,scaleReactionMs 缩放,数值
// 行为不变)。种子离线核算(seed 7):人类先手、起手火烧连营(军师窗停点=稳定种植点);
// 种植后人类改持目标牌,bot 手牌/位置/骰队列按用例直写。注意 seed 7 默认 bot 手牌含
// 火烧连营/半路杀出:bot 回合开始会弹火烧窗(不用+静音=2 选项),拦检例一律以
// 「行军将过你的城池」文案过滤后再应答(旧三例既有口径)。
import { test, expect } from "./fixtures";
import {
  force,
  waitMyRollDone,
  skipUntilNextSeat,
  engineState,
  startSolo,
  plantDemolishableCity,
  awaitReactionWindow,
  answerReactionWindow,
  pollReactionSettled,
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

/** 骰队列补丁:接下来数次掷骰(rollDie)依序取给定值,耗尽自还原(局部确定性)。
 *  #303:由「n 连 6」泛化为任意值序,行程补骰与拦检拼点([6,1]/[3,3])同源。
 *  尾分号必备:单独作为 fn 传 force 时,表达式语句必须自终止,否则吃掉后续 sync()。 */
const diceQueue = (...values: number[]) => `
  (() => {
    const o = e.dice.rollDie.bind(e.dice);
    const q = [${values.join(", ")}];
    e.dice.rollDie = () => {
      const v = q.shift();
      if (q.length === 0) e.dice.rollDie = o;
      return v ?? o();
    };
  })();`;

/** 拦检窗就绪种植:人类持半路杀出;三 bot 全部落位人类都城前一格(掷 ≥2 即途经);
 *  withSecondCity=真时(降噪口例):人类在都城 +2..+4 内首个「有城非都」格挪为第二座
 *  城(同一份行程的第二道询问);#303 合并走查例传假——三 bot 各只吃首都一道窗,
 *  平局/放行的续走不会撞出第二道询问。骰队列 n 连 6(人类+bot 行程全定)。 */
async function plantAmbush(page: Page, diceRolls: number, withSecondCity = true): Promise<void> {
  await force(
    page,
    `
    e.players[0].jinnangHand = ["半路杀出"];
    for (let i = 1; i < e.players.length; i++)
      e.players[i].position =
        (e.players[0].capitalIndex + e.board.count - 1) % e.board.count;
    ${
      withSecondCity
        ? `
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
    }`
        : ""
    }
    ${diceQueue(...Array.from({ length: diceRolls }, () => 6))}
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
  test("识破自保:横幅+倒计时弧+架上金边→点牌落印→识破留痕窗收(结算下沉单测)", async ({ page }) => {
    await plantCounterScenario(page);
    // 反应窗横幅:事件文案 + 朱砂倒计时弧;架上识破诡计呼吸金边(.reactive)——视觉锚
    const baseline = await awaitReactionWindow(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText("使用【火烧连营】");
    await expect(banner.getByTestId(TESTIDS.reactionTimer)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangCard("识破诡计"))).toHaveClass(/reactive/);
    // 点牌落印确认,识破留痕 + 窗收(双牌皆耗/城不降级等结算细节由单测守)
    await answerReactionWindow(page, { mode: "counter", card: "识破诡计" });
    await pollReactionSettled(page, baseline, { countered: true });
  });

  test("不用路径:点「不用」立即应答→窗收留痕(城失结算下沉单测)", async ({ page }) => {
    await plantCounterScenario(page);
    const baseline = await awaitReactionWindow(page);
    await answerReactionWindow(page, { mode: "decline" });
    await pollReactionSettled(page, baseline, { declined: true });
  });

  test("超时兜底:窗内不应答,LocalController 归零代发「不用」,计照常结算", async ({ page }) => {
    await plantCounterScenario(page);
    await awaitReactionWindow(page); // 横幅升起即停靠点
    const citiesBefore = await engineState(page, "e.players[0].properties.length");
    // 窗长 1500ms(0.5 倍率):到点 UI 自动收回 + 权威侧代发——不点任何钮,等结算
    await answerReactionWindow(page, { mode: "timeout", windowMs: 1500 });
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

  test("半路杀出三分支走查:拦胜止步落格→平局牌白耗续走→点不用放行牌不耗", async ({ page }) => {
    await startSolo(page);
    // 只留首都一道窗:三 bot 各自行程各开一问,顺序吃满三分支(#292 Q1 合并)
    await plantAmbush(page, 4, false);
    await skipMyTurn(page);
    // 每分支先等窗再以文案过滤:bot 回合开始的火烧连营窗(seed 7 默认手牌)与拦检窗
    // 同形不同文,文案断言重试穿过它,只对 march 拦检窗应答(旧三例既有口径)。
    // ── 分支一 拦胜:横幅文案 + 架上金边(视觉锚)→ 城主 6 对行人 1 → 行人止步首都格照常落格 ──
    await awaitReactionWindow(page);
    const marchText = page.getByTestId(TESTIDS.reactionBanner).getByTestId(TESTIDS.reactionText);
    await expect(marchText).toContainText("行军将过你的城池");
    await expect(page.getByTestId(TESTIDS.jinnangCard("半路杀出"))).toHaveClass(/reactive/);
    const mover1 = await engineState(page, "e.pendingReaction.view.userSeat");
    await force(page, diceQueue(6, 1));
    await answerReactionWindow(page, { mode: "counter", card: "半路杀出" });
    // 拦胜止步:位置落首都格且此后不挪(后续分支不再轮到该 bot),无窗竞态
    await expect
      .poll(
        () => engineState(page, `e.players[${mover1}].position === e.players[0].capitalIndex`),
        { timeout: 15_000, message: "拦胜后行人未止步首都格" },
      )
      .toBe(true);
    // ── 分支二 平局:补牌 → 城主 3 对行人 3 → 牌白耗,行人照常续走落原落点 ──
    await force(page, `e.players[0].jinnangHand = ["半路杀出"];`);
    await awaitReactionWindow(page);
    await expect(
      page.getByTestId(TESTIDS.reactionBanner).getByTestId(TESTIDS.reactionText),
    ).toContainText("行军将过你的城池");
    const mover2 = await engineState(page, "e.pendingReaction.view.userSeat");
    await force(page, diceQueue(3, 3));
    await answerReactionWindow(page, { mode: "counter", card: "半路杀出" });
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        away: e.players[${mover2}].position !== e.players[0].capitalIndex,
        spent: !e.players[0].jinnangHand.includes("半路杀出"),
      }`,
          ),
        { timeout: 15_000, message: "平局分支:牌未白耗或行人未续走" },
      )
      .toEqual({ away: true, spent: true });
    // ── 分支三 放行:补牌 → 点「不用」→ 行人续走、牌不耗 ──
    // 结算断言走结果键(mover 离首都 + 牌留手):火烧窗超时代发已把 use=0 留痕写进
    // 日志,declined 留痕在本局不可作分支信号;此问后人类唯反应手牌驻停军师窗,
    // 不再有任何拦检窗,结果键一旦为真即终局稳定。
    await force(page, `e.players[0].jinnangHand = ["半路杀出"];`);
    await awaitReactionWindow(page);
    await expect(
      page.getByTestId(TESTIDS.reactionBanner).getByTestId(TESTIDS.reactionText),
    ).toContainText("行军将过你的城池");
    const mover3 = await engineState(page, "e.pendingReaction.view.userSeat");
    await answerReactionWindow(page, { mode: "decline" });
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `{
        away: e.players[${mover3}].position !== e.players[0].capitalIndex,
        keep: e.players[0].jinnangHand.includes("半路杀出"),
      }`,
          ),
        { timeout: 15_000, message: "放行分支:行人未续走或牌被误耗" },
      )
      .toEqual({ away: true, keep: true });
  });

  test("军师幕「唯反应」:两张反应牌皆灰置不入可用集,放行后照常自动起摇", async ({ page }) => {
    await startSolo(page); // 停稳开局军师窗(#303 轻瘦身:手搓开局链路收口 startSolo)
    // 开局窗停点把人类手牌换成两张反应牌:唯反应不入 choices 可用集,双牌皆灰置。
    // (#303 实测注:本构建下军师窗壳对唯反应手牌仍驻留、等「不出」点击,旧例的
    // 「窗不在场」断言不成立;可守的本质=灰置印 + 放行后自动起摇,军师窗不弹的
    // 引擎前提由 jinnang.test 唯反应单测守。)
    await force(page, `e.players[0].jinnangHand = ["识破诡计", "半路杀出"];`);
    // 条件 poll 替代 600ms 采样窗(#292 Q4):灰置即 choices 重算完成的信号(视觉锚)
    const shipo = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    const banlu = page.getByTestId(TESTIDS.jinnangCard("半路杀出"));
    await expect
      .poll(() => shipo.isDisabled(), { timeout: 4_000, message: "识破诡计未灰置" })
      .toBe(true);
    await expect(banlu).toBeDisabled();
    await expect(shipo.locator(".reason")).toHaveText("唯反应(反应窗打出)");
    await expect(banlu.locator(".reason")).toHaveText("唯反应(反应窗打出)");
    // 放行后照常自动起摇:人类当前一手自动走完(#188)
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
  });

  test("军师幕混排:反应牌灰置印「唯反应」,可用牌照常可出", async ({ page }) => {
    await startSolo(page); // 停稳开局军师窗
    await force(page, `e.players[0].jinnangHand = ["火烧连营", "识破诡计"];`);
    // 条件 poll 替代 300ms choices 重算一拍(#292 Q4):灰置即重算完成的信号
    const shipo = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect
      .poll(() => shipo.isDisabled(), { timeout: 4_000, message: "反应牌未灰置" })
      .toBe(true);
    // 视觉锚:灰置印「唯反应」;可用牌照常可出
    const huoshao = page.getByTestId(TESTIDS.jinnangCard("火烧连营"));
    await expect(huoshao).toBeEnabled();
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

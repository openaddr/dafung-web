// 军情密探即时窥探+窥探弹层(#575):打出且未被识破 → 窥方(viewer=本座,单机热座
// 恒 0)屏前弹 PileShell 窥探弹层——被窥者锦囊手牌竖笺牌面横排、牌背翻面入场,
// 点击任意处/X 关闭,关闭即逝、无任何残留;被识破则无弹层(窥探从未发生)。
// 结算/留痕/隐私归引擎与投影层单测(test/jinnang.test.ts、test/room.test.ts),
// 本 spec 只守呈现层接线(弹层出现/牌名可见/关闭无残留/识破不弹)。
// 种子离线核算(react-jinnang-use 同源,seed 67 × 关中):人类先手,选都候选 DOM
// 首格=0 长安,起手求贤令(自身域恒可用)→ 开局出牌阶段=稳定停靠点;军情密探进
// 目标段无附加门槛(#477 起卡级才查存活对手,恒可用),手牌内容全走 force 引擎直写。
// 到站形制(#1256 对账,ADR-0058 种局式直通):startPeekStop 前置链从「goto→选图→
// 起兵→点城确认」UI 旅程换装 quickStart stopAtOpeningHand(seedSolo 桥路)——桥路与
// 旧 UI 链同 seed 同局(registry 选都口径统一:两路同 seed 必须同局),waitMyPause
// 不代发放行(其头注:AwaitingJinnang 本身就是合法停靠点),窗态保留;被测环=出牌
// 四击链与窥探弹层呈现,到站通路替换零断言改动。3 例均非旅程例,种局式直通是本族应答。
// #1215 棒2(ADR-0058 一环一真):3 例真实段逐例头注声明;塞指定锦囊种植已迁
// giveJinnang(#1298,判词单源 src/core/planter.ts 头注:生产发牌只有牌堆顶随机抽,
// 无「给指定牌」流程)。③ 余下 force=防窗反应牌清除(归 #1301 反应窗族收编)+
// isBot 翻转判词(见该例);resolveJinnang/respondReaction 走引擎公共方法(合法漏斗,
// 非红牌)。
import { test, expect } from "./fixtures";
import { quickStart, snap, freezeClock, useHalfScale } from "./react-helpers";
import { callEngine, plant } from "./helpers/drivers";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 开局收口(seed 67 × 关中,react-jinnang-use 同款):种局式直通(#1256,判词见
 *  头注)停稳在人类开局出牌阶段——引擎直写种植的稳定停靠点。 */
async function startPeekStop(page: Page): Promise<void> {
  await useHalfScale(page);
  await quickStart(page, 67, { mapId: "guanzhong", stopAtOpeningHand: true });
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
  // 真实段:出牌四击链(点牌→「出牌」→点席位→「出」打出)与窥探弹层开/内容/遮罩
  // 关闭/零残留全真——打出命令走真引擎通路,弹层由真实 peekApplied 事件驱动。
  // force 判词:手牌无公共通路,断言面需「己方军情密探+被窥者两张指定牌」牌形。
  test("主路径:打出→窥探弹层出现→目标牌名可见→关闭后无残留", async ({ page }) => {
    await startPeekStop(page);
    // 种植:人类持军情密探;bot1 手牌钉两张(弹层内容断言口);被窥目标恒 seat 1
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    await plant(page, {
      kind: "giveJinnang",
      seat: 1,
      cards: ["火烧连营", "求贤令"],
    });
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

  // 真实段:同款出牌四击链+「囊中空空」空态呈现(目标有效性对手牌数无守卫的引擎
  // 语义经真弹层呈现)。force 判词:手牌无公共通路,断言面需「己方军情密探+目标空手」
  // 牌形(空手非自然局面)。
  test("空手牌目标合法可窥:弹层「囊中空空」空态(目标有效性对手牌数无守卫)", async ({ page }) => {
    await startPeekStop(page);
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    await plant(page, { kind: "giveJinnang", seat: 1, cards: [] }); // 目标空手形
    await playPeekAtSeat1(page);
    const modal = page.getByTestId(TESTIDS.peekModal);
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekEmpty)).toBeVisible();
    await expect(modal.getByTestId(TESTIDS.peekCard("火烧连营"))).toHaveCount(0);
  });

  // 真实段:呈现面断言真(counter 序列零窥探信号、弹层从未打开);命令序
  // (resolveJinnang/respondReaction)走引擎公共方法=合法漏斗(ADR-0058 种植合法性
  // 分层:公共方法必走,局面不变量全保真),经 callEngine 直呼(#1302);翻人走
  // setBot 种植件(#1303,判词单源 src/core/planter.ts:bot 即席代答按 isBot 判定
  // (ADR-0017),无「挂起代答」公共通路)。
  test("被识破:无窥探弹层(识破只护份,窥探从未发生)", async ({ page }) => {
    await startPeekStop(page);
    // bot 识破口径(#281)对 peek 估损恒 0(不抵牌值底价)→ 永不拆——识破军情密探是
    // 人玩家政局玩法(联机对局),单机热座无第二真人。故本例在页面真引擎里走「被识破」
    // 命令序,呈现层断言 countered 序列零窥探信号(弹层从未打开)。要点:seat1 暂翻
    // isBot=false——bot 即席代答按 isBot 判定(reaction-window.ts,ADR-0017),全 bot
    // 被询问时窗在 resolveJinnang 调用内即闭且必「不用」;翻人后窗挂起,respondReaction
    // 应答识破,再翻回。原单拍 evaluate 全同步已拆拍(setBot/callEngine 各一拍,#1303
    // 棒1):拍间隙 ms 级,窗 TTL 秒级(fixtures 注入 E2E_REACTION_MS=5000),超时
    // 代答竞速面不回归;翻人期间唯一被询问座就是 seat1,余座反应牌已清。
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["军情密探"] });
    await plant(page, { kind: "giveJinnang", seat: 1, cards: ["识破诡计"] });
    // 只给 seat1 识破诡计(queried 恰 [1]):清走其余座位反应牌,防其他 bot 被询问
    // 留窗拖尾(窗不闭则结算悬置,断言竞速)。防窗控制(#1301 判词选择):读现值滤
    // 反应牌后走 giveJinnang 终态组合(handCount 随件重灌)——语义是「去指定牌」
    // 而非「给指定牌」,但终态件已能表达,不另设 kind。
    const hands = (await snap(page)).players as { jinnangHand: string[] }[];
    for (let seat = 2; seat < hands.length; seat++) {
      const rest = hands[seat]!.jinnangHand.filter((id) => id !== "识破诡计");
      await plant(page, { kind: "giveJinnang", seat, cards: rest });
    }
    await plant(page, { kind: "setBot", seat: 1, bot: false }); // 暂翻人:窗不即席代答
    await callEngine(page, "resolveJinnang", ["军情密探"]);
    await callEngine(page, "resolveJinnang", ["军情密探", [1]]);
    await callEngine(page, "respondReaction", [1, true, "识破诡计", 1]); // 识破自保生效,窗闭即结算
    await plant(page, { kind: "setBot", seat: 1, bot: true }); // 翻回 bot(后续 bot 链照常)
    await freezeClock(page); // 计被拆后回合照常收卷,冻结推进防 bot 链干扰断言
    // 引擎面:识破生效(战报公开面照旧),窥探事件零产出
    const s = await snap(page);
    expect(s.log.some((l: { detail: string }) => l.detail.includes("reactionCounter"))).toBe(true);
    expect(s.events.some((x: { kind: string }) => x.kind === "peekApplied")).toBe(false);
    // 呈现面:窥探弹层从未打开
    await expect(page.getByTestId(TESTIDS.peekModal)).toHaveCount(0);
  });
});

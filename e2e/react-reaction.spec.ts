// 反应窗单机回路(#281,#234 P1-D 牌架即反应窗;#303 按 #292 决议改造):
// - 半路杀出三例(拦胜/平局/放行)合并为一例三分支走查(省两次建房);
// - 引擎结算断言接「反应窗应答流程」helper 下沉(单测已在守:reaction-window 22 例
//   全回路 + jinnang.test 唯反应),e2e 每例只留「横幅→点选/不用→结果」接线冒烟
//   + 视觉锚(倒计时弧 / 架上金边 / 灰置印「唯反应」);
// - 超时兜底与降噪口两例原样保留(#292 Q2 立照:守权威侧定时代发 /
//   静默状态机,非引擎语义);超时例换 helper 的 timeout 模式;
// - 两处硬等待(出牌阶段采样窗 / choices 重算一拍)换条件 poll(#292 Q4)。
// 权威侧兜底=房间编排反应窗看门狗(#281,room watchdogs)定时代发「不用」(与手点同
// 一条命令路径;#398 单机统一后单机与联机同走房间编排)。注意:权威窗长=引擎
// windowMs 原值,不吃 e2e 倍率(倍率只缩放演出编排,节拍单源 core/timings,#399);
// e2e 经 fixtures 注入 E2E_REACTION_MS=5000 加长权威窗(联机 server env 同款通道,
// 终局 e2e:3s 窗与「断言+读数+应答」点击链在 4 worker 负载下赛跑,误窗应答);横幅
// 展示时长=scaleReactionMs(windowMs)(0.5 倍 → 2500ms 先收回),timeout 例预算按展示
// 时长给、结算按权威窗长等。
// 地图重钉(ADR-0027 满格螺旋,seed 7 × 新环序 tmp 真浏览器探针复算):
// draftOrder=[0,3,2,1] 人类先手不变;选都三候选 [长沙,剑阁,许昌] 取 DOM 首格=11 长沙
// (bot 都:黔=23 虎牢关、荆=44 会稽、宋=25 咸阳);起手牌=识破诡计(唯反应,不入可用集)
// → 自动起摇掷「五」落 16 江州(无主城)——开局停靠点=购地抉择卷轴(soloAtBuyAsk 等卷轴
// 升起)。续局=force 直授周瑜(heroDefs #378 调试面给完整定义;招贤卷轴在本图种子下
// 开局不再可达。疾行=人类行军步数恒 +1,行程骰队列已计入;火攻=回合 2+ 出牌阶段停靠点
// 来源)+「不取」放行购地卷轴交 bot 链。种植后人类无再手动的回合:窗由 bot 链带到
// (火烧例=bot1 回合开始即出;拦检例=bot1 自首都前一格(10 零陵)掷骰途经长沙)。
// bot 手牌/位置/骰队列按用例直写。
import { test, expect } from "./fixtures";
import {
  force,
  waitMyRollDone,
  waitMyPause,
  skipUntilNextSeat,
  engineState,
  snap,
  plantDemolishableCity,
  awaitReactionWindow,
  answerReactionWindow,
  answerMarchCounter,
  pollReactionSettled,
  openSoloSetup,
  useHalfScale,
} from "./react-helpers";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { TESTIDS } from "../src/app/screens/game/testids";
import type { Page } from "@playwright/test";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

/** 开局收口(seed 50 × huanyou ADR-0034 重钉,tmp 引擎仿真复算):AI 选都评分变更后
 *  bot 选都/骰流全变,原 seed 7 链作废——新链:定都江州(16)、起手唯反应「识破诡计」
 *  自动起摇(掷三)落凉州(19,无主城)弹购地抉择卷轴。种植类用例的稳定停靠点
 *  (force 在任何相位可用;此停靠点 engine 停在 AwaitingDecision 等输入)。 */
async function soloAtBuyAsk(page: Page): Promise<void> {
  await useHalfScale(page);
  await page.goto("/?seed=50");
  await page.getByTestId(HOME_TID.selectMap).click();
  await page.getByTestId(SETUP_TID.mapItem("huanyou")).click();
  await page.getByTestId(SETUP_TID.mapConfirm).click();
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.startGame).click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
}

/** 停靠点续局:force 直授周瑜(疾行=行军 +1、火攻=出牌阶段停靠点来源,多条编排依赖,
 *  勿换将;招贤卷轴开局不可达后改走 heroDefs 调试面,完整 HeroDef 随对象进麾下),
 *  再「不取」放行购地卷轴——落格结算收尾,回合随即交 bot 链。 */
async function grantZhouyuAndPass(page: Page): Promise<void> {
  await force(
    page,
    `e.players[0].heroes.push(__dafung.heroDefs().find((h) => h.id === "zhouyu"));`,
  );
  await page.getByTestId(TESTIDS.actionButton("skip")).click();
}

/** 骰队列补丁(拼点):接下来数次 rollDie 依序取给定值,耗尽自还原(局部确定性)。
 *  #303:由「n 连 6」泛化为任意值序,拦检拼点([6,1]/[3,3])由此控制。
 *  ⚠ 只 patch rollDie:行军掷骰走 dice.roll() 属性(闭包),不吃本补丁——行程确定性
 *  由 marchSteps 队列(下)另行控制,两队列分属两个注入口互不串队。
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

/** 行军骰队列(行程):接下来数次 rollAndMove 的行程骰依序取给定值,耗尽自还原。
 *  与 diceQueue(拼点 rollDie 属性)分属两个注入口互不串队;patch 命中时不消耗
 *  种子 rng(还原后种子流无缝续走)。三分支走查分支三用 [2,5]:人类骰 2(周瑜疾行
 *  +1 → 止于 14 华容道可购决策,fx 排空停靠),bot1 骰 5(拦检放行后续走至 15 涪陵渡
 *  落格,机遇已归零无事发生,away 断言成立)。 */
const marchQueue = (...values: number[]) => `
  (() => {
    const o = e.dice.roll.bind(e.dice);
    const q = [${values.join(", ")}];
    e.dice.roll = () => {
      const v = q.shift();
      if (q.length === 0) e.dice.roll = o;
      return { die: v ?? o().die };
    };
  })();`;

/** 拦检窗就绪种植:人类持半路杀出;三 bot 全部落位人类都城前一格(掷 ≥1 即途经,
 *  长沙前一格=10 零陵);
 *  duelDice=拼点骰(开窗前一次种足,拼点是唯一 rollDie 消费者→各取一粒);
 *  withSecondCity=真时(降噪口例):人类在都城 +2..+4 内首个「有城非都」格挪为第二座
 *  城(huanyou 下邳 +2=新野驿站锦囊格无城,+3=16 武昌,同一份行程的第二道询问);
 *  clearBotHands=真时(降噪口例):清 bot 手牌——p2 起手持求贤令(可用即用),其回合
 *  开始的 inline 反应窗(queried=p3)会在「两份应答」计数里插第三条 use=0 痕,把
 *  resp==2 的采样窗压到毫秒级,故清场保窗序纯净;
 *  marchSteps=行程骰队列(见 marchQueue;分支三专用)。
 *  #398 快速链 + 权威 3s 反应窗:骰必须在开窗前种足、窗内零 force——force 等 fx 排空
 *  吃掉秒级预算,看门狗到点代发「不用」后,紧随的应答会落到下一个 bot 的窗上(实测:
 *  读到的 mover1=1,拼点战报 mover=p2)。行程骰=种子 rng(dice.roll 闭包,不吃
 *  diceQueue)。 */
async function plantAmbush(
  page: Page,
  opts: {
    duelDice?: [number, number];
    withSecondCity?: boolean;
    clearBotHands?: boolean;
    marchSteps?: number[];
  } = {},
): Promise<void> {
  const { duelDice, withSecondCity = true, clearBotHands, marchSteps } = opts;
  await force(
    page,
    `
    e.players[0].jinnangHand = ["半路杀出"];
    ${clearBotHands ? `for (let i = 1; i < e.players.length; i++) e.players[i].jinnangHand = [];` : ""}
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
    ${marchSteps ? marchQueue(...marchSteps) : ""}
    ${duelDice ? diceQueue(...duelDice) : ""}
  `,
  );
}

/** 火烧连营窗种植:人类挪入一座非都城(0 级)= 全场唯一「可失之城」(都城不可拆,
 *  demolishOnVictim 排除;都城 +2=13 交州,relative 扫描自择)+ 全员改持目标/识破牌;
 *  授周瑜「不取」续局后首个行动 bot 在其回合开始即出火烧(城最多者=人类)。 */
async function plantCounterScenario(page: Page): Promise<void> {
  await soloAtBuyAsk(page);
  await plantDemolishableCity(page);
  await force(
    page,
    `
    e.players[0].jinnangHand = ["识破诡计"];
    for (let i = 1; i < e.players.length; i++) e.players[i].jinnangHand = ["火烧连营"];
  `,
  );
  await grantZhouyuAndPass(page);
}

/** 等人类出牌阶段窗态升起(seed 7 × huanyou 开局无窗:起手唯反应牌;回合 2 起由可选项带到
 *  ——混排例=手牌火烧连营本就可用,唯反应例=火攻引窗,p1 都城升 Lv.1 变「可降级」
 *  使火攻可指定)。poll 带 decisionOwner 守卫:bot 链步进途中的 AwaitingJinnang 瞬拍
 *  (decisionOwner=bot)不误配。 */
async function waitJinnangStop(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        return s.decisionOwner === 0 && s.turnPhase === "AwaitingJinnang";
      },
      { timeout: 60_000, message: "人类出牌阶段未进入" },
    )
    .toBe(true);
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

  test("反应窗长按开牌面详情(#751 A1):既有弹层纯接线,窗内不双弹", async ({ page }) => {
    await plantCounterScenario(page);
    await awaitReactionWindow(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    const card = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(card).toHaveClass(/reactive/);
    // 长按(裸 mouse 序列,越过 500ms 判定窗;坐标输入无 actionability,同 #715 长按例)
    const box = await card.boundingBox();
    if (!box) throw new Error("反应牌无几何盒:反应窗未升起");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700); // 越过长按判定窗(全套件唯一保留硬等待同款)
    await page.mouse.up();
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("识破诡计");
    await expect(detail).toHaveCount(1); // 长按吞补发 click,同一动作不弹两次
    // 长按不改选中:点=选中的既有语义不因详情通路偏移(选中态维持既有上浮表达)
    await expect(card).not.toHaveClass(/sel/);
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });

  test("不用路径:点「不用」立即应答→窗收留痕(城失结算下沉单测)", async ({ page }) => {
    await plantCounterScenario(page);
    const baseline = await awaitReactionWindow(page);
    await answerReactionWindow(page, { mode: "decline" });
    await pollReactionSettled(page, baseline, { declined: true });
  });

  test("超时兜底:窗内不应答,权威侧看门狗归零代发「不用」,计照常结算", async ({ page }) => {
    await plantCounterScenario(page);
    await awaitReactionWindow(page); // 横幅升起即停靠点
    const citiesBefore = await engineState(page, "e.players[0].properties.length");
    // 横幅 2500ms(权威窗 5000ms × 0.5 倍率,fixtures 注入 E2E_REACTION_MS=5000,
    // 联机 server env 同款通道)先收回;权威窗到点房间看门狗代发——不点任何钮,等结算
    await answerReactionWindow(page, { mode: "timeout", windowMs: 2500 });
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
    await soloAtBuyAsk(page);
    // 火攻停点钉子:p2 都城升 Lv.1(可降级)→ 周瑜火攻自人类回合 2 起恒可指定,
    // 每个人类回合开始必停出牌阶段(waitMyPause 停靠点与行程骰解耦,不赌落格)。
    await force(page, `e.players[2].properties[0].level = 1;`);
    // 只留首都一道窗:三 bot 各自行程各开一问,顺序吃满三分支(#292 Q1 合并)。
    // #398 快速链 + 权威反应窗(5s):拼点骰开窗前种足、窗内零 force(force 等 fx 排空
    // 会撞看门狗代发,应答落到下一个 bot 的窗上);mover 读取与应答合并为页面内原子
    // 操作(answerMarchCounter)——读与答同一窗,无 CDP 往返竞速。
    // 购地卷轴停靠点种植后授周瑜「不取」续局:回合随即收尾,bot1 自 10(零陵)掷骰
    // 途经长沙开窗。
    await plantAmbush(page, { duelDice: [6, 1], withSecondCity: false });
    await grantZhouyuAndPass(page);
    // 每分支以文案过滤(火烧连营窗与拦检窗同形不同文,answerMarchCounter 页面内只认
    // 「行军将过你的城池」),拦胜/平局以点牌落印应答、放行以「不用」应答。
    // ── 分支一 拦胜:城主 6 对行人 1 → 行人止步首都格照常落格 ──
    const mover1 = await answerMarchCounter(page);
    // 拼点签面(#637,ADR-0030):拦胜判词=城主(座 0)金圈+金描边,行人签沉暗;
    // 全屏签面幕在结算批首位登场(点差 6−1≥3 判词拍震屏,纯视觉不在此断言)。
    const duelWin = page.getByTestId(TESTIDS.duelOverlay);
    await duelWin.waitFor({ timeout: 10_000 });
    await expect(duelWin.getByTestId(TESTIDS.duelSign(0))).toBeVisible();
    await expect(duelWin.getByTestId(TESTIDS.duelSign(mover1))).toBeVisible();
    // 签面排布锚(#709):双签并排整排落视口内(排高 ≤200=单签档;收缩适配误折行
    // 的纵叠 ≈472 即此炸)——桌面/矮横屏同形,矮横屏专项在 react-short-stage.spec。
    // 读数须在渐出收场前(整场 ~675ms @0.25 倍率;判词停留 900ms 随 #760 校准,
    // 全场 2700ms@1x),故紧贴挂载拍取盒。
    const signRow = await page.evaluate(() => {
      const r = document.querySelector(".duel-signs")?.getBoundingClientRect();
      return r ? { h: r.height, y: r.y, bottom: r.bottom, vh: innerHeight } : null;
    });
    expect(signRow, "签面排已收场,读数晚于渐出").not.toBeNull();
    expect(signRow!.h).toBeLessThanOrEqual(200);
    expect(signRow!.y).toBeGreaterThanOrEqual(0);
    expect(signRow!.bottom).toBeLessThanOrEqual(signRow!.vh);
    await expect(duelWin.getByTestId(TESTIDS.duelVerdict)).toHaveAttribute("data-verdict", "win", {
      timeout: 10_000,
    });
    await expect(duelWin.getByTestId(TESTIDS.duelSign(0))).toHaveClass(/duel-sign-win/);
    await expect(duelWin.getByTestId(TESTIDS.duelSign(mover1))).toHaveClass(/duel-sign-dim/);
    // 拦胜止步:位置落首都格且此后不挪(后续分支不再轮到该 bot),无窗竞态
    await expect
      .poll(
        () => engineState(page, `e.players[${mover1}].position === e.players[0].capitalIndex`),
        { timeout: 15_000, message: "拦胜后行人未止步首都格" },
      )
      .toBe(true);
    // ── 分支二 平局:补牌 → 城主 3 对行人 3 → 牌白耗,行人照常续走落原落点 ──
    // #398 快速链适配:分支 1 应答后房间编排一拍跑完整条 bot 链(合并连锁,联机同构),
    // 「链中补牌」不再可达——重布场挪到人类停点(等停靠 → plantAmbush 重种手牌/布位/
    // 骰队 → 放行)。停靠=回合开始出牌阶段(火攻钉子)。行程骰队列 [2,5]:人类骰 2
    // (+疾行止于 19 凉州可购决策——**停靠让 fx 排空**,若人类一路走到无人停靠格,看门狗
    // 自动化会连播行军动画,answerMarchCounter 的 fx 门在 5s 权威窗内永远等不到空闲;
    // ADR-0034 重钉:原 [1,5] 落 18=bot 都城剑阁,停靠形态随选都地理失效);
    // bot 首个行程骰 5 → 自 15 途经江州开拦检窗后续走落格,away 不赌自然骰。
    await waitMyPause(page, 0);
    await plantAmbush(page, { duelDice: [3, 3], withSecondCity: false, marchSteps: [2, 5] });
    await skipUntilNextSeat(page, 0);
    const mover2 = await answerMarchCounter(page);
    // 拼点签面(平局判词,#637):双方无圈(无 win/dim 态类),中缝印钤变金「平」
    // ——「都没圈」与「还没判」不可区分,文字承载语义例外(ADR-0030)。
    const duelTie = page.getByTestId(TESTIDS.duelOverlay);
    await duelTie.waitFor({ timeout: 10_000 });
    await expect(duelTie.getByTestId(TESTIDS.duelVerdict)).toHaveAttribute("data-verdict", "tie", {
      timeout: 10_000,
    });
    await expect(duelTie.getByTestId(TESTIDS.duelVerdict)).toHaveText("平");
    await expect(duelTie.getByTestId(TESTIDS.duelSign(0))).not.toHaveClass(/duel-sign-win/);
    await expect(duelTie.getByTestId(TESTIDS.duelSign(0))).not.toHaveClass(/duel-sign-dim/);
    await expect(duelTie.getByTestId(TESTIDS.duelSign(mover2))).not.toHaveClass(/duel-sign-win/);
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
    // 日志,declined 留痕在本局不可作分支信号;放行后结果键一旦为真即终局稳定。
    // 停靠=回合开始出牌阶段(火攻钉子)。行程骰队列 [2,5]:人类骰 2(+疾行 → 14 华容道
    // 可购决策,fx 排空原理同分支二),bot 首个行程骰 5(拦检放行后续走至 15 涪陵渡落格)。
    await waitMyPause(page, 0);
    await plantAmbush(page, { withSecondCity: false, marchSteps: [2, 5] });
    await skipUntilNextSeat(page, 0);
    const mover3 = await answerMarchCounter(page, "decline");
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

  test("出牌阶段「唯反应」:两张反应牌皆灰置不入可用集,放行后照常自动起摇", async ({ page }) => {
    test.setTimeout(90_000); // bot 链(含 p2 求贤令窗 5s 看门狗代发)+ 两段行程,60s 基线偏紧
    await soloAtBuyAsk(page); // 停稳购地卷轴(#303 轻瘦身:手搓开局链路收口 soloAtBuyAsk)
    // 购地停靠点换牌 + 火攻引窗:人类手牌换成两张反应牌(唯反应不入 choices 可用集,
    // 双牌皆灰置);唯反应手牌自身起不了窗态(seed 7 起手即唯反应,开局无窗可驻),
    // p1 都城升 Lv.1(可降级)使周瑜火攻可指定 → 人类回合 2 出牌阶段窗态必升起,唯反应灰置
    // 得以在活窗内验证。(#303 实测注仍立:窗态对唯反应手牌驻留、等「不出」点击;
    // 「窗不在场」断言本就不成立,可守的本质=灰置印 + 放行后自动起摇。)
    await force(
      page,
      `
      e.players[0].jinnangHand = ["识破诡计", "半路杀出"];
      e.players[1].properties[0].level = 1;
    `,
    );
    await grantZhouyuAndPass(page);
    await waitJinnangStop(page);
    // 灰置即 choices 重算完成的信号(视觉锚;10s:窗升起拍与牌架重灌之间有快照/渲染
    // 节拍差,4s 在满载下实测会踩空)
    const shipo = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    const banlu = page.getByTestId(TESTIDS.jinnangCard("半路杀出"));
    await expect
      .poll(() => shipo.isDisabled(), { timeout: 10_000, message: "识破诡计未灰置" })
      .toBe(true);
    await expect(banlu).toBeDisabled();
    await expect(shipo.locator(".reason")).toHaveText("唯反应(反应窗打出)");
    await expect(banlu.locator(".reason")).toHaveText("唯反应(反应窗打出)");
    // 行程骰钉子(放行前种足):放行后唯反应手牌驻留窗壳等「不出」,而唯反应+火攻
    // 未发使每个回合开始都重开窗——waitMyRollDone 的完成判定(离开 Roll/出牌阶段)会把
    // 采样全打在人类回合内,赌自然落格必挂。骰 1(+疾行 → 13 交州可购决策)把「一手
    // 走完」钉成确定性停靠。
    await force(page, marchQueue(1));
    // 放行后照常自动起摇:人类当前一手自动走完(#188)
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
  });

  test("出牌阶段混排:反应牌灰置印「唯反应」,可用牌照常可出", async ({ page }) => {
    await soloAtBuyAsk(page); // 停稳购地卷轴
    // 购地停靠点换牌:火烧连营可用(城最多者目标段回窗内再验)→ 人类回合 2 出牌阶段窗态升起
    await force(page, `e.players[0].jinnangHand = ["火烧连营", "识破诡计"];`);
    await grantZhouyuAndPass(page);
    await waitJinnangStop(page);
    // 灰置即重算完成的信号(10s 预算,理由同唯反应例);视觉锚:灰置印「唯反应」,
    // 可用牌照常可出
    const shipo = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect
      .poll(() => shipo.isDisabled(), { timeout: 10_000, message: "反应牌未灰置" })
      .toBe(true);
    // 视觉锚:灰置印「唯反应」;可用牌照常可出
    const huoshao = page.getByTestId(TESTIDS.jinnangCard("火烧连营"));
    await expect(huoshao).toBeEnabled();
    await expect(shipo.locator(".reason")).toHaveText("唯反应(反应窗打出)");
  });

  test("降噪口:点「本回合不再询问」后同回合后续询问不弹横幅、下回合恢复", async ({ page }) => {
    await soloAtBuyAsk(page);
    // 第二城=都城 +2(13 交州):同一 mover 连开两道拦检窗。
    // clearBotHands:杀 p2 求贤令的 inline 反应窗痕,保「两份应答」计数纯净(见
    // plantAmbush 注)。行程骰钉子 [5]:购地停靠点种植后续局,首个行程骰=bot1 的——
    // 骰 5 必连穿 11(窗1)与 13(窗2),w2 的到达不赌自然骰。授周瑜「不取」续局。
    await plantAmbush(page, { clearBotHands: true, marchSteps: [5] });
    await grantZhouyuAndPass(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    // 第一道窗:点降噪口=当前窗立即「不用」+本回合静默(应答点击走页面内直派,
    // 与权威看门狗无赛跑)
    await answerReactionWindow(page, { mode: "mute" });
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
    await answerReactionWindow(page, { mode: "decline" }); // 收尾放行,不留悬窗
  });
});

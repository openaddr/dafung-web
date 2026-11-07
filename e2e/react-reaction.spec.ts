// 反应窗单机回路(#281,#234 P1-D 牌架即反应窗;#303 按 #292 决议改造):
// - 半路杀出三例(拦胜/平局/放行)合并为一例三分支走查(省两次建房);
// - 引擎结算断言接「反应窗应答流程」helper 下沉(单测已在守:reaction-window 22 例
//   全回路 + jinnang.test 唯反应),e2e 每例只留「横幅→点选/不用→结果」接线冒烟
//   + 视觉锚(倒计时弧 / 架上金边 / 灰置印「唯反应」);
// - 超时兜底例已迁无头层(#1181 → test/reaction-watchdog.test.ts 看门狗直驱);
//   降噪口例留接线(点钮→当窗代发+静默自动应答+换回合横幅复显),静默状态机判词
//   下沉 test/reaction-mute.test.ts(reaction-mute 纯函数,#1181);
// - 两处硬等待(出牌阶段采样窗 / choices 重算一拍)换条件 poll(#292 Q4)。
// 权威侧兜底=房间编排反应窗看门狗(#281,room watchdogs)定时代发「不用」(与手点同
// 一条命令路径;#398 单机统一后单机与联机同走房间编排)。注意:权威窗长=引擎
// windowMs 原值,不吃 e2e 倍率(倍率只缩放演出编排,节拍单源 core/timings,#399);
// e2e 经 fixtures 注入 E2E_REACTION_MS=5000 加长权威窗(联机 server env 同款通道,
// 终局 e2e:3s 窗与「断言+读数+应答」点击链在 4 worker 负载下赛跑,误窗应答);横幅
// 展示时长=scaleReactionMs(windowMs)(0.5 倍 → 2500ms 先收回),timeout 例预算按展示
// 时长给、结算按权威窗长等。
// 地图重钉(#949 关中图 28 城 4×7 满格螺旋,seed 1010 × 关中 进程内直扫复算):
// draftOrder=[0,3,1,2] 人类先手;选都 DOM 首格=盘面序最小候选=12 剑阁(引擎候选
// 首格=环序最小,双链同格)(bot 都:黔=2 幽州、荆=10 长沙、宋=3 辽东;bot 起手
// 全唯反应:黔=窃玉偷香、荆=识破诡计、宋=火烧连营——回合开始无 inline 出牌窗痕);
// 起手牌=半路杀出(唯反应,不入可用集)
// → 自动起摇落 13 汉中(无主城)——开局停靠点=购地抉择卷轴(soloAtBuyAsk 等卷轴
// 升起)。续局=force 直授周瑜(heroDefs #378 调试面取定义,槽位行(heroId+全池授技)
// 进麾下;招贤卷轴(卧龙岗@20)在本图种子下开局不再可达。疾行=人类行军步数恒 +1,
// 行程骰队列已计入;火攻=回合 2+ 出牌阶段停靠点来源)+「不取」放行购地卷轴交 bot 链。
// 种植后人类无再手动的回合:窗由 bot 链带到
// (火烧例=bot1 回合开始即出;拦检例=bot 自首都前一格(11 锦囊城)掷骰途经剑阁)。
// bot 手牌/位置/骰队列按用例直写。
// #1216 波3 直通形制(ADR-0058 一环一真):全 7 例头注声明真实段——本族形制=「种局→
// 真打出→窗真开→真应答」:布场/手牌/骰流按用例种植(前置链,判词见各助手与行内),
// 窗开本身恒真引擎行为(bot 真打出反应牌,禁种「窗已开」),应答点击链与结算全真。
// 脊柱例③(识破自保/半路杀出三分支走查)永不深种,零逻辑改动只补声明;force 红牌
// 审计(9 处)逐处判词,公共命令面核查结论=零处可迁(现金/授将/手牌/布位/授城/钉骰
// 均无玩家公共命令,详见各判词);唯反应/混排两例停靠谓词升级 parkMyTurn(严格我的
// 回合+轮询体内代发放行,freeze:false 流程续跑口径,#1216)。
import { test, expect } from "./fixtures";
import {
  force,
  waitMyRollDone,
  skipUntilNextSeat,
  engineState,
  snap,
  parkMyTurn,
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

/** 开局收口(seed 1010 × 关中 #949 重钉,进程内直扫复算):换图后
 *  bot 选都/骰流全变——新链:定都剑阁(12,DOM 首格)、起手唯反应「半路杀出」
 *  自动起摇落汉中(13,无主城)弹购地抉择卷轴。种植类用例的稳定停靠点
 *  (force 在任何相位可用;此停靠点 engine 停在 AwaitingDecision 等输入)。 */
async function soloAtBuyAsk(page: Page): Promise<void> {
  await useHalfScale(page);
  await page.goto("/?seed=1026"); // #1100 起手发放改写骰流,#949 同款重钓(探针实测 1026 首回合落购地格)
  await page.getByTestId(HOME_TID.selectMap).click();
  await page.getByTestId(SETUP_TID.mapItem("guanzhong")).click();
  await page.getByTestId(SETUP_TID.mapConfirm).click();
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.startGame).click();
  // 种植现金(谱前提):开局自动起摇的**第一停**必弹购地卷轴(世界停在
  // 人类回合 1,bot 链不先跑)。起手 5000 扣剑阁建城费 2400 后净剩 2600 不足汉中 3000,
  // 不种则第一停变自动不取,卷轴迟到第二轮——种植大额现金让卷轴与地图价格解耦,
  // 停靠点回第一停。
  // force 判词:现金无玩家公共命令(grantSkillCash 是效果注册表内部通道、「UI/bot
  // 不得使用」且直调会派发假技能得银战报污染日志断言面);购地命令只扣不加,到不了
  // 「种植大额现金」形态。
  // force 前等调试桥 controller 就位(起局瞬间尚为 null,竞态实锤)。
  await page.waitForFunction(() => window.__dafung?.controller() != null);
  await force(page, `e.players[0].cash = 20000;`);
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
}

/** 停靠点续局:force 直授周瑜(疾行=行军 +1、火攻=出牌阶段停靠点来源,多条编排依赖,
 *  勿换将),再「不取」放行购地卷轴——落格结算收尾,回合随即交 bot 链。
 *  force 判词:引擎无「直接授将」公共命令(resolveHeroPick 只在招贤卷轴语境可达,而
 *  招贤卷轴(卧龙岗@20)在本图种子下开局不可达)——heroDefs 调试面(#378 双门禁)是
 *  唯一授将通路,槽位行(heroId+全池授技+空冷却账)进麾下。 */
async function grantZhouyuAndPass(page: Page): Promise<void> {
  await force(
    page,
    `{ const d = __dafung.heroDefs().find((h) => h.id === "zhouyu");
       e.players[0].heroes.push({ heroId: d.id, skillIds: [...d.skillPool], lastFired: {} }); }`,
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
 *  种子 rng(还原后种子流无缝续走)。三分支走查用 [2,5,6,6]:人类骰 2(周瑜疾行
 *  +1 → 自 13 止于 16 凉州可购决策,fx 排空停靠),bot1 骰 5(分支一被拦停剑阁,
 *  续走自 12 迈过 13-16 落 17 函谷关,away 断言不赌落点;bot 未招募零加成),
 *  bot2/3 骰 6(自 11 落 17 函谷关=珍宝城,探宝拼点走 nextFloat,不吃本骰队列;
 *  16/19 两停靠格永不落地——后续分支的停靠前提)。 */
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
 *  剑阁前一格=11 锦囊城);
 *  duelDice=拼点骰(开窗前一次种足,拼点是唯一 rollDie 消费者→各取一粒);
 *  withSecondCity=真时(降噪口例):人类在都城 +2..+4 内首个「有城非都」格挪为第二座
 *  城(关中剑阁 +2=14 街亭,无主奇城无宝,同一份行程的第二道询问);
 *  clearBotHands=真时(降噪口例):清 bot 手牌——seed 1010 bot 起手全唯反应无 inline
 *  窗痕,清场保窗序纯净(守预算余量,无副作用);
 *  marchSteps=行程骰队列(见 marchQueue;分支三专用)。
 *  #398 快速链 + 权威 3s 反应窗:骰必须在开窗前种足、窗内零 force——force 等 fx 排空
 *  吃掉秒级预算,看门狗到点代发「不用」后,紧随的应答会落到下一个 bot 的窗上(实测:
 *  读到的 mover1=1,拼点战报 mover=p2)。行程骰=种子 rng(dice.roll 闭包,不吃
 *  diceQueue)。
 *  force 判词(#1216 波3 审计,四类直写一体):①手牌——引擎只按开局发牌/摸牌时机发牌
 *  (drawJinnang 恒随机抽),无「发指定牌」公共命令,断言面需特定牌形;②bot 布位——
 *  行军命令只归活跃座位自身回合,无「挪 bot 至指定格」公共命令,拦检窗前提=行人贴
 *  首都前一格;③第二城——同 plantDemolishableCity 判词(引擎无授城公共命令,购地受
 *  行军路线+现金约束);④骰队列——种子 rng 是全局流,无「钉骰」公共命令,patch 按值序
 *  局部确定性、耗尽自还原、不消耗 rng(两注入口分属拼点/行程互不串队)。 */
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
 *  demolishOnVictim 排除;都城 +1=13 汉中,relative 扫描自择)+ 全员改持目标/识破牌;
 *  授周瑜「不取」续局后首个行动 bot(bot1 黔)在其回合开始即出火烧(城最多者=人类)。 */
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

test.describe("反应窗(#281 单机)", () => {
  // 真实段(脊柱例③,ADR-0058 永不深种,#1216 只补声明零逻辑改动):反应窗全链全真——
  // 布场后 bot1 回合开始真打出火烧连营→窗真开(横幅/倒计时弧/架上金边/mini 签面几何锚
  // 即窗真开的呈现取证)→点牌落印真应答→识破留痕真结算窗收。前置=真实开局链
  // (soloAtBuyAsk 真 UI 选图开局/选都)+布场种植(判词见 plantCounterScenario 系助手)。
  test("识破自保:横幅+倒计时弧+架上金边→点牌落印→识破留痕窗收(结算下沉单测)", async ({ page }) => {
    await plantCounterScenario(page);
    // 反应窗横幅:事件文案(带目标括注 #921,火烧连营=one 域,目标=城最多者人类)+ 朱砂
    // 倒计时弧;架上识破诡计呼吸金边(.reactive)——视觉锚
    const baseline = await awaitReactionWindow(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    const snap0 = await snap(page);
    await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText(
      `使用【火烧连营】(对 ${snap0.players[0].guohao})`,
    );
    await expect(banner.getByTestId(TESTIDS.reactionTimer)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangCard("识破诡计"))).toHaveClass(/reactive/);
    // mini 签面回正尺寸锚(#834 P0-3,特异性回归哨):hand-rack.css
    // `.hand-rack .jinnang-card{font-size:inherit}`(0-2-0)曾打穿裸 `.reaction-mini`
    // (0-1-0)的 1.3px em 基,签面被撑成 96×128、横幅膨胀 145-200px 高;reaction-banner.css
    // 侧提级 0-3-0 后签面回 19.5×26、横幅回落 ~60px 浮置带。读数页内一次取齐
    // (50ms 轮询自旋),不与短展示窗赛跑。断言上限给足余量:签面 26→32、横幅
    // ~61→80(钮热区 44+padding 主导),特异性回退的 128/145+ 必红。
    const geo = await page.evaluate(
      ({ bannerTid }) =>
        new Promise<{ bannerH: number; miniH: number; miniW: number }>((resolve, reject) => {
          const deadline = Date.now() + 3000;
          const read = () => {
            const b = document
              .querySelector(`[data-testid="${bannerTid}"]`)
              ?.getBoundingClientRect();
            const m = document.querySelector(".reaction-mini")?.getBoundingClientRect();
            if (b == null || b.height <= 0) {
              if (Date.now() > deadline) reject(new Error("横幅几何不可读:窗已收"));
              else setTimeout(read, 50);
              return;
            }
            resolve({ bannerH: b.height, miniH: m?.height ?? 0, miniW: m?.width ?? 0 });
          };
          read();
        }),
      { bannerTid: TESTIDS.reactionBanner },
    );
    expect(geo.miniH, "mini 签面 em 基被特异性打回大卡(#834 回归)").toBeLessThanOrEqual(32);
    expect(geo.miniW, "jinnang 窗 mini 签面缺席(#751 A6 回归)").toBeGreaterThan(0);
    expect(geo.bannerH, "横幅未回落 ~60px 浮置带(#834 回归)").toBeLessThanOrEqual(80);
    // 点牌落印确认,识破留痕 + 窗收(双牌皆耗/城不降级等结算细节由单测守)
    await answerReactionWindow(page, { mode: "counter", card: "识破诡计" });
    await pollReactionSettled(page, baseline, { countered: true });
  });

  // 真实段(#1216):窗真开(bot 真打出,前置判词见 plantCounterScenario 系助手)后,
  // 裸指针长按序列(move→down 700ms→up)+补发 click 抑制的输入语义与详情呈现全真——
  // 「长按开详情不改选中、不双弹」即被测环。
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

  // 真实段(#1216):窗真开(前置判词见 plantCounterScenario 系助手)后,点「不用」
  // 单发命令应答→窗收 use=0 留痕全真——decline 应答接线即被测环(城失结算面已下沉
  // test/reaction-window.test.ts,见分类表)。
  test("不用路径:点「不用」立即应答→窗收留痕(城失结算下沉单测)", async ({ page }) => {
    await plantCounterScenario(page);
    const baseline = await awaitReactionWindow(page);
    await answerReactionWindow(page, { mode: "decline" });
    await pollReactionSettled(page, baseline, { declined: true });
  });

  // 超时兜底例已迁(#1181):权威侧定时代发「不用」的看门狗语义落点
  // test/reaction-watchdog.test.ts(room/watchdogs 编排层直驱,ManualClock 手泵);
  // 残留的横幅收回时机面守不住回归(分不清投影定时收与看门狗收),按 ADR-0056
  // 「骨架例是负资产」整删不缩。

  // 真实段(脊柱例③,ADR-0058 永不深种,#1216 只补声明零逻辑改动):三分支全链全真——
  // 三 bot 各自行程真途经首都格开拦检窗,页内原子应答(读 mover→选牌落印/点「不用」)
  // →真拼点→真结算(拦胜止步落格/平局牌白耗续走/放行牌不耗),一例串三环时序语义即
  // 被测环;拼点签面判词/钤落弧/震屏时长通道为真结算的呈现取证。前置判词见
  // soloAtBuyAsk(现金)/plantAmbush(布位/手牌/骰)/grantZhouyuAndPass(授将)与行内。
  // #1216 判读:分支二/三停靠谓词按波2 定性有「bot 回合询问期误停」风险,当时脊柱例
  // 零逻辑改动纪律(ADR-0058 ③)下不升级,严格谓词 parkMyTurn 上收共享备后续波处置
  // ——波5b #1218 处置(今日负载挂「半路杀出」×2):分支二/三换 parkMyTurn
  // (freeze:false,窗流续跑口径同唯反应例)。只换停靠谓词,种植与断言面零改动,
  // 脊柱例「永不深种」纪律不破(误停自愈从「赌 5s 看门狗代发」变为谓词内代发放行)。
  test("半路杀出三分支走查:拦胜止步落格→平局牌白耗续走→点不用放行牌不耗", async ({ page }) => {
    await soloAtBuyAsk(page);
    // 火攻停点钉子:p2 都城升 Lv.1(可降级)→ 周瑜火攻自人类回合 2 起恒可指定,
    // 每个人类回合开始必停出牌阶段(parkMyTurn 停靠点与行程骰解耦,不赌落格)。
    // force 判词:扩军命令(upgradeProperty)只作用于活跃座位自身的待决决策,bot 城
    // 升级归 botAct 代答、测试不可直呼;断言面需「p2 都城 Lv1=火攻可指定」形态。
    await force(page, `e.players[2].properties[0].level = 1;`);
    // 只留首都一道窗:三 bot 各自行程各开一问,顺序吃满三分支(#292 Q1 合并)。
    // #398 快速链 + 权威反应窗(5s):拼点骰开窗前种足、窗内零 force(force 等 fx 排空
    // 会撞看门狗代发,应答落到下一个 bot 的窗上);mover 读取与应答合并为页面内原子
    // 操作(answerMarchCounter)——读与答同一窗,无 CDP 往返竞速。
    // 购地卷轴停靠点种植后授周瑜「不取」续局:回合随即收尾,座位序首位 bot(黔)自
    // 11(锦囊城)掷骰途经剑阁开窗。
    // marchSteps [2,6,6](#882):三个 bot 的行程骰全钉——不只为分支一本身(拦检窗在
    // 途经首格 12 开,骰面无关),更为「后续 bot 链不得买走 16/19 停靠格」:分支二/三的
    // 人类停靠点=16/19 可购决策,是「停靠让 fx 排空」的前提;自然骰下后续 bot 若恰落
    // 停靠格购地,人类续局掷 2(+疾行)落格变交租,行军不停——人类自己的行军与 bot 链
    // 合并成单批,表现块播放超过横幅展示寿命(sc(windowMs)=2.5s),
    // answerMarchCounter 的「fx 排空 ∧ 横幅在场」应答交集变空,5s 权威窗内答不进去,
    // 看门狗逐窗代发不用(45s 超时,挂起实锤见票 #882 定性)。钉骰:bot1=2(途经 12
    // 开窗即可,落 13 买走汉中无碍——人类分支二自 13 起步);bot2/3=6(自 11 落 17
    // 函谷关=珍宝城,探宝拼点走 nextFloat,不吃本骰队列)。
    await plantAmbush(page, { duelDice: [6, 1], withSecondCity: false, marchSteps: [2, 6, 6] });
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
    // 钤落弧时长追帧通道探针(#849 棒3):duel-sign-land 时长由消费点内联注入
    // DUEL.landMs(scStage),不再是 fx.css 字面量——本例 0.5 倍率(useHalfScale)下
    // sc(260)=130ms;字面量回潮(时长失通道)读数恒 260ms,即此红。
    const landDur = await duelWin
      .locator(".duel-sign.duel-sign-land")
      .first()
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(landDur, "钤落弧时长未走消费点内联注入(#849 棒3)").toBe("0.13s");
    // 大胜档震屏时长追帧通道探针(#885):判词拍 shakeDeskBlowout 向 #board-wrap
    // 内联注入 DESK.blowoutMs(scStage),fx.css 不再持 0.45s 字面量——本例 0.5 倍率
    // (useHalfScale)下 sc(450)=225ms。字面量回潮(时长失通道)读数恒 0.45s,
    // 注入断裂读 0s,均此红;内联时长随类驻留(类自摘不清 style),判词拍后读数
    // 稳定无竞态。
    const shakeDur = await page
      .locator("#board-wrap")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(shakeDur, "大胜档震屏时长未走消费点内联注入(#885)").toBe("0.225s");
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
    // 骰队 → 放行)。停靠=回合开始出牌阶段(火攻钉子)。行程骰队列 [2,5,6,6]:人类骰 2
    // (+疾行自 13 止于 16 凉州可购决策——**停靠让 fx 排空**,且保住「人类行军批与 bot 链
    // 批分离」:人类停在可购决策,行军批先播完、fx 排空在停靠点上,answerMarchCounter
    // 的 fx 门在 5s 权威窗内有空档可答(#882:人类不停则两批合并单块,横幅先于 fx 排空
    // 收回,应答交集变空挂死));
    // bot1 骰 5(分支一被拦停剑阁,自 12 续走必迈过 16 落 17 函谷关,16 不被买回)、
    // bot2/3 骰 6(同分支一:自 11 落 17,16/19 停靠格保持无主到分支三),away 不赌自然骰。
    await parkMyTurn(page, 60_000, { freeze: false }); // 波5b #1218 加网,见本例头注
    await plantAmbush(page, { duelDice: [3, 3], withSecondCity: false, marchSteps: [2, 5, 6, 6] });
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
    // 停靠=回合开始出牌阶段(火攻钉子)。人类骰 2(+疾行)落远格停靠,fx 排空原理
    // 同分支二。
    // #830 守门:bot 行程前提不再赌前两支走完后的散布推演(#882→T4b 调价两度漂移实锤
    // ——价位改 bot 购地/交涉决策,链式挪动后续 bot 的站位,窗前提静默失效)——
    // 行程前 force 首位 bot(黔,座 1)贴到首都格前一格、骰 2 第一步即过首都开窗,前提
    // 自锚;放行后续走 2 步落 13(bot1 自家汉中,升级决策 bot 链自清,away=13≠12 恒真)
    // ——不赌 bot 自带疾行等加成(bot 招募/技能是现金决策,加成会挪落格);其余 bot 骰 6
    // 即便跟进过首都也是 #292 合并窗,看门狗代发不用、牌不耗。
    await parkMyTurn(page, 60_000, { freeze: false }); // 波5b #1218 加网,见本例头注
    // force 判词:同 plantAmbush 布位(#830 守门自锚——bot 挪位无公共命令,链式调价
    // 漂移下把首位 bot 贴回首都前一格,骰 2 第一步即过首都开窗,前提自锚)。
    await force(
      page,
      "e.players[1].position = (e.players[0].capitalIndex + e.board.count - 1) % e.board.count;",
    );
    await plantAmbush(page, { withSecondCity: false, marchSteps: [2, 2, 6, 6] });
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

  // 真实段(#1216):火攻引出的真出牌窗态内,唯反应灰置印(禁用态+原因条)呈现与
  // 放行「不出」→#188 自动起摇→一手自动走完的相位推进全真——「灰置不入可用集」与
  // 「放行后照常自动起摇」即被测环。前置判词见 soloAtBuyAsk(现金)/grantZhouyuAndPass
  // (授将)与行内(换牌/升城)。
  // #1216 停靠升级:waitJinnangStop 换 parkMyTurn(freeze:false)——严格谓词多钉
  // activeIndex===0 且轮询体内代发放行:关中 startingTreasures=2(#1172),bot 回合
  // 途中落人类城会把 AwaitingTreasureOwner 卷轴开给人类(引擎等输入、bot 链悬停),
  // 旧谓词只认相位不代放行 = 等待死锁;火攻钉子下首个我的回合停靠=回合开始出牌窗态,
  // 窗内灰置断言前提不变。不冻结:放行后的自动起摇是时钟回调本体,冻结即死锁。
  test("出牌阶段「唯反应」:两张反应牌皆灰置不入可用集,放行后照常自动起摇", async ({ page }) => {
    test.setTimeout(90_000); // bot 链(含 p2 求贤令窗 5s 看门狗代发)+ 两段行程,60s 基线偏紧
    await soloAtBuyAsk(page); // 停稳购地卷轴(#303 轻瘦身:手搓开局链路收口 soloAtBuyAsk)
    // 购地停靠点换牌 + 火攻引窗:人类手牌换成两张反应牌(唯反应不入 choices 可用集,
    // 双牌皆灰置);唯反应手牌自身起不了窗态(seed 7 起手即唯反应,开局无窗可驻),
    // p1 都城升 Lv.1(可降级)使周瑜火攻可指定 → 人类回合 2 出牌阶段窗态必升起,唯反应灰置
    // 得以在活窗内验证。(#303 实测注仍立:窗态对唯反应手牌驻留、等「不出」点击;
    // 「窗不在场」断言本就不成立,可守的本质=灰置印 + 放行后自动起摇。)
    // force 判词:换牌=手牌无「发指定牌」公共命令(同 plantAmbush ①);升城=扩军命令
    // 只作用于活跃座位自身待决决策,bot 都城升级测试不可直呼(同三分支火攻钉子)。
    await force(
      page,
      `
      e.players[0].jinnangHand = ["识破诡计", "半路杀出"];
      e.players[1].properties[0].level = 1;
    `,
    );
    await grantZhouyuAndPass(page);
    await parkMyTurn(page, 60_000, { freeze: false }); // 严格我的回合停靠,见本例头注
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
    // 采样全打在人类回合内,赌自然落格必挂。骰 1(+疾行自 13 → 15 咸阳可购决策)把「一手
    // 走完」钉成确定性停靠。
    await force(page, marchQueue(1));
    // 放行后照常自动起摇:人类当前一手自动走完(#188)
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
  });

  // 真实段(#1216):火攻引出的真出牌窗态内,混排手牌的灰置印「唯反应」与可用牌照常
  // 可出(禁用态分域)呈现全真——choices 按域分流的呈现接线即被测环(城最多者目标段
  // 回窗内再验)。前置判词见 soloAtBuyAsk(现金)/grantZhouyuAndPass(授将)与行内
  // (换牌/升城);停靠升级同唯反应例(parkMyTurn freeze:false,理由见该例头注)。
  test("出牌阶段混排:反应牌灰置印「唯反应」,可用牌照常可出", async ({ page }) => {
    await soloAtBuyAsk(page); // 停稳购地卷轴
    // 购地停靠点换牌:火烧连营可用(城最多者目标段回窗内再验)→ 人类回合 2 出牌阶段窗态升起。
    // seed 1010 关中:回合 2 时 bot 尚无第二座城(都城 Lv0 不算可毁),唯反应例同款
    // 把 p1 都城升 Lv.1 立起「可降级」目标,火烧连营方入可用集。
    // force 判词:换牌=手牌无「发指定牌」公共命令(同 plantAmbush ①);升城=扩军命令
    // 只作用于活跃座位自身待决决策,bot 都城升级测试不可直呼(同三分支火攻钉子)。
    await force(
      page,
      `
      e.players[0].jinnangHand = ["火烧连营", "识破诡计"];
      e.players[1].properties[0].level = 1;
    `,
    );
    await grantZhouyuAndPass(page);
    await parkMyTurn(page, 60_000, { freeze: false }); // 严格我的回合停靠,同唯反应例
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

  // 真实段(#1216):第一道拦检窗(bot 真途经首都开出,前置判词见 plantAmbush)上点
  // 「本回合不再询问」→ 当窗立即代发不用+横幅即收;同一 mover 第二道窗被静默自动代发
  // (全程仅一次人工点击、两条应答留痕=接线证据);回合变更横幅复显后点「不用」收尾
  // ——降噪口接线即被测环(静默状态机判词已下沉 test/reaction-mute.test.ts)。
  test("降噪口:点「本回合不再询问」后同回合后续询问不弹横幅、下回合恢复", async ({ page }) => {
    await soloAtBuyAsk(page);
    // 第二城=都城 +2(14 街亭):同一 mover 连开两道拦检窗。
    // clearBotHands:清 bot 手牌保「两份应答」计数纯净(seed 1010 bot 起手全唯反应,
    // 本无 inline 窗痕,守余量;见 plantAmbush 注)。行程骰钉子 [5]:购地停靠点种植后
    // 续局,首个行程骰=bot1(座 1)的——骰 5 自 11 必连穿 12(窗1=剑阁)与 14
    // (窗2=街亭),w2 的到达不赌自然骰。授周瑜「不取」续局。
    await plantAmbush(page, { clearBotHands: true, marchSteps: [5] });
    await grantZhouyuAndPass(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 45_000 });
    // 第一道窗:点降噪口=当前窗立即「不用」+本回合静默(应答点击走页面内直派,
    // 与权威看门狗无赛跑)
    await answerReactionWindow(page, { mode: "mute" });
    // 第二道窗(同一 mover 途经第二座城)被静默自动代发不用:全程只有一次人工点击,
    // 应答却有两条 = 第二份必出自静默代发(接线面;静默状态机判词已下沉
    // test/reaction-mute.test.ts,#1181;不用不耗牌的引擎面归 reaction-window 单测)。
    // 数据源=权威口 log(#1242):对局日志是快照携带字段(折叠契约不带),门控后玩家
    // 侧副本只在校准点离散更新——玩家侧恰值/时序不可保证,恰两条的确定性读数取权威
    // 账本(只读,非种植;权威口读断言见 react-helpers force 判词)。
    await expect
      .poll(
        async () =>
          engineState(
            page,
            `window.__dafung.getAuthorityEngine().snapshot().log.filter((l) => l.detail.includes("reactionRespond")).length`,
          ),
        { timeout: 20_000 },
      )
      .toBe(2);
    // 回合变更(bot 换位)自动解除静默:下一 mover 的拦检窗横幅恢复弹出
    await expect(banner).toBeVisible({ timeout: 45_000 });
    await answerReactionWindow(page, { mode: "decline" }); // 收尾放行,不留悬窗
  });
});

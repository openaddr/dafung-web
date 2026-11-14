// 地板名册(ADR-0062):地板·脊柱构造器×2(识破自保/三分支走查=脊柱③)+几何钉×1(长按开详情=真实输入)
// 反应窗单机回路(#281,#234 P1-D 牌架即反应窗;#303 按 #292 决议改造)——
// **#1317 批T3 后本 spec 只余名册地板三例**:脊柱③识破自保(mini 签面几何哨 #834+
// 倒计时弧呈现取证)、半路杀出三分支走查(三环时序语义+拼点签面/fx 时长通道探针
// #849/#885)、长按开详情(#751 A1 裸指针 700ms 输入时序=真实输入语义);可迁移余量
// 3 例(不用路径、唯反应灰置、降噪口)已下放接线层 `test/wiring/battle-wiring.test.tsx`
// (ADR-0062 层④:窗载荷经 armReaction 种植、应答走 respondReaction 真命令,判词见
// 该文件头注)。引擎结算断言早已下沉(单测守:reaction-window
// 22 例全回路 + jinnang.test 唯反应 + reaction-watchdog 看门狗 + reaction-mute 静默
// 状态机),本 spec 只留脊柱呈现取证与真实输入语义。
// 权威侧兜底=房间编排反应窗看门狗(#281,room watchdogs)定时代发「不用」(与手点同
// 一条命令路径;#398 单机统一后单机与联机同走房间编排)。注意:权威窗长=引擎
// windowMs 原值,不吃 e2e 倍率(倍率只缩放演出编排,节拍单源 core/timings,#399);
// e2e 经 fixtures 注入 E2E_REACTION_MS=5000 加长权威窗(联机 server env 同款通道);
// 横幅展示时长=scaleReactionMs(windowMs)(0.5 倍 → 2500ms 先收回)。
// 地图重钉(#949 关中图 28 城 4×7 满格螺旋,seed 1010 × 关中 进程内直扫复算):
// draftOrder=[0,3,1,2] 人类先手;选都 DOM 首格=盘面序最小候选=12 剑阁;起手牌=半路
// 杀出(唯反应,不入可用集)→ 自动起摇落 13 汉中(无主城)——开局停靠点=购地抉择
// 卷轴(soloAtBuyAsk 等卷轴升起)。续局=授周瑜(armHero 种植件 #1300)+「不取」放行
// 购地卷轴交 bot 链。种植后人类无再手动的回合:窗由 bot 链带到(火烧例=bot1 回合开始
// 即出;拦检例=bot 自首都前一格掷骰途经剑阁)。
// #1216 波3 直通形制(ADR-0058 一环一真):脊柱例③(识破自保/三分支走查)永不深种,
// 零逻辑改动只补声明;「长按」例到站=quickStart preRoll 直通(soloAtBuyAskQuick,
// #1280 负载窗根治,窗开恒真不变),种植数学/绝对格判词原样保留。
// #1280 负载窗根治(到站换轨):真路到站链在机器进程水位窗内爬不完 30s waitFor
// (水位=bun/node 进程叠加,纯 CPU 燃烧 6 核不复现,#1280 进程取证);全池由水位闸
// (scripts/e2e-one.ts,bun+node≥28 拒跑)护航。
import { test, expect } from "../fixtures";
import {
  skipUntilNextSeat,
  engineState,
  parkMyTurn,
  plantDemolishableCity,
  awaitReactionWindow,
  answerReactionWindow,
  answerMarchCounter,
  pollReactionSettled,
  openSoloSetup,
  quickStart,
  unfreezeClock,
  useHalfScale,
} from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../../src/app/screens/game/scroll/testids";
import type { Page } from "@playwright/test";
import { TID as SETUP_TID } from "../../src/app/screens/setup/testids";
import { HOME_TID } from "../../src/app/screens/home/testids";

/** 开局收口(seed 1010 × 关中 #949 重钉,进程内直扫复算):换图后
 *  bot 选都/骰流全变——新链:定都剑阁(12,DOM 首格)、起手唯反应「半路杀出」
 *  自动起摇落汉中(13,无主城)弹购地抉择卷轴。种植类用例的稳定停靠点
 *  (种植在任何相位可用;此停靠点 engine 停在 AwaitingDecision 等输入)。
 *  脊柱③真路到站(#1280):识破自保/三分支两例专用,真实自走链保留、一行禁碰;
 *  长按例走 soloAtBuyAskQuick(quickStart 直通)。 */
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
  // 现金种植走 setCash 数值族种植件(#1299,判词单源 src/core/planter.ts:现金无玩家
  // 公共命令,grantSkillCash 直调会派发假技能得银战报污染日志断言面,购地命令只扣
  // 不加——种植段要终态=直写唯一通路)。
  // 种植前等调试桥 controller 就位(起局瞬间尚为 null,竞态实锤)。
  await page.waitForFunction(() => window.__dafung?.controller() != null);
  await plant(page, { kind: "setCash", seat: 0, cash: 20000 });
  await page.locator(".bv-tile.bv-selectable").first().click();
  await page.getByTestId(TESTIDS.confirmCapitalOk).click();
  await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
}

/** 到站构造器(#1280 负载窗根治,react-short-stage #1256 同款到站换轨):quickStart
 *  preRoll 直通替代真实自走到站链。重钓 seed 49(探针 tmp 直扫 1-600 中选,canary
 *  同款判据):min(offeredCapitals)=12 剑阁(registry 桥选都=棋盘序最小,与 UI DOM
 *  首格同格)、draftOrder=[0,3,1,2] 人类先手、起手唯反应「半路杀出」(1010 家族同
 *  签名;bot 起手半路杀出/火烧连营/窃玉偷香全唯反应,无 inline 窗痕)。
 *  到站等价性(与 soloAtBuyAsk「卷轴停靠」同形):人类回合 1、落都剑阁 12 未掷
 *  (preRoll 冻结在自动起摇定时器点火前)+ 现金种 20000(setCash 种植件,#1299)+ 行程骰
 *  钉 1(pinDice 种植件 #1302,判词单源 src/core/planter.ts;自 12 落 13 汉中无主城,
 *  与旧链自然落格同格)→ 解冻自动起摇 → 购地卷轴升起停靠(引擎等输入,世界停人类
 *  回合 1)。种植前提(现金/都城/手牌)全可种,窗开恒真不变。 */
async function soloAtBuyAskQuick(page: Page): Promise<void> {
  await useHalfScale(page);
  await quickStart(page, 49, { mapId: "guanzhong", advance: "preRoll" });
  // 种植前等调试桥 controller 就位(起局瞬间尚为 null,竞速实锤,同 soloAtBuyAsk)
  await page.waitForFunction(() => window.__dafung?.controller() != null);
  await plant(page, { kind: "setCash", seat: 0, cash: 20000 });
  await plant(page, { kind: "pinDice", channel: "march", values: [1] });
  await unfreezeClock(page);
  await page.getByTestId(SCROLL_TESTIDS.buyScroll).waitFor({ timeout: 30_000 });
}

/** 停靠点续局:授周瑜(疾行=行军 +1、火攻=出牌阶段停靠点来源,多条编排依赖,
 *  勿换将),再「不取」放行购地卷轴——落格结算收尾,回合随即交 bot 链。
 *  授将走 armHero 种植件(#1300,判词单源 src/core/planter.ts:引擎无「直接授将」
 *  公共命令,resolveHeroPick 只在招贤卷轴语境可达;skillIds 缺省=整池原序)。 */
async function grantZhouyuAndPass(page: Page): Promise<void> {
  await plant(page, { kind: "armHero", seat: 0, heroId: "zhouyu" });
  await page.getByTestId(TESTIDS.actionButton("skip")).click();
}

/** 拦检窗就绪种植:人类持半路杀出;三 bot 全部落位人类都城前一格(掷 ≥1 即途经,
 *  剑阁前一格=11 锦囊城);
 *  duelDice=拼点骰(开窗前一次种足,拼点是唯一 rollDie 消费者→各取一粒);
 *  withSecondCity=真时(降噪口例):人类在都城 +2..+4 内首个「有城非都且无主」格挪为
 *  第二座城(关中剑阁 +2=14 街亭,无主奇城无宝,同一份行程的第二道询问);
 *  clearBotHands=真时(降噪口例):清 bot 手牌——seed 1010/49 bot 起手全唯反应无
 *  inline 窗痕,清场保窗序纯净(守预算余量,无副作用);
 *  marchSteps=行程骰钉队列(pinDice march 口,分支三专用)。
 *  #398 快速链 + 权威 3s 反应窗:骰必须在开窗前种足、窗内零桥写——plant 三拍等演出
 *  排空吃掉秒级预算,看门狗到点代发「不用」后,紧随的应答会落到下一个 bot
 *  的窗上(实测:读到的 mover1=1,拼点战报 mover=p2)。行程骰=种子 rng(march 口,
 *  不吃拼点口队列——两注入口互不串队,判词见 pinDice)。
 *  种植件(判词单源 src/core/planter.ts):①手牌=giveJinnang(#1298);②bot 布位=
 *  placePlayer(#1300);③第二城=grantProperty(#1300);④骰队列=pinDice(#1302)。 */
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
  await plant(page, { kind: "giveJinnang", seat: 0, cards: ["半路杀出"] });
  const { cap, seats, tiles } = await engineState(
    page,
    "{ cap: e.players[0].capitalIndex, seats: e.players.length, tiles: e.board.count }",
  );
  const position = (cap + tiles - 1) % tiles;
  for (let seat = 1; seat < seats; seat++)
    await plant(page, { kind: "placePlayer", seat, position });
  if (clearBotHands)
    for (let seat = 1; seat < seats; seat++)
      await plant(page, { kind: "giveJinnang", seat, cards: [] });
  if (withSecondCity) {
    const pid: string = await engineState(
      page,
      `(() => {
      for (const k of [2, 3, 4]) {
        const c = (${cap} + k) % ${tiles};
        const t = e.board.at(c);
        if (t.propertyId && !e.players.some((p) => p.capitalIndex === c) && !e.findOwner(t.propertyId))
          return t.propertyId;
      }
      throw new Error("种植失败:都城 +2..+4 无可挪城池格");
    })()`,
    );
    await plant(page, { kind: "grantProperty", seat: 0, propertyId: pid, level: 1 });
  }
  if (marchSteps) await plant(page, { kind: "pinDice", channel: "march", values: marchSteps });
  if (duelDice) await plant(page, { kind: "pinDice", channel: "duel", values: duelDice });
}

/** 火烧连营窗种植:人类挪入一座非都城(0 级)= 全场唯一「可失之城」(都城不可拆,
 *  demolishOnVictim 排除;都城 +1=13 汉中,relative 扫描自择)+ 全员改持目标/识破牌;
 *  授周瑜「不取」续局后首个行动 bot(bot1 黔)在其回合开始即出火烧(城最多者=人类)。 */
async function plantCounterScenario(page: Page): Promise<void> {
  await soloAtBuyAsk(page);
  await plantDemolishableCity(page);
  await plant(page, { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] });
  const seats = (await engineState(page, "e.players.length")) as number;
  for (let seat = 1; seat < seats; seat++)
    await plant(page, { kind: "giveJinnang", seat, cards: ["火烧连营"] });
  await grantZhouyuAndPass(page);
}

/** 火烧连营窗种植(构造器到站版,#1280):与 plantCounterScenario 同种植
 *  (plantDemolishableCity + 双方手牌种植 + 授周瑜放行,判词逐条见原版),
 *  唯到站换轨 soloAtBuyAskQuick——脊柱例①(识破自保)保持原版真路到站不动
 *  (ADR-0058 一行禁碰),长按例走本构造器。 */
async function plantCounterScenarioQuick(page: Page): Promise<void> {
  await soloAtBuyAskQuick(page);
  await plantDemolishableCity(page);
  // 双方手牌走 giveJinnang 种植件(#1298 判词单源 src/core/planter.ts)。
  await plant(page, { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] });
  const seats = (await engineState(page, "e.players.length")) as number;
  for (let seat = 1; seat < seats; seat++)
    await plant(page, { kind: "giveJinnang", seat, cards: ["火烧连营"] });
  await grantZhouyuAndPass(page);
}

test.describe("反应窗(#281 单机;#1317 批T3 后=名册地板三例)", () => {
  // 真实段(脊柱例③,ADR-0058 永不深种,#1216 只补声明零逻辑改动):反应窗全链全真——
  // 布场后 bot1 回合开始真打出火烧连营→窗真开(横幅/倒计时弧/架上金边/mini 签面几何锚
  // 即窗真开的呈现取证)→点牌落印真应答→识破留痕真结算窗收。前置=真实开局链
  // (soloAtBuyAsk 真 UI 选图开局/选都)+布场种植(判词见 plantCounterScenario 系助手)。
  test("识破自保:横幅+倒计时弧+架上金边→点牌选份落印→识破留痕窗收(结算下沉单测)", async ({
    page,
  }) => {
    await plantCounterScenario(page);
    // 反应窗横幅:事件文案(带目标括注 #921;火烧连营=城指向域 #1389,括注=受影响
    // 城清单——火源+前方 1、2 格波及,人类唯一可失之城(plantDemolishableCity 全场
    // 唯一可拆城)恒在其中)+ 朱砂倒计时弧;架上识破诡计呼吸金边(.reactive)——视觉锚
    const baseline = await awaitReactionWindow(page);
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    // 受击城=人类名下唯一非都城(plantDemolishableCity 种植保证);括注与识破选份都锚它
    const hit = await engineState(
      page,
      `(() => {
      const cap = new Set(e.players.map((p) => p.capitalIndex));
      for (let t = 0; t < e.board.count; t++) {
        const tile = e.board.at(t);
        if (tile.propertyId && !cap.has(t) && e.findOwner(tile.propertyId) === e.players[0])
          return { tile: t, name: tile.name };
      }
      throw new Error("布场失真:人类无非都城受击城");
    })()`,
    );
    // 括注=受影响城清单(火源+波及城名串,清单内容随 bot 火源选择走,不钉死);
    // 两个半断言:牌名括注前缀 + 受击城名在清单(=可保份在场,选份锚合法)
    const text = banner.getByTestId(TESTIDS.reactionText);
    await expect(text).toContainText("使用【火烧连营】(对 ");
    await expect(text).toContainText(hit.name);
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
    // 城指向域应答=点牌→选受击城份令牌→落印(#1389 未选份落印禁用);识破留痕 + 窗收
    // (双牌皆耗/城不降级等结算细节由单测守)
    await answerReactionWindow(page, { mode: "counter", card: "识破诡计", seat: hit.tile });
    await pollReactionSettled(page, baseline, { countered: true });
  });

  // 真实段(#1216):窗真开(bot 真打出,前置判词见 plantCounterScenario 系助手)后,
  // 裸指针长按序列(move→down 700ms→up)+补发 click 抑制的输入语义与详情呈现全真——
  // 「长按开详情不改选中、不双弹」即被测环。真实输入语义=happy-dom 无真值通路
  // (ADR-0062 迁移判据),永留浏览器。
  // #1280 到站=quickStart 直通(plantCounterScenarioQuick,负载窗根治),窗开恒真不变。
  test("反应窗长按开牌面详情(#751 A1):既有弹层纯接线,窗内不双弹", async ({ page }) => {
    await plantCounterScenarioQuick(page);
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
    // 预算 120s(scoped,#1328;#1310 react-tutorial 同款判词):三环时序语义最长例,
    // 串行 ~30s,W4 满载 2×+ 退化撞 60s 全局预算(负载族签名,零种植零交集;2026-11-08
    // 快池收口 W4 挂 1 例、串行复验 3/3 绿=此因)——脊柱③不可删(ADR-0058 ③),
    // #987 例外条款=一两行确定性改造,scoped 预算复位,快跑零成本。
    test.setTimeout(120_000);
    await soloAtBuyAsk(page);
    // 火攻停点钉子:p2 都城升 Lv.1(可降级)→ 周瑜火攻自人类回合 2 起恒可指定,
    // 每个人类回合开始必停出牌阶段(parkMyTurn 停靠点与行程骰解耦,不赌落格)。
    // 授等级走 grantProperty 种植件(#1300,判词单源 src/core/planter.ts)。
    const p2CapitalPid: string = await engineState(
      page,
      "e.board.at(e.players[2].capitalIndex).propertyId",
    );
    await plant(page, { kind: "grantProperty", seat: 2, propertyId: p2CapitalPid, level: 1 });
    // 只留首都一道窗:三 bot 各自行程各开一问,顺序吃满三分支(#292 Q1 合并)。
    // #398 快速链 + 权威反应窗(5s):拼点骰开窗前种足、窗内零桥写(plant 三拍等 fx 排空
    // 会撞看门狗代发,应答落到下一个 bot 的窗上);mover 读取与应答合并
    // 为页面内原子操作(answerMarchCounter)——读与答同一窗,无 CDP 往返竞速。
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
    // 行程前种植首位 bot(黔,座 1)贴到首都格前一格、骰 2 第一步即过首都开窗,前提
    // 自锚;放行后续走 2 步落 13(bot1 自家汉中,升级决策 bot 链自清,away=13≠12 恒真)
    // ——不赌 bot 自带疾行等加成(bot 招募/技能是现金决策,加成会挪落格);其余 bot 骰 6
    // 即便跟进过首都也是 #292 合并窗,看门狗代发不用、牌不耗。
    await parkMyTurn(page, 60_000, { freeze: false }); // 波5b #1218 加网,见本例头注
    // 布位走 placePlayer 种植件(#1300,判词单源 src/core/planter.ts;#830 守门自锚)。
    const { cap, tiles } = await engineState(
      page,
      "{ cap: e.players[0].capitalIndex, tiles: e.board.count }",
    );
    await plant(page, { kind: "placePlayer", seat: 1, position: (cap + tiles - 1) % tiles });
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
});

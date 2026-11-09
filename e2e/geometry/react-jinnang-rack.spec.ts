// 地板名册(ADR-0062):地板·几何钉×8(长按×3/hover 挥出=真实输入,叠加窥条与相邻间隙=几何,收起贴底位移=boundingRect,reduced-motion 入场=动画时序)
// 底部常驻手牌架(#238 一期 T3):起手牌在架内、点牌详情弹层(开/关)、长按同效、
// 他人回合显隐(回合联动+决策保底:bot 回合自动收起,回合回来自动弹回)。
// 空态斜牌背不做 DOM 断言(起手必 1 张,永不空),视觉证据归截图 tmp/ui-shots/t3/
// (tmp/shot-t3-rack.mjs 构造空手牌)。
// 断言口径:牌面文案断牌名(def.id/def.text),不断样式(样式归原型基线);
// 例外:文末 reduced-motion 用例(#239 T4 验收门)钉计算样式——动效退场是行为
// 契约不是视觉基线,delay/时长/不透明度只能从 getComputedStyle 取证。
// #305:入场级联/挥出过渡的固定硬等待(1200/300ms)换几何落定轮询——两拍盒模型全同
// 即视为落定;长按 700ms 是输入语义(越过 500ms 长按判定窗),全套件唯一保留的硬等待。
// 另载:出牌窗灰置牌(#715)、锦囊架临时收起重钉五条(会话临时态/banner-only/
// 选中态跨收起/呼吸钮/窗在场压回合归属;窗态可收起后本 spec 既有用例的「架可见」
// 前提仍恒真——各例均钉在我的回合或窗态在场)。
// #1215 棒1 确定性改造(#987 处置序;ADR-0058 一环一真):全例 15 例无 seed 曾靠自然
// 停点(随机停点 7/8 过的存量不可靠户)——现逐例固定 seed(1471-1485,避开既有种子谱
// 67/1010/1026/42/7/49/63/419/1101),quickStart 快路径经 seedSolo 把种子注入引擎,
// bot 轮走位与停靠相位随 seed 钉死;真实段声明与种植判词见各例头注(判词单源
// src/core/planter.ts,ADR-0058 种植合法性分层)。
// #1289 批二迁移:显隐状态机两例(「他人回合:架自动收起/回合回来自动弹回」「呼吸钮
// .breathe 四态走查」)迁入接线层 test/wiring/popup-state-wiring.test.tsx——断言面纯挂载
// 有无与类名挂点(store 快照驱动+点击→状态机),零几何零真实输入语义。
// #1315 批T1 迁移:再迁 5 例(13→8)——「起手 1 张点牌详情/Esc 关闭」「唯反应灰置牌
// 点击开详情/印条」「收起契约①出牌窗收起生效/②选中态跨收起/⑤他人回合反应窗决策保底」
// 迁入接线层 test/wiring/jinnang-wiring.test.tsx(详情/灰置/窥探/secrecy/自机域文件)与
// test/wiring/popup-state-wiring.test.tsx(收起契约族,与 #1289 显隐两例同主题);本 spec
// 存例 8 =几何哨与长按/hover/reduced-motion 真实输入语义(名册地板,永留浏览器)。
import { test, expect } from "../fixtures";
// parkMyTurn(#1216 波3)上收 react-helpers 共享:语义注释随迁见该函数注(本 spec 调用
// 全走缺省 freeze=true 停车坪口径)。
import { parkMyTurn, pollReactionSettled, quickStart, snap } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import type { Page } from "@playwright/test";

/** 盒模型序列化(getBoundingClientRect 的 plain object,便于跨 evaluate 搬运断言)。 */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 读手牌行内全部牌钮的几何 + 行容器与架体的关键横界(几何断言单一取数口)。 */
async function rackGeometry(page: Page): Promise<{ cards: Box[]; row: Box; rack: Box }> {
  return page.evaluate((sel) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const row = document.querySelector(`[data-testid="${sel}"]`);
    if (!row) throw new Error("手牌行不在 DOM:架未渲染或手牌为空");
    const rack = row.closest(".hand-rack");
    if (!rack) throw new Error("手牌行不在架内:DOM 结构漂移");
    return {
      cards: [...row.querySelectorAll(":scope > button")].map(rect),
      row: rect(row),
      rack: rect(rack),
    };
  }, TESTIDS.jinnangHand);
}

/** 几何落定轮询(#305 替代固定硬等待):单次 evaluate 内反复采样同一份盒模型,两拍
 *  (150ms)全同且行子树有限动画全部 finished 才视为落定并返回该样本;行缺失先等
 *  出现,deadline 内仍未落定即抛错(零兜底:落不下来是 bug,让它炸)。
 *  「动画全 finished」门槛(#987 接力定性):入场级联 rack-card-in 带 backwards
 *  填充,延迟期卡片按 from 帧 translateY(14px) 持住——矩形静止,两拍全同采样会把
 *  级联延迟期误判为落定(rest−before 恒 14px 竖移正是该 from 帧;headless 合帧稀疏
 *  时延迟期可远超自然时长,输入注入才续走),故采样之外显式等行子树动画收尾。 */
async function settledRackGeometry(
  page: Page,
  timeoutMs = 8_000,
): Promise<{ cards: Box[]; row: Box; rack: Box }> {
  const sample = (await page.evaluate(`(async () => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const read = () => {
      const row = document.querySelector('[data-testid="${TESTIDS.jinnangHand}"]');
      if (!row) return null;
      const rack = row.closest(".hand-rack");
      if (!rack) return null;
      return JSON.stringify({
        cards: [...row.querySelectorAll(":scope > button")].map(rect),
        row: rect(row), rack: rect(rack),
      });
    };
    const animsSettled = () => {
      const row = document.querySelector('[data-testid="${TESTIDS.jinnangHand}"]');
      if (!row) return false;
      return row.getAnimations({ subtree: true }).every((a) => a.playState === "finished");
    };
    let prev = read();
    const deadline = performance.now() + ${timeoutMs};
    for (;;) {
      await new Promise((r) => setTimeout(r, prev === null ? 100 : 150));
      const cur = read();
      if (cur !== null && cur === prev && animsSettled()) return cur;
      prev = cur;
      if (performance.now() > deadline) throw new Error("手牌几何未落定:行缺失或持续变化超时");
    }
  })()`)) as string;
  return JSON.parse(sample);
}

/** 9 张 = 8 种 + 识破诡计重复 1 张(#281 牌库 9 种 18 张;直写引擎不经摸牌,无需凑牌库)。 */
const NINE_CARDS = [
  "连环计",
  "军情密探",
  "缓兵之计",
  "横征暴敛",
  "窃玉偷香",
  "火烧连营",
  "识破诡计",
  "求贤令",
  "识破诡计",
];

/** 把对局钉进「叠加布局可安全观察」的停车坪:quickStart 后等人类停稳,直写手牌,
 *  再把相位钉在 AwaitingDecision + 清 pendingLand/落格投影——决策卷轴不弹(引擎等人、
 *  UI 无遮罩),牌架无限期稳定可 hover。测试全程不发命令,引擎不会被推进。
 *  真实段(共享停车坪,本组三例):真实开局链(seedSolo 直呼生产 handleStart)+发牌
 *  入场级联的真实 DOM 几何/动画落定——几何断言量的是真渲染盒模型。
 *  手牌种植经 giveJinnang(#1298,判词单源 src/core/planter.ts 头注:生产发牌只有牌堆
 *  顶随机抽,无「发指定牌」流程);钉相位走 armPhase(#1301,判词单源
 *  src/core/planter.ts:引擎自转无「钉相位」公共命令,quickStart 停点是断言前提);
 *  清落格投影(防决策卷轴遮罩)走 armLanding(null)(#1303,投影族判词单源
 *  src/core/planter.ts)。 */
async function rackStandstill(page: Page, cards: string[], seed: number): Promise<void> {
  await quickStart(page, seed);
  // quickStart 末次点击落点随随机种子可能残留在 .many 行上,hover spread 会污染
  // settledRackGeometry 基线(#751 集成定性:9 张等距 3.64px/hover 基线 409.36 两例同根,
  // 裸 master 复现)——指针先行离场,后续停车的等待窗足够回落过渡播完。
  await page.mouse.move(0, 0);
  // 90s:quickStart 收尾可能停在 bot 回合(waitMyRollDone 见 decisionOwner 换人即收),
  // 等一整轮 bot 走回人类停靠点——W2 全量负载下实测一轮可超 30s(2026-09-28 全量 flake,
  // #308 同款「标 slow 防超时,非删」口径)。
  await parkMyTurn(page);
  await plant(page, { kind: "giveJinnang", seat: 0, cards });
  await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
  await plant(page, { kind: "armLanding", landing: null });
  // 发牌入场级联(错峰 60ms 拍 + 本体动画)以几何落定为准(#305 替代固定 1200ms):
  // 两拍全同 = 级联播完,后续几何断言不再吃动画 transform 污染。级联延迟期误判
  // 落定(主因,rest−before 恒 14px)由 settledRackGeometry 的动画收尾门槛根治,
  // 见该函数注。停车坪封板已上移至 parkMyTurn(停靠即冻结,#987 接力定性:只钉
  // turnPhase 钉不住在途队列,引擎在测量窗内仍步进是几何基线的次生扰动源;冻结
  // 边界见 react-helpers「时钟缝」节,CSS 挥出过渡与几何落定轮询走真实时钟不受影响)。
  await settledRackGeometry(page);
}

/** 读本端起手牌名(单机座位 0;quickStart 后手牌恒 ≥1:起手 1 张且无人替你用牌)。 */
async function myFirstCard(page: Page): Promise<string> {
  const hand = (await snap(page)).players[0].jinnangHand as string[];
  if (hand.length === 0) throw new Error("起手牌为空:发牌没进引擎,后续断言全是废话");
  return hand[0];
}

/** #653:quickStart 停点相位不钉——落 AwaitingJinnang(出牌态)时点牌=选中、长按=取消
 *  (HandRack 窗态语义),「点牌/长按开详情」断言全灭(8 次随机停点 7/8 过,唯一失败
 *  恰落出牌态)。rackStandstill 同款钉法 minus 直写手牌(两例断的正是起手牌,故不发牌):
 *  等人类停稳,把相位钉进 AwaitingDecision 空闲态 + 清 pendingLand/落格投影——窗态
 *  (junshi 槽/反应横幅均快照相位派生,GameScreen reactionUp 口径)随之卸载,点/长按
 *  回归常态详情语义,架无限期稳定。取代 #674 的冻结+应答舞步(窗根本开不起来)。
 *  真实段(共享停车坪,消费例各在头注声明):quickStart 真开局链+起手牌真实发牌,
 *  消费例的点/长按/收起点击链全真。
 *  相位种植走 armPhase(#1301,判词单源 src/core/planter.ts):钉 AwaitingDecision
 *  空闲态=断言前提(#653 出牌态点牌语义反转会灭断言),引擎自转无「钉相位」公共
 *  命令;清落格投影走 armLanding(null)(#1303,同 rackStandstill 判词单源)。
 *  #1215 棒1(seed 1483 实锤):等待谓词升级为 parkMyTurn(严格我的回合+停靠即冻结)
 *  ——waitMyPause 只认 decisionOwner,会把「bot 回合的反应窗询问期」当停靠,随后
 *  窗看门狗代发、bot 链走完,钉进的是 bot 决策位(架已随收沿收起,toggle 语义反转)。 */
async function pinRackIdle(page: Page, seed: number): Promise<void> {
  await quickStart(page, seed);
  // 90s:quickStart 收尾可能停在 bot 回合,等一整轮 bot 走回人类停靠点(同 rackStandstill 口径)
  await parkMyTurn(page);
  await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
  await plant(page, { kind: "armLanding", landing: null });
}

/** 出牌窗停车坪(pinRackIdle 同款钉法 + 窗态变体,#715 立配方,#1006 重钉组共用):
 *  quickStart 等人类停稳,把相位钉进 AwaitingJinnang + 直写手牌——唯反应手牌恒灰置
 *  不影响窗升起(choices 恒含 pass);引擎直写不经发牌,回合不推进,窗无限期稳定。
 *  真实段(共享停车坪,消费例各在头注声明):窗升起后的点选/长按/收起点击链全真。
 *  手牌种植经 giveJinnang(#1298,判词单源 src/core/planter.ts 头注);钉
 *  AwaitingJinnang 走 armPhase(#1301,判词单源 src/core/planter.ts:出牌窗态=断言
 *  前提,引擎自转无「钉相位」公共命令);清落格投影走 armLanding(null)(#1303,同 rackStandstill 判词单源)。停车谓词同 pinRackIdle 升级 parkMyTurn(#1215 棒1):
 *  窗态依赖 interactive(decisionOwner=我),问到 bot 回合中途态上钉窗必不升。 */
async function pinJunshiWindow(page: Page, cards: string[], seed: number): Promise<void> {
  await quickStart(page, seed);
  await parkMyTurn(page);
  await plant(page, { kind: "giveJinnang", seat: 0, cards });
  await plant(page, { kind: "armPhase", turnPhase: "AwaitingJinnang" });
  await plant(page, { kind: "armLanding", landing: null });
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

test.describe("锦囊 T3:底部手牌架", () => {
  // 「起手 1 张:架可见且牌在架内;点牌详情含牌名全文;Esc 关闭」例已迁(#1315 批T1):
  // 断言面=架/手牌行挂载、详情弹层牌名与牌面全文、Esc 关闭即卸载(点击→详情 DOM 有无
  // 与文本,零几何零真实输入),迁移落点=接线层 test/wiring/jinnang-wiring.test.tsx「点牌
  // 详情」例;Esc 关闭走底件 document 级 keydown(happy-dom 合成派发即达,非真实输入
  // 时序)。
  // 真实段:裸指针长按序列(move→down 700ms→up)+补发 click 抑制的输入语义全真;
  // 前置钉相位判词见 pinRackIdle。
  test("长按 500ms 同效开详情,随后的 click 不再触发(不弹两次)", async ({ page }) => {
    await pinRackIdle(page, 1472); // #653:出牌态长按=取消选中,先钉空闲态
    const cardId = await myFirstCard(page);
    const card = page.getByTestId(TESTIDS.jinnangCard(cardId));
    const box = await card.boundingBox();
    if (!box) throw new Error("手牌无几何盒:架未渲染或被遮挡");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700); // 越过 500ms 长按判定窗
    await page.mouse.up();
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveCount(1); // 抬指的合成 click 已被抑制,无二次弹层
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });

  // 「他人回合:架自动收起(回合交出即撤);回合回来自动弹回」例已迁(#1289 批二):
  // 断言面=handZone 挂载有无+开关 .on 类名挂点(store 快照驱动,零几何零真实输入),
  // 迁移落点=接线层 test/wiring/popup-state-wiring.test.tsx「他人回合」例;本文件存例仅剩
  // 几何与真实输入语义(长按/hover/reduced-motion,名册地板)。
});

test.describe("手牌架叠加压缩(#254:手牌无上限 UI 半)", () => {
  // 牌面像素宽 = 15em × 架体 em 基,现场量测(HandRack.tsx 叠加公式同款口径:
  // CARD_WIDTH_EM × computed font-size,桌面 8px 基 → 120px)。旧常量 114(15×7.6
  // 仪表条槽位档)是写死的第二事实源——#700 手牌区改形后架体 em 基 8px,9 张窥条
  // 118 < 120 真在叠,旧常量反把「真在叠」错判成全展(W4 实锤)。断言留 ±1px 量测余量。
  const cardWidth = (page: Page): Promise<number> =>
    page.evaluate(() => {
      const rack = document.querySelector(".hand-rack");
      if (!rack) throw new Error("手牌架不在 DOM:无法量测牌面 em 基");
      return 15 * parseFloat(getComputedStyle(rack).fontSize);
    });

  // 真实段:9 张直写后的真实 DOM 叠加布局(等距窥条/末张全宽/行不出架/笺脚与牌名
  // 可读性)全量取自真渲染盒模型,无操作链——呈现态断言即被测环。种植判词见
  // rackStandstill(手牌无公共通路,断言面需 9 张特定牌形)。
  test("9 张(8 种+重复)叠加:每张露等宽窥条且牌名可辨,末张全宽,行不出架", async ({ page }) => {
    // 停车坪等一轮 bot + 发牌级联落定,内部预算 90s > 60s 默认档——W2 负载下标 slow
    // 防超时 flake(#294 同款「标 slow 防超时,非删」,2026-09-28 全量实证)。
    test.slow();
    await rackStandstill(page, NINE_CARDS, 1474);
    const CARD_W = await cardWidth(page);
    const { cards, row, rack } = await rackGeometry(page);
    expect(cards).toHaveLength(9);
    // 行总宽收进架体(叠加压缩的目的:可用宽内装下任意张数)
    expect(row.width).toBeLessThanOrEqual(rack.width + 1);
    expect(row.x).toBeGreaterThanOrEqual(rack.x);
    expect(row.x + row.width).toBeLessThanOrEqual(rack.x + rack.width + 1);
    // 逐张等距窥条:相邻牌左缘距离 = 步距,既真叠住(< 全宽)又露得可辨(≥ ~26px 窥条)
    const strips = cards.slice(0, 8).map((c, i) => cards[i + 1].x - c.x);
    for (const s of strips) {
      expect(s).toBeLessThan(CARD_W); // 真在叠,不是全展
      expect(s).toBeGreaterThanOrEqual(26); // 窥条下限(原型 --peek)
      expect(Math.abs(s - strips[0])).toBeLessThanOrEqual(1); // 等距(公式均一)
    }
    // 末张不叠不裁:全宽且完整落在架内
    const last = cards[8];
    expect(Math.abs(last.width - CARD_W)).toBeLessThanOrEqual(1);
    expect(last.x + last.width).toBeLessThanOrEqual(rack.x + rack.width + 1);
    // 笺脚可读红线(#841 刀①):矮横屏档(本套件默认 844×390 即该档)笺脚单独提档
    // 1.5em×6.4px=9.6px——8.4px 时代踩可读红线(笺脚是牌面唯一效果正文),实测钉下限
    const jiaoPx = await page.evaluate((sel) => {
      const el = document.querySelector(`[data-testid="${sel}"] .jiao`);
      if (!el) throw new Error("笺脚不在 DOM:牌面结构漂移");
      return parseFloat(getComputedStyle(el).fontSize);
    }, TESTIDS.jinnangHand);
    expect(jiaoPx).toBeGreaterThanOrEqual(9.5);
    // 每张牌名条 peek 布局下可辨:牌名未被邻牌完全盖住(至少一个字身位可见)
    const mingBoxes = await page.evaluate(
      (sel) =>
        [...document.querySelectorAll(`[data-testid="${sel}"] .ming`)].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, right: r.right };
        }),
      TESTIDS.jinnangHand,
    );
    expect(mingBoxes).toHaveLength(9);
    mingBoxes.forEach((m, i) => {
      const coverRight = i < 8 ? cards[i + 1].x : cards[i].x + cards[i].width;
      expect(Math.min(m.right, coverRight) - m.x).toBeGreaterThanOrEqual(10);
    });
  });

  // 真实段:3 张全展形态(不挂 .many/相邻正间隙)的真实 DOM 几何,呈现态断言即被测环。
  // 种植判词见 rackStandstill(手牌无公共通路,断言面需特定牌形)。
  test("3 张全展不叠:相邻牌间留正间隙(一期形态)", async ({ page }) => {
    test.slow(); // 同上:停车坪等待的负载余量(三例共用 rackStandstill)
    await rackStandstill(page, ["连环计", "军情密探", "缓兵之计"], 1475);
    const CARD_W = await cardWidth(page);
    const { cards } = await rackGeometry(page);
    expect(cards).toHaveLength(3);
    // 不挂 .many(≤3 全展分支);几何上相邻牌左缘距离 ≥ 全宽,且留正间隙(gap 3em ≈ 23px)
    const row = page.getByTestId(TESTIDS.jinnangHand);
    await expect(row).not.toHaveClass(/many/);
    for (let i = 0; i < 2; i++) {
      expect(cards[i + 1].x - cards[i].x).toBeGreaterThanOrEqual(CARD_W);
      expect(cards[i + 1].x - (cards[i].x + cards[i].width)).toBeGreaterThanOrEqual(10);
    }
  });

  // 真实段:真实指针 hover→挥出→移出回落的完整输入链与挥出过渡几何(上浮/放大/
  // 邻牌让位/回落 ±2px)全真——交互几何即被测环。种植判词见 rackStandstill
  // (手牌无公共通路,断言面需 9 张特定牌形)。
  test("hover 挥出全显:悬停牌上浮放大、邻牌两侧让位,移出回落", async ({ page }) => {
    test.slow(); // 同上:停车坪等待的负载余量(三例共用 rackStandstill)
    await rackStandstill(page, NINE_CARDS, 1476);
    const CARD_W = await cardWidth(page);
    const before = (await rackGeometry(page)).cards;
    // 悬停第 5 张(有左右邻):牌钮中心被右侧牌盖住,落点取左缘窥条内(10px 处)
    await page
      .locator(`[data-testid="${TESTIDS.jinnangHand}"] > button`)
      .nth(4)
      .hover({ position: { x: 10, y: 60 } });
    // 挥出过渡(--dur-fast)以几何落定为准(#305 替代固定 300ms):两拍全同即悬停稳态
    const after = (await settledRackGeometry(page)).cards;
    // 悬停牌:上浮 + 放大(1.12 倍级)
    expect(after[4].y).toBeLessThan(before[4].y - 5);
    expect(after[4].width).toBeGreaterThan(before[4].width * 1.05);
    // 右邻让满幅(= 原全宽):悬停牌(除放大出界的描边外)不再被遮
    expect(after[5].x).toBeGreaterThanOrEqual(after[4].x + CARD_W - 2);
    // 邻牌让位(noname getSpreadOffset 语义):左邻左移、右邻右移
    expect(after[3].x).toBeLessThan(before[3].x);
    expect(after[5].x).toBeGreaterThan(before[5].x);
    // 移出回落:几何回到常态(±2px 量测余量);同口径等回落过渡落定(#305 替代固定
    // 300ms)。1px 实测过紧——swiftshader 亚像素合成下回落残差 1.28px(2026-10-02 取证),
    // 2px 仍足以抓「没回去」级回归。
    await page.mouse.move(0, 0);
    const rest = (await settledRackGeometry(page)).cards;
    rest.forEach((c, i) => {
      expect(Math.abs(c.x - before[i].x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.y - before[i].y)).toBeLessThanOrEqual(2);
    });
  });
});

// ── 出牌窗灰置牌可看不可出(#715;#676 定案施工)──
// 唯反应牌(识破诡计/半路杀出,#281 targetDomain=reaction)在出牌窗恒灰置「唯反应
// (反应窗打出)」(choices.ts 单源)。#715 前:原生 disabled 吞全部 pointer——不可
// 查看;#715 后:aria-disabled+自门控——点/长按开详情(现役详情通路),选中/出牌
// 命令通路仍只对 available 开(GameScreen 确认的 available 过滤 + HandRack 点选/
// 数字键/Enter 既有口径,前端自门控只是 UI 层,不放宽任何出牌通路)。
// 测试手法注记:Playwright click 的 Enabled actionability 同样认 aria-disabled(1.55
// injectedScript getAriaDisabled)——真实浏览器指针并不被拦,灰置牌点击一律走
// force: true 模拟真人;长按走 page.mouse 裸序列(坐标输入,无 actionability)。
test.describe("出牌窗灰置牌可看不可出(#715)", () => {
  const LOCKED = "识破诡计"; // 唯反应(反应窗打出),出牌窗恒灰置
  const USABLE = "求贤令"; // self 域,出牌窗恒可用(对照组)

  // 「唯反应灰置牌:点击开详情(aria-disabled 语义保持),选中与出牌零通路」例已迁
  // (#1315 批T1):断言面=aria-disabled/非原生 disabled/灰置类/唯反应印条文本+
  // 点击开详情+出牌钮不亮+引擎零命令快照证伪(全 DOM·store 语义,force:true 点击在
  // 接线层是合成 click 同义),迁移落点=接线层 test/wiring/jinnang-wiring.test.tsx「灰置
  // 印条」例;长按腿(裸指针时序)留浏览器,由本组存例守。
  // 真实段:窗态灰置牌的裸指针长按链(move→down 700ms→up)+补发 click 抑制全真。
  // 种植判词见 pinJunshiWindow(手牌无公共通路,需唯反应牌形;钉窗态=断言前提)。
  test("唯反应灰置牌:长按同效开详情,补发 click 不双弹", async ({ page }) => {
    await pinJunshiWindow(page, [LOCKED], 1478);
    const card = page.getByTestId(TESTIDS.jinnangCard(LOCKED));
    const box = await card.boundingBox();
    if (!box) throw new Error("灰置牌无几何盒:窗态未升起");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700); // 越过 500ms 长按判定窗(全套件唯一保留硬等待)
    await page.mouse.up();
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveCount(1); // 长按吞补发 click,同一动作不弹两次
    await expect(page.getByTestId(TESTIDS.actionbarPlay)).toHaveAttribute("aria-disabled", "true");
  });

  // 真实段:available 牌点选→出牌点亮→灰置牌点击不夺选中→长按取消选中的完整
  // 选中态交互链全真(.sel 放大态/出牌钮启禁随行)。种植判词见 pinJunshiWindow
  // (手牌无公共通路,需「唯反应+可用」对照牌形;钉窗态=断言前提)。
  test("available 对照零回归:点牌选中出牌点亮、长按取消;灰置牌开详情不动选中", async ({ page }) => {
    await pinJunshiWindow(page, [LOCKED, USABLE], 1479);
    const locked = page.getByTestId(TESTIDS.jinnangCard(LOCKED));
    const usable = page.getByTestId(TESTIDS.jinnangCard(USABLE));
    const play = page.getByTestId(TESTIDS.actionbarPlay);

    // available 牌:点=选中(.sel 放大态),「出牌」点亮(#256 现役手感)
    await usable.click();
    await expect(usable.locator(".jinnang-card")).toHaveClass(/sel/);
    await expect(play).toBeEnabled();

    // 灰置牌点击=只开详情:不夺选中、不动出牌钮(门控在语义层,不在指针层)
    await locked.click({ force: true });
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(usable.locator(".jinnang-card")).toHaveClass(/sel/);
    await expect(play).toBeEnabled();

    // available 选中态长按=取消选中(窗态既有语义,#653 钉相口径),「出牌」回禁用
    const box = await usable.boundingBox();
    if (!box) throw new Error("可用牌无几何盒:窗态未升起");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(usable.locator(".jinnang-card")).not.toHaveClass(/sel/);
    await expect(play).toHaveAttribute("aria-disabled", "true");
  });
});

// ── 锦囊架临时收起重钉(#1006 建组;显隐模型 2026-11-07 改「回合联动+决策保底」)──
// 会话内临时态 rackHidden(GameScreen 持有,规则沿自动同步):亮=我的回合∪决策窗
// 在场∪手动临时开,其余一律收;收起不断决策通路(出牌窗=动作条、反应窗=横幅贴底
// 下移),选中态跨收起保留。五契约的迁移账:①②⑤已迁接线层(#1315 批T1,断言面=
// 挂载有无/类名挂点/真命令过相位,落点 test/wiring/popup-state-wiring.test.tsx「锦囊架收起
// 契约」组)、④呼吸钮 .breathe 已迁(#1289 批二)、「他人回合」沿联动例已迁(#1289
// 批二);本组存例=③(收起贴底位移=banner boundingRect 几何+选牌落印真结算链,
// 名册地板)。
test.describe("锦囊架临时收起重钉(#1006)", () => {
  // 真实段:呼吸钮收起(banner-only 形态/贴底几何)→重开→选牌→落印确认的点击链
  // 全真,落印走真引擎结算(reactionCounter 留痕经 pollReactionSettled 断言)。
  // 窗载荷种植走 armReaction(#1301,判词单源 src/core/planter.ts:反应窗无「凭空
  // 开一道窗」公共命令,直种 pendingReaction 挂起态是窗态唯一种植口)。
  test("③反应窗收起:横幅保留贴底下移;点呼吸钮重开,选牌落印走通", async ({ page }) => {
    await pinRackIdle(page, 1482);
    // 直种反应窗(openReactionWindow 挂起态同构,字段一一对应):view.windowMs 直写
    // 30s——横幅展示(倍率缩放)与权威看门狗同读此值(#284 单源),收起→断言→重开
    // →应答的点击链不再与默认窗的 2.5s 展示档赛跑;火烧连营根窗 + 人手持识破诡计,
    // 结算走真引擎通路(不经 bot 链,配方参照 react-reaction.spec plantCounterScenario
    // 的窗形状,省其开局/种植长链)。(塞牌经 giveJinnang #1298;窗载荷经 armReaction
    // #1301)
    await plant(page, { kind: "giveJinnang", seat: 0, cards: ["识破诡计"] });
    await plant(page, {
      kind: "armReaction",
      view: {
        kind: "jinnang",
        cardId: "火烧连营",
        userSeat: 1,
        targetSeats: [0],
        queriedBySeat: [0],
        windowMs: 30000,
      },
      payload: {
        kind: "jinnang",
        userSeat: 1,
        cardId: "火烧连营",
        targets: [0],
      },
    });
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    // 收起:banner-only 形态——牌行卸载,横幅保留(倒计时弧/不用全可达),架体盒
    // 失去牌行依托随零高贴底下移(下缘锚零高架体 ≈ 视口底 −18;架亮档 ≈ 视口底 −170)
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId(TESTIDS.reactionTimer)).toBeVisible();
    await expect(banner.getByTestId(TESTIDS.reactionDecline)).toBeVisible();
    const geo = await banner.evaluate((el) => ({
      bottom: el.getBoundingClientRect().bottom,
      vh: document.documentElement.clientHeight,
    }));
    expect(geo.bottom).toBeGreaterThanOrEqual(geo.vh - 40); // 贴底下移(视口相对,横幅入场动画只会更低)
    // 点呼吸钮重开:牌行回场,选牌→落印应答,窗收结算(识破落空,reactionCounter 留痕)
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    const card = page.getByTestId(TESTIDS.jinnangCard("识破诡计"));
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId(TESTIDS.reactionConfirm)).toBeEnabled();
    const baseline = await snap(page).then((s) => ({
      cash: s.players.map((p: any) => p.cash),
    }));
    await page.getByTestId(TESTIDS.reactionConfirm).click();
    await pollReactionSettled(page, baseline, { countered: true });
  });

  // 「④呼吸钮:.breathe 四态走查」例已迁(#1289 批二):断言面=呼吸钮与开关钮的
  // 类名挂点(窗态∧收起的纯状态机,store 快照驱动),迁移落点=接线层
  // test/wiring/popup-state-wiring.test.tsx「呼吸钮」例;呼吸金光的真实视觉存在归
  // visual-compare(演出与静态景深的存在性防线统一归口)。

  // 「⑤他人回合反应窗:窗在场架必亮(决策保底不问回合);窗收架撤(决策毕不赖站)」
  // 例已迁(#1315 批T1):断言面=横幅/手牌行挂载有无沿三个可见性沿的走查(窗态∧
  // activeIndex 的纯状态机,store 快照驱动+种植布场),零几何零真实输入,迁移落点=
  // 接线层 test/wiring/popup-state-wiring.test.tsx「锦囊架收起契约⑤」例(窗载荷经
  // armReaction、回合交接经 armPhase 种植件直呼)。
});

// ── 发牌入场级联 reduced-motion(#239 T4):系统「减弱动态效果」下入场动画必须
// 退场——app.css M-4 全局兜层把 animation-duration 压到 0.01ms,但压不住 delay;
// backwards 填充下不归零的 delay 会「先空白再逐张弹现」,hand-rack.css 的 reduce
// 块显式把 delay 归零(那是 M-4 管不到的唯一缝)。本用例钉住两层都生效。
test.describe("发牌入场级联 reduced-motion(#239 T4)", () => {
  // 真实段:reduce 媒体档下的计算样式取证(animationName/delay/duration/opacity)
  // 全真——动效退场契约只能从 getComputedStyle 取证。手牌种植经 giveJinnang(#1298,
  // 判词单源 src/core/planter.ts 头注),断言面需 3 张特定牌形以验级联 delay 归零;
  // 钉相位走 armPhase(#1301,判词同 rackStandstill),清落格投影走 armLanding(null)(#1303,同其判词单源)。
  test("reduce 下入场动画不播放:delay 归零+时长压缩,牌挂载即不透明", async ({ page }) => {
    // emulateMedia 挂在 goto 前:首屏样式计算即按 reduce 生效,无时序缝
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quickStart(page, 1485);
    await plant(page, {
      kind: "giveJinnang",
      seat: 0,
      cards: ["连环计", "军情密探", "缓兵之计"],
    });
    await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
    await plant(page, { kind: "armLanding", landing: null });
    const hand = page.getByTestId(TESTIDS.jinnangHand);
    await expect(hand).toBeVisible();
    const first = hand.getByTestId(TESTIDS.jinnangCard("连环计"));
    await expect(first).toHaveCount(1);
    // 挂载后即读计算样式:入场动画仍在(animationName 钉住特性在),但 delay=0s
    // (hand-rack.css reduce 块)、duration=0.01ms(app.css M-4 兜层)——动画在
    // 挂载帧内播完,opacity 恒 1(reduce 下不存在「首帧空白」)。
    const cs = await first.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        delay: s.animationDelay,
        dur: s.animationDuration,
        opacity: s.opacity,
      };
    });
    expect(cs.name).toBe("rack-card-in");
    expect(cs.delay).toBe("0s");
    // Chromium 把 0.01ms 序列化成「1e-05s」——按秒解析断言「被压到 <1ms」,
    // 不钉字面量(序列化形式随内核版本漂,物理量不变)
    expect(parseFloat(cs.dur)).toBeLessThanOrEqual(0.001);
    // 不透明终态用带重试的 toHaveCSS:delay=0+dur≈0 已钉死「无可见空窗」(承重断言),
    // 0.01ms 动画的挂载帧采样竞态(backwards 填充下首帧读到 keyframe-0 的 opacity 0,
    // 2026-10-02 取证)不该在这里放大成 flake。
    await expect(first).toHaveCSS("opacity", "1");
  });
});

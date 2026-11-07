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
import { test, expect } from "./fixtures";
import {
  force,
  freezeClock,
  pollReactionSettled,
  quickStart,
  snap,
  waitMyPause,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { jinnangCardOf } from "../src/core/jinnang";
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
 *  UI 无遮罩),牌架无限期稳定可 hover。测试全程不发命令,引擎不会被推进。 */
async function rackStandstill(page: Page, cards: string[]): Promise<void> {
  await quickStart(page);
  // quickStart 末次点击落点随随机种子可能残留在 .many 行上,hover spread 会污染
  // settledRackGeometry 基线(#751 集成定性:9 张等距 3.64px/hover 基线 409.36 两例同根,
  // 裸 master 复现)——指针先行离场,后续 waitMyPause 的等待窗足够回落过渡播完。
  await page.mouse.move(0, 0);
  // 90s:quickStart 收尾可能停在 bot 回合(waitMyRollDone 见 decisionOwner 换人即收),
  // 等一整轮 bot 走回人类停靠点——W2 全量负载下实测一轮可超 30s(2026-09-28 全量 flake,
  // #308 同族「标 slow 防超时,非删」口径)。
  await waitMyPause(page, 0, 90_000);
  await force(
    page,
    `
    e.players[0].jinnangHand = ${JSON.stringify(cards)};
    e.lastLandOutcome = null;
    e.pendingLand = null;
    e.turnPhase = "AwaitingDecision";
  `,
  );
  // 发牌入场级联(错峰 60ms 拍 + 本体动画)以几何落定为准(#305 替代固定 1200ms):
  // 两拍全同 = 级联播完,后续几何断言不再吃动画 transform 污染
  await settledRackGeometry(page);
  // 停车坪封板(#987 接力定性):基线采样前冻结房间时钟。只钉 turnPhase 钉不住
  // 在途队列——复跑取证(失败窗内签面揭示芯片换字、「行军中」留痕)证明引擎在
  // 测量窗内仍步进,是几何基线的次生扰动源;冻结后三例量在真静态页上。本组零
  // 发令,同步 bot 链不存在(冻结边界见 react-helpers「时钟缝」节);CSS 挥出
  // 过渡与几何落定轮询走真实时钟不受影响。页随测试灭、冻结随上下文销毁,无需
  // 解冻对称。级联延迟期误判落定(主因,rest−before 恒 14px)由 settledRackGeometry
  // 的动画收尾门槛根治,见该函数注。
  await freezeClock(page);
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
 *  回归常态详情语义,架无限期稳定。取代 #674 的冻结+应答舞步(窗根本开不起来)。 */
async function pinRackIdle(page: Page): Promise<void> {
  await quickStart(page);
  // 90s:quickStart 收尾可能停在 bot 回合,等一整轮 bot 走回人类停靠点(同 rackStandstill 口径)
  await waitMyPause(page, 0, 90_000);
  await force(
    page,
    `
    e.lastLandOutcome = null;
    e.pendingLand = null;
    e.turnPhase = "AwaitingDecision";
  `,
  );
}

/** 出牌窗停车坪(pinRackIdle 同款钉法 + 窗态变体,#715 立配方,#1006 重钉组共用):
 *  quickStart 等人类停稳,把相位钉进 AwaitingJinnang + 直写手牌——唯反应手牌恒灰置
 *  不影响窗升起(choices 恒含 pass);引擎直写不经发牌,回合不推进,窗无限期稳定。 */
async function pinJunshiWindow(page: Page, cards: string[]): Promise<void> {
  await quickStart(page);
  await waitMyPause(page, 0, 90_000);
  await force(
    page,
    `
    e.players[0].jinnangHand = ${JSON.stringify(cards)};
    e.lastLandOutcome = null;
    e.pendingLand = null;
    e.turnPhase = "AwaitingJinnang";
  `,
  );
  await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
}

test.describe("锦囊 T3:底部手牌架", () => {
  test("起手 1 张:架可见且牌在架内;点牌详情含牌名全文;Esc 关闭", async ({ page }) => {
    await pinRackIdle(page);
    const rack = page.getByTestId(TESTIDS.jinnangRack);
    await expect(rack).toBeVisible();
    // 手牌行在架内,恰好 1 张(testid 原值 jinnang-hand / jinnang-card-<牌名>)
    const hand = page.getByTestId(TESTIDS.jinnangHand);
    await expect(hand).toBeVisible();
    const cardId = await myFirstCard(page);
    await expect(rack.getByTestId(TESTIDS.jinnangCard(cardId))).toHaveCount(1);

    // 点牌 → 详情弹层(桌面=底部面板):含牌名与牌面全文
    await rack.getByTestId(TESTIDS.jinnangCard(cardId)).click();
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    const def = jinnangCardOf(cardId);
    await expect(detail).toContainText(cardId);
    await expect(detail).toContainText(def.text);

    // Esc 关闭(detail 容器随 Portal 卸载)
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });

  test("长按 500ms 同效开详情,随后的 click 不再触发(不弹两次)", async ({ page }) => {
    await pinRackIdle(page); // #653:出牌态长按=取消选中,先钉空闲态
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

  test("他人回合:架自动收起(回合交出即撤);回合回来自动弹回", async ({ page }) => {
    await quickStart(page);
    // 停车坪先钉稳再动刀(pinRackIdle 同款两步,配方出处本文件;2026-11-07 轮实锤:
    // 裸 freeze+force 会撞 quickStart 交还点的 mid-flight 行军——负载下 waitFxIdle
    // 死等/拦检卷轴在场,断言连挂;先等自然停靠+钉 AwaitingDecision 空闲态即根除,
    // float-skeleton #1006 例同款,无需冻结)。
    await waitMyPause(page, 0, 90_000);
    await force(
      page,
      `
      e.lastLandOutcome = null;
      e.pendingLand = null;
      e.turnPhase = "AwaitingDecision";
    `,
    );
    // #413 调试钩子种植(直写引擎不经房间编排,driveBots 不会被触发,钉住的状态
    // 稳定)。钉的是回合联动收沿的契约:回合交出(activeIndex 离席)→ 架自动收起,
    // 手牌区整区卸载,bot 回合全图畅看;回合回来(亮沿)→ 自动弹回。
    // 2026-11-07 前钉「他人回合架常驻可见」,该语义已随显隐改模翻转。
    await force(
      page,
      `
      const botIdx = e.players.findIndex((p) => p.isBot);
      e.activeIndex = botIdx;
    `,
    );
    const s = await snap(page);
    expect(s.decisionOwner).not.toBe(0);
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.jinnangToggle)).not.toHaveClass(/on/);
    // 回合回来:我的回合亮沿自动弹回(架回场,钮亮态)
    await force(page, `e.activeIndex = e.players.findIndex((p) => !p.isBot);`);
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangToggle)).toHaveClass(/on/);
  });
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

  test("9 张(8 种+重复)叠加:每张露等宽窥条且牌名可辨,末张全宽,行不出架", async ({ page }) => {
    // 停车坪等一轮 bot + 发牌级联落定,内部预算 90s > 60s 默认档——W2 负载下标 slow
    // 防超时 flake(#294 同款「标 slow 防超时,非删」,2026-09-28 全量实证)。
    test.slow();
    await rackStandstill(page, NINE_CARDS);
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

  test("3 张全展不叠:相邻牌间留正间隙(一期形态)", async ({ page }) => {
    test.slow(); // 同上:停车坪等待的负载余量(三例共用 rackStandstill)
    await rackStandstill(page, ["连环计", "军情密探", "缓兵之计"]);
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

  test("hover 挥出全显:悬停牌上浮放大、邻牌两侧让位,移出回落", async ({ page }) => {
    test.slow(); // 同上:停车坪等待的负载余量(三例共用 rackStandstill)
    await rackStandstill(page, NINE_CARDS);
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

  test("唯反应灰置牌:点击开详情(aria-disabled 语义保持),选中与出牌零通路", async ({ page }) => {
    await pinJunshiWindow(page, [LOCKED]);
    const card = page.getByTestId(TESTIDS.jinnangCard(LOCKED));
    await expect(card).toBeVisible();
    // 禁用形态双钉:原生 disabled 已弃(pointer 可达,可查看),aria-disabled 宣告
    // 禁用(屏读语义不降级);灰置态仍下沉置灰+唯反应原因印条
    await expect(card).not.toHaveAttribute("disabled");
    await expect(card).toHaveAttribute("aria-disabled", "true");
    await expect(card.locator(".jinnang-card")).toHaveClass(/off/);
    await expect(card.locator(".reason")).toHaveText("唯反应(反应窗打出)");

    // 点击=只开详情(不选中):动作条「出牌」钮不亮(#751 B1:卡牌段弃原生 disabled,
    // aria-disabled+自门控,断言随行)
    await card.click({ force: true });
    const detail = page.getByTestId(TESTIDS.jinnangDetail);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(LOCKED);
    await expect(page.getByTestId(TESTIDS.actionbarPlay)).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);

    // 引擎零命令:相位仍在出牌窗、牌未消耗(出牌命令通路未开)
    const s = await snap(page);
    expect(s.turnPhase).toBe("AwaitingJinnang");
    expect(s.players[0].jinnangHand).toContain(LOCKED);
  });

  test("唯反应灰置牌:长按同效开详情,补发 click 不双弹", async ({ page }) => {
    await pinJunshiWindow(page, [LOCKED]);
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

  test("available 对照零回归:点牌选中出牌点亮、长按取消;灰置牌开详情不动选中", async ({ page }) => {
    await pinJunshiWindow(page, [LOCKED, USABLE]);
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
// 下移),选中态跨收起保留。本组钉收起态与窗态交织的五个面(亮沿/收沿的全沿契约
// 钉在 react-float-skeleton #1006 例与本文件「他人回合」例);三问自答:守住什么=
// 「窗内可收、收而不断、选中不丢、呼吸只挂窗态+收起、窗在场压回合归属」五契约
// (各例头注分答);墙钟≈每例 40-60s(共用两条停车坪配方,③⑤ 的直种窗免 bot 链
// 长跑);替代=无旧例(全新语义,原 #700 ③ 开关例在 react-float-skeleton 已按同
// spec 重写,不在此重复)。
test.describe("锦囊架临时收起重钉(#1006)", () => {
  const PLAYABLE = "求贤令"; // self 域可用牌(出牌窗选中态载体,#715 USABLE 同款口径)

  test("①出牌窗收起生效:架消失、动作条仍在场、「不出」可点过相位", async ({ page }) => {
    await pinJunshiWindow(page, [PLAYABLE]);
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    // 决策通路不断:架与动作条相互独立,「不出」随时可点
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await expect(page.getByTestId(TESTIDS.actionbar)).toHaveCount(0);
    const s = await snap(page);
    expect(s.turnPhase).not.toBe("AwaitingJinnang");
  });

  test("②出牌窗收起→重开:卡牌段选中态还原续选(选中态跨收起保留)", async ({ page }) => {
    await pinJunshiWindow(page, [PLAYABLE]);
    const card = page.getByTestId(TESTIDS.jinnangCard(PLAYABLE));
    const play = page.getByTestId(TESTIDS.actionbarPlay);
    await card.click();
    await expect(card.locator(".jinnang-card")).toHaveClass(/sel/);
    await expect(play).toBeEnabled();
    // 收起:架整区卸载,选中留在 GameScreen 会话态(不随架卸载丢失)
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    // 重开:选中态原样还原,「出牌」仍点亮(续选无断)
    await page.getByTestId(TESTIDS.jinnangToggle).click();
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(card.locator(".jinnang-card")).toHaveClass(/sel/);
    await expect(play).toBeEnabled();
  });

  test("③反应窗收起:横幅保留贴底下移;点呼吸钮重开,选牌落印走通", async ({ page }) => {
    await pinRackIdle(page);
    // 直种反应窗(openReactionWindow 挂起态同构,字段一一对应):view.windowMs 直写
    // 30s——横幅展示(倍率缩放)与权威看门狗同读此值(#284 单源),收起→断言→重开
    // →应答的点击链不再与默认窗的 2.5s 展示档赛跑;火烧连营根窗 + 人手持识破诡计,
    // 结算走真引擎通路(不经 bot 链,配方参照 react-reaction.spec plantCounterScenario
    // 的窗形状,省其开局/种植长链)。
    await force(
      page,
      `
      e.players[0].jinnangHand = ["识破诡计"];
      e.jinnangSeq += 1;
      e.pendingReaction = {
        seq: e.jinnangSeq,
        view: { kind: "jinnang", cardId: "火烧连营", userSeat: 1, targetSeats: [0], queriedBySeat: [0], windowMs: 30000 },
        answers: [],
        payload: { kind: "jinnang", userSeat: 1, cardId: "火烧连营", targets: [0] },
      };
      e.turnPhase = "AwaitingReaction";
    `,
    );
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

  test("④呼吸钮:窗态+收起才挂 .breathe;非窗态收起与窗态亮架均无该 class", async ({ page }) => {
    await pinRackIdle(page);
    const toggle = page.getByTestId(TESTIDS.jinnangToggle);
    const breathe = page.locator(".game-layout .gbtn.breathe");
    // 非窗态收起:无呼吸(「有活决策被收起来」只在窗态成立)
    await toggle.click();
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    await expect(breathe).toHaveCount(0);
    // 窗态开场亮沿先弹回(亮沿②,弹回语义归 react-float-skeleton #1006 例);
    // 窗态亮架不呼吸——呼吸=窗态∧收起,非「窗态」单条件
    await toggle.click();
    await force(page, `e.turnPhase = "AwaitingJinnang";`);
    await expect(page.getByTestId(TESTIDS.actionbar)).toBeVisible();
    await expect(breathe).toHaveCount(0);
    // 窗内收起:呼吸金光挂上(状态表达 §4.6,零文字)
    await toggle.click();
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    await expect(breathe).toHaveCount(1);
    await expect(toggle).toHaveClass(/breathe/);
    // 窗落(仍在我的回合):窗落沿按规则重对齐——我的回合=亮,窗内手动收起被
    // 抹平(手动只活沿间,回合联动语义);呼吸随窗态退场
    await force(page, `e.turnPhase = "AwaitingDecision";`);
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
    await expect(breathe).toHaveCount(0);
  });

  test("⑤他人回合反应窗:窗在场架必亮(决策保底不问回合);窗收架撤(决策毕不赖站)", async ({
    page,
  }) => {
    await pinRackIdle(page);
    // 直种反应窗(③ 同款形状,windowMs 30s 免与展示档赛跑):窗态开场亮沿,架随横幅回场
    await force(
      page,
      `
      e.jinnangSeq += 1;
      e.pendingReaction = {
        seq: e.jinnangSeq,
        view: { kind: "jinnang", cardId: "火烧连营", userSeat: 1, targetSeats: [0], queriedBySeat: [0], windowMs: 30000 },
        answers: [],
        payload: { kind: "jinnang", userSeat: 1, cardId: "火烧连营", targets: [0] },
      };
      e.turnPhase = "AwaitingReaction";
    `,
    );
    const banner = page.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toBeVisible();
    // 回合交出(activeIndex 钉 bot):窗在场压住回合归属——决策保底不问回合,架仍亮
    await force(page, `e.activeIndex = e.players.findIndex((p) => p.isBot);`);
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toBeVisible();
    await expect(banner).toBeVisible();
    // 窗收(应答/超时/直写同效——可见性只跟窗走):窗落且不在我的回合 → 架自动收
    await force(page, `e.turnPhase = "AwaitingDecision";`);
    await expect(banner).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.handZone)).toHaveCount(0);
    // 回合回来:我的回合亮沿弹回,循环闭合
    await force(page, `e.activeIndex = e.players.findIndex((p) => !p.isBot);`);
    await expect(page.getByTestId(TESTIDS.handZone)).toBeVisible();
  });
});

// ── 发牌入场级联 reduced-motion(#239 T4):系统「减弱动态效果」下入场动画必须
// 退场——app.css M-4 全局兜层把 animation-duration 压到 0.01ms,但压不住 delay;
// backwards 填充下不归零的 delay 会「先空白再逐张弹现」,hand-rack.css 的 reduce
// 块显式把 delay 归零(那是 M-4 管不到的唯一缝)。本用例钉住两层都生效。
test.describe("发牌入场级联 reduced-motion(#239 T4)", () => {
  test("reduce 下入场动画不播放:delay 归零+时长压缩,牌挂载即不透明", async ({ page }) => {
    // emulateMedia 挂在 goto 前:首屏样式计算即按 reduce 生效,无时序缝
    await page.emulateMedia({ reducedMotion: "reduce" });
    await quickStart(page);
    await force(
      page,
      `
      e.players[0].jinnangHand = ["连环计", "军情密探", "缓兵之计"];
      e.lastLandOutcome = null;
      e.pendingLand = null;
      e.turnPhase = "AwaitingDecision";
    `,
    );
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

// 底部常驻手牌架(#238 一期 T3):起手牌在架内、点牌详情弹层(开/关)、长按同效、
// 他人回合架常驻可见(常驻不收拢,P1-C 拍板)。空态斜牌背不做 DOM 断言(起手必 1 张,
// 永不空),视觉证据归截图 tmp/ui-shots/t3/(tmp/shot-t3-rack.mjs 构造空手牌)。
// 断言口径:牌面文案断牌名(def.id/def.text),不断样式(样式归原型基线);
// 例外:文末 reduced-motion 用例(#239 T4 验收门)钉计算样式——动效退场是行为
// 契约不是视觉基线,delay/时长/不透明度只能从 getComputedStyle 取证。
// #305:入场级联/挥出过渡的固定硬等待(1200/300ms)换几何落定轮询——两拍盒模型全同
// 即视为落定;长按 700ms 是输入语义(越过 500ms 长按判定窗),全套件唯一保留的硬等待。
import { test, expect } from "./fixtures";
import { actIfCan, force, quickStart, snap, waitMyPause } from "./react-helpers";
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
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const row = document.querySelector('[data-testid="jinnang-hand"]');
    if (!row) throw new Error("手牌行不在 DOM:架未渲染或手牌为空");
    const rack = row.closest(".hand-rack");
    if (!rack) throw new Error("手牌行不在架内:DOM 结构漂移");
    return {
      cards: [...row.querySelectorAll(":scope > button")].map(rect),
      row: rect(row),
      rack: rect(rack),
    };
  });
}

/** 几何落定轮询(#305 替代固定硬等待):单次 evaluate 内反复采样同一份盒模型,两拍
 *  (150ms)全同即视为动画/过渡落定并返回该样本;行缺失先等出现,deadline 内仍未落定
 *  即抛错(零兜底:落不下来是 bug,让它炸)。错峰 60ms 拍的入场级联任意时刻都有牌在动
 *  (duration > 错峰),级联间的静止窗小于采样间隔——两拍全同只可能出现在全体落定后。 */
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
      const row = document.querySelector('[data-testid="jinnang-hand"]');
      if (!row) return null;
      const rack = row.closest(".hand-rack");
      if (!rack) return null;
      return JSON.stringify({
        cards: [...row.querySelectorAll(":scope > button")].map(rect),
        row: rect(row), rack: rect(rack),
      });
    };
    let prev = read();
    const deadline = performance.now() + ${timeoutMs};
    for (;;) {
      await new Promise((r) => setTimeout(r, prev === null ? 100 : 150));
      const cur = read();
      if (cur !== null && cur === prev) return cur;
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
}

/** 读本端起手牌名(单机座位 0;quickStart 后手牌恒 ≥1:起手 1 张且无人替你用牌)。 */
async function myFirstCard(page: Page): Promise<string> {
  const hand = (await snap(page)).players[0].jinnangHand as string[];
  if (hand.length === 0) throw new Error("起手牌为空:发牌没进引擎,后续断言全是废话");
  return hand[0];
}

test.describe("锦囊 T3:底部手牌架", () => {
  test("起手 1 张:架可见且牌在架内;点牌详情含牌名全文;Esc 关闭", async ({ page }) => {
    await quickStart(page);
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
    await quickStart(page);
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

  test("他人回合:架常驻可见(不收拢)", async ({ page }) => {
    await quickStart(page);
    // 等决策方换人。人类自动行军可能落上决策格(购地/扩军/机遇…)把 decisionOwner
    // 钉在 0——轮询体内先用 actIfCan 清人类决策点(react-helpers 通用的「今不用/跳过/
    // 首选项」放行),纯等会 30s 超时假阳(#239 T4 收口实测:无 seed 时约半数种子命中)。
    await expect
      .poll(
        async () => {
          await actIfCan(page);
          return (await snap(page)).decisionOwner;
        },
        { timeout: 30_000 },
      )
      .not.toBe(0);
    await expect(page.getByTestId(TESTIDS.jinnangRack)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.jinnangHand)).toBeVisible();
  });
});

test.describe("手牌架叠加压缩(#254:手牌无上限 UI 半)", () => {
  // 牌面像素宽 = 15em × 7.6px 槽位档 = 114px(原型 --cw 同值);断言留 ±1px 量测余量。
  const CARD_W = 114;

  test("9 张(8 种+重复)叠加:每张露等宽窥条且牌名可辨,末张全宽,行不出架", async ({ page }) => {
    // 停车坪等一轮 bot + 发牌级联落定,内部预算 90s > 60s 默认档——W2 负载下标 slow
    // 防超时 flake(#294 同款「标 slow 防超时,非删」,2026-09-28 全量实证)。
    test.slow();
    await rackStandstill(page, NINE_CARDS);
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
    // 每张牌名条 peek 布局下可辨:牌名未被邻牌完全盖住(至少一个字身位可见)
    const mingBoxes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="jinnang-hand"] .ming')].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, right: r.right };
      }),
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
    // 移出回落:几何回到常态(±1px 量测余量);同口径等回落过渡落定(#305 替代固定 300ms)
    await page.mouse.move(0, 0);
    const rest = (await settledRackGeometry(page)).cards;
    rest.forEach((c, i) => {
      expect(Math.abs(c.x - before[i].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - before[i].y)).toBeLessThanOrEqual(1);
    });
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
    expect(cs.opacity).toBe("1");
  });
});

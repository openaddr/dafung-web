// 底部常驻手牌架(#238 一期 T3):起手牌在架内、点牌详情弹层(开/关)、长按同效、
// 他人回合架常驻可见(常驻不收拢,P1-C 拍板)。空态斜牌背不做 DOM 断言(起手必 1 张,
// 永不空),视觉证据归截图 tmp/ui-shots/t3/(tmp/shot-t3-rack.mjs 构造空手牌)。
// 断言口径:牌面文案断牌名(def.id/def.text),不断样式(样式归原型基线)。
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

/** 9 张 = 8 种 + 重复 1 张(牌库共 15 张、8 个牌名;直写引擎不经摸牌,无需凑牌库)。 */
const NINE_CARDS = [
  "连环计",
  "军情密探",
  "缓兵之计",
  "横征暴敛",
  "窃玉偷香",
  "火烧连营",
  "免战金牌",
  "求贤令",
  "免战金牌",
];

/** 把对局钉进「叠加布局可安全观察」的停车坪:quickStart 后等人类停稳,直写手牌,
 *  再把相位钉在 AwaitingDecision + 清 pendingLand/落格投影——决策卷轴不弹(引擎等人、
 *  UI 无遮罩),牌架无限期稳定可 hover。测试全程不发命令,引擎不会被推进。 */
async function rackStandstill(page: Page, cards: string[]): Promise<void> {
  await quickStart(page);
  await waitMyPause(page, 0);
  await force(page, `
    e.players[0].jinnangHand = ${JSON.stringify(cards)};
    e.lastLandOutcome = null;
    e.pendingLand = null;
    e.turnPhase = "AwaitingDecision";
  `);
  // 发牌入场级联(末张 delay 数百 ms + 本体 250ms)结束再取几何,避开动画 transform 污染
  await page.waitForTimeout(1200);
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
    await rackStandstill(page, NINE_CARDS);
    const before = (await rackGeometry(page)).cards;
    // 悬停第 5 张(有左右邻):牌钮中心被右侧牌盖住,落点取左缘窥条内(10px 处)
    await page
      .locator(`[data-testid="${TESTIDS.jinnangHand}"] > button`)
      .nth(4)
      .hover({ position: { x: 10, y: 60 } });
    await page.waitForTimeout(300); // 挥出过渡(--dur-fast)落定
    const after = (await rackGeometry(page)).cards;
    // 悬停牌:上浮 + 放大(1.12 倍级)
    expect(after[4].y).toBeLessThan(before[4].y - 5);
    expect(after[4].width).toBeGreaterThan(before[4].width * 1.05);
    // 右邻让满幅(= 原全宽):悬停牌(除放大出界的描边外)不再被遮
    expect(after[5].x).toBeGreaterThanOrEqual(after[4].x + CARD_W - 2);
    // 邻牌让位(noname getSpreadOffset 语义):左邻左移、右邻右移
    expect(after[3].x).toBeLessThan(before[3].x);
    expect(after[5].x).toBeGreaterThan(before[5].x);
    // 移出回落:几何回到常态(±1px 量测余量)
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const rest = (await rackGeometry(page)).cards;
    rest.forEach((c, i) => {
      expect(Math.abs(c.x - before[i].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - before[i].y)).toBeLessThanOrEqual(1);
    });
  });
});

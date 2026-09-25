// 底部常驻手牌架(#238 一期 T3):起手牌在架内、点牌详情弹层(开/关)、长按同效、
// 他人回合架常驻可见(常驻不收拢,P1-C 拍板)。空态斜牌背不做 DOM 断言(起手必 1 张,
// 永不空),视觉证据归截图 tmp/ui-shots/t3/(tmp/shot-t3-rack.mjs 构造空手牌)。
// 断言口径:牌面文案断牌名(def.id/def.text),不断样式(样式归原型基线)。
import { test, expect } from "./fixtures";
import { actIfCan, quickStart, snap } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { jinnangCardOf } from "../src/core/jinnang";
import type { Page } from "@playwright/test";

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

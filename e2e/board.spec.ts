// 棋盘交互:滚轮缩放、拖拽平移、总览复位、弹窗整宽标题栏可拖。
// 防 v1.9.x 引入的缩放平移 / 整宽标题栏 / 点击被吞等回归。
import { test, expect } from "@playwright/test";
import { setupAndPlay } from "./helpers";

test("滚轮缩放放大城池", async ({ page }) => {
  await setupAndPlay(page, "2", 1);
  const tile = page.locator("[data-name='长安']").first();
  const before = await tile.boundingBox();
  const box = (await page.locator("#board").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); // 向上滚 = 放大
  await page.waitForTimeout(200);
  const after = await tile.boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width);
});

test("拖拽空白处平移,「总览」复位", async ({ page }) => {
  await setupAndPlay(page, "2", 1);
  const vb0 = await page.locator("#board").getAttribute("viewBox");
  // 找一个非城池点作为平移起点(避免点到城)
  const bg = await page.evaluate(() => {
    const b = document.getElementById("board")!.getBoundingClientRect();
    for (let y = 8; y < b.height; y += 24) {
      for (let x = 8; x < b.width; x += 24) {
        const el = document.elementFromPoint(b.left + x, b.top + y);
        if (!el || !el.closest(".tile")) return { x: b.left + x, y: b.top + y };
      }
    }
    return { x: b.left + 10, y: b.top + 10 };
  });
  await page.mouse.move(bg.x, bg.y);
  await page.mouse.down();
  await page.mouse.move(bg.x - 80, bg.y - 50, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const vb1 = await page.locator("#board").getAttribute("viewBox");
  expect(vb1).not.toBe(vb0);
  // 总览按钮复位
  await page.locator(".board-reset").click();
  await page.waitForTimeout(150);
  const vb2 = await page.locator("#board").getAttribute("viewBox");
  expect(vb2).toBe(vb0);
});

test("城池详情卷轴标题栏可拖(非仅中心文字)", async ({ page }) => {
  await setupAndPlay(page, "2", 1);
  // 等到人类 Roll 回合(稳定窗口:bot 不动作,详情弹窗不会被冲掉)
  await page.waitForFunction(
    () => {
      const e = (window as unknown as { __dafung?: { engine: { isOver: boolean; activePlayer: { isBot: boolean }; turnPhase: string } } }).__dafung?.engine;
      return !!e && !e.isOver && !e.activePlayer.isBot && e.turnPhase === "Roll";
    },
    undefined,
    { timeout: 30000 },
  );
  await page.locator("[data-name='洛阳']").first().click();
  const scroll = page.locator(".scroll-overlay .scroll").first();
  await expect(scroll).toBeVisible({ timeout: 3000 });
  const header = page.locator(".scroll-header").first();

  // 从标题栏【左端】(非中心、非 × 按钮)按下拖动;在 pointerup 前读 transform
  // (pointerup 后的 click 可能落在被拖走的 .scroll 之外的 overlay 上触发 onClose)。
  const h = (await header.boundingBox())!;
  const t0 = await scroll.evaluate((el) => (el as HTMLElement).style.transform);
  await page.mouse.move(h.x + 10, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 40, h.y + h.height / 2 + 20, { steps: 2 });
  const t1 = await scroll.evaluate((el) => (el as HTMLElement).style.transform);
  await page.mouse.up();
  expect(t1).not.toBe(t0); // 拖动改了 transform → 整宽标题栏可拖(非仅中心文字)
});


// React 重构 · 棋盘交互(阶段 11)。
// 意图来源:旧 board.spec(滚轮缩放/拖拽平移;标题栏拖拽归 react-scrolls 的卷轴范畴,
// React ScrollShell 无独立 header testid,此处不逐行翻译)。
import { test, expect } from "@playwright/test";
import { quickStart } from "./react-helpers";

test("滚轮缩放:向上滚放大城池", async ({ page }) => {
  await quickStart(page);
  const tile = page.locator("[data-tile='3']");
  const before = await tile.boundingBox();
  const svg = page.locator("#board-wrap svg");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); // 向上滚 = 放大
  await page.waitForTimeout(250);
  const after = await tile.boundingBox();
  expect(after!.width).toBeGreaterThan(before!.width);
});

test("拖拽空白处平移棋盘(viewBox 变化)", async ({ page }) => {
  await quickStart(page);
  const svg = page.locator("#board-wrap svg");
  const vb0 = await svg.getAttribute("viewBox");
  // 找一个非城池的空白点作平移起点(避免点中城池)
  const bg = await page.evaluate(() => {
    const b = document.querySelector("#board-wrap svg")!.getBoundingClientRect();
    for (let y = 8; y < b.height; y += 24) {
      for (let x = 8; x < b.width; x += 24) {
        const el = document.elementFromPoint(b.left + x, b.top + y);
        if (!el || !el.closest(".bv-tile")) return { x: b.left + x, y: b.top + y };
      }
    }
    return { x: b.left + 10, y: b.top + 10 };
  });
  await page.mouse.move(bg.x, bg.y);
  await page.mouse.down();
  await page.mouse.move(bg.x - 80, bg.y - 50, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const vb1 = await svg.getAttribute("viewBox");
  expect(vb1).not.toBe(vb0);
});

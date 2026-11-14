// 地板名册(ADR-0062):地板·几何钉——真实 SVG 遮罩的渐隐带不得侵入内部画幅。
// 守住 #1424 的横/纵硬缝:按现役地图清单测四边几何,同图直接提交 viewBox 只换取景,
// 不重算艺术画幅、不复活 #946 已退役的手势;城池缩略图继续引用棋盘共享 defs。
import { test, expect, type Page } from "../fixtures";
import { quickStart } from "../helpers/scenes";
import maps from "../../public/maps/index.json" with { type: "json" };
import { TESTIDS } from "../../src/app/screens/game/testids";

async function maskBounds(page: Page) {
  return page.locator("#board").evaluate((el) => {
    const box = (fill: string) => {
      const rect = el.querySelector<SVGRectElement>(`#bv-edge-mask rect[fill="${fill}"]`)!;
      const b = rect.getBBox();
      return { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
    };
    return {
      left: box("url(#bv-edge-fade-l)"),
      right: box("url(#bv-edge-fade-r)"),
      top: box("url(#bv-edge-fade-t)"),
      bottom: box("url(#bv-edge-fade-b)"),
    };
  });
}

test.describe("棋盘底纹渐隐(#1424)", () => {
  test.describe.configure({ retries: 0 });
  test("现役地图内部画幅连续,换取景及城池缩略图保持同源", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    for (const map of maps) {
      await quickStart(page, 67, { advance: "preRoll", mapId: map.id });
      const board = page.locator("#board");
      await board.waitFor({ state: "attached" });
      const fit = await board.evaluate((el) => {
        const v = (el as SVGSVGElement).viewBox.baseVal;
        return { x: v.x, y: v.y, w: v.width, h: v.height };
      });
      const original = await maskBounds(page);
      // 预期来自画幅四边,不复制 computeFitView 或遮罩的 padding 算法。
      expect.soft(original.left.right, `${map.id}左带在画幅之外`).toBeCloseTo(fit.x);
      expect.soft(original.right.x, `${map.id}右带在画幅之外`).toBeCloseTo(fit.x + fit.w);
      expect.soft(original.top.bottom, `${map.id}上带在画幅之外`).toBeCloseTo(fit.y);
      expect.soft(original.bottom.y, `${map.id}下带在画幅之外`).toBeCloseTo(fit.y + fit.h);

      // 几何缝直接换取景,生产艺术画幅仍是原 fit,遮罩不得跟着切进内部。
      await board.evaluate((el, f) => {
        el.setAttribute(
          "viewBox",
          [f.x - f.w / 10, f.y - f.h / 10, f.w * 1.2, f.h * 1.2].join(" "),
        );
      }, fit);
      expect(await maskBounds(page), `${map.id}取景变化不改艺术画幅`).toEqual(original);
      await board.evaluate((el, f) => {
        el.setAttribute("viewBox", [f.x, f.y, f.w, f.h].join(" "));
      }, fit);

      await page.getByTestId(TESTIDS.topbarOverview).click();
      await page.getByTestId(TESTIDS.warlordsCities(0)).click();
      const thumb = page.getByTestId(TESTIDS.cityLedger).locator(".city-ledger-thumb").first();
      await expect(thumb).toBeVisible();
      const shared = await thumb.evaluate((el) => {
        const svg = el as SVGSVGElement;
        const painted = svg.querySelector<SVGGraphicsElement>(".bv-tile")!.getBBox();
        const gradients = [...svg.querySelectorAll("[fill^='url(#bv-']")].map((part) => {
          const id = part.getAttribute("fill")!.slice(5, -1);
          return document.getElementById(id)!.closest("svg")!.id;
        });
        return {
          width: painted.width,
          height: painted.height,
          gradients,
          localDefs: svg.querySelectorAll("defs").length,
        };
      });
      expect(shared.width, `${map.id}缩略图有实绘宽度`).toBeGreaterThan(0);
      expect(shared.height, `${map.id}缩略图有实绘高度`).toBeGreaterThan(0);
      expect(shared.gradients.length, `${map.id}缩略图消费共享渐变`).toBeGreaterThan(0);
      expect(shared.gradients.every((id) => id === "board")).toBe(true);
      expect(shared.localDefs).toBe(0);
    }
  });
});

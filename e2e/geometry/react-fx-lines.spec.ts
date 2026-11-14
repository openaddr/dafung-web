// 地板名册(ADR-0062):真实SVG实绘与局部视口必须在浏览器验证。
// 守住易主/锦囊/命令式行军流光的零视口复发、裁切与RM瞬隐;每档组合一例。
import { test, expect } from "../fixtures";
import { quickStart } from "../helpers/scenes";
import { waitFxIdle } from "../helpers/settle";
import { playPresentation } from "../helpers/drivers";
import {
  expectFxPaint,
  freezeFxTimers,
  measureFxAnchorDrift,
  pauseFxFrame,
} from "../helpers/fx-paint";

test.describe("线状特效的实际绘制(#1419)", () => {
  test.describe.configure({ retries: 0 });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`局部视口与实绘:${reducedMotion}`, async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.emulateMedia({ reducedMotion });
      await quickStart(page, 67, { advance: "preRoll", mapId: "guanzhong" });
      await waitFxIdle(page);
      await page.locator("#board").waitFor({ state: "attached" });
      const anchor = await page.evaluate(() => {
        const s = window.__dafung!.snapshot()!;
        const e = window.__dafung!.getEngine()!;
        const v = (document.getElementById("board") as unknown as SVGSVGElement).viewBox.baseVal;
        const center = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
        const tile = [...e.board.tiles].sort(
          (a, b) =>
            Math.hypot(a.position.x - center.x, a.position.y - center.y) -
            Math.hypot(b.position.x - center.x, b.position.y - center.y),
        )[0];
        return { ...center, playerId: s.players[0].id, tileIndex: tile.index };
      });
      await freezeFxTimers(page);
      const at = (x: number, y: number) => ({ x: anchor.x + x, y: anchor.y + y });
      // 走生产anchorMarches→marchBegin→animateMove,不能直接调用私有高亮函数。
      const march = playPresentation(page, [
        {
          kind: "tokenMoved",
          playerId: anchor.playerId,
          keyframes: [
            {
              points: [at(-150, -100), at(-120, -100)],
              flow: [at(-150, -100), at(-135, -145), at(-120, -100)],
            },
          ],
        },
      ]);
      // 固定推进覆盖生产两次rAF与首段,不轮询或改造行军时序。
      await page.clock.runFor(160);
      await march;
      await playPresentation(page, [
        {
          kind: "propertyChanged",
          tileIndex: anchor.tileIndex,
          level: 1,
          levelChanged: false,
          ownerChanged: true,
          ownerColorIndex: 0,
        },
        {
          kind: "skillPointed",
          playerId: anchor.playerId,
          lines: [
            { x1: anchor.x - 150, y1: anchor.y - 40, x2: anchor.x + 80, y2: anchor.y + 50 },
            { x1: anchor.x + 160, y1: anchor.y - 70, x2: anchor.x + 160, y2: anchor.y + 70 },
            { x1: anchor.x - 120, y1: anchor.y + 100, x2: anchor.x + 110, y2: anchor.y + 100 },
          ],
        },
      ]);
      // 每个指示线宿主按自身顺序定位,不把defs计进实际绘制名册。
      const jlines = page.locator("#bv-fx .fx-svg-jline");
      await expect(jlines).toHaveCount(3);
      const selectors = [
        "#bv-fx .fx-ownflash-line",
        ...[0, 1, 2].map((i) => `#bv-fx .fx-svg-jline >> nth=${i}`),
        "#bv-flow .road-flow",
      ];
      await expect(page.locator(selectors[4])).toHaveCount(1);
      await pauseFxFrame(page, 0.45);
      for (const selector of selectors) {
        const geometry = await page.locator(selector).evaluate((el) => {
          const svg = (el as SVGGraphicsElement).ownerSVGElement!;
          const box = svg.getBoundingClientRect();
          // 从真实DOM几何与描边取画笔范围,不在测试重写产品的线段/箭羽算法。
          const paintedCorners = [
            ...svg.querySelectorAll<SVGGraphicsElement>("line,path,circle"),
          ].flatMap((part) => {
            const b = part.getBBox();
            const css = getComputedStyle(part);
            const stroke = css.stroke === "none" ? 0 : Number.parseFloat(css.strokeWidth) / 2;
            return [
              [b.x - stroke, b.y - stroke],
              [b.x + b.width + stroke, b.y - stroke],
              [b.x - stroke, b.y + b.height + stroke],
              [b.x + b.width + stroke, b.y + b.height + stroke],
            ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(part.getScreenCTM()!));
          });
          return {
            width: box.width,
            height: box.height,
            contained: paintedCorners.every(
              (point) =>
                point.x >= box.left - 1 &&
                point.x <= box.right + 1 &&
                point.y >= box.top - 1 &&
                point.y <= box.bottom + 1,
            ),
          };
        });
        expect.soft(geometry.width, selector).toBeGreaterThan(0);
        expect.soft(geometry.height, selector).toBeGreaterThan(0);
        expect.soft(geometry.contained, selector).toBe(true);
        expect.soft(await measureFxAnchorDrift(page, selector), selector).toBeLessThan(1);
      }
      await expectFxPaint(page, selectors);
      await page.evaluate(() => {
        const board = document.getElementById("board") as unknown as SVGSVGElement;
        const v = board.viewBox.baseVal;
        board.setAttribute(
          "viewBox",
          [v.x + v.width * 0.05, v.y + v.height * 0.05, v.width * 0.9, v.height * 0.9].join(" "),
        );
      });
      await page.clock.runFor(32);
      await page.screenshot({ animations: "allow" });
      for (const selector of selectors) {
        const drift = await measureFxAnchorDrift(page, selector);
        expect.soft(drift, selector + "取景提交后的锚点").toBeLessThan(1);
      }
      await page.clock.runFor(2000);
      await expect(
        page.locator("#bv-flow > svg, #bv-fx .fx-ownflash-line, #bv-fx .fx-svg-jline"),
      ).toHaveCount(0);
    });
  }
});

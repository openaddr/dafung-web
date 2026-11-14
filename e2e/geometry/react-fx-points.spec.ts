// 地板名册(ADR-0062):SVG局部视口几何+真实栅格像素,假DOM不能证明浏览器实绘。
// 守住浮字/印章零视口复发与RM瞬隐;同组造态复用生产present→sink→store。
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

test.describe("点状特效的实际绘制(#1418)", () => {
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
        const p = s.players[0];
        const e = window.__dafung!.getEngine()!;
        const v = (document.getElementById("board") as unknown as SVGSVGElement).viewBox.baseVal;
        const center = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
        const tile = [...e.board.tiles].sort(
          (a, b) =>
            Math.hypot(a.position.x - center.x, a.position.y - center.y) -
            Math.hypot(b.position.x - center.x, b.position.y - center.y),
        )[0];
        // 本例守表现层绘制边界：显式坐标在可见中部造场，避开顶端知会槽的合法遮挡。
        return { ...center, playerId: p.id, tileIndex: tile.index };
      });
      await freezeFxTimers(page);
      // 真实破产sink分拍产出墨渍/撒币;只推进主线程时钟到撒币拍,不越过TTL。
      const ceremony = playPresentation(page, [
        {
          kind: "bankruptCeremony",
          playerId: anchor.playerId,
          x: anchor.x + 180,
          y: anchor.y - 120,
        },
      ]);
      await expect
        .poll(
          async () => {
            await page.clock.runFor(25);
            return page.locator("#bv-fx .fx-burst-coins").count();
          },
          // 推进虚拟时间不能沿用真实时间的递增长退避；每步推进后直接观察。
          { intervals: [0] },
        )
        .toBe(1);
      await playPresentation(page, [
        {
          kind: "textFloat",
          playerId: anchor.playerId,
          atTile: anchor.tileIndex,
          x: anchor.x - 120,
          y: anchor.y,
          text: "火烧连营·借东风",
          skill: { kind: "cast", colorIndex: 0 },
        },
        {
          kind: "textFloat",
          playerId: anchor.playerId,
          atTile: anchor.tileIndex,
          x: anchor.x,
          y: anchor.y,
          text: "卧龙",
          skill: { kind: "tag" },
        },
        {
          kind: "cashDelta",
          playerId: anchor.playerId,
          atTile: anchor.tileIndex,
          x: anchor.x,
          y: anchor.y,
          amount: -888,
        },
        {
          kind: "supplyRain",
          playerId: anchor.playerId,
          amount: 888,
          atTile: anchor.tileIndex,
          x: anchor.x - 100,
          y: anchor.y - 130,
        },
        {
          kind: "landPulse",
          tileIndex: anchor.tileIndex,
          x: anchor.x + 10,
          y: anchor.y + 80,
        },
        {
          kind: "sealStamped",
          tileIndex: anchor.tileIndex,
          x: anchor.x + 100,
          y: anchor.y,
          char: "得",
          tone: "gold",
        },
      ]);
      const targets = [
        ".fx-svg-floater.skill",
        ".fx-svg-floater.tag",
        ".fx-svg-floater.neg",
        ".fx-svg-seal",
        ".fx-supply-coins",
        ".fx-burst-coins",
        ".fx-svg-pulse",
        ".fx-svg-inkblot",
      ].map((selector) => `#bv-fx > .bv-fx-svg ${selector}`);
      await page.locator(targets[0]).waitFor({ state: "attached" });
      await pauseFxFrame(page);
      for (const selector of targets) {
        const geometry = await page.locator(selector).evaluate((el) => {
          const svg = (el as SVGGraphicsElement).ownerSVGElement!;
          const box = svg.getBoundingClientRect();
          const animations = el.getAnimations({ subtree: true });
          const savedTimes = animations.map((a) => a.currentTime);
          // 从浏览器真实keyframes取端点,不在测试复制动画路径/峰值公式。
          const offsets = new Set(Array.from({ length: 25 }, (_, i) => i / 24));
          for (const animation of animations) {
            for (const frame of (animation.effect as KeyframeEffect).getKeyframes()) {
              offsets.add(frame.computedOffset);
            }
          }
          let contained = true;
          for (const offset of offsets) {
            for (const animation of animations) {
              const timing = animation.effect!.getTiming();
              if (typeof timing.delay !== "number") throw new Error("动画延迟不可解析");
              animation.currentTime = timing.delay + Number(timing.duration) * offset;
            }
            const art = el.getBoundingClientRect();
            contained &&=
              art.left >= box.left - 1 &&
              art.right <= box.right + 1 &&
              art.top >= box.top - 1 &&
              art.bottom <= box.bottom + 1;
          }
          animations.forEach((animation, i) => {
            animation.currentTime = savedTimes[i];
          });
          return {
            width: box.width,
            height: box.height,
            contained,
          };
        });
        expect.soft(geometry.width, selector).toBeGreaterThan(0);
        expect.soft(geometry.height, selector).toBeGreaterThan(0);
        expect.soft(geometry.contained, selector).toBe(true);
        // 宿主既有clientWidth整数读数与SVG小数布局有亚像素差，守一个CSS像素。
        expect.soft(await measureFxAnchorDrift(page, selector), selector).toBeLessThan(1);
      }
      await expectFxPaint(page, targets);
      // 几何缝直接提交新取景,让生产BoardHost观察器重新同步。
      await page.evaluate(() => {
        const board = document.getElementById("board") as unknown as SVGSVGElement;
        const v = board.viewBox.baseVal;
        board.setAttribute(
          "viewBox",
          [v.x + v.width * 0.05, v.y + v.height * 0.05, v.width * 0.9, v.height * 0.9].join(" "),
        );
      });
      await page.clock.runFor(32);
      // 合成层提交后再读 SVG CTM；虚拟 rAF 不会替代浏览器真实绘制提交。
      await page.screenshot({ animations: "allow" });
      for (const selector of targets) {
        const drift = await measureFxAnchorDrift(page, selector);
        expect.soft(drift, selector + "取景提交后的锚点").toBeLessThan(1);
      }
      await page.clock.runFor(2000);
      await ceremony;
    });
  }
});

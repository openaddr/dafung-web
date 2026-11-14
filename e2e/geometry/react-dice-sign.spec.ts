// 地板名册(ADR-0062):真实浏览器签体/文字几何与揭示拍,假 DOM 不量边界。
// 真实环:种到待决前一拍→生产 present/sink 掷骰签→芯片同拍揭示→原生命周期退场。
// 全合法签面共享两种媒体偏好组;约秒级浏览器成本,不重复验证引擎掷骰规则。
import { test, expect } from "../fixtures";
import { quickStart } from "../helpers/scenes";
import { plant, playPresentation } from "../helpers/drivers";
import { waitFxIdle } from "../helpers/settle";
import { freezeFxTimers } from "../helpers/fx-paint";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { SIGN_FACES } from "../../src/core/constants";
import { DICE } from "../../src/app/fx/timings";

test.describe("掷骰签安全区与揭示拍(#1420)", () => {
  test.use({ viewport: { width: 844, height: 390 } });
  test.describe.configure({ retries: 0 });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`全部合法签面完整可读并同步揭示:${reducedMotion}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await quickStart(page, 67, { advance: "preRoll", mapId: "guanzhong" });
      await page.locator("#board").waitFor({ state: "attached" });
      await plant(page, { kind: "armPhase", turnPhase: "AwaitingDecision" });
      await plant(page, { kind: "armLanding", landing: null });
      await waitFxIdle(page);
      // 现有 safe-area 取值口模拟横屏刘海;常规组同时守住零 inset 原始缺陷。
      const safe =
        reducedMotion === "reduce"
          ? { top: 12, right: 44, bottom: 8, left: 44 }
          : { top: 0, right: 0, bottom: 0, left: 0 };
      await page.evaluate((insets) => {
        for (const [edge, value] of Object.entries(insets)) {
          document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`);
        }
      }, safe);
      await freezeFxTimers(page);
      const chip = page.getByTestId(TESTIDS.diceFace);
      const anchor = page.getByTestId(TESTIDS.diceSignAnchor);
      await expect(anchor).toHaveCount(1);
      for (const [index, face] of SIGN_FACES.entries()) {
        const previous = await chip.textContent();
        await expect(page.locator(".dice-overlay")).toHaveCount(0);
        // 启动和收敛分开:时钟暂停期间不能 await 完整演出生命周期。
        const playing = playPresentation(page, [{ kind: "diceRolled", die: index + 1 }]);
        const sign = page.locator(".dice-sign");
        await expect(sign).toHaveText(face);
        await expect(chip).toHaveText(face);
        expect(previous, "揭示前驻留上一结果,现身拍才换成新点数").not.toBe(face);
        const geometry = await sign.evaluate(
          (el, ids) => {
            const box = el.getBoundingClientRect();
            // 新节点先物化样式再取动画;固定真实入场末帧,不改 opacity 或时长。
            for (const animation of el.parentElement!.getAnimations()) {
              animation.pause();
              animation.currentTime = Number(animation.effect!.getTiming().duration);
            }
            const range = document.createRange();
            range.selectNodeContents(el);
            const text = range.getBoundingClientRect();
            const intersects = ids.some((id) => {
              const target = document.querySelector(`[data-testid="${id}"]`);
              if (target === null) throw new Error(`顶栏验收节点缺席:${id}`);
              const r = target.getBoundingClientRect();
              return (
                box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top
              );
            });
            return {
              box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
              text: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
              textInside:
                text.left >= box.left &&
                text.right <= box.right &&
                text.top >= box.top &&
                text.bottom <= box.bottom,
              intersects,
              opacity: Number(getComputedStyle(el.parentElement!).opacity),
            };
          },
          [TESTIDS.settingsButton, TESTIDS.topbarOverview, TESTIDS.turnCapsule],
        );
        for (const [kind, bounds] of Object.entries({ 签体: geometry.box, 字形: geometry.text })) {
          expect.soft(bounds.left, `${face}${kind}左缘`).toBeGreaterThanOrEqual(safe.left);
          expect.soft(bounds.right, `${face}${kind}右缘`).toBeLessThanOrEqual(844 - safe.right);
          expect.soft(bounds.top, `${face}${kind}上缘`).toBeGreaterThanOrEqual(safe.top);
          expect.soft(bounds.bottom, `${face}${kind}下缘`).toBeLessThanOrEqual(390 - safe.bottom);
        }
        expect.soft(geometry.textInside, `${face}字形不溢出签体`).toBe(true);
        expect.soft(geometry.intersects, `${face}不压顶栏交互或胶囊`).toBe(false);
        expect.soft(geometry.opacity, `${face}可读停留帧`).toBe(1);
        await page.clock.runFor(DICE.readyMs + DICE.holdMs + DICE.fadeOutMs + 1);
        await playing;
        await expect(page.locator(".dice-overlay")).toHaveCount(0);
        await expect(chip).toHaveText(face);
      }
    });
  }
});

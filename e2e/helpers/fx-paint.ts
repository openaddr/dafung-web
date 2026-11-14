// 真浏览器实绘缝(#1418):控制真实动画时间,临时隐去整件SVG比较像素,不改变布局。
import { expect, type Page } from "@playwright/test";

/** Worker 已由场景冻结;在演出排空后冻结主线程TTL,再造受测表现态。 */
export async function freezeFxTimers(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // 入场缩放只作用于底板SVG；先完成它，不能把入场中间态当宿主对位基准。
  await page.locator("#board").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  // 浏览器时钟使用明确纪元与未来暂停点，不混用宿主Date.now造成毫秒级“倒退”。
  const epoch = new Date("2026-01-01T00:00:00Z");
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(epoch.getTime() + 60_000));
}

/** 背景保持当前帧，受测FX钉在含延迟的有效比例；全页一起静止。 */
export async function pauseFxFrame(page: Page, fraction = 0.35): Promise<void> {
  await page.evaluate((at) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      const duration = animation.effect!.getTiming().duration;
      if (typeof duration !== "number") throw new Error("受控帧:动画时长不可解析");
      const target = (animation.effect as KeyframeEffect).target;
      if (target instanceof Element && target.closest("#bv-fx, #bv-flow")) {
        const delay = animation.effect!.getTiming().delay;
        if (typeof delay !== "number") throw new Error("受控帧:动画延迟不可解析");
        animation.currentTime = delay + duration * at;
      }
    }
  }, fraction);
}

/** 按局部视口中心读真实屏幕矩阵,点状/线状及取景前后共用同一锚定口径。 */
export async function measureFxAnchorDrift(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => {
    const svg = (el as SVGGraphicsElement).ownerSVGElement!;
    const board = document.getElementById("board") as unknown as SVGSVGElement;
    const v = svg.viewBox.baseVal;
    const at = new DOMPoint(v.x + v.width / 2, v.y + v.height / 2);
    const expected = at.matrixTransform(board.getScreenCTM()!);
    const actual = at.matrixTransform(svg.getScreenCTM()!);
    return Math.hypot(expected.x - actual.x, expected.y - actual.y);
  });
}

/** PNG在浏览器Canvas中解码后逐像素比较,不把压缩字节/metadata当成实绘。 */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([first, second]) => {
      const decode = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [left, right] = await Promise.all([decode(first), decode(second)]);
      let changed = 0;
      for (let i = 0; i < left.length; i += 4) {
        if (
          left[i] !== right[i] ||
          left[i + 1] !== right[i + 1] ||
          left[i + 2] !== right[i + 2] ||
          left[i + 3] !== right[i + 3]
        )
          changed++;
      }
      return changed;
    },
    [a, b].map((png) => `data:image/png;base64,${png.toString("base64")}`),
  );
}

/** 每件独立证明:先双拍稳定,随后仅隐藏目标,其像素必须确实消失。 */
export async function expectFxPaint(page: Page, selectors: string[]): Promise<void> {
  const visible = await page.screenshot({ animations: "allow" });
  const stable = await page.screenshot({ animations: "allow" });
  expect(await changedPixels(page, visible, stable), "无操作的同帧截图应稳定").toBe(0);
  for (const selector of selectors) {
    const target = page.locator(selector);
    await expect(target).toHaveCount(1);
    // DPR=1的Blink会复用SVG子g的visibility栅格缓存;整件opacity在合成阶段隐藏。
    const previous = await target.evaluate((el) => {
      const svg = el instanceof SVGSVGElement ? el : (el as SVGGraphicsElement).ownerSVGElement!;
      const opacity = {
        value: svg.style.getPropertyValue("opacity"),
        priority: svg.style.getPropertyPriority("opacity"),
      };
      svg.style.setProperty("opacity", "0", "important");
      return opacity;
    });
    const hidden = await page.screenshot({ animations: "allow" });
    await target.evaluate((el, opacity) => {
      const svg = el instanceof SVGSVGElement ? el : (el as SVGGraphicsElement).ownerSVGElement!;
      if (opacity.value) svg.style.setProperty("opacity", opacity.value, opacity.priority);
      else svg.style.removeProperty("opacity");
    }, previous);
    expect
      .soft(await changedPixels(page, visible, hidden), `${selector}应有实际绘制像素`)
      .toBeGreaterThan(4);
  }
}

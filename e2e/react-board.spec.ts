// React 重构 · 棋盘交互(阶段 11)。
// 意图来源:旧 board.spec(滚轮缩放/拖拽平移;标题栏拖拽归 react-scrolls 的卷轴范畴,
// React ScrollShell 无独立 header testid,此处不逐行翻译)。
import { test, expect } from "./fixtures";
import { quickStart, force, engineState } from "./react-helpers";

test("滚轮缩放:向上滚放大城池", async ({ page }) => {
  // master 对照实验(#240 收口)曾在全量负载下翻车:缩放动画轮询 5s 在高压下不够,
  // 标 slow 对齐外层超时(与 encounters/online 同口径,2026-09-25 flake 还债)。
  test.slow();
  await quickStart(page);
  const tile = page.locator("[data-tile='3']");
  const before = await tile.boundingBox();
  const svg = page.locator("#board");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); // 向上滚 = 放大
  // TODO #13:缩放是动画过渡,原固定 250ms 在全量负载下动画未完就读 boundingBox。
  // 改为轮询"宽度真的变大了"(5s 余量),到位即断言通过。
  await expect
    .poll(async () => (await tile.boundingBox())?.width ?? 0, { timeout: 5_000 })
    .toBeGreaterThan(before!.width);
});

test("拖拽空白处平移棋盘(viewBox 变化)", async ({ page }) => {
  test.slow(); // 同上:负载下的操作时序余量
  await quickStart(page);
  const svg = page.locator("#board");
  const vb0 = await svg.getAttribute("viewBox");
  // 找一个非城池的空白点作平移起点(避免点中城池/角落控制钮——pan/zoom 监听在
  // svg 上,从按钮起拖的事件到不了 svg,viewBox 不会动)
  const bg = await page.evaluate(() => {
    const b = document.querySelector("#board")!.getBoundingClientRect();
    for (let y = 8; y < b.height; y += 24) {
      for (let x = 8; x < b.width; x += 24) {
        const el = document.elementFromPoint(b.left + x, b.top + y);
        if (!el || !el.closest(".bv-tile, button")) return { x: b.left + x, y: b.top + y };
      }
    }
    return { x: b.left + 10, y: b.top + 10 };
  });
  await page.mouse.move(bg.x, bg.y);
  await page.mouse.down();
  await page.mouse.move(bg.x - 80, bg.y - 50, { steps: 5 });
  await page.mouse.up();
  // TODO #13:平移同样有过渡动画,固定 150ms 改为轮询 viewBox 真的变化(5s 余量)
  await expect
    .poll(async () => await svg.getAttribute("viewBox"), { timeout: 5_000 })
    .not.toBe(vb0);
});

test("城池档位珠:等级=珠数,满级金框加冕,非满级无金框,Lv0 无珠", async ({ page }) => {
  await quickStart(page);
  // 种植式零竞速:持有直接入册后断 DOM,不走真实升级路径——升级 endTurn 会同步放
  // bot 链,火烧连营可同拍拆城,升级后的活状态断言必 flake(实录见 react-solo 扩军用例注)。
  await force(
    page,
    `
    e.phase = "Playing";
    e.activeIndex = 0;
    const unowned = e.board.tiles.filter((t) => t.propertyId && e.findOwner(t.propertyId) == null);
    const mk = (t, level) => ({
      propertyId: t.propertyId,
      level,
      maxLevel: 3,
      group: t.group ?? "a",
    });
    e.players[0].properties.push(mk(unowned[0], 3));
    e.players[1].properties.push(mk(unowned[1], 2));
    window.__pipProbe = { full: unowned[0].index, mid: unowned[1].index, empty: unowned[2].index };
  `,
  );
  const { full, mid, empty } = await engineState(page, "window.__pipProbe");
  // 满级城:三珠 + 满贯金框,data-level 随等级
  const pips = page.locator(`[data-tile="${full}"] .bv-level-pips`);
  await expect(pips).toHaveAttribute("data-level", "3");
  await expect(pips.locator(".bv-pip")).toHaveCount(3);
  await expect(pips.locator(".bv-pips-crown")).toHaveCount(1);
  // 非满级城:两珠、无金框(满级判据 level>=maxLevel 的反面,防金框误常亮)
  const midPips = page.locator(`[data-tile="${mid}"] .bv-level-pips`);
  await expect(midPips).toHaveAttribute("data-level", "2");
  await expect(midPips.locator(".bv-pip")).toHaveCount(2);
  await expect(midPips.locator(".bv-pips-crown")).toHaveCount(0);
  // Lv0=无珠:无主城不出珠组(有珠才看,升级过的城天然突出)
  await expect(page.locator(`[data-tile="${empty}"] .bv-level-pips`)).toHaveCount(0);
});

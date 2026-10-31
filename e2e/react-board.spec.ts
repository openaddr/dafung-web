// React 重构 · 棋盘交互(阶段 11)。
// 意图来源:旧 board.spec(滚轮缩放/拖拽平移;标题栏拖拽归 react-scrolls 的卷轴范畴,
// React ScrollShell 无独立 header testid,此处不逐行翻译)。
import { test, expect } from "./fixtures";
import { quickStart, force, engineState } from "./react-helpers";

test("滚轮缩放:向上滚放大城池", async ({ page }) => {
  // 满载 flake 族退役(#620 登记→#626 加固):原断言读 tile boundingBox(布局派生
  // 量),svg 自身尺寸沉降(面板挂载/字体)与缩放增长同轴打架,全量负载下掩盖真缩放。
  // 缩放实为同步 viewBox 重写(usePanZoom.onWheel 命令式 setAttribute,无动画——
  // 原 TODO #13「动画过渡」前提有误),断言真源 viewBox.w 变小(=放大),与平移例
  // 同口径;test.slow 保留作操作时序余量。
  test.slow();
  await quickStart(page);
  const svg = page.locator("#board");
  const vbW0 = Number((await svg.getAttribute("viewBox"))!.split(/\s+/)[2]);
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400); // 向上滚 = 放大(viewBox.w 经 exp(-0.6)≈0.55 收缩)
  await expect
    .poll(async () => Number((await svg.getAttribute("viewBox"))!.split(/\s+/)[2]), {
      timeout: 5_000,
    })
    .toBeLessThan(vbW0);
});

test("拖拽空白处平移棋盘(viewBox 变化)", async ({ page }) => {
  test.slow(); // 同上:负载下的操作时序余量
  await quickStart(page);
  const svg = page.locator("#board");
  const vb0 = await svg.getAttribute("viewBox");
  // 找一个非城池的空白点作平移起点。空白=事件真落棋盘:命中元素必须在 #board 内
  // 且非城池/按钮——压在棋盘上的浮层(#700 顶钮容器 .topbtns pointer-events:auto
  // 盖住左上角)旧判据 closest(".bv-tile, button") 挡不住,起手事件被浮层吞掉,
  // svg 零事件、viewBox 纹丝不动(W4 实锤)。
  const bg = await page.evaluate(() => {
    const b = document.querySelector("#board")!.getBoundingClientRect();
    const svg = document.querySelector("#board")!;
    for (let y = 8; y < b.height; y += 24) {
      for (let x = 8; x < b.width; x += 24) {
        const el = document.elementFromPoint(b.left + x, b.top + y);
        if (el && svg.contains(el) && !el.closest(".bv-tile, button"))
          return { x: b.left + x, y: b.top + y };
      }
    }
    throw new Error("棋盘全格无非城池空白点(命中不在 #board 内即浮层盖死)——布局或判据崩");
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

test("棋盘景深静态件:纸纤维 pattern 一次生成+远山带双幅+路肩随驿道(#844)", async ({ page }) => {
  // 静态件全部确定性存在(StaticLayers memo,无时序竞速):结构断言守住
  // 「深 zoom 肌理/远景衬/路肩」三件套不被后续重构静默摘除。
  await quickStart(page);
  // 纸纤维:SVG pattern(feTurbulence 一次生成,零图片资产)
  await expect(page.locator("#board pattern#bv-fiber")).toHaveCount(1);
  // 远山衬:龚贤横带上/下缘各一幅(素材 texture:gongxian-shanshui)
  await expect(page.locator('#board image[href*="texture-gongxian-shanshui"]')).toHaveCount(2);
  // 路肩:单环闭合,每段驿道垫一条肩线(数 = 格数)
  const n = await engineState(page, "e.board.count");
  await expect(page.locator("#board .bv-road-shoulder")).toHaveCount(n);
});

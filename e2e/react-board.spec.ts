// React 重构 · 棋盘交互(阶段 11)。
// 意图来源:旧 board.spec(滚轮缩放/拖拽平移两例已随 #946 平移缩放整退役删除——
// 棋盘恒 computeFitView 总览定格,无手势通路可测;标题栏拖拽归 react-scrolls 的
// 卷轴范畴,React ScrollShell 无独立 header testid,此处不逐行翻译)。
import { test, expect } from "./fixtures";
import { quickStart, force, engineState, waitFxIdle, freezeClock } from "./react-helpers";

// 真实段(ADR-0058):真实挂载棋盘 DOM 上等级珠挂点的渲染链即被测环(data-level/
// 珠数/金框随 property 数据真渲染)。force 判词:满级/半级城引擎到不了——真实升级
// 路径走 endTurn 会同步放 bot 链(火烧连营可同拍拆城),升级后的活状态断言必竞速
// (react-solo 扩军实录);持有直接入册=断言面需特定等级形态,排空演出+冻结+直写
// 种植是确定性到达手段。
test(
  "城池等级珠:等级=珠数,满级金框加冕,非满级无金框,Lv0 无珠",
  { tag: "@slow" },
  async ({ page }) => {
    // 慢池(#1026;菜单A 2026-11-07 挪入):单例实测 52.4s>30s——快池门禁 --grep-invert @slow 跳过。
    await quickStart(page);
    // #987 冻结闸(#943 竞速点清偿):种植的两城分属人类/bot 席,不冻则 bot 链继续自走,
    // 理论上可落自己城升级改 level——先排空演出再冻结,种植态在断言窗内不可变。
    await waitFxIdle(page);
    await freezeClock(page);
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
  },
);

test("棋盘景深静态件:纸纤维 pattern 一次生成+远山带双幅+路肩随驿道(#844)", async ({ page }) => {
  // 真实段(ADR-0058):quickStart 真实开局链后静态件的结构性存在(StaticLayers
  // memo 确定性渲染,零时序竞速)即被测环——零种植零冻结。
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

// 特殊城落格抉择流 e2e 冒烟(#830,#824/#826 批次收官守门):非珍宝特殊城真 UI 走查——
// 落招贤城(event:"hero")免随机机遇、招贤三选一卷轴挂起 → 选将续跑交易链(可购决策
// 出现)→ 买成收口。珍宝城购地链序已由 react-scrolls「珍宝城购地」钉住;其余固定事件
// 的结算数值与链序(免掷/事件先于交易链/池空沉默/恢复随行)由 test/city-event.test.ts
// 引擎缝钉住,此处不重复——冒烟只证用户可见抉择流(宁缺毋滥:墙钟 ~5s / 无既有 spec
// 覆盖非珍宝事件城落格 / 引擎断言已下沉 test/)。
// 落格场景配方照抄 react-scrolls「珍宝城购地」例(场景配方跨 spec 照抄+头注注明出处
// 惯例,2026-10-29 retro 成文):freezeClock → 摆位邻格 → marchTraverse 单格 →
// settleMarchLanding → 断言;选择器一律走 TESTIDS/SCROLL_TESTIDS 单源。
import { test, expect } from "./fixtures";
import {
  quickStart,
  snap,
  engineState,
  freezeClock,
  unfreezeClock,
  waitFxIdle,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";

test("招贤城落格抉择流:三选一选将 → 续跑交易链 → 购地买成收口(#824 冒烟)", async ({ page }) => {
  await quickStart(page);
  await freezeClock(page); // 钉死看门狗:强制行军/落格不与自动起摇、停摆代驾赛跑
  try {
    // 摆位到无主招贤城邻格,直走 rollAndMove 掷定 1 步后的同一段引擎路径:途经遍历
    // (marchTraverse)→ 落格结算(settleMarchLanding;机遇已被 fixtures 归零,招贤城
    // =event 城本就免掷)。无主筛掉都城(选都筑城即产 holding,findOwner 非空)。
    const heroIdx = await page.evaluate(() => {
      const e = (window as any).__dafung.getEngine();
      e.phase = "Playing";
      e.activeIndex = 0;
      const me = e.players[0];
      const hc = e.board.tiles.find(
        (t: { event?: string; propertyId: string | null }) =>
          t.event === "hero" && !e.findOwner(t.propertyId),
      );
      if (hc == null) throw new Error("盘面无无主招贤城(数据 bug)");
      const from = (hc.index + e.board.count - 1) % e.board.count;
      me.position = from;
      const walked = e.marchTraverse(me, [hc.index], 1, hc.index, from, 1);
      if (walked !== "landed") throw new Error(`marchTraverse=${walked}(单格无拦检,契约违反)`);
      e.lastMove = e.board.computePath(from, 1, me.capitalIndex);
      const logAt = (window as any).__dafung.snapshot().log.length;
      e.settleMarchLanding(me, hc.index);
      (window as any).__dafung.sync();
      return { idx: hc.index as number, logAt: logAt as number };
    });
    // 固定事件:招贤三选一卷轴挂起(AwaitingHeroPick,决策方=人类座位 0)
    const scroll = page.getByTestId(SCROLL_TESTIDS.heroPickScroll);
    await expect(scroll).toBeVisible();
    await expect(scroll.getByRole("button")).toHaveCount(3); // 三选一(无「不取」)
    // 选将 → 固定事件解毕续跑交易链(pendingCityEvent 消费):可购决策卷轴出现
    await scroll.getByTestId(SCROLL_TESTIDS.heroPickOption(0)).click();
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toBeVisible();
    const pid = await engineState(page, `e.board.at(${heroIdx.idx}).propertyId`);
    await waitFxIdle(page);
    const logLenBefore = (await snap(page)).log.length;
    await page.getByTestId(TESTIDS.actionButton("buy")).click();
    // 收口:买成行落账;链序正典(#824)——招贤纳士(固定事件)先于可购(交易链)
    // 先于买成,对拍全账不截断(自落格行起)
    await expect
      .poll(
        async () => {
          const lines: { detail: string }[] = (await snap(page)).log.slice(logLenBefore);
          return lines.some((l) => l.detail.includes(`buy player=p0 prop=${pid}`));
        },
        { timeout: 15_000, message: "招贤城买成收口" },
      )
      .toBe(true);
    const lines: { detail: string }[] = (await snap(page)).log.slice(heroIdx.logAt);
    const offerAt = lines.findIndex((l) => l.detail.includes("offerHeroes"));
    const availAt = lines.findIndex((l) => l.detail.includes("available"));
    const buyAt = lines.findIndex((l) => l.detail.includes(`buy player=p0 prop=${pid}`));
    expect(offerAt).toBeGreaterThanOrEqual(0); // 固定事件已落账(招贤纳士)
    expect(availAt).toBeGreaterThan(offerAt); // 事件先于交易链
    expect(buyAt).toBeGreaterThan(availAt); // 决策买成收口
  } finally {
    await unfreezeClock(page);
  }
});

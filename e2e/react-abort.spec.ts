// #642 异常终局:引擎 abortGame(驱动链三出口——链内抛异常/停摆看门狗/时钟挂死——
// 的公共入口)→ 快照 GameOver 相位(winReason="aborted"、winner=null)→ 终局屏
// 「对局作废」面板:无胜者演出、出口按钮组与胜局同款。
// 注入走 window.__dafung 桥直呼引擎公共 abortGame(生产通路本体),经 fx 提取器/
// 折叠器全链到 UI——零共享桥污染(callEngine 封装,#1302 直呼通道)。
import { test, expect } from "./fixtures";
import { quickStart, snap } from "./react-helpers";
import { callEngine } from "./helpers/drivers";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { HOME_TID } from "../src/app/screens/home/testids";

// 真实段(ADR-0058):真实对局→引擎公共命令 abortGame 直呼(驱动链三出口的生产
// 通路本体)→fx 提取/折叠全链→作废面板真实渲染+再战真实点击即被测环。直呼走
// callEngine(#1302:只承载引擎公共方法调用,字段直写归种植件——abortGame 纯公共
// 命令无字段直写,判词=「作废对局」无 UI 通路,生产由停摆看门狗等驱动链死亡出口
// 触发,断言面=该出口的呈现链)。
test("异常终局:引擎 abortGame → 对局作废面板,无胜者渲染", { tag: "@slow" }, async ({ page }) => {
  // 慢池(#1026;菜单A 2026-11-07 挪入):单例实测 39.9s>30s——快池门禁 --grep-invert @slow 跳过。
  await quickStart(page);
  await callEngine(page, "abortGame", ["e2e:注入作废(驱动链死亡出口语义)"]);

  // 快照口径:作废态无胜者(零兜底判别的数据前提)
  const s = await snap(page);
  expect(s.phase).toBe("GameOver");
  expect(s.winner).toBeNull();
  expect(s.winReason).toBe("aborted");

  // 作废面板可见(壳体复用 victory-screen testid),标题+说明=「对局作废」口径
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryScreen)).toBeVisible();
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryAbortedTitle)).toHaveText("对局作废");
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryAbortedNote)).toContainText("详情见对局日志");

  // 无胜者渲染:胜局专属演出元素(天下归一大字/称帝行/终榜)不在场
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryTitle)).toHaveCount(0);
  await expect(page.getByTestId(SCROLL_TESTIDS.victorySub)).toHaveCount(0);
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryStandings)).toHaveCount(0);

  // 出口按钮组与胜局同款:再战一局(整页重载回设置屏,原样接既有路由)
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryRestart)).toBeVisible();
  await page.getByTestId(SCROLL_TESTIDS.victoryRestart).click();
  await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
});

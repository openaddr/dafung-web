// #642 异常终局:引擎 abortGame(驱动链三出口——链内抛异常/停摆看门狗/时钟挂死——
// 的公共入口)→ 快照 GameOver 相位(winReason="aborted"、winner=null)→ 终局屏
// 「对局作废」面板:无胜者演出、出口按钮组与胜局同款。
// 注入走 window.__dafung 桥直呼引擎公共 abortGame(生产通路本体),经 fx 提取器/
// 折叠器全链到 UI——零共享桥污染(force() 既有范式,同 react-scrolls 胜利屏例)。
import { test, expect } from "./fixtures";
import { quickStart, force, snap } from "./react-helpers";

test("异常终局:引擎 abortGame → 对局作废面板,无胜者渲染", async ({ page }) => {
  await quickStart(page);
  await force(page, `e.abortGame("e2e:注入作废(驱动链死亡出口语义)");`);

  // 快照口径:作废态无胜者(零兜底判别的数据前提)
  const s = await snap(page);
  expect(s.phase).toBe("GameOver");
  expect(s.winner).toBeNull();
  expect(s.winReason).toBe("aborted");

  // 作废面板可见(壳体复用 victory-screen testid),标题+说明=「对局作废」口径
  await expect(page.getByTestId("victory-screen")).toBeVisible();
  await expect(page.getByTestId("victory-aborted-title")).toHaveText("对局作废");
  await expect(page.getByTestId("victory-aborted-note")).toContainText("详情见对局日志");

  // 无胜者渲染:胜局专属演出元素(天下归一大字/称帝行/终榜)不在场
  await expect(page.getByTestId("victory-title")).toHaveCount(0);
  await expect(page.getByTestId("victory-sub")).toHaveCount(0);
  await expect(page.getByTestId("victory-standings")).toHaveCount(0);

  // 出口按钮组与胜局同款:再战一局(整页重载回设置屏,原样接既有路由)
  await expect(page.getByTestId("victory-restart")).toBeVisible();
  await page.getByTestId("victory-restart").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
});

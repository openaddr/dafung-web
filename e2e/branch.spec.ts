// 分歧路(捷径)重做 e2e:抵达分歧点起点后,下回合掷骰前先弹选路卷轴;
// 选小路(免费捷径)→ 再下回合 rollAndMove 经捷径行军至 rejoin 节点。
// 覆盖:doRoll 入口的 AwaitingBranch 拦截、selectBranch 设 pendingBranch、
// rollAndMove 用 pendingBranch 走捷径(board.computePath 第一步 = rejoin)。
import { test, expect } from "@playwright/test";
import { setupAndPlay, snap } from "./helpers";

// 赤壁(#11):无主 Property 型分歧点,rejoin = 江陵(#14)。主路 11→12→13→14,
// 小路 11⇒14(一步直达)。落此城可购买(像普通无主城),购买后下回合掷骰前再选路。
const BRANCH_TILE = 11;
const REJOIN_TILE = 14;

/** 等到轮到人类(p0)且为 Roll 阶段。选都定序 + 先手差异下,首回合可能是 bot 先行。 */
async function waitForHumanRoll(page: import("@playwright/test").Page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await snap(page);
    if (s.isOver) return false;
    if (s.activeIndex === 0 && !s.players[0].isBot && s.turnPhase === "Roll") return true;
    await page.waitForTimeout(400);
  }
  return false;
}

test("分歧点:掷骰前弹选路卷轴,选小路走捷径抵达 rejoin", async ({ page }) => {
  test.setTimeout(60_000);
  await setupAndPlay(page, "2", 20260728); // p0=人类,p1=bot
  // 先手可能为 bot,等到轮到人类(p0)再布置场景
  expect(await waitForHumanRoll(page)).toBe(true);

  // 模拟"上回合落格停在分歧点":把 p0 放到赤壁,强制 AwaitingBranch(pendingBranch==null)。
  // 这正是 engine.endTurn 推进到分歧点起点时自动设置的状态。
  await page.evaluate((branch) => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    eng.players[0].position = branch;
    eng.players[0].pendingBranch = null;
    eng.turnPhase = "AwaitingBranch";
  }, BRANCH_TILE);

  // 点「行军」→ onRoll→doRoll 入口拦截 AwaitingBranch → 弹选路卷轴(不掷骰)
  await expect(page.locator("#roll-btn")).toBeEnabled({ timeout: 5000 });
  await page.locator("#roll-btn").click();
  await expect(page.locator(".scroll-overlay")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".scroll-overlay")).toContainText("赤壁");

  // 选小路 → selectBranch 设 pendingBranch{Shortcut}+endTurn → 切到 bot(p1)
  await page.locator('.scroll-overlay [data-action="shortcut"]').click();
  await page.waitForTimeout(300);
  const pb = await page.evaluate(() => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    return eng.players[0].pendingBranch;
  });
  expect(pb).toEqual({ fromNode: BRANCH_TILE, kind: "Shortcut" });

  // 等 bot 走完一回合,轮到 p0:pendingBranch 已设 → endTurn 不再 AwaitingBranch → Roll
  expect(await waitForHumanRoll(page)).toBe(true);

  // 掷骰:rollAndMove 用 pendingBranch 走小路,computePath 第一步直达 rejoin(江陵#14)
  await page.locator("#roll-btn").click();
  await page.waitForTimeout(2500);
  const post = await page.evaluate(() => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    const mv = eng.lastMove;
    return {
      firstStep: mv && mv.traversed && mv.traversed.length > 0 ? mv.traversed[0] : null,
      fromTile: mv ? mv.from : null,
    };
  });
  expect(post.fromTile).toBe(BRANCH_TILE); // 确认从分歧点起步
  expect(post.firstStep).toBe(REJOIN_TILE); // 第一步经捷径直达 rejoin(江陵)
});

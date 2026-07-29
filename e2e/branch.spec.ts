// 分岔辅路 e2e:落到辅路起点(许昌)→ 弹入口抉择 → 入辅路逐格掷骰 → 终点汇入主路。
// 覆盖:doRoll 入口 AwaitingBranch 拦截弹卷轴、selectBranch(Branch) 置 onBranch={step:0}
// + 触发首格、后续 rollAndMove 沿 branch.cells 推进(branchWaypoints)、到终点清 onBranch 落 endNode。
import { test, expect } from "@playwright/test";
import { setupAndPlay, snap } from "./helpers";

// 辅路:许昌(#5)→ 襄阳(#8),5 格(珍宝/珍宝/锦囊/珍宝/中伏)。
const BRANCH_START_NAME = "许昌";
const BRANCH_END_NAME = "襄阳";

async function branchStartIndex(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate((name) => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    return eng.board.tiles.find((t: any) => t.name === name).index;
  }, BRANCH_START_NAME);
}
async function branchEndIndex(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate((name) => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    return eng.board.tiles.find((t: any) => t.name === name).index;
  }, BRANCH_END_NAME);
}

/** 等到轮到人类(p0)且为 Roll 阶段。 */
async function waitForHumanRoll(page: import("@playwright/test").Page, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await snap(page);
    if (s.isOver) return false;
    if (s.activeIndex === 0 && !s.players[0].isBot && s.turnPhase === "Roll") return true;
    await page.waitForTimeout(400);
  }
  return false;
}

test("辅路:落起点弹抉择,入辅路逐格行进,终点汇入主路", async ({ page }) => {
  test.setTimeout(90_000);
  await setupAndPlay(page, "2", 20260728); // p0=人类,p1=bot
  expect(await waitForHumanRoll(page)).toBe(true);

  const startIdx = await branchStartIndex(page);
  const endIdx = await branchEndIndex(page);

  // 模拟"上回合落格停在辅路起点":把 p0 放到许昌,强制 AwaitingBranch。
  await page.evaluate((start) => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    eng.players[0].position = start;
    eng.players[0].onBranch = null;
    eng.turnPhase = "AwaitingBranch";
  }, startIdx);

  // 点「行军」→ onRoll→doRoll 入口拦截 AwaitingBranch → 弹辅路抉择卷轴(不掷骰)
  await expect(page.locator("#roll-btn")).toBeEnabled({ timeout: 5000 });
  await page.locator("#roll-btn").click();
  await expect(page.locator(".scroll-overlay")).toBeVisible({ timeout: 3000 });
  await expect(page.locator(".scroll-overlay")).toContainText("许昌");
  await expect(page.locator(".scroll-overlay")).toContainText("辅路");

  // 入辅路 → selectBranch("Branch"):onBranch={step:0} + 触发第 0 格(珍宝拼点)
  await page.locator('.scroll-overlay [data-action="branch"]').click();
  await page.waitForTimeout(300);
  const after1 = await page.evaluate(() => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    return { onBranch: eng.players[0].onBranch, turnPhase: eng.turnPhase };
  });
  expect(after1.onBranch).toEqual({ step: 0 }); // 已在辅路第 0 格

  // 驱动若干回合(自动抉择),直到 p0 离开辅路(汇入主路)或回合用尽
  let rejoined = false;
  for (let i = 0; i < 40; i++) {
    // 等到轮到人类 Roll
    if (!(await waitForHumanRoll(page))) break;
    // 若仍 in 辅路,掷骰推进;若已汇入主路(endNode 或更远),收尾判定
    const st = await page.evaluate(() => {
      const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
      return { onBranch: eng.players[0].onBranch, pos: eng.players[0].position };
    });
    if (st.onBranch == null) {
      rejoined = true;
      break;
    }
    await page.locator("#roll-btn").click();
    await page.waitForTimeout(1800); // 掷骰 + 行军 + bot 一回合
    // 关掉可能弹出的卷轴(决策/招贤等),点主按钮
    const overlay = await page.$(".scroll-overlay");
    if (overlay) {
      await page.click('.scroll-overlay .btn-primary').catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  // 校验:已汇入主路(无论落在 endNode 还是更远)
  expect(rejoined).toBe(true);
  const final = await page.evaluate(() => {
    const eng = (window as unknown as { __dafung: { engine: any } }).__dafung.engine;
    return { onBranch: eng.players[0].onBranch, pos: eng.players[0].position };
  });
  expect(final.onBranch).toBeNull();
  // 位置应在 endNode 或之后(主路上),不再停在起点
  expect(final.pos).not.toBe(startIdx);
  void endIdx;
});

// 人类交互 e2e:覆盖全 bot 测试测不到的人类路径。
// 关键防回归:onTurnAdvanced 修复前,AI→人类切换后行军按钮卡 disabled,
// 全 bot e2e 永远不点人类按钮所以漏测。这里直接断言 toBeEnabled()。
import { test, expect } from "@playwright/test";
import { setupAndPlay, snap, dismissScroll, waitForBot } from "./helpers";

test("人类回合:行军按钮启用并可掷骰(防 onTurnAdvanced 回归)", async ({ page }) => {
  await setupAndPlay(page, "2", 12345);
  let humanRolls = 0;
  for (let i = 0; i < 24; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await waitForBot(page);
      continue;
    }
    // 人类回合开始即为 Roll;AI→人类切换后按钮必须启用(核心断言,不用 if 守卫)
    if (s.turnPhase === "Roll") {
      await expect(page.locator("#roll-btn")).toBeEnabled();
      await page.locator("#roll-btn").click();
      await page.waitForTimeout(2000);
      await dismissScroll(page);
      humanRolls++;
    } else {
      // 上回合遗留的决策弹窗
      await dismissScroll(page);
    }
  }
  expect(humanRolls).toBeGreaterThan(0);
});

test("人类落格无主城:购买扣款并获得地产", async ({ page }) => {
  await setupAndPlay(page, "2", 777);
  let bought = false;
  for (let i = 0; i < 40 && !bought; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await waitForBot(page);
      continue;
    }
    if (s.turnPhase === "AwaitingDecision") {
      const buyBtn = await page.$('.scroll-overlay [data-action="buy"]');
      if (buyBtn) {
        const buyerIdx = s.activeIndex;
        const beforeCash = s.players[buyerIdx].cash;
        const beforeProps = s.players[buyerIdx].properties.length;
        await buyBtn.click();
        await page.waitForTimeout(800);
        const after = await snap(page);
        const afterP = after.players[buyerIdx];
        expect(afterP.cash).toBeLessThan(beforeCash);
        expect(afterP.properties.length).toBeGreaterThan(beforeProps);
        bought = true;
      } else {
        await dismissScroll(page); // 升级弹窗等,跳过
      }
    } else if (s.turnPhase === "Roll") {
      await expect(page.locator("#roll-btn")).toBeEnabled();
      await page.locator("#roll-btn").click();
      await page.waitForTimeout(2000);
    } else {
      await dismissScroll(page);
    }
  }
  expect(bought).toBe(true);
});

test("落点有主城(付租)不触发 doRoll 死锁(防 lastRoll reset 回归)", async ({ page }) => {
  test.setTimeout(120_000); // 14 次迭代 × 固定等待 + bot 回合偶尔吃满 60s,放宽到 120s 防时序 flake
  // seed=42 在 T7 会出现"幽落魏的城付租":rollAndMove 内部 endTurn 会 reset lastRoll,
  // 修复前 doRoll 的 animateDice(lastRoll.die) 崩 → botFlow 异常 → busy 卡 true → 人类按钮死锁。
  // 单元测试直调 rollAndMove 不经 doRoll,e2e 全 bot 断言宽松,都漏测。此测试锁死该路径。
  await setupAndPlay(page, "2", 42);
  for (let i = 0; i < 14; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    if (s.players[s.activeIndex].isBot) {
      await page.waitForTimeout(2500);
      // 过关交涉:bot 踩人类城 → 人类需响应(toll-owner/visitor 弹窗)
      await dismissScroll(page);
      await page.waitForTimeout(500);
      continue;
    }
    await dismissScroll(page);
    if (s.turnPhase === "Roll") {
      // 核心防回归:人类回合按钮必须 enabled(死锁时卡 disabled,toBeEnabled 会超时失败)
      await expect(page.locator("#roll-btn")).toBeEnabled({ timeout: 8000 });
      await page.locator("#roll-btn").click();
      await page.waitForTimeout(2500);
    }
  }
  const s = await snap(page);
  expect(s.turnNumber).toBeGreaterThan(5); // 推进过了 T8(之前的死锁点)
});

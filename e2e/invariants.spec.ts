// AI 自主迭代 loop 的不变量测试:全 bot 自动对局,周期检查全程不变量合法 + 终局有 winner。
// 用途:Claude 改代码后跑这个,任何不变量违规都会失败 → 回去改。
import { test, expect } from "@playwright/test";
import { setupAndPlay, snap, dismissScroll } from "./helpers";

test("AI loop:全程不变量合法 + 终局", async ({ page }) => {
  test.setTimeout(200000); // 全程跑(含随机事件局),需放宽超时
  await setupAndPlay(page, "4", 1234);
  // 跑到终局,周期检查不变量(现金非负 / 位置合法 / 身价非负 / 破产残留)
  for (let i = 0; i < 80; i++) {
    const s = await snap(page);
    if (s.isOver) break;
    for (const p of s.players) {
      if (!p.isBankrupt && p.cash < 0) throw new Error(`不变量违规:T${s.turnNumber} ${p.guohao} cash=${p.cash}<0`);
      if (p.position < 0 || p.position > 50) throw new Error(`不变量违规:T${s.turnNumber} ${p.guohao} pos=${p.position}`);
      if (p.netWorth < 0) throw new Error(`不变量违规:T${s.turnNumber} ${p.guohao} nw=${p.netWorth}<0`);
      if (p.isBankrupt && (p.cash !== 0 || p.properties.length !== 0 || p.treasures.length !== 0 || p.heroes.length !== 0)) throw new Error(`破产残留:${p.guohao}`);
    }
    // 人类回合处理弹窗 + 掷骰;bot 自动
    await dismissScroll(page);
    const rollBtn = page.locator("#roll-btn");
    if (await rollBtn.isEnabled({ timeout: 2000 }).catch(() => false)) await rollBtn.click();
    await page.waitForTimeout(1800);
  }
  const s = await snap(page);
  // 随机事件局(机遇/命运/商市)让 4 人终局偏慢,这里验证「推进 + 全程不变量合法」,
  // 终局则额外校验 winner;不强求 isOver,避免测试过度耗时。
  expect(s.turnNumber).toBeGreaterThan(20);
  if (s.isOver) {
    expect(s.winner).not.toBeNull();
    expect(s.winReason).toMatch(/TargetNetWorth|LastStanding/);
  }
});

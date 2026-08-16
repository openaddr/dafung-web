// React 重构 · e2e 共享工具(阶段 11):全部选择器走 data-testid,
// 相位推进用 window.__dafung 调试钩子强制(见 src/app/controllers/registry.ts)。
// 走 vite preview(4173)的 dist 产物——跑前需 npm run build;联机走 3010。
import { expect, type Page } from "@playwright/test";

/** 强制引擎进入指定状态并同步 UI(测试专用通道;fn 内以 e 引用引擎)。 */
export async function force(page: Page, fn: string): Promise<void> {
  await page.evaluate(`(() => { const e = window.__dafung.getEngine(); ${fn} window.__dafung.sync(); })()`);
}

/** 读引擎快照(god view;结构与 store 的 GameSnapshot 同构)。 */
export function snap(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__dafung.snapshot());
}

/** UI 快速开局:goto(可选 ?seed=)→ 起兵 → 点第一座可选城建都 → 等轮到人类。
 *  行军按钮可用 ≠ bot 链结束(busy 在 bot 步间会短暂放开),紧接着读快照/断言会撞上
 *  bot 仍在推进的竞态(TODO 记账的 e2e 抖动家族)。故补"局面稳定"轮询:
 *  连续两次快照一致(300ms 间隔)才认为轮到人类且尘埃落定。 */
export async function quickStart(page: Page, seed?: number): Promise<void> {
  await page.goto(seed != null ? `/?seed=${seed}` : "/");
  await page.getByTestId("start-game").click();
  await page.locator(".bv-tile.bv-selectable").first().click();
  await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 30_000 });
  await waitSettled(page);
}

/** 等局面稳定:连续两次引擎快照一致(防在 bot 行动/动画中途读数)。 */
export async function waitSettled(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      const read = () => JSON.stringify((window as any).__dafung.snapshot());
      const a = read();
      await new Promise((r) => setTimeout(r, 300));
      return a === read();
    },
    undefined,
    { timeout, polling: 400 },
  );
}

/** 等待 window.__dafung 挂载(地图异步 fetch 期间快照可能尚未就绪)。 */
export async function waitForEngine(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__dafung?.snapshot?.(), undefined, { timeout: 15_000 });
}

/** 货币格式化(与 core/money.formatMoney 同口径:百进制 锭/两/分)。 */
export function fmtMoney(cash: number): string {
  if (cash <= 0) return "0分";
  const ding = Math.floor(cash / 10000);
  const rem = cash % 10000;
  const liang = Math.floor(rem / 100);
  const fen = rem % 100;
  const parts: string[] = [];
  if (ding) parts.push(`${ding}锭`);
  if (liang) parts.push(`${liang}两`);
  if (fen) parts.push(`${fen}分`);
  return parts.join("") || "0分";
}

/** 推进一步可用动作(掷骰 / 内嵌决策 / 卷轴主按钮);无可用动作返回 false。 */
export async function actIfCan(p: Page): Promise<boolean> {
  const roll = p.getByTestId("roll-button");
  if (await roll.isEnabled().catch(() => false)) {
    await roll.click();
    return true;
  }
  // 只匹配按钮(action-inline 是容器 div,无 disabled 属性会误中导致空转)
  const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
  if ((await inline.count()) > 0) {
    await inline.first().click();
    return true;
  }
  const scrollPrimary = p.locator('[data-testid^="scroll-"] button:not([disabled])');
  if ((await scrollPrimary.count()) > 0) {
    await scrollPrimary.first().click();
    return true;
  }
  return false;
}

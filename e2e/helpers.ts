// e2e 共享工具:驱动开局/选都/掷骰,读取 window.__dafung.snapshot 断言。
import type { Page } from "@playwright/test";

export const GOTO_OPTS = { waitUntil: "domcontentloaded" as const };

export interface PlayerSnap {
  name: string;
  guohao: string;
  isBot: boolean;
  cash: number;
  netWorth: number;
  position: number;
  capitalIndex: number;
  isBankrupt: boolean;
  properties: { propertyId: string; level: number }[];
  treasures: { id: string; level: number }[];
  heroes: { id: string }[];
}

export interface Snapshot {
  phase: string;
  setupPhase?: string;
  turnPhase?: string;
  turnNumber: number;
  activeIndex: number;
  isOver: boolean;
  logCount: number;
  currentSetupPlayerIndex: number;
  takenCapitalIndices: number[];
  players: PlayerSnap[];
  lastRoll?: { die: number } | null;
  lastMove?: { landIndex: number; capitalIndex: number } | null;
  winner?: number | null;
  winReason?: string | null;
}

/** 读取引擎快照(完整游戏状态)。 */
export function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() =>
    (window as unknown as { __dafung: { snapshot: () => Snapshot } }).__dafung.snapshot()
  );
}

/** 开局:goto(可选 ?seed= 确定性)→ 选诸侯数 → 起兵。 */
export async function startGame(page: Page, seats: string, seed?: number) {
  const url = seed != null ? `/?seed=${seed}` : "/";
  await page.goto(url, GOTO_OPTS);
  await page.locator("#seat-count").selectOption(seats);
  await page.locator("#start-btn").click();
  // main.ts fetch 地图异步,等 App 就绪(__dafung 挂载)再继续
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });
}

/** 驱动选都直到进入对局。人类点第一个空城 + 确认,bot 自动。 */
export async function drivePickCapital(page: Page) {
  for (let i = 0; i < 40; i++) {
    const s = await snap(page);
    if (s.phase !== "Setup") return;
    const idx = s.currentSetupPlayerIndex;
    if (idx < 0) return;
    if (s.players[idx].isBot) {
      await page.waitForTimeout(1100); // bot 自动选都延时
      continue;
    }
    const free = await page.evaluate(
      () => (window as unknown as { __dafung?: { engine?: { firstAvailableCapitalIndex(): number } } }).__dafung?.engine?.firstAvailableCapitalIndex() ?? -1,
    );
    if (free < 0) return;
    await page.click(`[data-tile='${free}']`);
    await page.click('[data-action="confirm"]');
    await page.waitForTimeout(250);
  }
}

/** 开局 + 选都 + 进入对局,返回对局首帧 snapshot。 */
export async function setupAndPlay(page: Page, seats: string, seed?: number): Promise<Snapshot> {
  await startGame(page, seats, seed);
  // main.ts fetch 地图异步,等 App 就绪(__dafung 挂载)再选都;之前 import 同步没这问题
  await page.waitForFunction(() => !!(window as unknown as { __dafung?: unknown }).__dafung, undefined, { timeout: 10000 });
  await drivePickCapital(page);
  return snap(page);
}

/** 若有卷轴弹层,点指定 action;不传则点主按钮。返回是否处理了弹层。 */
export async function dismissScroll(page: Page, action?: string): Promise<boolean> {
  const overlay = await page.$(".scroll-overlay");
  if (!overlay) return false;
  if (action) {
    await page.click(`.scroll-overlay [data-action="${action}"]`).catch(() => {});
  } else {
    const primary = await page.$(".scroll-overlay .btn-primary");
    if (primary) await primary.click();
    else await page.click('.scroll-overlay [data-action]').catch(() => {});
  }
  await page.waitForTimeout(300);
  return true;
}

/** 等待 bot 完成一个回合(掷骰 + 动画 + 决策)。 */
export async function waitForBot(page: Page, ms = 2500) {
  await page.waitForTimeout(ms);
}

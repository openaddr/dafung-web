// 联机多客户端测试 helpers:可复用的联机 e2e 基础设施。
// 核心模式:N 个独立 browser context(= N 台设备)同房,走真实 UI(非 REST 旁路),
// actIfCan 驱动活跃方,driveToGameOver 循环到终局 + 同步断言。
//
// 用法(完整对局):
//   const { clients } = await createClients(browser, 2, { target: 3000 });
//   const { winner } = await driveToGameOver(clients);
//
// 用法(场景测试):
//   const { clients } = await createClients(browser, 2);
//   await playRounds(clients, 5);
//   await clients[1].close();  // 模拟掉线
//   // ... 验证接管/重连
import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";

const ONLINE = "http://localhost:3010";

export interface CreateClientsOptions {
  bot?: number[]; // bot 座位号(默认无)
  target?: number; // 目标身价(默认 3000,确保终局)
  seed?: number; // 种子(可选)
}

/** 创建 N 个独立浏览器 context + 走真实 UI 建房/加入/开局,返回各客户端 page。 */
export async function createClients(
  browser: Browser,
  n: number,
  opts: CreateClientsOptions = {},
): Promise<{ clients: Page[]; roomId: string }> {
  const { bot = [], target = 3000, seed } = opts;
  const clients: Page[] = [];
  for (let i = 0; i < n; i++) clients.push((await (await browser.newContext()).newPage()));

  // 0 号建房
  const host = clients[0];
  await host.goto(`${ONLINE}/?online=1`);
  if (target) await host.getByPlaceholder("目标身价(默认8000)").fill(String(target));
  if (seed) await host.getByPlaceholder("种子(可空)").fill(String(seed));
  if (bot.length) await host.getByPlaceholder("bot 座位号,逗号分隔(如 1,2)").fill(bot.join(","));
  await host.getByRole("button", { name: "建房" }).click();
  await expect(host.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });
  const roomId = ((await host.locator(".lobby-code").textContent()) ?? "").trim();
  expect(roomId).toMatch(/^[A-Z]{4}$/);

  // 1..n-1 号凭码加入
  for (let i = 1; i < n; i++) {
    const c = clients[i];
    await c.goto(`${ONLINE}/?online=1`);
    await c.getByPlaceholder("房间码").fill(roomId);
    await c.getByRole("button", { name: "加入" }).click();
    await expect(c.getByRole("heading", { name: "大厅" })).toBeVisible({ timeout: 8000 });
  }

  // host 开局
  await host.getByRole("button", { name: "开局" }).click();
  // 所有客户端都进对局
  for (const c of clients) {
    await expect(c.locator("#status-bar")).toContainText(/的回合/, { timeout: 20000 });
  }
  return { clients, roomId };
}

/** 在某端推进一个可用动作(掷骰 / 内嵌常规决策 / 卷轴复杂决策)。无可用动作返回 false。 */
export async function actIfCan(p: Page): Promise<boolean> {
  if (await p.locator("#roll-btn").isEnabled().catch(() => false)) {
    await p.locator("#roll-btn").click();
    return true;
  }
  const inline = p.locator(".action-inline [data-action]:not([disabled])");
  if ((await inline.count()) > 0) {
    await inline.first().click();
    return true;
  }
  const scrollPrimary = p.locator(".scroll-overlay .btn-primary");
  if ((await scrollPrimary.count()) > 0) {
    await scrollPrimary.first().click();
    return true;
  }
  const scrollAny = p.locator(".scroll-overlay [data-action]");
  if ((await scrollAny.count()) > 0) {
    await scrollAny.first().click();
    return true;
  }
  return false;
}

/** 读某端状态条文本(活跃国号 + 现金 + 委任)。 */
export async function statusOf(p: Page): Promise<string> {
  return ((await p.locator("#status-bar").textContent()) ?? "").trim();
}

/** 断言两端状态条一致(跨端同步校验)。 */
export async function assertSync(a: Page, b: Page): Promise<void> {
  const sa = await statusOf(a);
  const sb = await statusOf(b);
  if (sa && sb && !sa.includes("称帝")) expect(sb).toBe(sa);
}

/** 读某端胜者文本(如"「韩」称帝")。未终局返回 null。 */
export async function winnerOf(p: Page): Promise<string | null> {
  const text = ((await p.locator(".victory-sub").textContent().catch(() => null)) ?? "").trim();
  return text || null;
}

/** 判断某端是否已终局(胜利层可见)。 */
export async function isGameOver(p: Page): Promise<boolean> {
  return (await p.locator(".victory-overlay").count()) > 0;
}

export interface DriveToGameOverOptions {
  maxActions?: number; // 上限(默认 800)
  syncEvery?: number; // 每 N 步同步校验(默认 20)
  stallTicks?: number; // 卡死阈值 tick(默认 30)
  stallWaitMs?: number; // 每 tick 等待 ms(默认 250)
}

export interface GameOverResult {
  actions: number;
  winner: string;
}

/** 循环驱动到终局:遍历所有客户端,谁活跃谁推进,直到全部出胜利层。
 *  含:同步巡检、卡死守卫(自动 dump 引擎诊断)、终局同一胜者断言。 */
export async function driveToGameOver(
  clients: Page[],
  opts: DriveToGameOverOptions = {},
): Promise<GameOverResult> {
  const { maxActions = 800, syncEvery = 20, stallTicks = 30, stallWaitMs = 250 } = opts;
  let stall = 0;
  let actions = 0;
  for (let i = 0; i < maxActions; i++) {
    if ((await Promise.all(clients.map(isGameOver))).every(Boolean)) break;

    let acted = false;
    for (const c of clients) {
      if (await actIfCan(c)) {
        acted = true;
        break;
      }
    }
    if (acted) {
      actions++;
      stall = 0;
      if (actions % syncEvery === 0) {
        await clients[0].waitForTimeout(150);
        for (let j = 1; j < clients.length; j++) await assertSync(clients[0], clients[j]);
      }
    } else {
      stall++;
      if (stall === 8) await dumpStallDiagnostics(clients);
      if (stall > stallTicks) throw new Error(`联机对局卡住:${stallTicks} tick 无可用动作(见 STALL_ 日志)`);
      await clients[0].waitForTimeout(stallWaitMs);
    }
  }

  for (const c of clients) await expect(c.locator(".victory-overlay")).toBeVisible({ timeout: 10000 });
  const winners = await Promise.all(clients.map(winnerOf));
  expect(winners[0]).toBeTruthy();
  for (let j = 1; j < winners.length; j++) expect(winners[j]).toBe(winners[0]);
  console.log("MULTI_ACTIONS", actions, "MULTI_WINNER", winners[0]);
  return { actions, winner: winners[0]! };
}

/** 驱动指定轮数(不要求终局)。用于场景测试:先玩几手,再测特定事件(掉线/接管等)。 */
export async function playRounds(clients: Page[], rounds: number): Promise<number> {
  let actions = 0;
  let stall = 0;
  const target = rounds * clients.length * 3;
  while (actions < target && stall < 30) {
    let acted = false;
    for (const c of clients) {
      if (await actIfCan(c)) {
        acted = true;
        actions++;
        stall = 0;
        break;
      }
    }
    if (!acted) {
      stall++;
      await clients[0].waitForTimeout(250);
    }
  }
  return actions;
}

/** 卡死诊断:dump 每个客户端的引擎状态(通过 network-client 的 __dafung 钩子)。 */
async function dumpStallDiagnostics(clients: Page[]): Promise<void> {
  for (let i = 0; i < clients.length; i++) {
    const d = await clients[i].evaluate(() => {
      const df = (window as unknown as { __dafung?: { engine: any; seat: () => number; busy: () => boolean } }).__dafung;
      const e = df?.engine;
      const seat = df?.seat() ?? -1;
      const owner = e?.turnPhase === "AwaitingTreasureOwner" ? e?.treasureVisitor?.ownerIdx : e?.activeIndex;
      return {
        seat,
        phase: e?.phase,
        turnPhase: e?.turnPhase,
        activeIndex: e?.activeIndex,
        owner,
        myIsBot: e?.players?.[seat]?.isBot,
        myDecision: e?.phase === "Playing" && owner === seat && !(e?.players?.[seat]?.isBot ?? true),
        busy: df?.busy(),
        rollDisabled: document.querySelector<HTMLButtonElement>("#roll-btn")?.disabled,
      };
    });
    console.log(`STALL_CLIENT${i}`, JSON.stringify(d));
  }
}

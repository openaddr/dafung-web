// React 迁移 · 阶段 8 验证门:联机双端全流程(大厅建房/加入/选图/开局 → 双端对局同步)。
// 走 3010 引擎服务器(托管 dist + WS;playwright.config 第二个 webServer)。
// ⚠ 跑前需先 npm run build(dist 必须最新——两个 webServer 都消费 dist 产物)。
// 服务器可能已在跑(reuseExistingServer):若 3010 被旧进程占用且代码旧,先 kill 再跑。
import { test, expect, type Page } from "@playwright/test";
import { waitSettled } from "./react-helpers";

const ONLINE = "http://localhost:3010";

/** 推进一步可用动作(掷骰 → 卷轴内决策按钮);无可用动作返回 false。
 *  选择器全部用 React 屏的 data-testid(对照旧 multi-helpers 的 actIfCan);
 *  交互重构后决策按钮住在卷轴里,testid 沿用 action-,选择器无需变。 */
async function actIfCan(p: Page): Promise<boolean> {
  const roll = p.getByTestId("roll-button");
  if (await roll.isEnabled().catch(() => false)) {
    await roll.click();
    return true;
  }
  const inline = p.locator('[data-testid^="action-"]:not([disabled])');
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

/** 读一端的核心引擎态(经 __dafung 调试钩子;跨端一致性断言用)。 */
async function coreState(p: Page) {
  return p.evaluate(() => {
    // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
    const s = (window as any).__dafung.snapshot();
    return {
      phase: s.phase,
      round: s.round,
      activeIndex: s.activeIndex,
      turnPhase: s.turnPhase,
      players: s.players.map((x: any) => ({
        id: x.id,
        position: x.position,
        cash: x.cash,
        netWorth: x.netWorth,
        isBankrupt: x.isBankrupt,
      })),
    };
  });
}

test("双端联机:建房→加入→开局→各自行动→快照一致", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();

  // ── 建房(?online=1 直达大厅;低目标身价保证后续可推进)──
  // TODO #13:建房/加入/开局各窗按全量并行负载放宽(8s→30s、20s→45s,约 4 倍余量):
  // 负载尖峰下 WS 建连 + 大厅广播 + 首帧 snapshot 的到达时间抖动远超单跑。
  await host.goto(`${ONLINE}/?online=1`);
  await expect(host.getByTestId("lobby-screen")).toBeVisible();
  await host.getByTestId("lobby-target").fill("3000");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(roomId).toMatch(/^[A-Z]{4}$/);

  // ── 加入(?room= 直链自动加入)──
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 8000 });
  // 建房端也看到座位 1 被占(lobby 广播 → netStore → 座位列表)
  await expect(host.getByTestId("lobby-seat-1")).toContainText("人");

  // ── host 选图(开局前置;复用 setup 的选图二级屏)──
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-sanguo").click();
  await host.getByTestId("map-confirm").click();
  await expect(host.getByTestId("lobby-map-name")).not.toBeEmpty();

  // ── 开局:双端都收到首帧 snapshot → 切 Game 屏 ──
  await host.getByTestId("lobby-start").click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId("hand-panel")).toBeVisible({ timeout: 45_000 });
    await expect(p.getByTestId("status-bar-panel")).toBeVisible();
  }

  // ── 双端各推进若干步(掷骰/决策/卷轴混合),模拟真实你来我往 ──
  // ── 双端各推进若干步(掷骰/决策/卷轴混合),模拟真实你来我往 ──
  // TODO #13:原 stall<40×250ms(=10s 盲预算)在全量并行负载下不够——WS 广播/渲染排队
  // 可让按钮可用性迟到超过 10s,导致 actions<2 假失败。改为时间预算(90s,约 5 倍余量):
  // 只要总时长没用完就继续轮询两端,状态(按钮可用)到了立刻行动,不做无谓盲等。
  let actions = 0;
  const deadline = Date.now() + 90_000;
  while (actions < 6 && Date.now() < deadline) {
    let acted = false;
    for (const p of [host, guest]) {
      if (await actIfCan(p)) {
        acted = true;
        actions++;
        break;
      }
    }
    if (!acted) await host.waitForTimeout(250); // 短间隔重试,等对端/托管广播推进
  }
  expect(actions).toBeGreaterThanOrEqual(2); // 至少双方各动过一手(断言不降级)

  // ── 同步断言:双端核心引擎态一致(assertSync 思想,改比快照核心字段)──
  // TODO #13:原固定 waitForTimeout(400) 后一次性 toEqual 在负载下撞上广播尚未沉降。
  // 改为轮询收敛:持续比对两端核心态直到相等(30s 余量),收敛后再各自确认非瞬态
  //(两端 waitSettled 后终判),杜绝"中途恰好相等"的假阳性。
  await expect
    .poll(
      async () => JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
      { timeout: 30_000, message: "双端核心引擎态收敛一致" },
    )
    .toBe(true);
  // 收敛后再等两端各自局面稳定(连续快照一致),排除"恰好相等"的瞬态假阳性后终判
  await Promise.all([waitSettled(host), waitSettled(guest)]);
  expect(await coreState(guest)).toEqual(await coreState(host));

  // ── 托管入口存在(联机专属;spec: autopilot)──
  await expect(guest.getByTestId("autopilot-button")).toBeVisible();

  await host.context().close();
  await guest.context().close();
});

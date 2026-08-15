// 联机托管 e2e(spec: autopilot 02)。
// 王牌用例:两端都开快速托管 → 零人工输入推进到终局且两端胜者一致(自动化联机回归底座)。
// 另:托管收回恢复本地可操作;托管中切速度。
import { test, expect } from "@playwright/test";
import { createClients, isGameOver, winnerOf } from "./multi-helpers";

test("双端快速托管:零输入到终局,两端胜者一致", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clients } = await createClients(browser, 2, { target: 3000 }); // 两真人
  const [a, b] = clients;
  // 两端都开托管(快速)
  for (const c of clients) {
    await expect(c.locator("#autopilot-btn")).toBeVisible({ timeout: 10000 });
    await c.locator("#autopilot-btn").click();
  }
  // 按钮翻转为「收回托管」,状态显示电脑代打中
  for (const c of clients) {
    await expect(c.locator("#autopilot-btn")).toHaveText("收回托管", { timeout: 10000 });
    await expect(c.locator("#autopilot-status")).toContainText("电脑代打中", { timeout: 10000 });
  }
  // 零输入等终局(快速托管全 bot 局秒级完成;给足 e2e 余量)
  await expect.poll(async () => (await Promise.all(clients.map(isGameOver))).every(Boolean), {
    timeout: 120_000,
    message: "两端都到终局",
  }).toBe(true);
  const [wa, wb] = await Promise.all([winnerOf(a), winnerOf(b)]);
  expect(wa).toBeTruthy();
  expect(wb).toBe(wa);
});

test("托管收回:按钮复位,轮到自己时行军恢复可用", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clients } = await createClients(browser, 2, { target: 3000 }); // 两真人
  const [host, guest] = clients;
  // 双端先切慢速再托管:慢速局不会秒完,收回后有真实的 host 决策点
  for (const c of clients) {
    await expect(c.locator("#autopilot-btn")).toBeVisible({ timeout: 10000 });
    await c.locator("#autopilot-speed").selectOption("slow");
    await c.locator("#autopilot-btn").click();
  }
  await expect(host.locator("#autopilot-btn")).toHaveText("收回托管", { timeout: 10000 });
  await expect(host.locator("#autopilot-status")).toContainText("电脑代打中·慢", { timeout: 10000 });
  // host 收回托管(对方继续托管;慢速连锁会推进到 host 的决策点并停下)
  await host.locator("#autopilot-btn").click();
  await expect(host.locator("#autopilot-btn")).toHaveText("托管", { timeout: 10000 });
  await expect
    .poll(async () => (await host.locator("#roll-btn").isEnabled().catch(() => false)), { timeout: 120_000, message: "收回后轮到 host 时行军可用" })
    .toBe(true);
  void guest;
});

test("托管中切慢速:状态文字更新,对局保持进行(节奏语义已在单测覆盖)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { clients } = await createClients(browser, 2, { target: 3000 });
  const host = clients[0];
  await expect(host.locator("#autopilot-btn")).toBeVisible({ timeout: 10000 });
  await host.locator("#autopilot-btn").click();
  await expect(host.locator("#autopilot-status")).toContainText("电脑代打中·快", { timeout: 10000 });
  await host.locator("#autopilot-speed").selectOption("slow");
  await expect(host.locator("#autopilot-status")).toContainText("电脑代打中·慢", { timeout: 10000 });
  // 对局仍在进行(未崩溃、未终局)
  const phase = await host.evaluate(() => (window as unknown as { __dafung?: { engine: { phase: string } } }).__dafung!.engine.phase);
  expect(phase).toBe("Playing");
});

// React 重构 · 联机托管 + 房间 REST 契约(阶段 11)。
// 意图来源:旧 online-autopilot.spec(双端托管零输入到终局 / 收回 / 切速)与
// online.spec 的 REST 占座契约(FCFS + 满员 409)。
import { test, expect, type Browser, type Page } from "@playwright/test";

// 联机对局依赖真实 WS 广播时序,与其他高负载 spec 并行时易抖:
// 本文件串行执行,降低双端 + 服务器的并发压力。
test.describe.configure({ mode: "serial" });

const ONLINE = "http://localhost:3010";

/** 双端建房/加入/开局(低目标身价保证可终局),返回 [host, guest]。 */
async function twoClients(browser: Browser, target = 3000): Promise<[Page, Page]> {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill(String(target));
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 8_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 8_000 });
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-sanguo").click();
  await host.getByTestId("map-confirm").click();
  await host.getByTestId("lobby-start").click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId("hand-panel")).toBeVisible({ timeout: 20_000 });
  }
  return [host, guest];
}

test("双端快速托管:零输入到终局,两端胜者一致", async ({ browser }) => {
  test.setTimeout(180_000);
  const clients = await twoClients(browser);
  try {
    // 两端都开托管(默认快速)
    for (const c of clients) {
      await expect(c.getByTestId("autopilot-button")).toBeVisible({ timeout: 10_000 });
      await c.getByTestId("autopilot-button").click();
    }
    // 零输入等终局(快速托管全 bot 秒级推进;给足余量)
    for (const c of clients) {
      await expect(c.getByTestId("victory-screen")).toBeVisible({ timeout: 120_000 });
    }
    const subs = await Promise.all(
      clients.map((c) => c.getByTestId("victory-sub").textContent()),
    );
    expect(subs[0]).toBeTruthy();
    expect(subs[1]).toBe(subs[0]);
  } finally {
    for (const c of clients) await c.context().close();
  }
});

test("托管收回:按钮复位,轮到自己时行军恢复可用", async ({ browser }) => {
  test.setTimeout(180_000);
  const [host, guest] = await twoClients(browser);
  try {
    // 双端开慢速托管(慢速局不会秒完),host 收回后 guest 继续托管推进到 host 的决策点
    for (const c of [host, guest]) {
      await c.getByTestId("autopilot-speed").selectOption("slow");
      // 高负载下生效广播偶发迟到:等 5s 未见「收回」才补点一次(避免双击翻转)
      await c.getByTestId("autopilot-button").click();
      let on = false;
      for (let attempt = 0; attempt < 5 && !on; attempt++) {
        on = await c
          .getByTestId("autopilot-button")
          .textContent()
          .then((t) => t === "收回")
          .catch(() => false);
        if (!on) await c.waitForTimeout(1_000);
      }
      if (!on) await c.getByTestId("autopilot-button").click();
    }
    await expect(host.getByTestId("autopilot-button")).toHaveText("收回", { timeout: 10_000 });
    // 收回同样带「未生效则补点」兜底(高负载下广播偶发丢失)
    await host.getByTestId("autopilot-button").click();
    let off = false;
    for (let attempt = 0; attempt < 5 && !off; attempt++) {
      off = await host
        .getByTestId("autopilot-button")
        .textContent()
        .then((t) => t === "托管")
        .catch(() => false);
      if (!off) await host.waitForTimeout(1_000);
    }
    if (!off) {
      await host.getByTestId("autopilot-button").click();
    }
    await expect(host.getByTestId("autopilot-button")).toHaveText("托管", { timeout: 10_000 });
    // 对局仍在进行(guest 不托管则轮到 guest 时等待;host 的行军钮最终可用)
    await expect
      .poll(
        async () => host.getByTestId("roll-button").isEnabled().catch(() => false),
        { timeout: 120_000, message: "收回后轮到 host 时行军可用" },
      )
      .toBe(true);
  } finally {
    await host.context().close();
    await guest.context().close();
  }
});

test("REST 房间契约:建房占座 → 加入次座 → 满员 409", async ({ request }) => {
  const created = await request.post(`${ONLINE}/room/new`, {
    data: { seats: 3, bot: "2", seed: 7 },
  });
  expect(created.ok()).toBeTruthy();
  const c = await created.json();
  expect(c.roomId).toMatch(/^[A-Z]{4}$/);
  expect(c.seat).toBe(0);
  expect(c.seatToken).toBeTruthy();
  expect(c.seats).toHaveLength(3);
  expect(c.seats[0].taken).toBe(true); // host 已占
  expect(c.seats[2].kind).toBe("bot");

  const joined = await request.post(`${ONLINE}/room/join`, { data: { roomId: c.roomId } });
  const j = await joined.json();
  expect(j.seat).toBe(1);
  expect(j.seatToken).toBeTruthy();

  // 满员再加入 → 409
  const full = await request.post(`${ONLINE}/room/join`, { data: { roomId: c.roomId } });
  expect(full.status()).toBe(409);
});

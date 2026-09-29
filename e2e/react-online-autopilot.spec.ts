// React 重构 · 联机托管 UI 守卫(阶段 11)。
// 意图来源:旧 online-autopilot.spec(双端托管零输入到终局 / 收回 / 切速)。
// #306:REST 占座契约例已下沉 test/room.test.ts(room.ts 零 WS,bun test 直打)——
// lobbyView 即 /room/new·join 响应体,UI 层不再重复守传输契约;本文件只守托管行为 UI。
import { testUnscaled as test, expect, type Browser, type Page } from "./fixtures";
import { dismissJinnangIfUp, newBridgeContext } from "./react-helpers";

// 联机对局依赖真实 WS 广播时序,与其他高负载 spec 并行时易抖:
// 本文件串行执行,降低双端 + 服务器的并发压力。
test.describe.configure({ mode: "serial" });

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 双端建房/加入/开局(经济 v2 标准目标 30000),返回 [host, guest]。 */
async function twoClients(browser: Browser, target = 30000): Promise<[Page, Page]> {
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
  // TODO #13:建房/加入 8s→30s、开局 20s→45s——全量并行负载下 WS 广播到达抖动大
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill(String(target));
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 30_000 });
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-sanguo").click();
  await host.getByTestId("map-confirm").click();
  await host.getByTestId("lobby-start").click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId("top-bar")).toBeVisible({ timeout: 45_000 });
    // L41 后开局停在 Setup·PickCapital,卷轴(锦囊相位)要到选都完才可能出现——
    // 此处无 5s 短候可等(#306:白烧 10s/次),只做即时探测;真正的放行在各自用例的
    // 推进环里(托管代发 / 轮询体 dismissJinnangIfUp)。
    await dismissJinnangIfUp(p);
  }
  return [host, guest];
}

test("双端快速托管:零输入到终局,两端胜者一致", async ({ browser }) => {
  // #306 预算收紧:快速托管全 bot 秒级推进,实测整局 ~15s 内,上限从 180/120s 对折再对折。
  test.setTimeout(90_000);
  const clients = await twoClients(browser);
  try {
    // 两端都开托管(默认快速)
    for (const c of clients) {
      await expect(c.getByTestId("autopilot-button")).toBeVisible({ timeout: 10_000 });
      await c.getByTestId("autopilot-button").click();
    }
    // 零输入等终局
    for (const c of clients) {
      await expect(c.getByTestId("victory-screen")).toBeVisible({ timeout: 60_000 });
    }
    const subs = await Promise.all(clients.map((c) => c.getByTestId("victory-sub").textContent()));
    expect(subs[0]).toBeTruthy();
    expect(subs[1]).toBe(subs[0]);
  } finally {
    for (const c of clients) await c.context().close();
  }
});

test("托管收回:按钮复位,轮到自己时行军恢复可用", async ({ browser }) => {
  // #306 预算收紧(52.8→30s):弃慢速全双端(2s/步是旧例最大耗时),也弃「双端快速托管
  // 等 Playing 再收回」——快速局服务器秒级跑完整局,收回永远输给终局(实测 GameOver)。
  // 定式:guest 开慢速托管(2s/步爬行,对局绝无跑飞之虞),host 开快速托管后**立即**收回
  // (仍在 Setup,窗口毫秒级);收回后 host=真人决策门,对局必停在 human-turn。
  test.setTimeout(120_000);
  const [host, guest] = await twoClients(browser);
  try {
    // guest 开慢速托管(对局发动机,慢速保收回窗口与后继行军观察的从容)
    await guest.getByTestId("autopilot-speed").selectOption("slow");
    await guest.getByTestId("autopilot-button").click();
    let guestOn = false;
    for (let attempt = 0; attempt < 20 && !guestOn; attempt++) {
      guestOn = await guest
        .getByTestId("autopilot-button")
        .textContent()
        .then((t) => t === "收回")
        .catch(() => false);
      if (!guestOn) await guest.waitForTimeout(500);
    }
    if (
      !guestOn &&
      (await guest
        .getByTestId("autopilot-button")
        .textContent()
        .catch(() => "")) !== "收回"
    ) {
      await guest.getByTestId("autopilot-button").click();
    }
    // host 开快速托管 → 随即收回(TODO #13:生效广播可迟到,过早补点会双击翻转——
    // 轮询窗 10s 逐拍复查 + 补点前即时复查,把翻转窗口压到一次读取内。慢速 guest
    // 爬行兜底:即便生效迟到十余秒,对局也只前进数步)
    await host.getByTestId("autopilot-button").click();
    let on = false;
    for (let attempt = 0; attempt < 20 && !on; attempt++) {
      on = await host
        .getByTestId("autopilot-button")
        .textContent()
        .then((t) => t === "收回")
        .catch(() => false);
      if (!on) await host.waitForTimeout(500);
    }
    if (
      !on &&
      (await host
        .getByTestId("autopilot-button")
        .textContent()
        .catch(() => "")) !== "收回"
    ) {
      await host.getByTestId("autopilot-button").click();
    }
    // 收回(同样带「未生效则补点」结构)→ 按钮复位「托管」
    await host.getByTestId("autopilot-button").click();
    let off = false;
    for (let attempt = 0; attempt < 20 && !off; attempt++) {
      off = await host
        .getByTestId("autopilot-button")
        .textContent()
        .then((t) => t === "托管")
        .catch(() => false);
      if (!off) await host.waitForTimeout(500);
    }
    if (
      !off &&
      (await host
        .getByTestId("autopilot-button")
        .textContent()
        .catch(() => "")) !== "托管"
    ) {
      await host.getByTestId("autopilot-button").click();
    }
    await expect(host.getByTestId("autopilot-button")).toHaveText("托管", { timeout: 15_000 });
    // L41:收回 = 自己决策,选都也不例外——host 在自己选都前收回,服务器停在 Setup 等
    // host 手选(guest 仍托管,由服务器代选)。轮询体内代 host 点候选城 + 确认。
    // (若收回前 host 的托管恰好已代选完,phase 直达 Playing,循环体一次不进,同样成立。)
    await expect
      .poll(
        async () => {
          const s = (await host
            .evaluate(() => (window as any).__dafung.snapshot())
            .catch(() => null)) as { phase: string; currentSetupPlayerIndex: number } | null;
          if (s == null) return "";
          if (s.phase === "Setup" && s.currentSetupPlayerIndex === 0) {
            await host.locator(".bv-tile.bv-selectable").nth(0).click({ timeout: 10_000 });
            await host.getByTestId("confirm-capital-ok").click({ timeout: 10_000 });
          }
          return s.phase;
        },
        { timeout: 60_000, message: "host 手选都 + guest 托管代选 → 进 Playing" },
      )
      .toBe("Playing");
    // 对局仍在进行:收回后 host 的回合不再被代打,轮到 host 时行军照常自动发生——
    // #188:无 roll-button 可等,改以「host 棋盘位置前进」为证(行军只发生在自己的
    // 回合:锦囊放行 → 服务器 1s 定时起摇 → 棋子前进)。轮询体内先「今不用」放行。
    const posAtRecall = (await host.evaluate(
      () => (window as any).__dafung.snapshot().players[0].position,
    )) as number;
    await expect
      .poll(
        async () => {
          await dismissJinnangIfUp(host);
          const pos = (await host.evaluate(
            () => (window as any).__dafung.snapshot().players[0].position,
          )) as number;
          return pos !== posAtRecall;
        },
        { timeout: 90_000, message: "收回后轮到 host 时自动行军发生(位置前进)" },
      )
      .toBe(true);
  } finally {
    await host.context().close();
    await guest.context().close();
  }
});

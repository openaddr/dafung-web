// 联机保密下行验证门(#381,ADR-0020 决策 2 保密后补兑现):发送总口逐座位过滤——
// 他人锦囊手牌内容/锦囊牌库序/反应窗询问集三类秘密不出网(ADR-0016 per-seat 投影复活;
// 事件批 redactEvents 逐 kind 裁剪,唯一裁剪面 = jinnang 窗 queriedSeats 身份匿名、
// 数量保留——折叠器闭窗算术依赖长度,且应答事件 seat 本就公开,数量零额外泄漏)。
// 两道门:
//   1. 常规局(无种子):guest 线级捕获全部帧——每份 snapshot(摘要/校准)他人手牌恒空、
//      牌库恒空只剩数量;每个事件批里 jinnang 窗 queriedSeats 只含自己座位或匿名占位
//      (-1)。驱动数秒保证事件批非空(断言非空性:摘要至少一份、事件批至少一批)。
//   2. 种子局(seed 430,与 react-reaction-online 同款确定性):选都一结束 bot 即出
//      横征暴敛,全桌只有 guest(seat1)持识破诡计、被询问集 god-view=[1]——guest 侧
//      事件批可见 [自己];host 侧同一窗只见匿名占位(真实座位 1 不得出现)。双向证明
//      「身份按座位裁、自己看见自己」。
// 观测口 = Playwright WebSocket framereceived 线级捕获(与 react-online-cutover 同款);
// testUnscaled 全速;跑前需先 build(两 webServer 都消费 dist)。
import { testUnscaled as test, expect, type Page } from "./fixtures";
import { newBridgeContext, onlinePickCapitals } from "./react-helpers";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;
const SEED = 430;

/** 线级连接收集器(react-online-cutover 同款):按 WS 连接分组捕获全部下行 JSON 帧。 */
function collectConnections(page: Page): { msgs: Record<string, unknown>[] }[] {
  const conns: { msgs: Record<string, unknown>[] }[] = [];
  page.on("websocket", (ws) => {
    const conn = { msgs: [] as Record<string, unknown>[] };
    conns.push(conn);
    ws.on("framereceived", (data) => {
      const payload = (data as { payload?: unknown }).payload ?? data;
      conn.msgs.push(JSON.parse(typeof payload === "string" ? payload : String(payload)));
    });
  });
  return conns;
}

/** 保密口径断言(对单端全部帧):快照他人手牌恒空/牌库恒空只剩数量;事件批 jinnang 窗
 *  queriedSeats ⊆ {自己座位, 匿名占位}。selfSeat 之外的任何真实座位号都是违例。 */
function expectFramesRedacted(
  conns: { msgs: Record<string, unknown>[] }[],
  selfSeat: number,
  seatCount: number,
): void {
  let snapshots = 0;
  let eventBatches = 0;
  let jinnangWindows = 0;
  for (const conn of conns) {
    for (const m of conn.msgs) {
      if (m.type === "snapshot") {
        snapshots++;
        const snap = m as {
          players?: { jinnangHand: string[] }[];
          jinnangDeck?: string[];
          jinnangDeckCount?: number;
        };
        expect(snap.players, "快照携带座位表").toBeTruthy();
        snap.players!.forEach((p, i) => {
          if (i !== selfSeat)
            expect(p.jinnangHand, `座位 ${i} 手牌对座位 ${selfSeat} 不可见`).toEqual([]);
        });
        expect(snap.jinnangDeck, "牌库牌序不可见(只剩数量)").toEqual([]);
        expect(snap.jinnangDeckCount ?? 0).toBeGreaterThan(0);
      }
      if (m.type === "events") {
        eventBatches++;
        const batch = m as {
          events?: { kind: string; windowKind?: string; queriedSeats?: number[] }[];
        };
        for (const ev of batch.events ?? []) {
          if (ev.kind === "reactionOpened" && ev.windowKind === "jinnang") {
            jinnangWindows++;
            for (const s of ev.queriedSeats ?? []) {
              expect(
                s === selfSeat || s === -1,
                `询问集座位 ${s} 对座位 ${selfSeat} 必须匿名(只许自己或 -1 占位)`,
              ).toBe(true);
            }
          }
        }
      }
    }
  }
  expect(snapshots, "至少收到一份整房摘要").toBeGreaterThanOrEqual(1);
  expect(eventBatches, "驱动窗内至少收到一批事件(断言非空性)").toBeGreaterThanOrEqual(1);
  void seatCount;
}

/** 常规局双端建房/加入/选图/开局 + 选都(react-online-cutover 同款,无种子)。 */
async function twoClientsSetup(pages: [Page, Page]): Promise<void> {
  const [host, guest] = pages;
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill("30000");
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 30_000 });
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-sanguo").click();
  await host.getByTestId("map-confirm").click();
  await host.getByTestId("lobby-start").click();
  for (const p of pages) {
    await expect(p.getByTestId("top-bar")).toBeVisible({ timeout: 45_000 });
  }
  await onlinePickCapitals(pages);
}

test.describe("联机保密下行(#381,ADR-0020 决策 2 兑现)", () => {
  test.setTimeout(180_000);

  test("guest 视角:摘要/校准快照无他人手牌、无牌库序;事件批询问集只含自己或匿名占位", async ({
    browser,
  }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    const guestConns = collectConnections(guest);
    await twoClientsSetup([host, guest]);

    // 驱动数秒:让对局真实推进(掷骰/行军/决策),事件批与校准快照随 flush 到达
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      await host
        .locator('button[data-testid^="action-"]:not([disabled])')
        .first()
        .click({ timeout: 1_000 })
        .catch(() => {});
      await guest
        .locator('button[data-testid^="action-"]:not([disabled])')
        .first()
        .click({ timeout: 1_000 })
        .catch(() => {});
      await guest.waitForTimeout(300);
    }
    expectFramesRedacted(guestConns, 1, 2);

    await host.context().close();
    await guest.context().close();
  });

  test("种子局:被询问者(guest)见 [自己],旁观者(host)只见匿名占位——身份不出网", async ({
    browser,
  }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    const hostConns = collectConnections(host);
    const guestConns = collectConnections(guest);
    await host.goto(`${ONLINE}/?online=1`);
    // 种子注入(react-reaction-online 同款):拦截建房请求补 seed;国号预设同步钉死
    // (空缺会改变引擎国号池洗牌的骰流消耗,演算按 host=魏 复刻)
    await host.evaluate(() => localStorage.setItem("dafung.guohao", "魏"));
    await host.route("**/room/new", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      body.seed = SEED;
      await route.continue({ postData: JSON.stringify(body) });
    });
    await host.getByTestId("lobby-target").fill("30000");
    await host.getByTestId("lobby-seat-count-plus").click(); // 2 → 3 座(seat2 开局自动 bot)
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
    }
    await onlinePickCapitals([host, guest]);

    // 选都一结束 bot 即出横征暴敛(种子 430 离线核算):轮询两端事件批流直到
    // jinnang 窗开窗事件到达(取代横幅等待——本例只看线级帧,不做应答交互)
    const firstJinnangWindow = (conns: { msgs: Record<string, unknown>[] }[]) =>
      conns
        .flatMap((c) => c.msgs)
        .filter((m) => m.type === "events")
        .flatMap((m) => (m as { events: { kind: string; windowKind?: string }[] }).events)
        .find((ev) => ev.kind === "reactionOpened" && ev.windowKind === "jinnang") as
        | { queriedSeats?: number[] }
        | undefined;
    await expect
      .poll(async () => firstJinnangWindow(guestConns) != null, {
        timeout: 30_000,
        message: "guest 事件批流出现 jinnang 窗(种子 430:bot 选都后即出横征暴敛)",
      })
      .toBe(true);
    // 被询问者视角:god-view [1] → 自己可见
    expect(firstJinnangWindow(guestConns)?.queriedSeats).toEqual([1]);
    // 旁观者(host,seat0)视角:等同一窗到达 host 帧(同批广播,时序差在毫秒级),
    // 询问集必须全匿——真实座位(0/1/2)一个都不许出现
    await expect
      .poll(async () => firstJinnangWindow(hostConns) != null, {
        timeout: 15_000,
        message: "host 事件批流出现同一 jinnang 窗",
      })
      .toBe(true);
    const hostQueried = firstJinnangWindow(hostConns)?.queriedSeats ?? [];
    expect(hostQueried.length, "数量保留(闭窗算术依赖)").toBe(1);
    expect(hostQueried).not.toContain(0);
    expect(hostQueried).not.toContain(1);
    expect(hostQueried).not.toContain(2);

    await host.context().close();
    await guest.context().close();
  });
});

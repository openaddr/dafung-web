// 联机事件批下行通道验证门(#390,ADR-0020 折叠切换①):真实对局(建房/加入/选图/
// 开局/双端选都)中,断言服务端按转移序把 {type:"events"} 事件批消息送到每个客户端
// (明传,双端同一份),且事件带 GameEvent 首部(kind/seat/round/turn)。
// 观测口 = Playwright WebSocket framereceived(线级捕获,与 fixtures 的调试桥门禁无关);
// 客户端暂存语义(lastEvents/计数器/容错)归 test/event-feed.test.ts 单测。
// 联机 spec 免注入时间倍率(testUnscaled,fixtures 既定口径);跑前需先 build(两
// webServer 都消费 dist)。
import { testUnscaled as test, expect, type Page } from "./fixtures";
import { newBridgeContext, onlinePickCapitals } from "./react-helpers";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 线级事件批收集器:挂 page.on("websocket") 捕获framereceived,只留 type==="events"
 *  的消息(须在 goto 前挂上;本服务器所有帧都是 JSON,非 JSON 帧让 JSON.parse 炸出)。 */
function collectEventBatches(page: Page): { batches: { events: any[] }[] } {
  const batches: { events: any[] }[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (data) => {
      const payload = (data as { payload?: unknown }).payload ?? data;
      const msg = JSON.parse(typeof payload === "string" ? payload : String(payload));
      if (msg.type === "events") batches.push(msg);
    });
  });
  return { batches };
}

test("事件批下行:开局选都逐转移到达双端,内容与顺序符合批语义", async ({ browser }) => {
  // 180s:双端建房/选都全程在满载下墙钟抖动大(联机 spec 家族同款放预算)
  test.setTimeout(180_000);
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
  // 收集器先于导航挂上(建连发生在 create/join 之后,不漏帧)
  const hostFeed = collectEventBatches(host);
  const guestFeed = collectEventBatches(guest);

  // 双端建房/加入/选图/开局(2 真人座,选都后进 Playing)
  await host.goto(`${ONLINE}/?online=1`);
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

  // 事件批按转移序到达(明传:双端同一份流)。#388 切换后事件批是唯一对局状态通路
  // (快照只剩开局校准/关键节点),客户端引擎离开 Setup 时对应批次必然已在线级收集
  // 器里,无需额外等待。
  for (const [label, feed] of [
    ["host", hostFeed],
    ["guest", guestFeed],
  ] as const) {
    // 两笔选都转移各一批(末位选都的编排批内含 finishSetup 收尾链,见 #375 批语义)
    expect(feed.batches.length, `${label} 收到事件批`).toBeGreaterThanOrEqual(2);
    for (const batch of feed.batches) {
      // 服务端不发空批;每事件带 GameEvent 首部(行动者座位可为 null=系统行为)
      expect(batch.events.length).toBeGreaterThan(0);
      for (const ev of batch.events) {
        expect(typeof ev.kind, `${label} 事件 kind`).toBe("string");
        expect(ev.seat === null || typeof ev.seat === "number", `${label} 事件 seat`).toBe(true);
        expect(typeof ev.round, `${label} 事件 round`).toBe("number");
        expect(typeof ev.turn, `${label} 事件 turn`).toBe("number");
      }
    }
    // 到达序 = 转移发生序:拼接后 (round, turn) 非降(事件时刻戳随引擎单调,见 #375)
    const stamps: [number, number][] = feed.batches.flatMap((b) =>
      b.events.map(
        (ev: { round: number; turn: number }) => [ev.round, ev.turn] as [number, number],
      ),
    );
    for (let i = 1; i < stamps.length; i++) {
      const cmp = stamps[i][0] - stamps[i - 1][0] || stamps[i][1] - stamps[i - 1][1];
      expect(cmp, `${label} 事件批转移序非降`).toBeGreaterThanOrEqual(0);
    }
    // 选都与开局收尾确实走了通道(两笔建城 + finishSetup 链)
    const kinds: string[] = feed.batches.flatMap((b) =>
      b.events.map((ev: { kind: string }) => ev.kind),
    );
    expect(
      kinds.filter((k) => k === "capitalSelected"),
      `${label} 两次建城事件`,
    ).toHaveLength(2);
    expect(kinds, `${label} 开局收尾链`).toEqual(
      expect.arrayContaining(["setupCompleted", "gameStarted", "turnStarted"]),
    );
  }

  await host.context().close();
  await guest.context().close();
});

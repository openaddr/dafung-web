// 联机同步模型切换终局验证门(#388,ADR-0020 折叠切换⑥):正常对局零逐步快照——
// 事件批消息(#390)是唯一对局状态通路,全量下行只剩三类(首连/重连整房摘要、关键
// 节点校准、房间生命周期;#381 起摘要/校准按接收座位投影,事件批逐座位过滤)。三道门:
//   1. 全程托管局:双端零输入打满一整局,线级统计 snapshot 类消息——开局校准序列之后
//      出现的每份快照都必须是校准快照(判定口径与 server.ts 同源镜像),逐步快照为零;
//      终局由事件折叠收敛(fold gameOver),双端胜者一致。
//   2. 房间元数据通道:对局中掉线不再搭快照车,靠 lobby 形状指纹变化下发(座位 online
//      翻转双端可见)。
//   3. 断线重连:裸关 WS(绕过 closedByUs)走真实退避重连路径 → 整房摘要按座位投影
//      水合(#381:牌序只见数量、他人手牌不可见)→ 双端状态收敛一致 → 折叠继续推进,
//      摘要之后依旧零逐步快照。
// 观测口 = Playwright WebSocket framereceived 线级捕获(与 react-online-events 同款);
// 联机 spec 免注入时间倍率(testUnscaled);跑前需先 build(两 webServer 都消费 dist)。
import { testUnscaled as test, expect, type Page } from "./fixtures";
import { newBridgeContext, dismissJinnangIfUp, onlinePickCapitals } from "./react-helpers";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 校准快照判定(e2e 侧镜像,口径与 scripts/server.ts CALIBRATION_* 一致):
 *  开局 Setup 全程 / 节点批(gameStarted·playerBankrupt)/ 决策窗五相位停留 /
 *  决策窗退出收尾(空批 flush)。其余 snapshot = 逐步快照(切换后的违例)。 */
const CALIBRATION_EVENT_KINDS = new Set(["gameStarted", "playerBankrupt"]);
const CALIBRATION_WINDOWS = new Set([
  "AwaitingJinnang",
  "AwaitingHeroPick",
  "AwaitingEncounter",
  "AwaitingExhaustion",
  "AwaitingBankruptcySettle",
]);
function isCalibrationSnapshot(msg: {
  phase?: string;
  turnPhase?: string | null;
  events?: unknown;
}): boolean {
  const events = Array.isArray(msg.events) ? (msg.events as { kind: string }[]) : [];
  return (
    msg.phase === "Setup" ||
    CALIBRATION_WINDOWS.has(msg.turnPhase ?? "") ||
    events.length === 0 ||
    events.some((ev) => CALIBRATION_EVENT_KINDS.has(ev.kind))
  );
}

/** 线级连接收集器:按 WS 连接分组捕获全部下行 JSON 帧(须在 goto 前挂上;
 *  本服务器所有帧都是 JSON,非 JSON 帧让 JSON.parse 炸出)。快照审计以连接为单位:
 *  每连接首帧 snapshot = 首连/重连整房摘要(①类全量下行,#381 起按接收座位投影,
 *  校准判定口径外的合法快照——重连落在任意停摆相位时,摘要 events 携带未消化批,
 *  不属逐步广播)。 */
function collectConnections(page: Page): {
  conns: { msgs: Record<string, unknown>[]; firstSnapshotDone: boolean }[];
} {
  const conns: { msgs: Record<string, unknown>[]; firstSnapshotDone: boolean }[] = [];
  page.on("websocket", (ws) => {
    const conn = { msgs: [] as Record<string, unknown>[], firstSnapshotDone: false };
    conns.push(conn);
    ws.on("framereceived", (data) => {
      const payload = (data as { payload?: unknown }).payload ?? data;
      conn.msgs.push(JSON.parse(typeof payload === "string" ? payload : String(payload)));
    });
  });
  return { conns };
}

/** 快照审计:逐连接消费消息,首帧 snapshot(整房摘要)豁免,其余必须是校准快照。
 *  返回逐步快照违例的 {phase, turnPhase} 列表(空数组 = 审计通过)。 */
function auditStepSnapshots(
  conns: { msgs: Record<string, unknown>[]; firstSnapshotDone: boolean }[],
): { phase?: string; turnPhase?: string }[] {
  const violations: { phase?: string; turnPhase?: string }[] = [];
  for (const conn of conns) {
    for (const m of conn.msgs) {
      if (m.type !== "snapshot") continue;
      if (!conn.firstSnapshotDone) {
        conn.firstSnapshotDone = true; // 整房摘要(open 处理器同步首发,每连接恰一份)
        continue;
      }
      const snap = m as { phase?: string; turnPhase?: string; events?: unknown };
      if (!isCalibrationSnapshot(snap)) {
        violations.push({ phase: snap.phase, turnPhase: snap.turnPhase });
      }
    }
  }
  return violations;
}

/** 读一端的核心引擎态(经 __dafung 调试钩子;跨端一致性断言用)。 */
async function coreState(p: Page) {
  return p.evaluate(() => {
    const s = (window as any).__dafung.snapshot();
    return {
      phase: s.phase,
      round: s.round,
      turnNumber: s.turnNumber,
      activeIndex: s.activeIndex,
      decisionOwner: s.decisionOwner,
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

/** 双端建房/加入/选图/开局(经济 v2 标准目标 30000)+ 各自三选一选都。
 *  pages = [host, guest](收集器等观察者由调用方在建页后、goto 前挂好)。 */
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
  for (const p of pages) {
    await p.waitForSelector('[data-testid="actionbar-pass"]', { timeout: 5_000 }).catch(() => null);
    await dismissJinnangIfUp(p);
  }
}

/** 盲驱多端决策点(清卷轴/动作条,同 react-online 的 tryClick 口径):每拍轮询各端,
 *  短时限失败即跳过,交给下一拍——断线重连窗口里对局推进方可以是任一端,只驱单端
 *  会在「轮到另一端抉择」处永久停摆(零转移 = 零事件批)。 */
async function driveDecisions(pages: Page[], ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const p of pages) {
      await dismissJinnangIfUp(p);
      const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
      if ((await inline.count()) > 0) {
        await inline
          .first()
          .click({ timeout: 2_000 })
          .catch(() => {});
      } else {
        const scrollPrimary = p.locator(
          '[data-testid^="scroll-"]:not([data-testid*="jinnang"]) button:not([disabled])',
        );
        if ((await scrollPrimary.count()) > 0) {
          await scrollPrimary
            .first()
            .click({ timeout: 2_000 })
            .catch(() => {});
        }
      }
    }
    await pages[0].waitForTimeout(400);
  }
}

test.describe("折叠切换⑥(#388,ADR-0020 终局形态)", () => {
  // 全文件统一预算(reaction-online 家族同款 describe 级):建房/选都全程 + 断线重连
  // 窗口 + 双端驱动,满载下墙钟抖动大。
  test.setTimeout(240_000);

  test("全程托管局:零逐步快照,事件批是唯一状态通路,终局由折叠收敛", async ({ browser }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    // 收集器先于导航挂上(建连发生在 create/join 之后,不漏帧)
    const hostFeed = collectConnections(host);
    const guestFeed = collectConnections(guest);
    await twoClientsSetup([host, guest]);

    // 双端开快速托管(默认 fast):整局零输入,服务器 bot 链直跑终局
    for (const p of [host, guest]) {
      await expect(p.getByTestId("autopilot-button")).toBeVisible({ timeout: 10_000 });
      await p.getByTestId("autopilot-button").click();
    }
    for (const p of [host, guest]) {
      await expect(p.getByTestId("victory-screen")).toBeVisible({ timeout: 120_000 });
    }
    const subs = await Promise.all(
      [host, guest].map((c) => c.getByTestId("victory-sub").textContent()),
    );
    expect(subs[0]).toBeTruthy();
    expect(subs[1], "双端胜者一致(折叠收敛)").toBe(subs[0]);

    // ── 快照审计:每连接首帧=整房摘要(豁免),此后逐步快照必须为零,只允许校准快照 ──
    for (const [label, feed] of [
      ["host", hostFeed],
      ["guest", guestFeed],
    ] as const) {
      const snaps = feed.conns.flatMap((c) => c.msgs.filter((m) => m.type === "snapshot"));
      expect(snaps.length, `${label} 开局校准快照存在`).toBeGreaterThanOrEqual(1);
      expect(
        auditStepSnapshots(feed.conns),
        `${label} 逐步快照必须为零(只允许摘要与校准快照)`,
      ).toEqual([]);
      // 事件批通路:全程托管局的转移批全部经 {type:"events"} 到达,终局宣告在内
      const batches = feed.conns.flatMap((c) => c.msgs.filter((m) => m.type === "events")) as {
        events: { kind: string }[];
      }[];
      expect(batches.length, `${label} 事件批到达`).toBeGreaterThanOrEqual(1);
      const kinds = batches.flatMap((b) => b.events.map((ev) => ev.kind));
      expect(kinds, `${label} 终局宣告经事件批到达`).toContain("gameOver");
    }

    await host.context().close();
    await guest.context().close();
  });

  test("对局中掉线:元数据走 lobby 指纹通道,其余座位看到 online 翻转", async ({ browser }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    const hostFeed = collectConnections(host);
    await twoClientsSetup([host, guest]);

    // guest 裸关底层 socket(真实断线路径;重连由退避自动进行,本例只看元数据下行)
    await guest.evaluate(() => {
      const sock = (window as any).__dafung.controller().sock;
      if (!sock?.ws) throw new Error("socket 未建立");
      sock.ws.close();
    });
    // host 收到 lobby 形状元数据(座位 1 online=false):对局中掉线不再搭逐步快照车,
    // 由指纹变化单独下发(③ 房间生命周期)
    await expect
      .poll(
        async () =>
          hostFeed.conns
            .flatMap((c) => c.msgs)
            .some(
              (m) =>
                m.type === "lobby" &&
                (m as { started?: boolean; seats?: { online: boolean }[] }).started === true &&
                (m as { seats?: { online: boolean }[] }).seats?.[1]?.online === false,
            ),
        { timeout: 20_000, message: "host 收到座位下线的 lobby 元数据" },
      )
      .toBe(true);

    await host.context().close();
    await guest.context().close();
  });

  test("断线重连:整房摘要按座位投影水合,事件面清零后折叠继续,依旧零逐步快照", async ({
    browser,
  }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    const guestFeed = collectConnections(guest);
    await twoClientsSetup([host, guest]);
    // 进入正常对局节奏(任一端的决策点由本端盲驱清掉,自动起摇持续推进)
    await driveDecisions([host, guest], 2_000);

    // 断线:裸关底层 socket(绕过 closedByUs)→ onclose → 退避重连(真实 #388 重连路径)
    await guest.evaluate(() => {
      const sock = (window as any).__dafung.controller().sock;
      if (!sock?.ws) throw new Error("socket 未建立");
      sock.ws.close();
    });
    await expect(guest.getByTestId("connection-banner")).toBeVisible({ timeout: 15_000 });
    // 断线即丢(ADR-0020 决策 4):服务器照常推进(在线端自动起摇),不补发不排队;
    // 轮到离线座抉择则停摆等重连,同为设计内形态
    await driveDecisions([host], 2_000);

    // 重连:退避 ~1s 后新连接出现,首帧 = 整房摘要(#381 起按接收座位投影:
    // 牌序只见数量、他人手牌不可见)
    await expect
      .poll(async () => guestFeed.conns.length, { timeout: 20_000, message: "重连新连接出现" })
      .toBeGreaterThanOrEqual(2);
    const reconn = guestFeed.conns[guestFeed.conns.length - 1];
    await expect
      .poll(async () => reconn.msgs.some((m) => m.type === "snapshot"), {
        timeout: 15_000,
        message: "重连整房摘要到达",
      })
      .toBe(true);
    const summary = reconn.msgs.find((m) => m.type === "snapshot") as {
      phase: string;
      players: { jinnangHand: string[] }[];
      jinnangDeck: string[];
      jinnangDeckCount: number;
    };
    expect(summary.phase).toBe("Playing");
    // 保密后补落定(#381,ADR-0020 决策 2 兑现):guest(seat1)视角牌序只见数量,
    // 他人(seat0=host)手牌内容不出网——摘要与校准快照同口径
    expect(summary.jinnangDeckCount).toBeGreaterThan(0);
    expect(summary.jinnangDeck).toEqual([]);
    expect(summary.players[0].jinnangHand).toEqual([]);
    await expect(guest.getByTestId("connection-banner")).not.toBeVisible({ timeout: 15_000 });

    // 双端状态收敛一致(摘要水合 + 折叠双通道同源)
    await expect
      .poll(
        async () =>
          JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
        { timeout: 30_000, message: "重连后双端核心引擎态一致" },
      )
      .toBe(true);

    // 折叠继续:边驱动边等事件批(驱动并入轮询——满载下固定 8s 驱动窗可能在批次
    // 到达前耗尽;轮询体内持续清两端决策点,任一转移的批到达即收,40s 预算兜慢环境)
    const before = await coreState(guest);
    const eventsBefore = reconn.msgs.filter((m) => m.type === "events").length;
    await expect
      .poll(
        async () => {
          await driveDecisions([host, guest], 1_200);
          return reconn.msgs.filter((m) => m.type === "events").length;
        },
        { timeout: 40_000, intervals: [200], message: "重连后事件批继续到达" },
      )
      .toBeGreaterThan(eventsBefore);
    await expect
      .poll(async () => JSON.stringify(await coreState(guest)) !== JSON.stringify(before), {
        timeout: 20_000,
        message: "重连后本端局面继续推进(折叠在工作)",
      })
      .toBe(true);

    // 摘要之后依旧零逐步快照(重连不重启逐步广播);重连摘要本身按每连接首帧豁免
    expect(
      auditStepSnapshots([{ msgs: reconn.msgs, firstSnapshotDone: false }]),
      "重连后逐步快照必须为零",
    ).toEqual([]);

    await host.context().close();
    await guest.context().close();
  });
});

// 反应窗联机双端(#281,ADR-0017 per-seat 非阻塞;testUnscaled 全速;#291 决议/#302 整治):
// 标准双端 UI 流程(react-online 同款)建 3 座房 [host 页=seat0 / guest 页=seat1 /
// seat2 不入座→开局自动 bot 填充],种子 430 经路由拦截注入建房请求(联机 UI 无种子入口;
// 种子是确定性前提)。种子离线核算(同配置引擎演算):draftOrder=[2,1,0] bot 先动且起手
// 横征暴敛,guest 起手识破诡计,host 起手缓兵之计——选都一结束 bot 即出横征暴敛
// (全体域,targetSeats=[0,1]),guest 被询问(持识破者=guest;#284 拍板「不狩双人
// 各持识破种子」,双端时序例以在场询问端/观察端承担 host/guest 角色):
//   · 替第三席拆招(点 host 座笺)→ host 份失效不缴,guest 照缴;
//   · 自保(点自己笺)→ guest 不缴,host 照缴;
//   · 不应答 → 服务端超时代发「不用」,对局继续;
//   · 断线 → 超时即「不用」,不冻结对局(房间落盘记录作服务端观测口);
//   · 降噪口(#284)→ 点「本回合不再询问」立即代发不用,横幅收回,对局继续;
//   · 双端时序(#284,降级断言)→ 被询问窗内,观察端对局 UI 全程可用不被阻塞;应答后对局即续。
// #291 处置:拆份/自保瘦身(按份结算引擎语义下沉 test/reaction-window.test,e2e 只守询问集
// 真值、点笺接线、出牌线 rAF 原子采样、最小结算 poll);超时/双端时序/降噪口/
// 断线座位四例保留;六例超时统一 120s。应答流程与引擎结算断言收口 react-helpers 反应窗
// 三段式(等窗开→应答→结算 poll),本 spec 无固定硬等待。
// #388 切换后:对局中 log 只随校准快照更新(不再逐步实时),declined/countered 等
// 权威语义断言改走线级事件批(framereceived 捕获 {type:"events"},#390 唯一状态通路);
// 现金/窗收断言仍走折叠后的本地快照(pollReactionSettled 的 paid/unpaid/up 键)。
// 窗长走服务器 env E2E_REACTION_MS=8000(playwright.config webServer 注入,#284):
// 权威侧定时器与客户端横幅(view.windowMs 随快照)同长,本 spec 从此与 3s 广播赛跑脱钩。
import { testUnscaled as test, expect } from "./fixtures";
import {
  newBridgeContext,
  onlinePickCapitals,
  skipUntilNextSeat,
  awaitReactionWindow,
  answerReactionWindow,
  pollReactionSettled,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;
const SEED = 430;
/** 加长窗(playwright.config E2E_REACTION_MS 注入 server,spec 侧同源取值——单源,不双持)。 */
const REACTION_MS = Number(process.env.E2E_REACTION_MS ?? 8000);

/** 房间落盘目录(与 playwright.config 的 E2E_ROOMS_DIR 同源):断线用例的服务端观测口。 */
function roomsDir(): string {
  return resolve(process.env.E2E_ROOMS_DIR ?? "./tmp/e2e-rooms");
}

/** 线级事件批收集器(#390 同款,#388 后为唯一状态通路):挂 page 捕获 {type:"events"}
 *  帧,权威语义断言(declined/countered)据此判定(对局中 log 不再逐步实时)。 */
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

/** 线级权威断言:轮询事件批流直到谓词命中(取代旧 log.includes 断言)。 */
async function pollEventSeen(
  feed: { batches: { events: any[] }[] },
  pred: (ev: any) => boolean,
  message: string,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(async () => feed.batches.some((b) => b.events.some(pred)), { timeout, message })
    .toBe(true);
}

/** 标准 UI 建房/加入/选图/开局(种子 430 经路由拦截注入 /room/new 请求体);
 *  3 座:seat2 不入座,开局由服务器 bot 填充。返回 [host, guest, guest 线级事件批]。 */
async function twoClientsWithSeed(browser: Browser): Promise<{
  host: Page;
  guest: Page;
  roomId: string;
  guestFeed: { batches: { events: any[] }[] };
}> {
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
  const guestFeed = collectEventBatches(guest);
  await host.goto(`${ONLINE}/?online=1`);
  // 种子注入:建房请求体补 seed(不改 UI 契约;房间确定性来自这一拦截)。
  // 国号预设同步钉死:建房 guohao 取 localStorage 偏好(点击时读),空缺会改变引擎国号池
  // 洗牌的骰流消耗——演算(seed 430)按 host=魏 / guest=无预设 复刻,此处对齐。
  await host.evaluate(() => localStorage.setItem("dafung.guohao", "魏"));
  await host.route("**/room/new", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    body.seed = SEED;
    await route.continue({ postData: JSON.stringify(body) });
  });
  await host.getByTestId("lobby-target").fill("30000");
  await host.getByTestId("lobby-seat-count-plus").click(); // 2 → 3 座
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
    await expect(p.getByTestId(TESTIDS.topBar)).toBeVisible({ timeout: 45_000 });
  }
  // L41 选都三选一:两页各坐一席,seat2(bot)服务器代选(助手自带)
  await onlinePickCapitals([host, guest]);
  return { host, guest, roomId, guestFeed };
}

test.describe("反应窗联机(#281 双端,#284 加长窗,#291 整治)", () => {
  // 六例超时统一 120s(#291):describe 级生效——建房/选都/Before Hooks/重试全程同预算,
  // 不靠用例体内逐例声明。
  test.setTimeout(120_000);

  test("横征暴敛反应窗:guest 替第三席(host 座)拆一份——host 不缴,guest 照缴", async ({
    browser,
  }) => {
    const { host, guest, guestFeed } = await twoClientsWithSeed(browser);
    try {
      const before = await awaitReactionWindow(guest);
      // 询问集真值(#388 god-view 明传,per-seat 裁剪退役):seed 430 全桌只有 guest
      // 持识破诡计,被询问集恒 [1]
      const queried = await guest.evaluate(
        () => (window as any).__dafung.snapshot().reaction?.queriedBySeat,
      );
      expect(queried).toEqual([1]);
      // 事件文案报进攻方牌(点笺接线的一半:窗开即报牌)
      await expect(
        guest.getByTestId(TESTIDS.reactionBanner).getByTestId(TESTIDS.reactionText),
      ).toContainText("使用【横征暴敛】");
      // 选牌 → 点 host 座笺 → 落印(点笺接线住 helper)
      await answerReactionWindow(guest, { mode: "counter", card: "识破诡计", seat: 0 });
      // 联机出牌线(#385):本端事件批直读(jinnangAnnounced/jinnangVoided)出线。
      // 线是 700ms 瞬态(testUnscaled 不缩放),条件性在场元素禁 locator 读——单次
      // evaluate 内 rAF 轮询原子采样(react-jinnang-use 墨线例同款口径,#272)。
      const sawLine = await guest.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const t0 = Date.now();
            const tick = () => {
              if (document.querySelector("[data-fx-jinnang-line]")) return resolve(true);
              if (Date.now() - t0 > 15_000) return resolve(false);
              requestAnimationFrame(tick);
            };
            tick();
          }),
      );
      expect(sawLine).toBe(true);
      // 最小结算 poll(按份引擎语义已下沉 reaction-window.test):窗收 + guest 照缴
      // + host 份拆掉不缴;识破拆招留痕走线级事件批(#388)
      await pollReactionSettled(guest, before, { paid: [1], unpaid: [0] });
      await pollEventSeen(guestFeed, (ev) => ev.kind === "jinnangVoided", "识破拆招经事件批留痕");
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("自保:guest 点自己笺——guest 不缴,host 照缴", async ({ browser }) => {
    const { host, guest } = await twoClientsWithSeed(browser);
    try {
      const before = await awaitReactionWindow(guest);
      // 点自己笺=保自己份(不与拆份合并,保独立失败定位)
      await answerReactionWindow(guest, { mode: "counter", card: "识破诡计", seat: 1 });
      await pollReactionSettled(guest, before, { paid: [0], unpaid: [1] });
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("超时代发:guest 不应答,服务端加长窗到期代发「不用」,对局继续", async ({ browser }) => {
    const { host, guest, guestFeed } = await twoClientsWithSeed(browser);
    try {
      const before = await awaitReactionWindow(guest);
      // 不应答:横幅到点自动收回(客户端 8s 投影=view.windowMs),权威侧代发「不用」
      // ——两份全缴。断言窗略大于窗长(住 helper timeout 模式):横幅收回必发生在
      // 加长窗拍,3s 旧窗反而不满足。
      await answerReactionWindow(guest, { mode: "timeout", windowMs: REACTION_MS });
      await pollReactionSettled(guest, before, { paid: [0, 1] });
      // 权威代发留痕走线级事件批(#388:对局中 log 不再逐步实时)
      await pollEventSeen(
        guestFeed,
        (ev) => ev.kind === "reactionAnswered" && ev.use === false,
        "超时代发「不用」经事件批留痕",
      );
      await skipUntilNextSeat(host, 0, 60_000);
      await skipUntilNextSeat(guest, 1, 60_000);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("双端时序(降级断言):被询问窗内观察端 UI 全程可用不被阻塞;应答后对局即续", async ({
    browser,
  }) => {
    const { host, guest, guestFeed } = await twoClientsWithSeed(browser);
    try {
      const before = await awaitReactionWindow(guest);
      // 窗内两拍检查 host 端(观察端)对局 UI(#291:2s 硬等待换 poll):顶条/仪表条在、
      // 快照可读(页面活着),且横幅(被询问端的窗态呈现)不出现在观察端——联机不暂停
      // 全场(ADR-0017)。每个轮询拍都复验一遍观察端,直到拍距跨过 1.5s(≥两拍);
      // 负载下轮询自动加密,不再死等固定 2s。
      const t0 = Date.now();
      await expect
        .poll(
          async () => {
            await expect(host.getByTestId(TESTIDS.topBar)).toBeVisible();
            await expect(host.getByTestId(TESTIDS.dashboardBar)).toBeVisible();
            expect(await host.evaluate(() => (window as any).__dafung.snapshot().phase)).toBe(
              "Playing",
            );
            expect(await host.getByTestId(TESTIDS.reactionBanner).count()).toBe(0);
            return Date.now() - t0;
          },
          { timeout: 8_000, intervals: [1_000] },
        )
        .toBeGreaterThan(1_500);
      // guest 应答(点「不用」)→ 窗立收,两份全缴,对局在两端同时继续
      await answerReactionWindow(guest, { mode: "decline" });
      await pollReactionSettled(guest, before, { paid: [0, 1] });
      await pollEventSeen(
        guestFeed,
        (ev) => ev.kind === "reactionAnswered" && ev.use === false,
        "手点「不用」经事件批留痕",
      );
      await skipUntilNextSeat(host, 0, 60_000);
      await skipUntilNextSeat(guest, 1, 60_000);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("联机降噪口(单窗):点「本回合不再询问」立即代发不用+横幅收回+对局继续", async ({
    browser,
  }) => {
    const { host, guest, guestFeed } = await twoClientsWithSeed(browser);
    try {
      const before = await awaitReactionWindow(guest);
      const banner = guest.getByTestId(TESTIDS.reactionBanner);
      // 点降噪口 = 当前窗立即「不用」+本回合静默:横幅应即刻收回——断言窗小于窗长,
      // 若走的是超时代发(8s)这条断言必挂,「立即」由此钉死(#291:本例灵魂)。
      await answerReactionWindow(guest, { mode: "mute" });
      await expect(banner).not.toBeVisible({ timeout: REACTION_MS - 3_000 });
      // 权威侧真态:use=0 应答入账,两份全缴(降噪代发与手点同一条普通命令),窗收续推;
      // 留痕断言走线级事件批(#388)
      await pollReactionSettled(guest, before, { paid: [0, 1] });
      await pollEventSeen(
        guestFeed,
        (ev) => ev.kind === "reactionAnswered" && ev.use === false,
        "降噪代发经事件批留痕",
      );
      // 对局继续:两端各自清决策点,局面持续推进
      await skipUntilNextSeat(host, 0, 60_000);
      await skipUntilNextSeat(guest, 1, 60_000);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("断线座位:窗开即断,服务端超时即「不用」,对局不冻结继续推进", async ({ browser }) => {
    const { host, guest, roomId } = await twoClientsWithSeed(browser);
    const before = await awaitReactionWindow(guest);
    // 窗内断线:WS 关闭 → 座位离线。断线端读不到快照,改读房间落盘记录(同机目录)
    // 观测服务端真态:超时代发照走(两份全缴)+ 对局持续推进(过窗后进下一回合)。
    await guest.context().close();
    const recPath = join(roomsDir(), `${roomId}.json`);
    await expect
      .poll(
        async () => {
          const rec = JSON.parse(readFileSync(recPath, "utf8")) as any;
          const snap = rec.snapshot;
          if (!snap) return {};
          return {
            declined: snap.log.some(
              (l: any) => l.detail.includes("reactionRespond") && l.detail.includes("use=0"),
            ),
            guestPaid: snap.players[1].cash < before.cash[1],
            hostPaid: snap.players[0].cash < before.cash[0],
            advanced: snap.turnNumber >= 2,
          };
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toEqual({ declined: true, guestPaid: true, hostPaid: true, advanced: true });
    await host.context().close();
  });
});

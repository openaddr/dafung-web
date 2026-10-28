// 反应窗联机双端(#281,ADR-0017 per-seat 非阻塞;testUnscaled 全速;#291 决议/#302 整治):
// 标准双端 UI 流程(react-online 同款)建 3 座房 [host 页=seat0 / guest 页=seat1 /
// seat2 不入座→开局自动 bot 填充],种子 419 经路由拦截注入建房请求(联机 UI 无种子入口;
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
// 窗长走服务器 env E2E_REACTION_MS=15000(playwright.config webServer 注入,#284;
// #626 加固 8s→15s:窗寿盖过 4-worker 帧停滞的观测延迟,窗开又关 = 等窗 helper
// 等不到的 flake 族退役):
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
import { LID } from "../src/app/screens/lobby/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;
const SEED = 419;
/** 加长窗(playwright.config E2E_REACTION_MS 注入 server,spec 侧同源取值——fallback
 *  与 config 的值成对改,#626)。 */
const REACTION_MS = Number(process.env.E2E_REACTION_MS ?? 15000);

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

/** 标准 UI 建房/加入/选图/开局(种子经路由拦截注入 /room/new 请求体,缺省 419);
 *  3 座:seat2 不入座,开局由服务器 bot 填充。返回 [host, guest, guest 线级事件批]。 */
async function twoClientsWithSeed(
  browser: Browser,
  seed: number = SEED,
): Promise<{
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
  // 洗牌的骰流消耗——演算按 host=魏 / guest=无预设 复刻,此处对齐。
  await host.evaluate(() => localStorage.setItem("dafung.guohao", "魏"));
  await host.route("**/room/new", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    body.seed = seed;
    await route.continue({ postData: JSON.stringify(body) });
  });
  await host.getByTestId(LID.target).fill("30000");
  await host.getByTestId(`${LID.seatCount}-plus`).click(); // 2 → 3 座
  await host.getByTestId(LID.create).click();
  await expect(host.getByTestId(LID.roomCode)).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId(LID.roomCode).textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId(LID.roomCode)).toHaveText(roomId, { timeout: 30_000 });
  await host.getByTestId(LID.selectMap).click();
  await host.getByTestId(SETUP_TID.mapItem("huanyou")).click();
  await host.getByTestId(SETUP_TID.mapConfirm).click();
  await host.getByTestId(LID.start).click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId(TESTIDS.topBar)).toBeVisible({ timeout: 45_000 });
  }
  // L41 选都三选一:两页各坐一席,seat2(bot)服务器代选(助手自带)
  await onlinePickCapitals([host, guest]);
  return { host, guest, roomId, guestFeed };
}

/** 双人类识破窗驱动(ADR-0027 换图重钉):种子级联洗牌后「双识破起手 + bot 首回合
 *  宣告」的自然命中率掉到 ~1/400,海选不再划算——改为驱动对局流动等窗:
 *  两端轮替清决策点(出牌「不出」/购地「不取」),单人识破窗应答「不用」放行,
 *  每回合开始各摸一张,双人类先后持识破后,任意 bot 宣告即开双窗。
 *  窗判定走两端各自的 per-seat 脱敏投影(本座真 id 在列、他人 -1),不读 god-view。
 *  返回宣告牌 id(结算留痕断言用,不再钉具体牌名)。 */
async function driveToDualWindow(host: Page, guest: Page, timeout = 110_000): Promise<string> {
  const deadline = Date.now() + timeout;
  const viewOf = (page: Page) =>
    page.evaluate(() => {
      // snapshot.reaction 就是 ReactionView 本体(不包 .view 壳,见 snapshot.ts 派生字段)
      const r = (window as any).__dafung.snapshot().reaction;
      // per-seat 脱敏投影:本座真 id 在列,他人匿名 -1——「本座在列且窗是多座」即双窗
      return { q: (r?.queriedBySeat ?? null) as number[] | null, card: r?.cardId ?? null };
    });
  for (;;) {
    if (Date.now() > deadline) throw new Error("驱动超时:双人类识破窗未出现");
    const hv = await viewOf(host);
    const gv = await viewOf(guest);
    // 双窗:两端各读到「本座在列 + 至少一座同行者」(host [0,-1] / guest [-1,1])
    if (hv.q && hv.q.includes(0) && hv.q.length >= 2 && gv.q && gv.q.includes(1)) {
      await awaitReactionWindow(host);
      await awaitReactionWindow(guest);
      if (!hv.card) throw new Error("双窗无宣告牌 id:结算留痕断言将失真");
      return hv.card;
    }
    // 单人窗(严格 solo=len 1):本端「不用」放行,对局继续流动
    if (hv.q && hv.q.includes(0) && hv.q.length < 2) {
      const before = await awaitReactionWindow(host);
      await answerReactionWindow(host, { mode: "decline" });
      await pollReactionSettled(host, before, {});
      continue;
    }
    // guest 侧:len 1 = solo 窗;len ≥2 且 host 视图无窗 = 双窗里 host 已答过的残窗
    // (驱动早前单人分支误答所致)——guest 应答放行,不把对局吊死在这扇窗上
    if (gv.q && gv.q.includes(1) && (gv.q.length < 2 || !hv.q)) {
      const before = await awaitReactionWindow(guest);
      await answerReactionWindow(guest, { mode: "decline" });
      await pollReactionSettled(guest, before, {});
      continue;
    }
    // 双窗形态但另一端视图未一致(投影/水合拍差):不答,等下一拍两端视图收敛
    await host.waitForTimeout(500);
    await skipUntilNextSeat(host, 0, 20_000).catch(() => {});
    await skipUntilNextSeat(guest, 1, 20_000).catch(() => {});
  }
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
      // 询问集真值(#388 god-view 明传,per-seat 裁剪退役):seed 419 全桌只有 guest
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
      // 联机出牌线(#385):服务端事件批直读——jinnangAnnounced/jinnangVoided/
      // reactionAnswered 经 event-extract 直译为同一 jinnangPlayed 表现事件(识破线
      // 的端点回溯靠跨批宣布游标),本端即收即播,不读引擎留痕通道。
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
      // 不应答:横幅到点自动收回(客户端窗寿投影=view.windowMs),权威侧代发「不用」
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
            await expect(host.getByTestId(TESTIDS.seatRail)).toBeVisible();
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
      // 若走的是超时代发(整个窗寿)这条断言必挂,「立即」由此钉死(#291:本例灵魂)。
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

  test("已应答座位横幅即收、不可重复应答(#453/B2):host 应答后横幅消失,权威侧应答齐窗收续结算", async ({
    browser,
  }) => {
    // 种子 837(bun in-process 房间演算直扫,权威同源零偏差;ADR-0034 重钓——AI 选都
    // 评分变更后原 125 链作废):双人类起手识破诡计、bot 首回合即宣告连环计开出 [0,1]
    // 双窗。draftOrder 客先动——驱动器沿途回答单人窗、
    // 清决策点,直至 bot 宣告开出 [0,1] 双窗(场景机制见 driveToDualWindow 注)。
    const { host, guest, roomId } = await twoClientsWithSeed(browser, 837);
    try {
      const announcedCard = await driveToDualWindow(host, guest);
      // 询问集 per-seat 投影(#461 起=身份匿名、数量保留,与脱敏批同口径):自己座位
      // 在列 + 他人位匿名占位(-1)——两端各自在列 = 双人类同窗的前提成立(god-view
      // 全集 [0,1] 见对局日志 reactionWindow 行);数量保留是折叠器闭窗算术的分母。
      const queriedOf = (page: Page): Promise<number[]> =>
        page.evaluate(() => (window as any).__dafung.snapshot().reaction?.queriedBySeat);
      expect(await queriedOf(host)).toEqual([0, -1]);
      expect(await queriedOf(guest)).toEqual([-1, 1]);
      // host 点「不用」应答(单发命令;联机日常路径与单机降噪同款点击链)
      await answerReactionWindow(host, { mode: "decline" });
      // #453/B2 验收:已应答座位横幅即刻消失、不可再点(入口没了)。权威侧窗未收
      // (guest 未应答,加长窗内由其超时代发兜底)——呈现层不许复显横幅。
      await expect(host.getByTestId(TESTIDS.reactionBanner)).not.toBeVisible({ timeout: 3_000 });
      // 应答齐窗收续结算:guest 超时代发「不用」后连环计照常执行,对局离开反应相位
      await expect
        .poll(
          async () =>
            guest.evaluate(
              () => (window as any).__dafung.snapshot().turnPhase !== "AwaitingReaction",
            ),
          { timeout: 20_000, message: "应答齐窗收续结算" },
        )
        .toBe(true);
      // 权威留痕(房间落盘):每被询问座位恰应答一次(重复应答被引擎拒绝,呈现层
      // 撤入口后无可重复点击面),连环计结算执行
      await expect
        .poll(
          async () => {
            const rec = JSON.parse(readFileSync(join(roomsDir(), `${roomId}.json`), "utf8")) as any;
            const log: string[] = (rec.snapshot?.log ?? []).map((l: any) => l.detail);
            return {
              hostAnswered: log.filter(
                (d) => d.includes("reactionRespond") && d.includes("seat=p0"),
              ).length,
              guestAnswered: log.filter(
                (d) => d.includes("reactionRespond") && d.includes("seat=p1"),
              ).length,
              settled: log.some((d) => d.includes("jinnangUse") && d.includes(announcedCard)),
            };
          },
          { timeout: 10_000, message: "权威应答留痕:两座各一次 + 结算执行" },
        )
        .toEqual({ hostAnswered: 1, guestAnswered: 1, settled: true });
      // 对局继续推进:两端各自清决策点,不留悬窗
      await skipUntilNextSeat(host, 0, 60_000);
      await skipUntilNextSeat(guest, 1, 60_000);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("非应答端可应答(#461):host 应答后 guest 应答入口健在、过网入账,应答齐权威即收窗", async ({
    browser,
  }) => {
    // 同种子 837 双人类识破窗(场景见上例;驱动等窗见 driveToDualWindow 注)。
    // #461 根因:出牌阶段开窗拍必带校准全量快照,其 per-seat 投影把查询集覆盖成长度 1,
    // 折叠器闭窗算术(answers 数 ≥ 查询数)被污染——host 首个应答即触发 guest 本地误闭窗:
    // 横幅提前消失、丧失应答入口,权威侧窗实际仍开满窗寿,玩家被超时代发兜底。
    const { host, guest, guestFeed } = await twoClientsWithSeed(browser, 837);
    try {
      await driveToDualWindow(host, guest);
      const before = await awaitReactionWindow(guest);
      await awaitReactionWindow(host);
      await answerReactionWindow(host, { mode: "decline" });
      // guest(非应答端)在 host 应答后必须仍可应答。回归判据走权威留痕而非横幅可视
      // 轮询:横幅是演出层,演出队列积压时渲染可迟于窗寿,可视轮询天然竞态;
      // #461 误闭窗的真故障 = guest 本地挂起态丢失 → guest 应答被客户端拒绝 →
      // seat=1 的应答不会过网。guest 随即点「不用」,留痕到位 = 应答入口健在。
      await answerReactionWindow(guest, { mode: "decline" });
      await pollReactionSettled(guest, before, {});
      // 权威留痕:guest 自己的应答(seat=1)过网入账(修复前此痕必缺)
      await pollEventSeen(
        guestFeed,
        (ev) => ev.kind === "reactionAnswered" && ev.seat === 1,
        "guest 应答经事件批留痕",
      );
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

// 反应窗联机双端(#281,ADR-0017 per-seat 非阻塞;testUnscaled 全速,3s 真窗可接受):
// 标准双端 UI 流程(react-online 同款)建 3 座房 [host 页=seat0 / guest 页=seat1 /
// seat2 不入座→开局自动 bot 填充],种子 191 经路由拦截注入建房请求(联机 UI 无种子入口;
// 种子是确定性前提)。种子离线核算(同配置引擎演算):draftOrder=[2,1,0] bot 先动且起手
// 横征暴敛,guest 起手识破诡计,host 起手缓兵之计——选都一结束 bot 即出横征暴敛
// (全体域,targetSeats=[0,1]),guest 被询问:
//   · 替第三席拆招(点 host 座笺)→ host 份失效不缴,guest 照缴;
//   · 自保(点自己笺)→ guest 不缴,host 照缴;
//   · 不应答 → 服务端 3s 超时代发「不用」,对局继续;
//   · 断线 → 超时即「不用」,不冻结对局(房间落盘记录作服务端观测口)。
import { testUnscaled as test, expect } from "./fixtures";
import { newBridgeContext, onlinePickCapitals } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;
const SEED = 430;

/** 房间落盘目录(与 playwright.config 的 E2E_ROOMS_DIR 同源):断线用例的服务端观测口。 */
function roomsDir(): string {
  return resolve(process.env.E2E_ROOMS_DIR ?? "./tmp/e2e-rooms");
}

/** 标准 UI 建房/加入/选图/开局(种子 191 经路由拦截注入 /room/new 请求体);
 *  3 座:seat2 不入座,开局由服务器 bot 填充。返回 [host, guest]。 */
async function twoClientsWithSeed(
  browser: Browser,
): Promise<{ host: Page; guest: Page; roomId: string }> {
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
  await host.goto(`${ONLINE}/?online=1`);
  // 种子注入:建房请求体补 seed(不改 UI 契约;房间确定性来自这一拦截)。
  // 国号预设同步钉死:建房 guohao 取 localStorage 偏好(点击时读),空缺会改变引擎国号池
  // 洗牌的骰流消耗——演算(seed 191)按 host=魏 / guest=无预设 复刻,此处对齐。
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
    await expect(p.getByTestId("top-bar")).toBeVisible({ timeout: 45_000 });
  }
  // L41 选都三选一:两页各坐一席,seat2(bot)服务器代选(助手自带)
  await onlinePickCapitals([host, guest]);
  return { host, guest, roomId };
}

/** 清一页的决策点(落格抉择等):一律跳过,直到断言条件成立或轮到别人。 */
async function skipDecisions(p: Page, mySeat: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const skip = p.getByTestId("action-skip");
        if (await skip.isVisible().catch(() => false)) {
          await skip.click({ timeout: 2_000 }).catch(() => {});
        } else {
          const jp = p.getByTestId(TESTIDS.actionbarPass);
          if (await jp.isVisible().catch(() => false)) {
            await jp.click({ timeout: 2_000 }).catch(() => {});
          } else {
            const any = p.locator('button[data-testid^="action-"]:not([disabled])');
            if ((await any.count()) > 0)
              await any
                .first()
                .click({ timeout: 2_000 })
                .catch(() => {});
          }
        }
        const s = await p.evaluate(() => (window as any).__dafung.snapshot());
        return s.phase === "GameOver" || s.decisionOwner !== mySeat;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

test.describe("反应窗联机(#281 双端)", () => {
  test("横征暴敛反应窗:guest 替第三席(host 座)拆一份——host 不缴,guest 照缴", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { host, guest } = await twoClientsWithSeed(browser);
    try {
      // 窗开前先记现金基线(窗只有 3s 真时长,操作链要短)
      const cashBefore = await guest.evaluate(() => {
        const s = (window as any).__dafung.snapshot();
        return { guest: s.players[1].cash, host: s.players[0].cash };
      });
      // bot(seat2)先动出横征暴敛 → guest 被询问:横幅 + 候选笺(含 host 座与自己)
      const banner = guest.getByTestId(TESTIDS.reactionBanner);
      await expect(banner).toBeVisible({ timeout: 60_000 });
      // 投影口径(ADR-0016):guest 只看到自己被询问,他人询问集裁掉
      const queried = await guest.evaluate(
        () => (window as any).__dafung.snapshot().reaction?.queriedBySeat,
      );
      expect(queried).toEqual([1]);
      // 点牌选中(全体域展开选份候选笺)→ 点 host 座笺 → 落印
      await guest.getByTestId(TESTIDS.jinnangCard("识破诡计")).click();
      await expect(banner.getByTestId(TESTIDS.reactionSeat(0))).toBeVisible();
      await expect(banner.getByTestId(TESTIDS.reactionText)).toContainText("使用【横征暴敛】");
      await banner.getByTestId(TESTIDS.reactionSeat(0)).click();
      await banner.getByTestId(TESTIDS.reactionConfirm).click();
      await expect
        .poll(
          async () =>
            guest.evaluate((before) => {
              const s = (window as any).__dafung.snapshot();
              return {
                up: s.turnPhase === "AwaitingReaction",
                guestPaid: s.players[1].cash < before.guest,
                hostPaid: s.players[0].cash < before.host,
                countered: JSON.stringify(s.log).includes("reactionCounter"),
              };
            }, cashBefore),
          { timeout: 30_000 },
        )
        .toEqual({ up: false, guestPaid: true, hostPaid: false, countered: true });
      // 对局继续:两页各自清决策点,局面持续推进
      await skipDecisions(host, 0);
      await skipDecisions(guest, 1);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("自保:guest 点自己笺——guest 不缴,host 照缴", async ({ browser }) => {
    test.setTimeout(240_000);
    const { host, guest } = await twoClientsWithSeed(browser);
    try {
      const cashBefore = await guest.evaluate(() => {
        const s = (window as any).__dafung.snapshot();
        return { guest: s.players[1].cash, host: s.players[0].cash };
      });
      const banner = guest.getByTestId(TESTIDS.reactionBanner);
      await expect(banner).toBeVisible({ timeout: 60_000 });
      await guest.getByTestId(TESTIDS.jinnangCard("识破诡计")).click();
      await banner.getByTestId(TESTIDS.reactionSeat(1)).click();
      await banner.getByTestId(TESTIDS.reactionConfirm).click();
      await expect
        .poll(
          async () =>
            guest.evaluate((before) => {
              const s = (window as any).__dafung.snapshot();
              return {
                up: s.turnPhase === "AwaitingReaction",
                guestPaid: s.players[1].cash < before.guest,
                hostPaid: s.players[0].cash < before.host,
              };
            }, cashBefore),
          { timeout: 30_000 },
        )
        .toEqual({ up: false, guestPaid: false, hostPaid: true });
      await skipDecisions(host, 0);
      await skipDecisions(guest, 1);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("超时代发:guest 不应答,服务端 3s 后代发「不用」,对局继续", async ({ browser }) => {
    test.setTimeout(240_000);
    const { host, guest } = await twoClientsWithSeed(browser);
    try {
      const cashBefore = await guest.evaluate(() => {
        const s = (window as any).__dafung.snapshot();
        return { guest: s.players[1].cash, host: s.players[0].cash };
      });
      const banner = guest.getByTestId(TESTIDS.reactionBanner);
      await expect(banner).toBeVisible({ timeout: 60_000 });
      // 不应答:横幅到点自动收回(客户端 3s 投影),权威侧代发「不用」——两份全缴
      await expect(banner).not.toBeVisible({ timeout: 10_000 });
      await expect
        .poll(
          async () =>
            guest.evaluate((before) => {
              const s = (window as any).__dafung.snapshot();
              const log = JSON.stringify(s.log);
              return {
                guestPaid: s.players[1].cash < before.guest,
                hostPaid: s.players[0].cash < before.host,
                declined: log.includes("reactionRespond") && log.includes("use=0"),
              };
            }, cashBefore),
          { timeout: 30_000 },
        )
        .toEqual({ guestPaid: true, hostPaid: true, declined: true });
      await skipDecisions(host, 0);
      await skipDecisions(guest, 1);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  test("断线座位:窗开即断,服务端 3s 超时即「不用」,对局不冻结继续推进", async ({ browser }) => {
    test.setTimeout(240_000);
    const { host, guest, roomId } = await twoClientsWithSeed(browser);
    const cashBefore = await guest.evaluate(() => {
      const s = (window as any).__dafung.snapshot();
      return { guest: s.players[1].cash, host: s.players[0].cash };
    });
    const banner = guest.getByTestId(TESTIDS.reactionBanner);
    await expect(banner).toBeVisible({ timeout: 60_000 });
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
            guestPaid: snap.players[1].cash < cashBefore.guest,
            hostPaid: snap.players[0].cash < cashBefore.host,
            advanced: snap.turnNumber >= 2,
          };
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toEqual({ declined: true, guestPaid: true, hostPaid: true, advanced: true });
    await host.context().close();
  });
});

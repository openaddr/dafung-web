// 联机断线重连 UI 通路守卫(#388,ADR-0020 折叠切换⑥;#1164 棒二改组)。
// 本文件原三道门(零逐步快照审计 / 掉线 lobby 指纹 / 重连摘要投影水合+双端收敛)的
// **协议面逻辑断言**已整体迁入 test/online/protocol-online.test.ts 场景八/九与场景二/四/五
// (落点总表见 docs/adr/0055-protocol-fault-e2e.md);浏览器侧只留真 UI 断言:
// 裸关底层 socket 走真实退避重连路径时,断线横幅的可见性翻转(可见性类,无头测试
// 不持有 DOM/演出面,替代不了)。
// 观测口 = Playwright 可见性断言;联机 spec 免注入时间倍率(testUnscaled);
// 跑前需先 build(两 webServer 都消费 dist)。
// 真实段(ADR-0058)(波5b #1218 标注):全 1 例全真零种植——双端真实开局后裸关底层
// socket(真断线)→断线横幅真渲染可见→真退避重连→横幅真撤,可见性翻转即被测环
// (重连摘要/事件续流/双端收敛协议面已迁 test/online/protocol-online.test.ts,见上)。
// 联机走 testUnscaled(对局节奏由服务器驱动)。零种植。
import { testUnscaled as test, expect, type Page } from "./fixtures";
import { newBridgeContext, dismissJinnangIfUp, onlinePickCapitals } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { LID } from "../src/app/screens/lobby/testids";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 双端建房/加入/选图/开局(经济 v2 标准目标 30000)+ 各自三选一选都。
 *  pages = [host, guest](原 react-online-cutover twoClientsSetup,纯场景配方)。 */
async function twoClientsSetup(pages: [Page, Page]): Promise<void> {
  const [host, guest] = pages;
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId(LID.target).fill("30000");
  await host.getByTestId(LID.create).click();
  await expect(host.getByTestId(LID.roomCode)).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId(LID.roomCode).textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId(LID.roomCode)).toHaveText(roomId, { timeout: 30_000 });
  await host.getByTestId(LID.selectMap).click();
  await host.getByTestId(SETUP_TID.mapItem("guanzhong")).click();
  await host.getByTestId(SETUP_TID.mapConfirm).click();
  await host.getByTestId(LID.start).click();
  for (const p of pages) {
    await expect(p.getByTestId(TESTIDS.topBar)).toBeVisible({ timeout: 45_000 });
  }
  await onlinePickCapitals(pages);
  for (const p of pages) {
    await p
      .waitForSelector(`[data-testid=${TESTIDS.actionbarPass}]`, { timeout: 5_000 })
      .catch(() => null);
    await dismissJinnangIfUp(p);
  }
}

test.describe("断线重连 UI 通路(#388,#1164 棒二改组)", { tag: "@slow" }, () => {
  // 慢池(#1026):联机真链路族——快池门禁 --grep-invert @slow 跳过,慢池批次收口跑。
  // 建房/选都全程 + 断线重连窗口,满载下墙钟抖动大(原 describe 级预算沿用)。
  test.setTimeout(240_000);

  test("断线重连 UI:裸关 WS → 断线横幅可见 → 退避重连 → 横幅消失", async ({ browser }) => {
    const host = await (await newBridgeContext(browser)).newPage();
    const guest = await (await newBridgeContext(browser)).newPage();
    await twoClientsSetup([host, guest]);

    // 断线:裸关底层 socket(绕过 closedByUs)→ onclose → 断线横幅升起(真 UI:
    // 连接状态横幅的可见性,无头协议层替代不了)
    await guest.evaluate(() => {
      const sock = (window as any).__dafung.controller().sock;
      if (!sock?.ws) throw new Error("socket 未建立");
      sock.ws.close();
    });
    await expect(guest.getByTestId(TESTIDS.connectionBanner)).toBeVisible({ timeout: 15_000 });

    // 重连:退避 ~1s 后自动重连,摘要水合完成 → 横幅消失(可见性翻转即 UI 通路全绿;
    // 摘要投影/事件续流/双端收敛等协议面断言在 test/online/protocol-online.test.ts 场景二/四)
    await expect(guest.getByTestId(TESTIDS.connectionBanner)).not.toBeVisible({ timeout: 30_000 });

    await host.context().close();
    await guest.context().close();
  });
});

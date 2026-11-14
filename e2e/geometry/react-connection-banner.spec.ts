// 地板名册(ADR-0062):几何钉+真实键盘——两屏恢复横幅的安全区、触区、焦点与知会让位。
// #1425:真实 UI 双人建房/入座/开局；仅在 /room/new 请求边界钉 seed=1。
// 首连及手动恢复都走原生 WebSocket 和真实权威摘要；故障时在全局构造边界只发 close，
// 浏览器虚拟时钟推进真实退避链。零引擎种植、零 store 直写、零控制器私有穿透。
// 原座/托管/旧回调隔离归 test/online/online-dual-run.test.ts；本例只补真浏览器证据。
import { testUnscaled as test, expect, newMobileContext, type Page } from "../fixtures";
import { onlinePickCapitals } from "../react-helpers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../../src/app/screens/setup/testids";
import { LID } from "../../src/app/screens/lobby/testids";
import { HOME_TID } from "../../src/app/screens/home/testids";

const gamePort = process.env.E2E_GAME_PORT;
if (!gamePort) throw new Error("Playwright配置未发布E2E_GAME_PORT");
const ONLINE = `http://localhost:${gamePort}`;
const VIEWPORT = { width: 844, height: 390 };
const SAFE = { top: 12, right: 20, bottom: 10, left: 24 };

declare global {
  interface Window {
    /** 仅由本例 addInitScript 注入的 WebSocket 系统故障边界，不注册产品调试桥。 */
    __connectionFault: { cut(): void; restore(): void; release(): void };
  }
}

async function installConnectionFault(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    let current: WebSocket | null = null;
    let failing = false;
    let holding = false;
    const messages: { socket: WebSocket; data: unknown }[] = [];
    window.WebSocket = new Proxy(Native, {
      construct(target, args) {
        if (failing) {
          // 模拟握手失败，不能先 open：open 会清空真实重连次数，永远无法耗尽。
          const failed = {
            readyState: Native.CLOSED,
            onopen: null,
            onmessage: null,
            onerror: null,
            onclose: null as (() => void) | null,
            close() {},
            send() {
              throw new Error("故障 socket 不可发送命令");
            },
          };
          queueMicrotask(() => failed.onclose!());
          return failed as unknown as WebSocket;
        }
        const socket = Reflect.construct(target, args) as WebSocket;
        current = socket;
        // 手动恢复仅暂扣原始消息以观察 calibrating；释放时原样交给产品接收者。
        socket.addEventListener("message", (event) => {
          if (!holding) return;
          event.stopImmediatePropagation();
          messages.push({ socket, data: event.data });
        });
        return socket;
      },
    });
    window.__connectionFault = {
      cut() {
        if (current === null) throw new Error("真实首连尚未建立");
        failing = true;
        current.close();
      },
      restore() {
        failing = false;
        holding = true;
      },
      release() {
        holding = false;
        for (const { socket, data } of messages.splice(0))
          socket.dispatchEvent(new MessageEvent("message", { data }));
      },
    };
  });
}

async function exhaustConnection(page: Page): Promise<void> {
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 100));
  await page.evaluate(() => window.__connectionFault.cut());
  await expect(page.getByTestId(TESTIDS.connectionBanner)).toContainText(/1\/10/);
  // 退避最大为 30s×1.3；逐拍推进，不跑四十秒 rAF，也不等真实墙钟。
  for (let attempt = 0; attempt < 10; attempt++) await page.clock.fastForward(40_000);
  await expect(page.getByTestId(TESTIDS.connectionBanner)).toContainText("自动重连已耗尽");
  await expect(page.getByTestId(TESTIDS.connectionRetry)).toBeEnabled();
}

async function restoreConnection(page: Page): Promise<void> {
  await page.evaluate(() => window.__connectionFault.restore());
  await page.getByTestId(TESTIDS.connectionRetry).click();
  await expect(page.getByTestId(TESTIDS.connectionBanner)).toContainText("正在校准局面");
  await expect(page.getByTestId(TESTIDS.connectionRetry)).toBeDisabled();
  await page.evaluate(() => window.__connectionFault.release());
  await expect(page.getByTestId(TESTIDS.connectionBanner)).toBeHidden();
  await page.clock.resume();
}

async function expectRecoveryGeometry(page: Page): Promise<void> {
  const retry = page.getByTestId(TESTIDS.connectionRetry);
  const exit = page.getByTestId(TESTIDS.connectionExit);
  const banner = (await page.getByTestId(TESTIDS.connectionBanner).boundingBox())!;
  expect(banner.x).toBeGreaterThanOrEqual(SAFE.left);
  expect(banner.x + banner.width).toBeLessThanOrEqual(VIEWPORT.width - SAFE.right);
  for (const [button, minimum] of [
    [retry, 44],
    [exit, 40],
  ] as const) {
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(minimum);
    expect(box.height).toBeGreaterThanOrEqual(minimum);
    expect(box.x).toBeGreaterThanOrEqual(SAFE.left);
    expect(box.y).toBeGreaterThanOrEqual(SAFE.top);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width - SAFE.right);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height - SAFE.bottom);
    expect(
      await button.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }),
      "按钮中心须真实命中，不能只在 DOM 中存在",
    ).toBe(true);
  }
  await retry.focus();
  await page.keyboard.press("Tab");
  await expect(exit).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(retry).toBeFocused();
  const focus = await retry.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      visible: el.matches(":focus-visible"),
      width: parseFloat(css.outlineWidth),
      style: css.outlineStyle,
    };
  });
  expect(focus.visible).toBe(true);
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe("none");
}

test.describe("两屏恢复横幅的真实触达(#1425)", () => {
  test.use({ viewport: VIEWPORT });
  test.describe.configure({ retries: 0 });
  test("大厅与对局:耗尽仍可读、按钮安全可达、校准撤条与返回首页", async ({ page, browser }) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(10_000);
    await installConnectionFault(page);
    await page.clock.install();
    await page.route("**/room/new", (route) =>
      route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), seed: 1 }) }),
    );
    const guestContext = await newMobileContext(browser);
    const guest = await guestContext.newPage();
    guest.setDefaultTimeout(10_000);
    try {
      console.info("[connection] 真实双人大厅");
      await page.goto(`${ONLINE}/?online=1`);
      await expect(page.getByTestId(LID.seatCount)).toContainText("2");
      await page.getByTestId(LID.target).fill("30000");
      await page.getByTestId(LID.create).click();
      await expect(page.getByTestId(LID.roomCode)).toHaveText(/^[A-Z]{4}$/);
      const roomId = (await page.getByTestId(LID.roomCode).textContent())!;
      await guest.goto(`${ONLINE}/?room=${roomId}`);
      await expect(guest.getByTestId(LID.roomCode)).toHaveText(roomId);
      await page.evaluate((insets) => {
        for (const [edge, value] of Object.entries(insets))
          document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`);
      }, SAFE);
      await page.evaluate(() => document.fonts.ready);

      console.info("[connection] 大厅耗尽与安全触区");
      await exhaustConnection(page);
      await expectRecoveryGeometry(page);
      const banner = (await page.getByTestId(TESTIDS.connectionBanner).boundingBox())!;
      const room = (await page.getByTestId(LID.roomCode).boundingBox())!;
      expect(room.y).toBeGreaterThanOrEqual(banner.y + banner.height + 8);
      await restoreConnection(page);
      await expect(page.getByTestId(LID.roomCode)).toHaveText(roomId);

      console.info("[connection] 固定 seed1 合法开局到首个出牌决策");
      // 原房主断线后，真实服务端已将房主移交给在线 guest，恢复不会抢回。
      await guest.getByTestId(LID.selectMap).click();
      await guest.getByTestId(SETUP_TID.mapItem("guanzhong")).click();
      await guest.getByTestId(SETUP_TID.mapConfirm).click();
      await guest.getByTestId(LID.start).click();
      await onlinePickCapitals([page, guest]);
      // 静态公开引擎核过:seed1、两 human、各选最小候选格 => seat1 首回合军情密探。
      // 这是持续等待真人的合法决策，不靠生产 timeout，也不发送“不出”启动自动行军。
      await expect(guest.getByTestId(TESTIDS.actionbarPass)).toBeVisible();
      await expect(page.getByTestId(TESTIDS.turnCapsule)).toBeVisible();
      await page.getByTestId(TESTIDS.turnCapsule).evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished));
      });
      const before = (await page.getByTestId(TESTIDS.turnCapsule).boundingBox())!;

      console.info("[connection] 对局耗尽与知会让位");
      await exhaustConnection(page);
      await expectRecoveryGeometry(page);
      await expect(page.locator("#board")).toBeVisible();
      const down = (await page.getByTestId(TESTIDS.connectionBanner).boundingBox())!;
      const capsule = (await page.getByTestId(TESTIDS.turnCapsule).boundingBox())!;
      expect(capsule.y - before.y).toBeCloseTo(60, 0);
      expect(capsule.y).toBeGreaterThanOrEqual(down.y + down.height + 8);
      const slot = (await page.getByTestId(TESTIDS.noticeBanner).boundingBox())!;
      expect(slot.y).toBeGreaterThanOrEqual(down.y + down.height + 8);
      for (const tid of [TESTIDS.settingsButton, TESTIDS.topbarOverview]) {
        const button = page.getByTestId(tid);
        const box = (await button.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(down.x);
        expect(
          await button.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }),
        ).toBe(true);
      }
      await restoreConnection(page);

      console.info("[connection] 再次耗尽后真实返回首页");
      await exhaustConnection(page);
      await page.getByTestId(TESTIDS.connectionExit).click();
      await expect(page.getByTestId(HOME_TID.screen)).toBeVisible();
      await page.clock.fastForward(400_000);
      await expect(page.getByTestId(TESTIDS.connectionBanner)).toBeHidden();
      await expect(page.locator("#board")).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});

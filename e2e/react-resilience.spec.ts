// React 重构 · 健壮性(阶段 11)。
// 意图来源:旧 resilience.spec(localStorage 坏数据不卡死、失效 id 回退)。
// 联机刷新重入:服务器无 token 重入(online.ts 注释 TODO),刷新 ?room= 会重新走
// 加入流程(满员则失败)——此处测降级不崩溃(意图同旧 resilience 的"重进"场景)。
import { test, expect } from "@playwright/test";
import { openSoloSetup } from "./react-helpers";

// 零兜底原则:图库数据损坏 = 启动时解析默认地图即抛,首页被拦在「地图清单加载中…」
// 并显式报错(HintBar 显示失败原因)——损坏可见,不静默清空、不静默忽略。
test("图库 localStorage 垃圾数据:首页显式报错(损坏可见,不静默清空)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dafung-custom-maps", "not-json{{{"));
  await page.goto("/");
  await expect(page.getByText("地图清单加载中…")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/地图清单加载失败/)).toBeVisible({ timeout: 10_000 });
});

test("记忆的地图 id 失效:起兵被拦,停留设置屏(降级不崩溃)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dafung.mapId", "no-such-map"));
  await page.goto("/");
  await expect(page.getByTestId("current-map-name")).toHaveText("no-such-map");
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  // ⚠ 产品缺陷(已报告):loadMapById 抛错后 pushHint 的「起兵失败」只渲染在 Game 屏,
  // 配置页看不到失败原因(静默失败)。此处只断言降级不崩溃:停留配置页、未开局。
  await expect(page.getByTestId("solo-setup-screen")).toBeVisible({ timeout: 5_000 });
  await expect(
    page.evaluate(() => !!(window as any).__dafung?.getEngine?.()),
  ).resolves.toBe(false);
});

test("联机刷新 ?room= 直链:重新走加入流程,不崩溃", async ({ browser }) => {
  const ONLINE = "http://localhost:3010";
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();

  // 建房 + 加入 + 开局(2 人房,速战身价)
  // TODO #13:加入后 room-code 原 8s 短窗在全量负载下偶发不够(WS+大厅渲染 >8s,实测复现),
  // 建房/加入 8s→30s、开局 20s→45s——只放宽轮询窗,断言强度不变。
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill("3000");
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
    await expect(p.getByTestId("hand-panel")).toBeVisible({ timeout: 45_000 });
  }

  // 刷新 guest:无 token 重入,重走 ?room= 加入(满员 409 → 停留大厅并提示;无论哪种,UI 不崩溃)
  // TODO #13:原 page.reload() 在全量并行下偶发 ERR_ABORTED——reload 的导航与 SPA 启动期的
  // 路由跳转/WS 重连竞态,导航被应用自身 abort。改为 goto 同 URL(waitUntil: "load"):
  // 语义等价(服务器无 token 重入,必然重走加入流程),但导航由测试显式等待 load 完成,
  // 再断言 UI,不受路由竞态影响。断言窗也按全量负载给足 3 倍余量(15s→45s)。
  await guest.goto(`${ONLINE}/?room=${roomId}`, { waitUntil: "load" });
  await expect(guest.getByTestId("lobby-screen")).toBeVisible({ timeout: 45_000 });
  // host 端对局不受影响(guest 重入的加入/满员广播可能短暂扰动,给轮询余量)
  await expect(host.getByTestId("hand-panel")).toBeVisible({ timeout: 30_000 });

  await host.context().close();
  await guest.context().close();
});

// React 重构 · 健壮性(阶段 11)。
// 联机刷新重入:服务器无 token 重入(online.ts 注释 TODO),刷新 ?room= 会重新走
// 加入流程(满员则失败)——此处测降级不崩溃(意图同旧 resilience 的"重进"场景)。
// 真实段(ADR-0058)(波5b #1218 标注):存例全真零种植——联机刷新=真实房间+真刷新
// 重走加入流程不崩溃(地板③浏览器运行时事实)。本例走 testUnscaled(联机段对局节奏
// 由服务器驱动)。
// 【#1316 批T2 迁 2 例(3→1)】「垃圾串回显」「失效 id 拦截」迁入接线层 test/
// map-storage-wiring.test.tsx「记忆健壮性接线」组(断言面=localStorage 与渲染语义,
// 真 happy-dom localStorage + 内存地图源零假数据,判词在该文件头注)。
import { testUnscaled as test, expect } from "./fixtures";
import { newBridgeContext } from "./react-helpers";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { LID } from "../src/app/screens/lobby/testids";
import { TESTIDS } from "../src/app/screens/game/testids";

test("联机刷新 ?room= 直链:重新走加入流程,不崩溃", { tag: "@slow" }, async ({ browser }) => {
  // 慢池(#1026):联机真链路族——快池门禁 --grep-invert @slow 跳过,慢池批次收口跑。
  const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();

  // 建房 + 加入 + 开局(2 人房,速战身价)
  // TODO #13:加入后 room-code 原 8s 短窗在全量负载下偶发不够(WS+大厅渲染 >8s,实测复现),
  // 建房/加入 8s→30s、开局 20s→45s——只放宽轮询窗,断言强度不变。
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
  for (const p of [host, guest]) {
    await expect(p.getByTestId(TESTIDS.topBar)).toBeVisible({ timeout: 45_000 });
  }

  // 刷新 guest:无 token 重入,重走 ?room= 加入(满员 409 → 停留大厅并提示;无论哪种,UI 不崩溃)
  // TODO #13:原 page.reload() 在全量并行下偶发 ERR_ABORTED——reload 的导航与 SPA 启动期的
  // 路由跳转/WS 重连竞态,导航被应用自身 abort。改为 goto 同 URL(waitUntil: "load"):
  // 语义等价(服务器无 token 重入,必然重走加入流程),但导航由测试显式等待 load 完成,
  // 再断言 UI,不受路由竞态影响。断言窗也按全量负载给足 3 倍余量(15s→45s)。
  await guest.goto(`${ONLINE}/?room=${roomId}`, { waitUntil: "load" });
  await expect(guest.getByTestId(LID.screen)).toBeVisible({ timeout: 45_000 });
  // host 端对局不受影响(guest 重入的加入/满员广播可能短暂扰动,给轮询余量)
  await expect(host.getByTestId(TESTIDS.topBar)).toBeVisible({ timeout: 30_000 });

  await host.context().close();
  await guest.context().close();
});

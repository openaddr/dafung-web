// React 重构 · 联机托管 UI 守卫(阶段 11)。
// 意图来源:旧 online-autopilot.spec(双端托管零输入到终局 / 收回 / 切速)。
// #306:REST 占座契约例已下沉 test/room.test.ts(room.ts 零 WS,bun test 直打)——
// lobbyView 即 /room/new·join 响应体,UI 层不再重复守传输契约;本文件只守托管行为 UI。
// #580 托管归一:单节拍 2s/步(权威节奏不吃 E2E_TIME_SCALE),无速度分档可切;
// 轮询超时一律按「步数×2s」富余给。
// #700/#701 通路改写:托管钮(autopilot-button)随仪表条退役,开关迁自机格 tap 单人
// 格弹层(SeatPopModal 托管行,Base UI Switch,态=aria-checked);行为语义=ADR-0028
// 单一托管开关(接管=自动托管),断言意图原样平移。
import { testUnscaled as test, expect, type Browser, type Page } from "./fixtures";
import { dismissJinnangIfUp, newBridgeContext } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

// 联机对局依赖真实 WS 广播时序,与其他高负载 spec 并行时易抖:
// 本文件串行执行,降低双端 + 服务器的并发压力。
test.describe.configure({ mode: "serial" });

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 双端建房/加入/开局(经济 v2 标准目标 30000),返回 [host, guest]。 */
async function twoClients(browser: Browser, target = 30000): Promise<[Page, Page]> {
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
  // TODO #13:建房/加入 8s→30s、开局 20s→45s——全量并行负载下 WS 广播到达抖动大
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill(String(target));
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";
  await guest.goto(`${ONLINE}/?room=${roomId}`);
  await expect(guest.getByTestId("room-code")).toHaveText(roomId, { timeout: 30_000 });
  await host.getByTestId("lobby-select-map").click();
  await host.getByTestId("map-item-huanyou").click();
  await host.getByTestId("map-confirm").click();
  await host.getByTestId("lobby-start").click();
  for (const p of [host, guest]) {
    await expect(p.getByTestId("top-bar")).toBeVisible({ timeout: 45_000 });
    // L41 后开局停在 Setup·PickCapital,卷轴(锦囊相位)要到选都完才可能出现——
    // 此处无 5s 短候可等(#306:白烧 10s/次),只做即时探测;真正的放行在各自用例的
    // 推进环里(托管代发 / 轮询体 dismissJinnangIfUp)。
    await dismissJinnangIfUp(p);
  }
  return [host, guest];
}

/** 读一端核心引擎态(经 __dafung 调试钩子;停点/冻结断言用,与 react-online-cutover 同款)。 */
async function coreState(p: Page) {
  return p.evaluate(() => {
    const s = (window as any).__dafung.snapshot();
    return {
      phase: s.phase as string,
      round: s.round as number,
      turnNumber: s.turnNumber as number,
      activeIndex: s.activeIndex as number,
      decisionOwner: s.decisionOwner as number,
      turnPhase: s.turnPhase as string | null,
      positions: s.players.map((x: any) => x.position as number),
      cash: s.players.map((x: any) => x.cash as number),
    };
  });
}

/** 开/关本端托管(#701 通路):tap 自机格开单人格弹层 → 拨托管开关 → Esc 关层。
 *  格 tap 一律 DOM 直派 click(react-seat-pop 列首遮挡同款:决策卷轴 z-30 全屏遮罩
 *  在挂时真点击会被吞,直派照进真实 React onClick;弹层 z-50 恒在卷轴上,开关真点击
 *  可达)。开关态=aria-checked(useAutopilotOn 广播回读,与引擎 autoPilotOn 同源):
 *  点前读态、点后轮询确认生效——旧钮「未生效则补点」结构随状态可读而退役,迟到广播
 *  不再有双击翻转窗口(TODO #13 同因)。 */
async function setAutopilot(page: Page, seat: number, on: boolean) {
  await page.getByTestId(TESTIDS.seatSelf).dispatchEvent("click");
  const sw = page.getByTestId(TESTIDS.seatPopAutopilot(seat));
  await expect(sw).toBeVisible({ timeout: 10_000 });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on), { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(TESTIDS.seatPop(seat))).toBeHidden({ timeout: 5_000 });
}

test("双端托管:推进,host 中途收回即停(冻结),重开推进恢复(有界断言,#580)", async ({ browser }) => {
  // #580 单节拍 2s/步:整局分钟级,本例**不骑终局**——有界断言:双端开托管 → 等推进 →
  // host 中途收回(按钮复位 + 推进停驻)→ 重开 → 推进恢复。「两端胜者一致」由 bun 层
  // 全 bot/托管局泵送对拍覆盖(test/room-recovery 终态一致用例),不在 UI 层重复。
  test.setTimeout(240_000);
  const [host, guest] = await twoClients(browser);
  try {
    // 两端都开托管:Setup 由托管代选
    await setAutopilot(host, 0, true);
    await setAutopilot(guest, 1, true);
    // 轮询等推进:进 Playing(选都 2 步 ≈ 4s;超时按步数×2s 富余给)
    await expect
      .poll(async () => (await coreState(host).catch(() => null))?.phase ?? "", {
        timeout: 60_000,
        message: "托管代选完 Setup 进 Playing",
      })
      .toBe("Playing");
    // 确信「推进中」而非「恰停」:turnNumber 再前进(每回合数步,2s/步)
    const turnAtPlaying = (await coreState(host)).turnNumber;
    await expect
      .poll(async () => (await coreState(host).catch(() => null))?.turnNumber ?? -1, {
        timeout: 60_000,
        message: "托管推进中(turnNumber 前进)",
      })
      .toBeGreaterThan(turnAtPlaying);
    // 中途收回 host 托管:生效广播回读开关复位(aria-checked=false)
    await setAutopilot(host, 0, false);
    // 停点 = host 的真人决策门(Roll 有自动起摇、AwaitingReaction 有窗计时,均非停点;
    // guest 仍托管,其当前回合收尾后才轮到 host——轮询窗按步数×2s 富余给)
    await expect
      .poll(
        async () => {
          const s = await coreState(host).catch(() => null);
          if (s == null) return "";
          return s.decisionOwner === 0 &&
            s.turnPhase !== "Roll" &&
            s.turnPhase !== "AwaitingReaction"
            ? (s.turnPhase ?? "")
            : "";
        },
        { timeout: 90_000, message: "收回后链在 host 决策点停" },
      )
      .not.toBe("");
    // 冻结断言:停点后 3s 状态零变化且仍在对局(决策门在 host,guest 托管也推不动)
    const frozen = await coreState(host);
    expect(frozen.phase).toBe("Playing");
    await host.waitForTimeout(3_000);
    expect(await coreState(host), "收回后对局冻结(切回即停)").toEqual(frozen);
    // 重开托管 → 推进恢复(turnNumber 再前进;不骑到终局)。停点决策卷轴在挂不碍事:
    // 格 tap 直派穿遮罩,托管接管后已挂决策由托管代发(与旧钮同通路)。
    await setAutopilot(host, 0, true);
    await expect
      .poll(async () => (await coreState(host).catch(() => null))?.turnNumber ?? -1, {
        timeout: 60_000,
        message: "重开托管后推进恢复(turnNumber 前进)",
      })
      .toBeGreaterThan(frozen.turnNumber);
  } finally {
    for (const c of [host, guest]) await c.context().close();
  }
});

test("托管收回:开关复位,轮到自己时行军恢复可用", async ({ browser }) => {
  // #580 单节拍后本例定式保留:guest 开托管(2s/步爬行,对局绝无跑飞之虞),host 开
  // 托管后**立即**收回(仍在 Setup);收回后 host=真人决策门,对局必停在 human-turn。
  test.setTimeout(150_000);
  const [host, guest] = await twoClients(browser);
  try {
    // guest 开托管(对局发动机;单节拍 2s/步,保收回窗口与后继行军观察的从容)
    await setAutopilot(guest, 1, true);
    // host 开托管 → 随即收回(TODO #13:生效广播可迟到——开关点前读态 + 点后生效
    // 轮询把翻转窗口压到一次读取内,旧「补点」结构随旧钮退役;guest 2s/步爬行兜底:
    // 即便生效迟到十余秒,对局也只前进数步)
    await setAutopilot(host, 0, true);
    // 收回(setAutopilot 内已轮询确认开关复位 aria-checked=false)
    await setAutopilot(host, 0, false);
    // L41:收回 = 自己决策,选都也不例外——host 在自己选都前收回,服务器停在 Setup 等
    // host 手选(guest 仍托管,由服务器代选)。轮询体内代 host 点候选城 + 确认。
    // (若收回前 host 的托管恰好已代选完,phase 直达 Playing,循环体一次不进,同样成立。)
    await expect
      .poll(
        async () => {
          const s = (await host
            .evaluate(() => (window as any).__dafung.snapshot())
            .catch(() => null)) as { phase: string; currentSetupPlayerIndex: number } | null;
          if (s == null) return "";
          if (s.phase === "Setup" && s.currentSetupPlayerIndex === 0) {
            await host.locator(".bv-tile.bv-selectable").nth(0).click({ timeout: 10_000 });
            await host.getByTestId("confirm-capital-ok").click({ timeout: 10_000 });
          }
          return s.phase;
        },
        { timeout: 60_000, message: "host 手选都 + guest 托管代选 → 进 Playing" },
      )
      .toBe("Playing");
    // 对局仍在进行:收回后 host 的回合不再被代打,轮到 host 时行军照常自动发生——
    // #188:无 roll-button 可等,改以「host 棋盘位置前进」为证(行军只发生在自己的
    // 回合:锦囊放行 → 服务器 1s 定时起摇 → 棋子前进)。轮询体内先「今不用」放行。
    const posAtRecall = (await host.evaluate(
      () => (window as any).__dafung.snapshot().players[0].position,
    )) as number;
    await expect
      .poll(
        async () => {
          await dismissJinnangIfUp(host);
          const pos = (await host.evaluate(
            () => (window as any).__dafung.snapshot().players[0].position,
          )) as number;
          return pos !== posAtRecall;
        },
        { timeout: 90_000, message: "收回后轮到 host 时自动行军发生(位置前进)" },
      )
      .toBe(true);
  } finally {
    await host.context().close();
    await guest.context().close();
  }
});

// React 重构 · 联机托管 UI 守卫(阶段 11;#1164 棒二改组)。
// 意图来源:旧 online-autopilot.spec(双端托管零输入到终局 / 收回 / 切速)。
// #306:REST 占座契约例已下沉 test/room.test.ts(room.ts 零 WS,bun test 直打)——
// lobbyView 即 /room/new·join 响应体,UI 层不再重复守传输契约;本文件只守托管行为 UI。
// #580 托管归一:单节拍 2s/步(权威节奏不吃 E2E_TIME_SCALE),无速度分档可切;
// 轮询超时一律按「步数×2s」富余给。
// #700/#701 通路改写→#1097 再改写:托管钮(autopilot-button)随仪表条退役后曾迁
// 自机格 tap 单人格弹层,#1096 决议2 起收编设置弹层「托管」开关(settings-autopilot,
// Base UI Switch,态=aria-checked);行为语义=ADR-0028 单一托管开关(接管=自动托管),
// 断言意图原样平移。
// #1164 棒二:原用例一「双端托管:推进,host 中途收回即停(冻结),重开推进恢复」的
// **托管语义逻辑面**已迁 test/protocol-online.test.ts 场景七(落点总表见
// docs/adr/0055-protocol-fault-e2e.md);本文件只留「托管收回」一例,守开关交互通路
// (设置弹层开合/aria-checked 回读/手选都交互/棋子可见行进——交互与可见性,无头层
// 替代不了)。
// 真实段(ADR-0058)(波5b #1218 标注):全 1 例全真零种植——双端真实建房/入座/开局,
// 托管开/收经设置弹层真点击(ADR-0028 引擎公共通路,aria-checked 广播回读),收回后
// host 手选都→真行军(位置前进 poll)即被测环。联机走 testUnscaled(对局节奏由服务
// 器驱动)。零种植。
// #1287 慢池迁移批判词:判留(名册③)——托管语义已沉 protocol-online 场景七;余面=
// 设置弹层开关交互与收回后真行军过网,两腿同链不可拆(开关是行军观察的前提驱动),
// 零缩进项(行注见 docs/reference/e2e-分类表.md 联机行)。
import { testUnscaled as test, expect, type Browser, type Page } from "./fixtures";
import { dismissJinnangIfUp, newBridgeContext } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";
import { LID } from "../src/app/screens/lobby/testids";

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
  await host.getByTestId(LID.target).fill(String(target));
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
    // L41 后开局停在 Setup·PickCapital,卷轴(锦囊相位)要到选都完才可能出现——
    // 此处无 5s 短候可等(#306:白烧 10s/次),只做即时探测;真正的放行在各自用例的
    // 推进环里(托管代发 / 轮询体 dismissJinnangIfUp)。
    await dismissJinnangIfUp(p);
  }
  return [host, guest];
}

/** 开/关本端托管(#1097 通路):开设置弹层 → 拨「托管」开关 → Esc 关层。
 *  设置钮一律 DOM 直派 click(决策卷轴 z-30 全屏遮罩在挂时真点击会被吞,直派照进
 *  真实 React onClick;弹层 z-50 恒在卷轴上,开关真点击可达)。开关态=aria-checked
 *  (useAutopilotOn 广播回读,与引擎 autoPilotOn 同源):点前读态、点后轮询确认生效
 *  ——旧钮「未生效则补点」结构随状态可读而退役,迟到广播不再有双击翻转窗口
 *  (TODO #13 同因)。本端开关只属屏前真人(seat 语义并入「本端」)。 */
async function setAutopilot(page: Page, on: boolean) {
  await page.getByTestId(TESTIDS.settingsButton).dispatchEvent("click");
  const sw = page.getByTestId(TESTIDS.settingsAutopilot);
  await expect(sw).toBeVisible({ timeout: 10_000 });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on), { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(TESTIDS.settingsDialog)).toBeHidden({ timeout: 5_000 });
}

test("托管收回:开关复位,轮到自己时行军恢复可用", { tag: "@slow" }, async ({ browser }) => {
  // 慢池(#1026):联机真链路族——快池门禁 --grep-invert @slow 跳过,慢池批次收口跑。
  // #580 单节拍后本例定式保留:guest 开托管(2s/步爬行,对局绝无跑飞之虞),host 开
  // 托管后**立即**收回(仍在 Setup);收回后 host=真人决策门,对局必停在 human-turn。
  test.setTimeout(150_000);
  const [host, guest] = await twoClients(browser);
  try {
    // guest 开托管(对局发动机;单节拍 2s/步,保收回窗口与后继行军观察的从容)
    await setAutopilot(guest, true);
    // host 开托管 → 随即收回(TODO #13:生效广播可迟到——开关点前读态 + 点后生效
    // 轮询把翻转窗口压到一次读取内,旧「补点」结构随旧钮退役;guest 2s/步爬行兜底:
    // 即便生效迟到十余秒,对局也只前进数步)
    await setAutopilot(host, true);
    // 收回(setAutopilot 内已轮询确认开关复位 aria-checked=false)
    await setAutopilot(host, false);
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
            await host.getByTestId(TESTIDS.confirmCapitalOk).click({ timeout: 10_000 });
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

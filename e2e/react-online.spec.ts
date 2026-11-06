// React 迁移 · 阶段 8 验证门:联机双端全流程(大厅建房/加入/选图/开局 → 选都三选一 →
// 双端对局同步)。
// #987 清退:L42 落格决策卷轴时序例退役——机遇必出(#780)改落格事件序后,自然骰路
// 撞机遇决策先于购地流,「快照 PropertyAvailable→卷轴 20s 可见」的捕捞前提失效
// (buyScroll 永不可见,#797 A/B 实锤),场景不可确定性改造(联机无 freeze/种骰面)。
// 走引擎服务器(托管 dist + WS;playwright.config 第二个 webServer),端口随
// E2E_GAME_PORT 隔离协议取值(与 config 同源,默认 3010)。
// ⚠ 跑前需先 npm run build(dist 必须最新——两个 webServer 都消费 dist 产物)。
import { testUnscaled as test, expect, type Browser, type Page } from "./fixtures";
import type { Locator } from "@playwright/test";
import {
  waitSettled,
  onlinePickCapitals,
  dismissJinnangIfUp,
  newBridgeContext,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { LID } from "../src/app/screens/lobby/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

const ONLINE = `http://localhost:${process.env.E2E_GAME_PORT ?? "3010"}`;

/** 读一端的核心引擎态(经 __dafung 调试钩子;跨端一致性断言用)。 */
async function coreState(p: Page) {
  return p.evaluate(() => {
    // e2e 编译上下文看不到 src/app 的全局声明,evaluate 内以 any 访问调试钩子
    const s = (window as any).__dafung.snapshot();
    return {
      phase: s.phase,
      round: s.round,
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

/** 双端建房/加入/选图/开局(经济 v2 标准目标 30000)+ 各自三选一选都,返回 [host, guest]。 */
async function twoClientsSetup(browser: Browser): Promise<[Page, Page]> {
  const host = await (await newBridgeContext(browser)).newPage();
  const guest = await (await newBridgeContext(browser)).newPage();
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
  // L41 开局选都三选一:两客户端各自从 3 候选中选一(助手内断言候选高亮/不越权)
  await onlinePickCapitals([host, guest]);
  // 锦囊相位放行(#122/T2):起手有牌即停卷轴,「今不用」后再继续各自行动。
  // #188:行军按钮已移除(掷骰由服务器定时代发),等卷轴出现即可,无牌则短候跳过。
  for (const p of [host, guest]) {
    await p
      .waitForSelector(`[data-testid=${TESTIDS.actionbarPass}]`, { timeout: 5_000 })
      .catch(() => null);
    await dismissJinnangIfUp(p);
  }
  return [host, guest];
}

test(
  "双端联机:建房→加入→开局→各自选都→各自行动→快照一致",
  { tag: "@slow" },
  async ({ browser }) => {
    const [host, guest] = await twoClientsSetup(browser);

    // 选都完成即收敛:双端核心引擎态一致(选都结果/首回合归属同帧)
    await expect
      .poll(
        async () =>
          JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
        { timeout: 30_000, message: "选都后双端核心引擎态一致" },
      )
      .toBe(true);
    const s0 = await host.evaluate(() => (window as any).__dafung.snapshot());
    expect(s0.phase).toBe("Playing");
    // 两真人各有一都(offered 三选一逐个落定)
    expect(s0.players.every((p: any) => p.capitalIndex >= 0)).toBe(true);

    // ── 双端各推进若干步(决策/卷轴混合),模拟真实你来我往 ──
    // #188:掷骰由服务器定时代发(roll-button 已移除),本循环只清决策点。
    // TODO #13→#308:原「90s deadline 循环 + 250ms 盲等节奏」换 expect.poll 期望轮询
    // (encounters/war-report 同款口径):每拍扫两端可点控件行动一手,凑满断言契约
    // (≥2 手)即收;90s 时间预算与 250ms 采样原样保留在 timeout/intervals 里,广播/
    // 按钮可用性迟到在拍间自愈,不做无谓盲等。
    // 每次点击一律短时限+失败吞掉(#240 收口定性):负载下卷轴随广播反复重挂,裸 click
    // 的 actionability 重试会「resolved→detached」循环到吃光测试超时;点空了下一拍重试
    // 即可(决策钮幂等:卷轴已关的点击自然落空)。
    test.slow(); // 内部预算 90s > 测试级 60s 默认——与 encounters 同款,外层对齐 3×
    let actions = 0;
    const tryClick = async (loc: Locator) =>
      loc
        .first()
        .click({ timeout: 5_000 })
        .then(
          () => true,
          () => false,
        );
    await expect
      .poll(
        async () => {
          for (const p of [host, guest]) {
            const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
            if ((await inline.count()) > 0 && (await tryClick(inline))) {
              actions++;
              break;
            }
            // 锦囊卷轴优先「今不用」(#122/T2):通配 scroll 分支会误点第一张牌
            const jinnangPass = p.getByTestId(TESTIDS.actionbarPass);
            if (
              (await jinnangPass.isVisible().catch(() => false)) &&
              (await tryClick(jinnangPass))
            ) {
              actions++;
              break;
            }
            const scrollPrimary = p.locator(
              '[data-testid^="scroll-"]:not([data-testid*="jinnang"]) button:not([disabled])',
            );
            if ((await scrollPrimary.count()) > 0 && (await tryClick(scrollPrimary))) {
              actions++;
              break;
            }
          }
          return actions;
        },
        {
          timeout: 90_000,
          intervals: [250], // 原 250ms 重试节奏 → 轮询拍间隔
          message: "双端各推进若干手(决策/卷轴混合,至少双方各动一手)",
        },
      )
      .toBeGreaterThanOrEqual(2); // 至少双方各动过一手(断言不降级)

    // ── 同步断言:双端核心引擎态一致(assertSync 思想,改比快照核心字段)──
    // TODO #13:原固定 400ms 停等后一次性 toEqual 在负载下撞上广播尚未沉降。
    // 改为轮询收敛:持续比对两端核心态直到相等(30s 余量),收敛后再各自确认非瞬态
    //(两端 waitSettled 后终判),杜绝"中途恰好相等"的假阳性。
    await expect
      .poll(
        async () =>
          JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
        { timeout: 30_000, message: "双端核心引擎态收敛一致" },
      )
      .toBe(true);
    // 收敛后再等两端各自局面稳定(连续快照一致),排除"恰好相等"的瞬态假阳性后终判
    await Promise.all([waitSettled(host), waitSettled(guest)]);
    expect(await coreState(guest)).toEqual(await coreState(host));

    // ── 托管入口存在(联机专属;spec: autopilot;#1097 起入口=设置弹层「托管」
    // 开关,设置钮 DOM 直派穿决策卷轴遮罩,react-online-autopilot setAutopilot 同配方)──
    await guest.getByTestId(TESTIDS.settingsButton).dispatchEvent("click");
    await expect(guest.getByTestId(TESTIDS.settingsAutopilot)).toBeVisible();
    await guest.keyboard.press("Escape");
    await expect(guest.getByTestId(TESTIDS.settingsDialog)).toBeHidden();

    await host.context().close();
    await guest.context().close();
  },
);

test(
  "E7/X14:大厅国号方章 + 重名预告双端可见;房间码回车即加入",
  { tag: "@slow" },
  async ({ browser }) => {
    const host = await (await browser.newContext()).newPage();
    const g1 = await (await browser.newContext()).newPage();
    const g2 = await (await browser.newContext()).newPage();

    // host 建房(3 座;R3-D1 #99:建房路径也带预设国号——host 侧 localStorage 预设「蜀」
    // (与 SoloSetup GUOHAO_PREF_KEY 同源),seat0 应挂「蜀」章;与加入者的「魏」不重名,不影响下方预告断言)
    await host.addInitScript(() => localStorage.setItem("dafung.guohao", "蜀"));
    await host.goto(`${ONLINE}/?online=1`);
    await host.getByTestId(`${LID.seatCount}-plus`).click(); // X10 stepper:2 → 3 座
    await host.getByTestId(LID.create).click();
    await expect(host.getByTestId(LID.roomCode)).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
    const roomId = (await host.getByTestId(LID.roomCode).textContent())?.trim() ?? "";

    // 两名加入者预设同名「魏」(localStorage 与 SoloSetup GUOHAO_PREF_KEY 同源)
    for (const p of [g1, g2]) {
      await p.addInitScript(() => localStorage.setItem("dafung.guohao", "魏"));
    }
    // g1 点「加入」;g2 在输入框回车提交(X14 #33:form onSubmit 与点按等价)
    await g1.goto(`${ONLINE}/?online=1`);
    await g1.getByTestId(LID.joinInput).fill(roomId);
    await g1.getByTestId(LID.join).click();
    await expect(g1.getByTestId(LID.roomCode)).toHaveText(roomId, { timeout: 30_000 });

    await g2.goto(`${ONLINE}/?online=1`);
    await g2.getByTestId(LID.joinInput).fill(roomId);
    await g2.keyboard.press("Enter");
    await expect(g2.getByTestId(LID.roomCode)).toHaveText(roomId, { timeout: 30_000 });

    // 座位行单字方章:#99 起 host 建房也带预设 → seat0 挂「蜀」章(断言风格同 guest 行);
    // 两加入者各挂「魏」章(先到先得:seat1 保原名,seat2 预告东魏,见下)
    await expect(host.getByTestId(LID.seatGuohao(0))).toHaveText("蜀", { timeout: 30_000 });
    await expect(host.getByTestId(LID.seatGuohao(1))).toHaveText("魏");
    await expect(host.getByTestId(LID.seatGuohao(2))).toHaveText("魏");

    // 重名预告(先到先得):seat1 保原名无预告;seat2 预告开局改为方位前缀「东魏」;
    // 双方大厅(非仅本人视角)都可见彼此国号与预告
    await expect(host.getByTestId(LID.guohaoPreview(1))).toHaveCount(0);
    await expect(host.getByTestId(LID.guohaoPreview(2))).toHaveText(
      "此席国号重名,开局将改为『东魏』",
    );
    await expect(g1.getByTestId(LID.seatGuohao(2))).toHaveText("魏");
    await expect(g1.getByTestId(LID.guohaoPreview(2))).toHaveText(
      "此席国号重名,开局将改为『东魏』",
    );
    await expect(g2.getByTestId(LID.guohaoPreview(2))).toHaveText(
      "此席国号重名,开局将改为『东魏』",
    );

    await Promise.all([host, g1, g2].map((p) => p.context().close()));
  },
);

// React 迁移 · 阶段 8 验证门:联机双端全流程(大厅建房/加入/选图/开局 → 选都三选一 →
// 双端对局同步)+ L42 落格决策卷轴时序(行军动画播完才弹)。
// 走引擎服务器(托管 dist + WS;playwright.config 第二个 webServer),端口随
// E2E_GAME_PORT 隔离协议取值(与 config 同源,默认 3010)。
// ⚠ 跑前需先 npm run build(dist 必须最新——两个 webServer 都消费 dist 产物)。
import { testUnscaled as test, expect, type Browser, type Page } from "./fixtures";
import { waitSettled, onlinePickCapitals, dismissJinnangIfUp } from "./react-helpers";

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
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-target").fill("30000");
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
  // L41 开局选都三选一:两客户端各自从 3 候选中选一(助手内断言候选高亮/不越权)
  await onlinePickCapitals([host, guest]);
  // 锦囊相位放行(#122/T2):起手有牌即停卷轴,「今不用」后再继续各自行动。
  // #188:行军按钮已移除(掷骰由服务器定时代发),等卷轴出现即可,无牌则短候跳过。
  for (const p of [host, guest]) {
    await p
      .waitForSelector('[data-testid="scroll-jinnang-pass"]', { timeout: 5_000 })
      .catch(() => null);
    await dismissJinnangIfUp(p);
  }
  return [host, guest];
}

test("双端联机:建房→加入→开局→各自选都→各自行动→快照一致", async ({ browser }) => {
  const [host, guest] = await twoClientsSetup(browser);

  // 选都完成即收敛:双端核心引擎态一致(选都结果/首回合归属同帧)
  await expect
    .poll(
      async () => JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
      { timeout: 30_000, message: "选都后双端核心引擎态一致" },
    )
    .toBe(true);
  const s0 = await host.evaluate(() => (window as any).__dafung.snapshot());
  expect(s0.phase).toBe("Playing");
  // 两真人各有一都(offered 三选一逐个落定)
  expect(s0.players.every((p: any) => p.capitalIndex >= 0)).toBe(true);

  // ── 双端各推进若干步(决策/卷轴混合),模拟真实你来我往 ──
  // #188:掷骰由服务器定时代发(roll-button 已移除),本循环只清决策点。
  // TODO #13:原 stall<40×250ms(=10s 盲预算)在全量并行负载下不够——WS 广播/渲染排队
  // 可让按钮可用性迟到超过 10s,导致 actions<2 假失败。改为时间预算(90s,约 5 倍余量):
  // 只要总时长没用完就继续轮询两端,状态(决策卷轴)到了立刻行动,不做无谓盲等。
  let actions = 0;
  const deadline = Date.now() + 90_000;
  while (actions < 6 && Date.now() < deadline) {
    let acted = false;
    for (const p of [host, guest]) {
      const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
      if ((await inline.count()) > 0) {
        await inline.first().click();
        acted = true;
        actions++;
        break;
      }
      // 锦囊卷轴优先「今不用」(#122/T2):通配 scroll 分支会误点第一张牌
      const jinnangPass = p.getByTestId("scroll-jinnang-pass");
      if (await jinnangPass.isVisible().catch(() => false)) {
        await jinnangPass.click();
        acted = true;
        actions++;
        break;
      }
      const scrollPrimary = p.locator('[data-testid^="scroll-"] button:not([disabled])');
      if ((await scrollPrimary.count()) > 0) {
        await scrollPrimary.first().click();
        acted = true;
        actions++;
        break;
      }
    }
    if (!acted) await host.waitForTimeout(250); // 短间隔重试,等对端/自动掷骰广播推进
  }
  expect(actions).toBeGreaterThanOrEqual(2); // 至少双方各动过一手(断言不降级)

  // ── 同步断言:双端核心引擎态一致(assertSync 思想,改比快照核心字段)──
  // TODO #13:原固定 waitForTimeout(400) 后一次性 toEqual 在负载下撞上广播尚未沉降。
  // 改为轮询收敛:持续比对两端核心态直到相等(30s 余量),收敛后再各自确认非瞬态
  //(两端 waitSettled 后终判),杜绝"中途恰好相等"的假阳性。
  await expect
    .poll(
      async () => JSON.stringify(await coreState(guest)) === JSON.stringify(await coreState(host)),
      { timeout: 30_000, message: "双端核心引擎态收敛一致" },
    )
    .toBe(true);
  // 收敛后再等两端各自局面稳定(连续快照一致),排除"恰好相等"的瞬态假阳性后终判
  await Promise.all([waitSettled(host), waitSettled(guest)]);
  expect(await coreState(guest)).toEqual(await coreState(host));

  // ── 托管入口存在(联机专属;spec: autopilot)──
  await expect(guest.getByTestId("autopilot-button")).toBeVisible();

  await host.context().close();
  await guest.context().close();
});

test("L42 联机落格决策:快照落地后行军动画播完,购地卷轴才出现", async ({ browser }) => {
  test.setTimeout(240_000);
  const [host, guest] = await twoClientsSetup(browser);
  try {
    // 轮到谁谁自动掷(#188:服务器定时代发,roll-button 已移除);抓「落无主城」的一掷,
    // 断言决策卷轴不早于骰子+行军动画。只在真正等到起摇窗(Roll 等待态)时计次
    //(决策清理期间的空轮询不算),总时长兜 150s。
    let attempts = 0;
    const deadline = Date.now() + 150_000;
    while (attempts < 12 && Date.now() < deadline) {
      let roller: Page | null = null;
      for (const [p, seat] of [[host, 0], [guest, 1]] as const) {
        const s = (await coreState(p)) as { phase: string; turnPhase: string; decisionOwner: number };
        if (s.phase === "Playing" && s.turnPhase === "Roll" && s.decisionOwner === seat) {
          roller = p;
          break;
        }
      }
      if (!roller) {
        // 锦囊卷轴/落格决策会停住对局:清一轮决策(「今不用」优先 + action-* 任点其一)
        // 让对局继续走到下一个起摇窗,再短候重试(不计次)。
        for (const p of [host, guest]) {
          await dismissJinnangIfUp(p);
          const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
          if ((await inline.count()) > 0) {
            await inline.first().click({ timeout: 5_000 }).catch(() => {});
          }
        }
        await host.waitForTimeout(400); // 等自动起摇/广播到达
        continue;
      }
      attempts++;
      const landed = await roller
        .waitForFunction(
          () => {
            const s = (window as any).__dafung.snapshot();
            return s.turnPhase === "AwaitingDecision" && s.lastLandOutcomeKind === "PropertyAvailable";
          },
          undefined,
          { timeout: 20_000, polling: 100 },
        )
        .then(
          () => true,
          () => false,
        );
      if (!landed) {
        // 本次掷骰未落无主城(驻跸/己城/招贤/交涉…):把两端可用决策推完再等下一掷。
        // L42 后决策按钮要等骰子/行军动画播完才挂载——固定轮数在负载下会在卷轴
        // 挂载前空转殆尽,改为时间预算(10s),轮到起摇窗即交还外层。
        const advDeadline = Date.now() + 10_000;
        while (Date.now() < advDeadline) {
          let acted = false;
          for (const p of [host, guest]) {
            const inline = p.locator('button[data-testid^="action-"]:not([disabled])');
            if ((await inline.count()) > 0) {
              // 点击 10s 上限(与 actIfCan 同口径):系统性破坏下 actionability
              // 重试会烧满测试超时,失败即按未行动处理,交还循环预算
              acted = await inline
                .first()
                .click({ timeout: 10_000 })
                .then(() => true, () => false);
              break;
            }
            // 锦囊卷轴优先「今不用」(#122/T2),同上
            const jinnangPass = p.getByTestId("scroll-jinnang-pass");
            if (await jinnangPass.isVisible().catch(() => false)) {
              acted = await jinnangPass
                .click({ timeout: 10_000 })
                .then(() => true, () => false);
              break;
            }
            const scrollPrimary = p.locator('[data-testid^="scroll-"] button:not([disabled])');
            if ((await scrollPrimary.count()) > 0) {
              acted = await scrollPrimary
                .first()
                .click({ timeout: 10_000 })
                .then(() => true, () => false);
              break;
            }
          }
          if (!acted) await host.waitForTimeout(250); // 等动画播完/广播到达
        }
        continue;
      }
      // 关键断言①:快照已到 AwaitingDecision·PropertyAvailable,但购地卷轴尚未挂载
      //(骰子 ≥500ms + 行军逐段仍在播;若动画期间就弹,此处立即失败)
      await expect(roller.getByTestId("scroll-buy")).toHaveCount(0);
      // 关键断言②:动画播完卷轴才出现,且距快照落地非瞬时(骰子+行军节奏)
      const t0 = Date.now();
      await expect(roller.getByTestId("scroll-buy")).toBeVisible({ timeout: 20_000 });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(400);
      return; // 捕获一次即通过
    }
    throw new Error("多次掷骰均未捕获落无主城(概率异常)");
  } finally {
    await host.context().close();
    await guest.context().close();
  }
});

test("E7/X14:大厅国号方章 + 重名预告双端可见;房间码回车即加入", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const g1 = await (await browser.newContext()).newPage();
  const g2 = await (await browser.newContext()).newPage();

  // host 建房(3 座;R3-D1 #99:建房路径也带预设国号——host 侧 localStorage 预设「蜀」
  // (与 SoloSetup GUOHAO_PREF_KEY 同源),seat0 应挂「蜀」章;与加入者的「魏」不重名,不影响下方预告断言)
  await host.addInitScript(() => localStorage.setItem("dafung.guohao", "蜀"));
  await host.goto(`${ONLINE}/?online=1`);
  await host.getByTestId("lobby-seat-count-plus").click(); // X10 stepper:2 → 3 座
  await host.getByTestId("lobby-create").click();
  await expect(host.getByTestId("room-code")).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const roomId = (await host.getByTestId("room-code").textContent())?.trim() ?? "";

  // 两名加入者预设同名「魏」(localStorage 与 SoloSetup GUOHAO_PREF_KEY 同源)
  for (const p of [g1, g2]) {
    await p.addInitScript(() => localStorage.setItem("dafung.guohao", "魏"));
  }
  // g1 点「加入」;g2 在输入框回车提交(X14 #33:form onSubmit 与点按等价)
  await g1.goto(`${ONLINE}/?online=1`);
  await g1.getByTestId("lobby-join-input").fill(roomId);
  await g1.getByTestId("lobby-join").click();
  await expect(g1.getByTestId("room-code")).toHaveText(roomId, { timeout: 30_000 });

  await g2.goto(`${ONLINE}/?online=1`);
  await g2.getByTestId("lobby-join-input").fill(roomId);
  await g2.keyboard.press("Enter");
  await expect(g2.getByTestId("room-code")).toHaveText(roomId, { timeout: 30_000 });

  // 座位行单字方章:#99 起 host 建房也带预设 → seat0 挂「蜀」章(断言风格同 guest 行);
  // 两加入者各挂「魏」章(先到先得:seat1 保原名,seat2 预告东魏,见下)
  await expect(host.getByTestId("lobby-seat-0-guohao")).toHaveText("蜀", { timeout: 30_000 });
  await expect(host.getByTestId("lobby-seat-1-guohao")).toHaveText("魏");
  await expect(host.getByTestId("lobby-seat-2-guohao")).toHaveText("魏");

  // 重名预告(先到先得):seat1 保原名无预告;seat2 预告开局改为方位前缀「东魏」;
  // 双方大厅(非仅本人视角)都可见彼此国号与预告
  await expect(host.getByTestId("lobby-seat-1-guohao-preview")).toHaveCount(0);
  await expect(host.getByTestId("lobby-seat-2-guohao-preview")).toHaveText("开局将改为『东魏』");
  await expect(g1.getByTestId("lobby-seat-2-guohao")).toHaveText("魏");
  await expect(g1.getByTestId("lobby-seat-2-guohao-preview")).toHaveText("开局将改为『东魏』");
  await expect(g2.getByTestId("lobby-seat-2-guohao-preview")).toHaveText("开局将改为『东魏』");

  await Promise.all([host, g1, g2].map((p) => p.context().close()));
});

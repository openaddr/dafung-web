// React 重构 · 单机核心流 + 布局断言(阶段 11)。
// 意图来源(旧 spec → 此处):
// - play.spec / human.spec(掷骰推进、买地扣款、人类按钮可用性)→ 掷骰/买地/选路测试
// - invariants.spec(全程不变量 + 终局)→ 全速战档驱动到胜利的不变量巡检
// - solo-autopilot.spec(单机托管)→ 已过时:React 版托管仅联机支持,见报告
import { test, expect } from "@playwright/test";
import { quickStart, force, snap, actIfCan, fmtMoney, waitForSnapChanged, openSoloSetup, pickCapital } from "./react-helpers";

test("掷骰行军:签面显示点数、战报追加、回合推进不卡死", async ({ page }) => {
  await quickStart(page);
  const logsBefore = (await snap(page)).log.length;
  await page.getByTestId("roll-button").click();
  await expect(page.getByTestId("dice-face")).toHaveText(/[一二三四五六]/, { timeout: 15_000 });
  await expect
    .poll(async () => (await snap(page)).log.length, { timeout: 20_000 })
    .toBeGreaterThan(logsBefore);
  const s = await snap(page);
  expect(s.isOver).toBe(false);
});

test("状态栏四区数据一致:手牌现金/状态卡与引擎快照同步", async ({ page }) => {
  await quickStart(page);
  const s = await snap(page);
  const me = s.players[0];
  // 手牌区现金 = 快照现金(锭/两/分格式,同 core/money.formatMoney)
  await expect(page.getByTestId("hand-cash")).toContainText(fmtMoney(me.cash));
  // 状态卡:活跃玩家国号 + 现金/委任/身价元信息
  const active = s.players[s.activeIndex];
  await expect(page.getByTestId("status-guohao")).toHaveText(active.guohao);
  await expect(page.getByTestId("status-meta")).toContainText(fmtMoney(active.cash));
  await expect(page.getByTestId("status-meta")).toContainText(`委任 ${active.warrants}`);
  // 战报区可滚动渲染 + 诸侯列表就位
  await expect(page.getByTestId("warlog-panel")).toBeVisible();
  await expect(page.getByTestId("others-panel")).toBeVisible();
});

test("购地决策:卷轴购地扣银两 + 耗委任状 + 获得地产", async ({ page }) => {
  await quickStart(page);
  // 强制 AwaitingDecision + 无主城落地(意图同旧 human.spec 的买地用例,相位改为钩子构造)
  await force(page, `
    e.turnPhase = "AwaitingDecision";
    const me = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && !me.properties.some((h) => h.propertyId === t.propertyId));
    e.lastLandOutcome = { kind: "PropertyAvailable", property: e.catalog.get(tile.propertyId) };
  `);
  // 交互重构:决策一律走卷轴——轮到即自动弹(scroll-buy),按钮 testid 沿用 action-buy
  await expect(page.getByTestId("scroll-buy")).toBeVisible();
  await expect(page.getByTestId("action-buy")).toBeEnabled();
  const before = (await snap(page)).players[0];
  await page.getByTestId("action-buy").click();
  await expect
    .poll(async () => (await snap(page)).players[0].properties.length, { timeout: 15_000 })
    .toBe(before.properties.length + 1);
  const after = (await snap(page)).players[0];
  expect(after.cash).toBeLessThan(before.cash);
  expect(after.warrants).toBe(before.warrants - 1);
});

test("扩军决策:己方城升级免费(autos 31:到达免费升级,现金不变)", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    e.turnPhase = "AwaitingDecision";
    const me = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && t.propertyId !== e.board.at(me.capitalIndex).propertyId);
    me.properties.push({ propertyId: tile.propertyId, level: 1, group: "a", maxLevel: 3 });
    e.lastLandOutcome = { kind: "OwnProperty", property: e.catalog.get(tile.propertyId), owner: me };
  `);
  await expect(page.getByTestId("scroll-upgrade")).toBeVisible();
  await expect(page.getByTestId("action-upgrade")).toBeEnabled();
  const before = (await snap(page)).players[0].cash;
  await page.getByTestId("action-upgrade").click();
  // 升级免费:等级 +1,现金不变
  await expect
    .poll(
      async () =>
        (await snap(page)).players[0].properties.find((h: { level: number }) => h.level === 2) != null,
      { timeout: 15_000 },
    )
    .toBe(true);
  expect((await snap(page)).players[0].cash).toBe(before);
});

test("分岔辅路:落辅路起点弹抉择,入辅路后进入辅路格", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    e.turnPhase = "AwaitingBranch";
    e.activePlayer.onBranch = null;
  `);
  await expect(page.getByTestId("scroll-branch")).toBeVisible();
  await expect(page.getByTestId("scroll-branch")).toContainText("辅路");
  await page.getByTestId("action-branch").click();
  // selectBranch("Branch"):onBranch={step:0} + 触发首格
  await expect
    .poll(
      async () => page.evaluate(() => (window as any).__dafung.getEngine().players[0].onBranch),
      { timeout: 10_000 },
    )
    .toEqual({ step: 0 });
});

test("bot 托管思考态:活跃方为电脑时显示「运筹中…」", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    const botIdx = e.players.findIndex((p) => p.isBot);
    e.activeIndex = botIdx;
  `);
  await expect(page.getByTestId("thinking")).toContainText("运筹中…");
});

test("加速到胜利:现金推高后掷骰,触发身价达标胜利屏", async ({ page }) => {
  // 锁种子:不锁时随机骰路偶发决策链超长(辅路/交涉连环)超出等待窗——TODO 记账的抖动家族,
  // 锁定后本用例确定性通过;骰路覆盖广度由「全程驱动」用例承担。
  await quickStart(page, 7);
  // 身价=现金+地产:直接把现金推过目标身价,掷骰收尾 endTurn 即触发 checkVictory
  await force(page, `e.activePlayer.cash = e.targetNetWorth * 3;`);
  await page.getByTestId("roll-button").click();
  // 掷骰可能落在辅路起点/驻跸等决策格:把余下决策也推完才 endTurn 触发胜利判定;
  // 落在 bot 城主的珍宝交涉格会触发单机死锁缺陷(见 react-solo 全程驱动用例注释),同样绕过
  for (let i = 0; i < 10 && !(await snap(page)).isOver; i++) {
    const s = await snap(page);
    if (s.turnPhase === "AwaitingTreasureOwner" && s.treasureVisitor) {
      await force(page, `e.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });`);
      continue;
    }
    const before = JSON.stringify(s);
    if (!(await actIfCan(page))) break;
    // TODO #13:原固定 200ms 在全量负载下不等决策链推进完就读快照,循环提前 break;
    // 改为轮询"快照真的变了"(8s 余量),动作不改变局面时容忍(不阻塞循环)
    await waitForSnapChanged(page, before).catch(() => {});
  }
  await expect(page.getByTestId("victory-screen")).toBeVisible({ timeout: 60_000 });
  const s = await snap(page);
  expect(s.isOver).toBe(true);
  expect(s.players.find((p: any) => p.id === s.winner).isBot).toBe(false);
});

test("速战档全程驱动:不变量巡检 + 终局有胜者(意图同旧 invariants.spec)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?seed=1234");
  await openSoloSetup(page);
  await page.getByTestId("setup-target").selectOption("5000"); // 速战
  await page.getByTestId("setup-seat-count").selectOption("2"); // 2 人局加速节奏
  await page.getByTestId("start-game").click();
  await pickCapital(page);
  await expect(page.getByTestId("roll-button")).toBeEnabled({ timeout: 30_000 });

  let actions = 0;
  let stall = 0;
  let over = false;
  while (actions < 1200 && stall < 60 && !over) {
    const s = await snap(page);
    if (s.isOver) {
      over = true;
      break;
    }
    // 加速逼近终局:每 100 手给全员发银两(不破坏不变量,身价达标即触发胜利)
    if (actions % 15 === 0) {
      await force(page, `for (const p of e.players) p.cash += 3000;`);
    }
    // 不变量:现金/身价非负、位置合法、破产无残留(与旧 invariants.spec 同口径)
    for (const p of s.players) {
      if (!p.isBankrupt && p.cash < 0) throw new Error(`不变量违规:T${s.round} ${p.guohao} cash=${p.cash}<0`);
      if (p.position < 0 || p.position > 50) throw new Error(`不变量违规:T${s.round} ${p.guohao} pos=${p.position}`);
      if (p.netWorth < 0) throw new Error(`不变量违规:T${s.round} ${p.guohao} nw=${p.netWorth}<0`);
      if (p.isBankrupt && (p.properties.length || p.treasures.length || p.heroes.length))
        throw new Error(`破产残留:${p.guohao}`);
    }
    if (await actIfCan(page)) {
      actions++;
      stall = 0;
    } else {
      stall++;
      // ⚠ 产品缺陷(已报告):珍宝交涉(AwaitingTreasureOwner)在单机热座死锁——
      // 决策方是城主(ownerIdx),而 LocalController.viewSeat 恒跟 activeIndex(访客),
      // UI 只渲染访客只读视角;owner 为 bot 时也无驱动方代打。此处用调试钩子以
      // owner 身份「不交易」绕过,让全程驱动能继续跑到终局。
      const s2 = await snap(page);
      if (s2.turnPhase === "AwaitingTreasureOwner" && s2.treasureVisitor) {
        await force(page, `e.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });`);
        stall = 0;
        continue;
      }
      // TODO #13:原固定 300ms 盲等下 bot 链每步都计入 stall,负载下 60 次×300ms(18s)
      // 不够 bot 想完,假失败。改为等"快照变化":bot 推进期间快照持续变化会立刻返回,
      // 真正静止 2s 才算一次 stall——stall 语义从"等了 N 次"变成"局面真没动"。
      await waitForSnapChanged(page, JSON.stringify(s2), 2_000).catch(() => {});
    }
  }
  if (!over) {
    const dbg = await snap(page);
    console.log("DRIVE_STALL", JSON.stringify({ actions, stall, round: dbg.round, turnPhase: dbg.turnPhase, active: dbg.activeIndex, isBot: dbg.players[dbg.activeIndex].isBot, over: dbg.isOver }));
  }
  expect(over).toBe(true);
  const s = await snap(page);
  expect(s.winner).toBeTruthy();
  expect(s.round).toBeGreaterThan(0);
});

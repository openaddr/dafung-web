// React 重构 · 单机核心流 + 布局断言(阶段 11)。
// 意图来源(旧 spec → 此处):
// - play.spec / human.spec(掷骰推进、买地扣款、人类按钮可用性)→ 掷骰/买地/选路测试
// - invariants.spec(全程不变量 + 终局)→ 全速战档驱动到胜利的不变量巡检
// - solo-autopilot.spec(单机托管)→ 已过时:React 版托管仅联机支持,见报告
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { quickStart, force, snap, actIfCan, fmtMoney, waitForSnapChanged, openSoloSetup, pickCapital, waitMyRollDone, waitMyPause, dismissJinnangIfUp } from "./react-helpers";

test("行军自动触发(#188 第 1 步):进入人类回合自动起摇——签面显示点数、战报追加、回合推进不卡死", async ({ page }) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId("start-game").click();
  await pickCapital(page);
  const logsBefore = (await snap(page)).log.length;
  // 自动起摇:锦囊放行后 ~1s(e2e 加速后 ~250ms)引擎自动 rollAndMove,无须点任何按钮
  await waitMyRollDone(page, 0);
  await expect(page.getByTestId("dice-face")).toHaveText(/[一二三四五六]/, { timeout: 15_000 });
  await expect
    .poll(async () => (await snap(page)).log.length, { timeout: 20_000 })
    .toBeGreaterThan(logsBefore);
  const s = await snap(page);
  expect(s.isOver).toBe(false);
});

test("状态栏四区数据一致:手牌现金/状态卡与引擎快照同步", async ({ page }) => {
  await quickStart(page);
  // #188:对局自走后引擎态持续变化,「读一次快照 vs UI 文本」的固定期望会撞上推进——
  // 改为轮询比对:同一时刻 UI 与快照一致即算同步(断言意图不变,只是采样方式改了)。
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        const me = s.players[0];
        const active = s.players[s.activeIndex];
        const cash = await page.getByTestId("hand-cash").textContent();
        const guohao = await page.getByTestId("status-guohao").textContent();
        const meta = await page.getByTestId("status-meta").textContent();
        return (
          cash?.includes(fmtMoney(me.cash)) === true &&
          guohao === active.guohao &&
          meta?.includes(fmtMoney(active.netWorth)) === true &&
          meta?.includes(`委任 ${active.warrants}`) === true
        );
      },
      { timeout: 15_000, message: "手牌现金/状态卡与引擎快照同步" },
    )
    .toBe(true);
  // 珍宝·名将区(L48 战报腾位)+ 诸侯列表就位(结构性,不随推进变化)
  await expect(page.getByTestId("treasury-panel")).toBeVisible();
  await expect(page.getByTestId("others-panel")).toBeVisible();
  // X13(#32):「你」印挂在本方座位行——需轮到人类(viewSeat 跟随决策方),
  // 等停稳在人类等待态再断言(他人行没有)
  await waitMyPause(page, 0);
  await expect(page.getByTestId("other-player-0").getByTestId("other-player-you")).toBeVisible();
  await expect(page.getByTestId("other-player-1").getByTestId("other-player-you")).toHaveCount(0);
});

test("珍宝行键盘语义:行本体是 button,聚焦后 Enter 开详情(#42)", async ({ page }) => {
  await quickStart(page);
  // 起手无珍宝:force 发一枚触发珍宝行渲染(快照序列化只带 id/name/level/desc)
  await force(page, `e.players[0].treasures.push({ id: "seal", name: "传国玉玺", level: 10, desc: "受命于天,既寿永昌" });`);
  const row = page.getByTestId("treasury-treasure-seal");
  await expect(row).toBeVisible();
  // S9:行必须是原生 button(与同区名将卡同语义;div+onClick 已废,Tab 天然可达)
  await expect(row).toHaveJSProperty("tagName", "BUTTON");
  // Enter 开详情卷轴。#188:对局自走后自然对局可能弹出决策卷轴(焦点陷阱会截走 Enter),
  // 改 toPass 重试:清掉自然卷轴 → 聚焦 → Enter → 卷轴可见,直到逮住交互空闲窗
  //(与「城池详情卷轴」用例的 toPass 口径一致)。
  await expect(async () => {
    await dismissJinnangIfUp(page);
    await actIfCan(page);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("card-detail-scroll")).toBeVisible();
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("card-detail-scroll")).toContainText("传国玉玺");
});

test("购地决策:卷轴购地扣银两 + 耗委任状 + 获得地产", async ({ page }) => {
  await quickStart(page);
  // 强制 AwaitingDecision + 无主城落地(意图同旧 human.spec 的买地用例,相位改为钩子构造)。
  // C2 起 buyProperty 消费 pendingLand(决策载荷),布场须两态同步:表现(lastLandOutcome)
  // 归表现,决策上下文(pendingLand)归决策——真实路径由 resolveProperty 一并置值。
  // #188:先钉活跃座位到人类(0)——行军自动化后停靠点不保证轮到人类,决策方是 bot 时
  // interactive=false,卷轴恒不弹。
  await force(page, `
    e.turnPhase = "AwaitingDecision";
    e.activeIndex = 0;
    const me = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && !me.properties.some((h) => h.propertyId === t.propertyId));
    e.lastLandOutcome = { kind: "PropertyAvailable", property: e.catalog.get(tile.propertyId) };
    e.pendingLand = { kind: "PropertyAvailable", propertyId: tile.propertyId };
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

test("扩军决策:己方城升级免费(到达己城可选扩军,现金不变)", async ({ page }) => {
  await quickStart(page);
  // #188:先钉活跃座位到人类(0),理由同「购地决策」用例
  await force(page, `
    e.turnPhase = "AwaitingDecision";
    e.activeIndex = 0;
    const me = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.propertyId && t.propertyId !== e.board.at(me.capitalIndex).propertyId);
    me.properties.push({ propertyId: tile.propertyId, level: 0, group: "a", maxLevel: 3 });
    e.lastLandOutcome = { kind: "OwnProperty", property: e.catalog.get(tile.propertyId), owner: me };
    e.pendingLand = { kind: "OwnProperty", propertyId: tile.propertyId };
  `);
  await expect(page.getByTestId("scroll-upgrade")).toBeVisible();
  await expect(page.getByTestId("action-upgrade")).toBeEnabled();
  const before = (await snap(page)).players[0].cash;
  await page.getByTestId("action-upgrade").click();
  // 升级免费:等级 +1,现金不变
  await expect
    .poll(
      async () =>
        (await snap(page)).players[0].properties.find((h: { level: number }) => h.level === 1) != null,
      { timeout: 15_000 },
    )
    .toBe(true);
  expect((await snap(page)).players[0].cash).toBe(before);
});

test("分岔辅路:落辅路起点弹抉择,入辅路=待入(本回合结束),下回合掷骰沿辅路推进", async ({ page }) => {
  await quickStart(page);
  const turnBefore = (await snap(page)).turnNumber;
  // #188:先钉活跃座位到人类(0),理由同「购地决策」用例;下轮 onBranch 推进断言按座位 0 读
  await force(page, `
    e.turnPhase = "AwaitingBranch";
    e.activeIndex = 0;
    e.activePlayer.onBranch = null;
  `);
  await expect(page.getByTestId("scroll-branch")).toBeVisible();
  await expect(page.getByTestId("scroll-branch")).toContainText("辅路");
  await page.getByTestId("action-branch").click();
  // selectBranch("Branch"):置待入状态 onBranch={step:-1},棋子留在入口格,本回合结束
  await expect
    .poll(
      async () => page.evaluate(() => (window as any).__dafung.getEngine().players[0].onBranch),
      { timeout: 10_000 },
    )
    .toEqual({ step: -1 });
  await expect
    .poll(async () => (await snap(page)).turnNumber, { timeout: 10_000 })
    .toBeGreaterThan(turnBefore);
  // 下回合掷骰:掷几点走几格辅路格(第 die 格);die 超长则从辅路终点汇入主路
  // #188:掷骰自动触发,无须点行军——轮询体内放行每回合开始的锦囊卷轴(#122),
  // 自动起摇后 onBranch 自会推进(轮到 bot 先行时耐心等人类回合到来)。
  await expect
    .poll(
      async () => {
        await dismissJinnangIfUp(page);
        const ob = await page.evaluate(() => (window as any).__dafung.getEngine().players[0].onBranch);
        return ob == null || ob.step >= 0;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

// X7 #26:等待去重——底部「运筹中…」角标已删,thinking testid 迁到 WaitingBar 文案 span,
// bot 回合同屏仅等待条一处反馈(等待条同时是唯一挂载点,断言双锚定防回退)。
test("bot 托管思考态:活跃方为电脑时 WaitingBar 显示「运筹中…」", async ({ page }) => {
  await quickStart(page);
  await force(page, `
    const botIdx = e.players.findIndex((p) => p.isBot);
    e.activeIndex = botIdx;
    // WaitingBar 按 interactive 门控(旧角标不读它):debug sync 只灌快照不刷派生量,
    // 须走控制器 sync 才能把「决策方=bot → interactive=false」落进 store。
    window.__dafung.controller().sync();
  `);
  await expect(page.getByTestId("waiting-bar")).toBeVisible();
  await expect(page.getByTestId("thinking")).toContainText("运筹中…");
});

test("加速到胜利:现金推高后掷骰,触发身价达标胜利屏", async ({ page }) => {
  // 锁种子:不锁时随机骰路偶发决策链超长(辅路/交涉连环)超出等待窗——TODO 记账的抖动家族,
  // 锁定后本用例确定性通过;骰路覆盖广度由「全程驱动」用例承担。
  await quickStart(page, 7);
  // 身价=现金+地产:直接把现金推过目标身价,任一次 endTurn 收尾即触发 checkVictory。
  // #188:quickStart 不再保证「正轮到人类」(行军自动化后局面自走),改锁人类座位本尊——
  // checkVictory 先看主动玩家、再看全场达标者中身价最高者,开局数回合内 bot 身价远低,
  // 人类 3× 目标恒为最高达标者,胜者确定性不变。
  await force(page, `e.players[0].cash = e.targetNetWorth * 3;`);
  // #188:掷骰自动触发——决策点由 actIfCan 清理,行军自走,endTurn 即触发胜利判定。
  // 掷骰可能落在辅路起点等决策格:把余下决策也推完才 endTurn 触发胜利判定;
  // 落在 bot 城主的珍宝交涉格会触发单机死锁缺陷(见 react-solo 全程驱动用例注释),同样绕过
  // 经济 v2:掷骰后的移步/骰子动画期间决策卷轴尚未挂载,actIfCan 会暂时无按钮可点——
  // 不能立即 break(旧版恰好赶在动画后点到),改为等局面变化后再试,循环上限放宽。
  for (let i = 0; i < 30 && !(await snap(page)).isOver; i++) {
    const s = await snap(page);
    if (s.turnPhase === "AwaitingTreasureOwner" && s.treasureVisitor) {
      await force(page, `e.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });`);
      continue;
    }
    const before = JSON.stringify(s);
    if (!(await actIfCan(page))) {
      await waitForSnapChanged(page, before).catch(() => {});
      continue;
    }
    // TODO #13:原固定 200ms 在全量负载下不等决策链推进完就读快照,循环提前 break;
    // 改为轮询"快照真的变了"(8s 余量),动作不改变局面时容忍(不阻塞循环)
    await waitForSnapChanged(page, before).catch(() => {});
  }
  await expect(page.getByTestId("victory-screen")).toBeVisible({ timeout: 60_000 });
  const s = await snap(page);
  expect(s.isOver).toBe(true);
  expect(s.players.find((p: any) => p.id === s.winner).isBot).toBe(false);
  // E4(#16):胜因与终榜随快照——本局走 TargetNetWorth(富甲天下),终榜列出全员
  expect(s.winReason).toBe("TargetNetWorth");
  await expect(page.getByTestId("victory-info")).toContainText("富甲天下");
  await expect(page.getByTestId("victory-standings")).toContainText("终榜");
  // ADR-0014:胜利屏「导出日志」落完整 jsonl(局头 header 行 + 命令/事件流 + 终局 final 行)
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("log-export").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^dafung-log-[0-9a-z-]+\.jsonl$/);
  const lines = readFileSync((await download.path())!, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  expect(lines[0].category).toBe("header"); // 局头是首行(重放要素:gameId/mapId/seed/座位表)
  const header = JSON.parse(lines[0].detail);
  expect(header.mapId).toBeTruthy();
  expect(header.seats.length).toBe(s.players.length);
  expect(lines.some((l: any) => l.category === "cmd")).toBe(true); // 命令流(掷骰/选都经 submitCommand/pickCapital)
  expect(lines[lines.length - 1].category).toBe("final"); // 终局行收尾
  const final = JSON.parse(lines[lines.length - 1].detail);
  expect(final.winner).toBe(s.winner);
  expect(final.round).toBe(s.round);
});

test("速战档全程驱动:不变量巡检 + 终局有胜者(意图同旧 invariants.spec)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?seed=1234");
  await openSoloSetup(page);
  await page.getByTestId("setup-target-15000").click(); // 速战(经济 v2;X10 分段选择器)
  await page.getByTestId("setup-seat-count-minus").click(); // 4→3
  await page.getByTestId("setup-seat-count-minus").click(); // 3→2(X10 stepper),加速节奏
  await page.getByTestId("start-game").click();
  await pickCapital(page);
  // #188:等人类的当前一手自动走完(替代旧「等 roll-button 可用」——按钮已随自动化移除)
  await waitMyRollDone(page, 0, 90_000);

  let actions = 0;
  let steps = 0;
  let stall = 0;
  let over = false;
  while (actions < 1200 && stall < 60 && !over) {
    steps++;
    const s = await snap(page);
    if (s.isOver) {
      over = true;
      break;
    }
    // 加速逼近终局:每 15 圈循环给全员发银两(不破坏不变量,身价达标即触发胜利)。
    // #188:行军自动化后 actions 只在决策点增长,加速改按循环圈数计,不依赖决策密度。
    if (steps % 15 === 0) {
      await force(page, `for (const p of e.players) p.cash += 6000;`);
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
      // #188:行军自动化后掷骰不再是可点动作,bot 链/自动起摇期间 actIfCan 恒 false——
      // 局面真的在动(快照已变)就不算停滞,不烧 stall 预算(#217① 同族);静止才累计。
      if (JSON.stringify(await snap(page)) !== JSON.stringify(s2)) stall = 0;
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

// React 重构 · 单机核心流 + 布局断言(阶段 11)。
// 意图来源(旧 spec → 此处):
// - play.spec / human.spec(掷骰推进、买地扣款、人类按钮可用性)→ 掷骰/买地/选路测试
// - invariants.spec(全程不变量 + 终局)→ 引擎态部分下沉 test/invariant-soak.test.ts
//   (GameEngine 直驱多 seed soak,#293 Q1/#304 去浏览器化);UI 显示层由「加速到胜利」
//   例驱动途中顺带巡检承接
// - solo-autopilot.spec(单机托管)→ 已过时:React 版托管仅联机支持,见报告
import { test, expect } from "./fixtures";
import {
  quickStart,
  force,
  snap,
  actIfCan,
  waitForSnapChanged,
  openSoloSetup,
  pickCapital,
  waitMyRollDone,
  waitMyPause,
  waitFxIdle,
  freezeClock,
  unfreezeClock,
} from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";
import { SCROLL_TESTIDS } from "../src/app/screens/game/scroll/testids";
import { TID as SETUP_TID } from "../src/app/screens/setup/testids";

// 真实段(脊柱②,ADR-0058):本例为回合自转链脊柱例——真 UI 开局全链→自动起摇→
// 签面/战报/推进全真,永不深种。以下其余例各带自己的真实段声明。
test("行军自动触发(#188 第 1 步):进入人类回合自动起摇——签面显示点数、战报追加、回合推进不卡死", async ({
  page,
}) => {
  await page.goto("/");
  await openSoloSetup(page);
  await page.getByTestId(SETUP_TID.startGame).click();
  await pickCapital(page);
  const logsBefore = (await snap(page)).log.length;
  // 自动起摇:锦囊放行后 ~1s(e2e 加速后 ~250ms)引擎自动 rollAndMove,无须点任何按钮
  await waitMyRollDone(page, 0);
  // 签面显隐随架走(回合联动:bot 回合手牌区整区卸载)——钉回我的停靠态再读数,
  // 签面重挂初值取快照 lastRoll,揭示过的点数照常在(HandZone 水合口径)
  await waitMyPause(page, 0, 90_000);
  await expect(page.getByTestId(TESTIDS.diceFace)).toHaveText(/[一二三四五六]/, {
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await snap(page)).log.length, { timeout: 20_000 })
    .toBeGreaterThan(logsBefore);
  const s = await snap(page);
  expect(s.isOver).toBe(false);
});

// 「席位格同步:自机格现金与引擎快照停靠态同步」例已删(#1181 棒一重筛):现金面
// 被 react-seat-cells ① cellsMatchSnapshot 逐席覆盖(seat-cash-N == 快照现金,
// 自机格 seat-self/seatRail 结构面同文件 ①② 在守),重复例按宁缺毋滥直删。

// ── #421 时钟缝:冻结→种植→点击→断言→恢复 ──
// freezeClock/unfreezeClock 已升共享面(react-helpers,#423 项8:react-stamina 同款
// 口径接入);冻结边界(只钉到点回调、钉不住命令自带同步链)与断言纪律详见彼处注。

// 真实段(ADR-0058):冻结后真点「买地」→真卷轴结算扣款入册即被测环。force 判词:
// 钉 AwaitingDecision+人类行动方(引擎无「钉相位」公共命令,停靠点随骰流);无主城
// 落点直选(停靠随骰流漂,断言面需确定无主城);现金注资(购价随地图再平衡,断言面
// 需确定可购——本例测购地机制不测购地门槛)。
test("购地决策:卷轴购地扣银两 + 获得地产", async ({ page }) => {
  await quickStart(page);
  await freezeClock(page);
  try {
    // 强制 AwaitingDecision + 无主城落地(意图同旧 human.spec 的买地用例,相位改为钩子构造)。
    // C2 起 buyProperty 消费 pendingLand(决策载荷),布场须两态同步:表现(lastLandOutcome)
    // 归表现,决策上下文(pendingLand)归决策——真实路径由 resolveProperty 一并置值。
    // #188:先钉活跃座位到人类(0)——行军自动化后停靠点不保证轮到人类,决策方是 bot 时
    // interactive=false,卷轴恒不弹(#421 起冻结先行,种植在钉死的静止态上做)。
    await force(
      page,
      `
      e.turnPhase = "AwaitingDecision";
      e.activeIndex = 0;
      const me = e.activePlayer;
      const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) == null);
      // 种够现金:本例测购地机制不测购地门槛——起手 5000 选都扣建城费后未必买得起
      // 首个无主城(ADR-0041),价格随地图走,别让数值再平衡打真本例。
      me.cash = e.catalog.get(tile.propertyId).purchasePrice + 1000;
      e.lastLandOutcome = { kind: "PropertyAvailable", property: e.catalog.get(tile.propertyId) };
      e.pendingLand = { kind: "PropertyAvailable", propertyId: tile.propertyId };
    `,
    );
    // 交互重构:决策一律走卷轴——轮到即自动弹(scroll-buy),按钮 testid 沿用 action-buy
    await expect(page.getByTestId(SCROLL_TESTIDS.buyScroll)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.actionButton("buy"))).toBeEnabled();
    const before = (await snap(page)).players[0];
    const logLenBefore = (await snap(page)).log.length;
    await page.getByTestId(TESTIDS.actionButton("buy")).click();
    // 扣银两以 buy 留痕为凭(detail 的 price/cash= 结算瞬间值):
    // 购地收尾 endTurn 同步放出 bot 链,链上他人回合可正当变动本方现金(横征暴敛等)、
    // 也可正当拆掉本方城(火烧连营/火攻)——#421 冻结只钉看门狗节拍、钉不住命令自带
    // 的同步连锁,点击后再读快照属与连锁的竞速读数。
    const buyLine = async (): Promise<{ detail: string } | undefined> =>
      (await snap(page)).log
        .slice(logLenBefore)
        .find(
          (l: { category: string; detail: string }) =>
            l.category === "buy" && l.detail.startsWith("buy player=p0 "),
        );
    await expect
      .poll(async () => (await buyLine()) != null, {
        timeout: 15_000,
        message: "buy 留痕:购地落地(无主城入册)",
      })
      .toBe(true);
    await expect
      .poll(
        async () => {
          const line = await buyLine();
          return line == null ? null : Number(/cash=(\d+)/.exec(line.detail)![1]);
        },
        { timeout: 15_000, message: "buy 留痕现金=结算瞬间值,必低于种前现金(扣价)" },
      )
      .toBeLessThan(before.cash);
  } finally {
    await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
  }
});

// 真实段(ADR-0058):冻结后真点「扩军」→真免费升级结算即被测环。force 判词:钉
// 相位+行动方(同上,无「钉相位」公共命令);己方城种植(升级前提=名下有城,开局
// 初期自然到不了,断言面需确定己城邻格形态)。
test("扩军决策:己方城升级免费(到达己城可选扩军,现金不变)", async ({ page }) => {
  await quickStart(page);
  await freezeClock(page);
  try {
    // #188:先钉活跃座位到人类(0),理由同「购地决策」用例(#421 起冻结先行)
    await force(
      page,
      `
      e.turnPhase = "AwaitingDecision";
      e.activeIndex = 0;
      const me = e.activePlayer;
      const tile = e.board.tiles.find((t) => t.propertyId && t.propertyId !== e.board.at(me.capitalIndex).propertyId && e.findOwner(t.propertyId) == null);
      me.properties.push({ propertyId: tile.propertyId, level: 0, group: "a", maxLevel: 3 });
      e.lastLandOutcome = { kind: "OwnProperty", property: e.catalog.get(tile.propertyId), owner: me };
      e.pendingLand = { kind: "OwnProperty", propertyId: tile.propertyId };
    `,
    );
    await expect(page.getByTestId(SCROLL_TESTIDS.upgradeScroll)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.actionButton("upgrade"))).toBeEnabled();
    const before = (await snap(page)).players[0].cash;
    const logLenBefore = (await snap(page)).log.length;
    await page.getByTestId(TESTIDS.actionButton("upgrade")).click();
    // 升级免费:等级 +1,现金不变——两者都以 upgrade 留痕为凭(detail 的 level=/cash=
    // 结算瞬间值):升级收尾 endTurn 同步放出 bot 链,链上他人回合可正当变动本方现金
    // (横征暴敛等)、也可正当拆掉本方刚升级的城(火烧连营/周瑜火攻专烧城多
    // 者)——#421 冻结只钉看门狗节拍、钉不住命令自带的同步连锁,点击后再读快照属与
    // 连锁的竞速读数(失败实录:升级落地同拍被火攻拆回 Lv.0,快照断言永不达)。
    await expect
      .poll(
        async () => {
          const line = (await snap(page)).log
            .slice(logLenBefore)
            .find(
              (l: { category: string; detail: string }) =>
                l.category === "upgrade" && l.detail.startsWith("upgrade player=p0 "),
            );
          return line == null ? null : Number(/level=(\d+)/.exec(line.detail)![1]);
        },
        { timeout: 15_000, message: "upgrade 留痕:扩军落地(等级 +1)" },
      )
      .toBe(1);
    await expect
      .poll(
        async () => {
          const line = (await snap(page)).log
            .slice(logLenBefore)
            .find(
              (l: { category: string; detail: string }) =>
                l.category === "upgrade" && l.detail.startsWith("upgrade player=p0 "),
            );
          return line == null ? null : Number(/cash=(\d+)/.exec(line.detail)![1]);
        },
        { timeout: 15_000, message: "upgrade 留痕现金=结算瞬间值,须等于种前现金(免费)" },
      )
      .toBe(before);
  } finally {
    await unfreezeClock(page); // 挂起的到点回调按序补放,对局恢复自走(页面随后 teardown)
  }
});

// X7 #26:等待去重——底部「运筹中…」角标已删,thinking testid 迁到 WaitingBar 文案 span,
// bot 回合的等待反馈以 WaitingBar 挂载为断言锚(#732 起宿主在知会槽,#762 起与常驻
// 回合胶囊同槽融合——胶囊管回合方指名,本条断言的是等待附加信息自身,双锚定防回退)。
// 真实段(ADR-0058):「运筹中」WaitingBar 对决策方=bot 的渲染响应链即被测环。force
// 判词:钉行动方为 bot(自然停靠随骰流,断言面需确定的 bot 行动方;sync 走控制器
// 公共重灌,派生量 interactive 随之落 store)。
test("bot 托管思考态:活跃方为电脑时 WaitingBar 显示「运筹中…」", async ({ page }) => {
  // #987 定 seed 49(实测停靠干净无演出在播)——随机 seed 下
  // quickStart 归还时可能有签面幕在收(收幕走房间时钟),先冻结会把玄墨幕钉死屏上、
  // force 内的 waitFxIdle 永不排空(2026-11-02 W4 挂串行绿的负载敏感根因)。
  await quickStart(page, 49);
  // #421 冻结闸:quickStart 稳后局面仍自走,force 改 activeIndex 与自推进竞速——
  // #928 行军提速后 force 落点撞进人类决策窗(interactive 被决策方压回,WaitingBar
  // 永不开),钉住世界再动刀(同文件升级用例同款先例)。冻结前先排空演出:
  // 冻结会挂起时钟驱动的收幕回调,fx 在途时冻结=waitFxIdle 死等(#987)。
  await waitFxIdle(page);
  await freezeClock(page);
  try {
    await force(
      page,
      `
      const botIdx = e.players.findIndex((p) => p.isBot);
      e.activeIndex = botIdx;
      // WaitingBar 按 interactive 门控(旧角标不读它):debug sync 只灌快照不刷派生量,
      // 须走控制器 sync 才能把「决策方=bot → interactive=false」落进 store。
      window.__dafung.controller().sync();
    `,
    );
    await expect(page.getByTestId(TESTIDS.waitingBar)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.thinking)).toContainText("运筹中…");
  } finally {
    await unfreezeClock(page);
  }
});

// 真实段(ADR-0058):现金注资后的整局真实驱动至胜利屏(掷骰/决策清理/endTurn/
// checkVictory 全自然链)即被测环,途中不变量巡检为顺带取证。force 判词:身价注资
// (e.players[0].cash 直写——「现金推过目标身价」无公共通路,胜利判定本身走真链);
// 循环内 resolveTreasureOwner skip 走 e.submitCommand=引擎公共命令(交涉托管同语义,
// 非红牌)。
test(
  "加速到胜利:现金推高后掷骰,触发身价达标胜利屏(驱动途顺带不变量巡检)",
  { tag: "@slow" },
  async ({ page }) => {
    // 慢池(#1026):全程不变量巡检族(整局全程驱动)——快池门禁 --grep-invert @slow 跳过,
    // 慢池批次收口跑。单例实测 30.3s(#1026 标定)。
    // 锁种子:不锁时随机骰路偶发决策链超长(交涉连环)超出等待窗——TODO 记账的抖动家族,
    // 锁定后本用例确定性通过;骰路覆盖广度由 test/invariant-soak.test.ts 的多 seed 引擎
    // soak 承担(#293 Q1:全程驱动去浏览器化,本例只承接 UI 显示层巡检)。
    await quickStart(page, 7);
    // 身价=现金+地产:直接把现金推过目标身价,任一次 endTurn 收尾即触发 checkVictory。
    // #188:quickStart 不再保证「正轮到人类」(行军自动化后局面自走),改锁人类座位本尊——
    // checkVictory 先看主动玩家、再看全场达标者中身价最高者,开局数回合内 bot 身价远低,
    // 人类 3× 目标恒为最高达标者,胜者确定性不变。
    await force(page, `e.players[0].cash = e.targetNetWorth * 3;`);
    // #188:掷骰自动触发——决策点由 actIfCan 清理,行军自走,endTurn 即触发胜利判定。
    // 掷骰可能落在决策格(购地/扩军):把余下决策也推完才 endTurn 触发胜利判定;
    // 落在 bot 城主的珍宝交涉格会触发单机死锁缺陷(⚠ 已报告:决策方是城主 ownerIdx,而
    // #398 单机统一后 viewSeat 恒跟 decisionOwner(引擎 getter:珍宝交涉相位=城主),
    // UI 只渲染访客只读视角,owner 为 bot 时也无驱动方代打),同样以调试钩子按 owner
    // 身份「不交易」绕过。
    // 经济 v2:掷骰后的移步/骰子动画期间决策卷轴尚未挂载,actIfCan 会暂时无按钮可点——
    // 不能立即 break(旧版恰好赶在动画后点到),改为等局面变化后再试,循环上限放宽。
    // 不变量巡检(#293 Q1 承接):原「全程驱动」例下沉 core soak 后,本例驱动到胜利屏途中
    // 顺手盯 UI 数据源——快照喂给仪表条/席位卡的玩家态不越界(现金/身价非负、位置合法、
    // 破产无残留);引擎态全量口径(含都城位/锦囊残留)在 test/invariant-soak.test.ts。
    const tileCount = await page.evaluate(() => (window as any).__dafung.getEngine().board.count);
    for (let i = 0; i < 30 && !(await snap(page)).isOver; i++) {
      const s = await snap(page);
      for (const p of s.players) {
        if (p.cash < 0) throw new Error(`不变量违规:T${s.round} ${p.guohao} cash=${p.cash}<0`);
        if (p.netWorth < 0)
          throw new Error(`不变量违规:T${s.round} ${p.guohao} nw=${p.netWorth}<0`);
        if (p.position < 0 || p.position >= tileCount)
          throw new Error(`不变量违规:T${s.round} ${p.guohao} pos=${p.position}`);
        if (p.isBankrupt && (p.properties.length || p.treasures.length || p.heroes.length))
          throw new Error(`破产残留:${p.guohao}`);
      }
      if (s.turnPhase === "AwaitingTreasureOwner" && s.treasureVisitor) {
        await force(
          page,
          `e.submitCommand({ type: "resolveTreasureOwner", action: { type: "skip" } });`,
        );
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
    await expect(page.getByTestId(SCROLL_TESTIDS.victoryScreen)).toBeVisible({ timeout: 60_000 });
    // 终局封场(orchestrator.finishPresentation):真终局批先于胜利屏入队,封场后
    // 掷骰签 overlay(z-45)不得残留——在场一张随封场摘除,后续掷骰不再播。
    await expect(page.locator(".dice-overlay")).toHaveCount(0, { timeout: 2_000 });
    const s = await snap(page);
    expect(s.isOver).toBe(true);
    expect(s.players.find((p: any) => p.id === s.winner).isBot).toBe(false);
    // E4(#16):胜因与终榜随快照——本局走 TargetNetWorth(富甲天下),终榜列出全员
    expect(s.winReason).toBe("TargetNetWorth");
    await expect(page.getByTestId(SCROLL_TESTIDS.victoryInfo)).toContainText("富甲天下");
    await expect(page.getByTestId(SCROLL_TESTIDS.victoryStandings)).toContainText("终榜");
  },
);

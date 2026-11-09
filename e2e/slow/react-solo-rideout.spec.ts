// 地板名册(ADR-0062):脊柱⑥加速到胜利(骑局)——唯一骑生产装配走完全局的 e2e,
// 永不迁移。慢池(2026-11-09 #1345 目录制):本目录整池即慢池,批次收口跑;
// 单例实测 30.3s(#1026 标定)。自 e2e/spine/react-solo.spec.ts 拆出(#1345)。
// 真实段(ADR-0058):现金注资后的整局真实驱动至胜利屏(掷骰/决策清理/endTurn/
// checkVictory 全自然链)即被测环,途中不变量巡检为顺带取证。种植判词(setCash
// #1299,判词单源 src/core/planter.ts):身价注资——「现金推过目标身价」无公共通路,
// 胜利判定本身走真链。
// #1257 死代码退役:循环内旧有 AwaitingTreasureOwner 的 force「不交易」绕行分支
// (bot 城主珍宝交涉单机死锁缺陷 ⚠ 的绕行)——#398 后引擎对 bot 城主即席代打,分支
// 永不触发(桥驱动 150 seed 零卡死实证),整段退役;该形态走真实代打,被测环零改动。
import { test, expect } from "../fixtures";
import { quickStart, snap, actIfCan, engineState, waitForSnapChanged } from "../react-helpers";
import { plant } from "../helpers/drivers";
import { SCROLL_TESTIDS } from "../../src/app/screens/game/scroll/testids";

test("加速到胜利:现金推高后掷骰,触发身价达标胜利屏(驱动途顺带不变量巡检)", async ({ page }) => {
  // 锁种子:不锁时随机骰路偶发决策链超长(交涉连环)超出等待窗——TODO 记账的抖动家族,
  // 锁定后本用例确定性通过;骰路覆盖广度由 test/whole-game/invariant-soak.test.ts 的多 seed 引擎
  // soak 承担(#293 Q1:全程驱动去浏览器化,本例只承接 UI 显示层巡检)。
  await quickStart(page, 7);
  // 身价=现金+地产:直接把现金推过目标身价,任一次 endTurn 收尾即触发 checkVictory。
  // #188:quickStart 不再保证「正轮到人类」(行军自动化后局面自走),改锁人类座位本尊——
  // checkVictory 先看主动玩家、再看全场达标者中身价最高者,开局数回合内 bot 身价远低,
  // 人类 3× 目标恒为最高达标者,胜者确定性不变。
  // 现金推过目标身价走 setCash 种植件(#1299,判词单源 src/core/planter.ts)。
  const targetNetWorth: number = await engineState(page, "e.targetNetWorth");
  await plant(page, { kind: "setCash", seat: 0, cash: targetNetWorth * 3 });
  // #188:掷骰自动触发——决策点由 actIfCan 清理,行军自走,endTurn 即触发胜利判定。
  // 掷骰可能落在决策格(购地/扩军):把余下决策也推完才 endTurn 触发胜利判定。
  // 落 bot 城主珍宝交涉格零须处理:#398 后引擎即席代打(旧 force「不交易」绕行分支
  // 已随 #1257 退役,见例头注)。
  // 经济 v2:掷骰后的移步/骰子动画期间决策卷轴尚未挂载,actIfCan 会暂时无按钮可点——
  // 不能立即 break(旧版恰好赶在动画后点到),改为等局面变化后再试,循环上限放宽。
  // 不变量巡检(#293 Q1 承接):原「全程驱动」例下沉 core soak 后,本例驱动到胜利屏途中
  // 顺手盯 UI 数据源——快照喂给仪表条/席位卡的玩家态不越界(现金/身价非负、位置合法、
  // 破产无残留);引擎态全量口径(含都城位/锦囊残留)在 test/whole-game/invariant-soak.test.ts。
  const tileCount = await page.evaluate(() => (window as any).__dafung.getEngine().board.count);
  for (let i = 0; i < 30 && !(await snap(page)).isOver; i++) {
    const s = await snap(page);
    for (const p of s.players) {
      if (p.cash < 0) throw new Error(`不变量违规:T${s.round} ${p.guohao} cash=${p.cash}<0`);
      if (p.netWorth < 0) throw new Error(`不变量违规:T${s.round} ${p.guohao} nw=${p.netWorth}<0`);
      if (p.position < 0 || p.position >= tileCount)
        throw new Error(`不变量违规:T${s.round} ${p.guohao} pos=${p.position}`);
      if (p.isBankrupt && (p.properties.length || p.treasures.length || p.heroes.length))
        throw new Error(`破产残留:${p.guohao}`);
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
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryScreen)).toBeVisible({
    timeout: 60_000,
  });
  // 终局封场(orchestrator.finishPresentation):真终局批先于胜利屏入队,封场后
  // 掷骰签 overlay(z-45)不得残留——在场一张随封场摘除,后续掷骰不再播。
  await expect(page.locator(".dice-overlay")).toHaveCount(0, {
    timeout: 2_000,
  });
  const s = await snap(page);
  expect(s.isOver).toBe(true);
  expect(s.players.find((p: any) => p.id === s.winner).isBot).toBe(false);
  // E4(#16):胜因与终榜随快照——本局走 TargetNetWorth(富甲天下),终榜列出全员
  expect(s.winReason).toBe("TargetNetWorth");
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryInfo)).toContainText("富甲天下");
  await expect(page.getByTestId(SCROLL_TESTIDS.victoryStandings)).toContainText("终榜");
});

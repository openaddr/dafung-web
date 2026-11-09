// React 重构 · 单机核心流(阶段 11)。
// 意图来源(旧 spec → 此处):
// - play.spec / human.spec(掷骰推进、买地扣款、人类按钮可用性)→ 掷骰/买地/选路测试
// - invariants.spec(全程不变量 + 终局)→ 引擎态部分下沉 test/whole-game/invariant-soak.test.ts
//   (GameEngine 直驱多 seed soak,#293 Q1/#304 去浏览器化);UI 显示层由慢池「加速到胜利」
//   例驱动途中顺带巡检承接(拆至 e2e/slow/react-solo-rideout.spec.ts,#1345 目录制)
// - solo-autopilot.spec(单机托管)→ 已过时:React 版托管仅联机支持,见报告
//
// 地板名册(ADR-0062):脊柱②行军自动触发,永不迁移。#1318 批T4 已把购地/扩军/bot
// 托管三例下放 test/wiring/solo-wiring.test.tsx(层④);脊柱⑥加速到胜利(骑局)为
// 慢池例,同批拆见 e2e/slow/ 同名 rideout 文件。
import { test, expect } from "../fixtures";
import { snap, waitMyRollDone, waitMyPause, openSoloSetup, pickCapital } from "../react-helpers";
import { TESTIDS } from "../../src/app/screens/game/testids";
import { TID as SETUP_TID } from "../../src/app/screens/setup/testids";

// 真实段(脊柱②,ADR-0058):本例为回合自转链脊柱例——真 UI 开局全链→自动起摇→
// 签面/战报/推进全真,永不深种。
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
// 「购地决策」「扩军决策」「bot 托管思考态」三例已迁接线层(#1318 批T4,
// test/wiring/solo-wiring.test.tsx:冻结+种植+poll 的竞速读数配方在接线层收敛为
// 零时钟零竞速直读;被测环=按钮→命令→DOM/store 面不变)。

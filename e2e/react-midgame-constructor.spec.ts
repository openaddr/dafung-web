// 中盘构造器守卫 spec(ADR-0059 示导波,#1252):守调试桥 `seedSoloToRound` 的四件事——
// 到站确定性(同 seed 两跑快照逐位一致)、到站态正确(parkMyTurn 谓词停靠)、快进应答
// 走房间命令面(cmd 行留痕)+ 沉降后真实时钟可交互、快进+沉降墙钟与回合数脱钩的宽松
// 闸;附边界③实证:react-solo.spec 头注「bot 城主珍宝交涉单机死锁」过期——房间驱动链
// 经 botAct 代打城主决策(该 spec 因本结论可退役其 force 绕行,归后续票)。
// 种子谱(页内探针同 seed 两跑对拍选定;漂移按 how-to「种子哨兵与重钓配方」重钓):
// - 1504:快进到第 10 回合到站 turn 11/round 3/AwaitingJinnang(首个人类停靠;人类回合
//   随 draftOrder/skipTurns 漂移,到站判据=首个 turnNumber≥N 的人类决策停靠,非字面
//   第 N 回合),途中有人类购地 cmd 行(命令面留痕标记)。
// - 1485:快进途中 bot 城主(座 1)与访客(座 3)珍宝交涉成交(hubing-17/100 两)——
//   决策方=城主(与访客身份无关)的停相被房间链代打,快进不卡死。
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { quickStart, snap, waitMyRollDone } from "./react-helpers";
import { TESTIDS } from "../src/app/screens/game/testids";

/** 到站快照全量摘要(JSON 串):同 seed 两跑逐位对拍用。非确定字段掩码(与确定性无关,
 *  二跑必异):对局 id(毫秒时间戳+随机后缀,authority.ts 构造)与其战报 header 行内嵌
 *  形、战报行墙钟 ts/startedAt 类 13 位毫秒数。 */
async function arrivalDigest(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify((window as any).__dafung.snapshot())
      .replace(/[0-9]{13}/g, "0")
      .replace(/gameId[\\":a-z0-9-]*/gi, "gameId*"),
  );
}

/** 到站不变量巡检(react-solo 驱动循环同款口径,收窄到到站拍):现金/身价非负、位置
 *  合法、破产无残留。引擎驱动途中的抛错由桥的守卫(超时/停滞/终局)与页错误天然上抛。 */
async function assertArrivalInvariants(page: Page): Promise<void> {
  const s = await snap(page);
  const board = await page.evaluate(() => ({
    count: (window as any).__dafung.getEngine().board.count as number,
  }));
  for (const p of s.players) {
    expect(p.cash, `${p.guohao} cash`).toBeGreaterThanOrEqual(0);
    expect(p.netWorth, `${p.guohao} netWorth`).toBeGreaterThanOrEqual(0);
    expect(p.position, `${p.guohao} pos`).toBeGreaterThanOrEqual(0);
    expect(p.position, `${p.guohao} pos`).toBeLessThan(board.count);
    if (p.isBankrupt)
      throw new Error(`不变量违规:破产残留 ${p.guohao}(快进途中出现破产,换 seed/回合避开)`);
  }
}

test.describe("中盘构造器到站守卫(#1252)", () => {
  test("同 seed 两跑到站逐位一致,到站=人类决策停靠态", async ({ page }) => {
    test.setTimeout(120_000);
    let first = "";
    for (let run = 0; run < 2; run++) {
      await quickStart(page, 1504, { midGameRound: 10 });
      const s = await snap(page);
      // 到站态(parkMyTurn 谓词 + 谱钉死的停靠三元组:漂移按头注种子谱重钓)。
      expect(s.phase).toBe("Playing");
      expect(s.turnNumber).toBe(11);
      expect(s.round).toBe(3);
      expect(s.turnPhase).toBe("AwaitingJinnang");
      expect(s.activeIndex).toBe(0);
      expect(s.decisionOwner).toBe(0);
      await assertArrivalInvariants(page);
      const digest = await arrivalDigest(page);
      if (run === 0) first = digest;
      else expect(digest, "同 seed 两跑到站快照逐位一致").toBe(first);
    }
  });

  test("快进应答走房间命令面(cmd 行留痕);沉降后真实时钟真做一次交互", async ({ page }) => {
    await quickStart(page, 1504, { midGameRound: 10 });
    const s = await snap(page);
    // 命令面证据:submitCommand 入口逐条记 cmd 行(人类座=魏);bot 直调不经此口零 cmd
    // 行。快进应答(行军/购地/今不用…)必须在此留痕,直调绕行即红(评审口径的可执行面)。
    const myCmds = s.log.filter(
      (r: { player: string | null; brief: string }) =>
        r.player === "魏" && r.brief.includes("提交命令"),
    );
    expect(myCmds.length, "快进中真人应答经房间命令面(cmd 行)").toBeGreaterThan(0);
    expect(
      myCmds.some((r: { brief: string }) => r.brief.includes("行军")),
      "有起摇行军应答",
    ).toBe(true);
    // 尾段真实时钟:出牌阶段「今不用」真点 → ~1s 真实自动起摇 → 行军结算,战报继续增长。
    const before = s.logCount;
    await page.getByTestId(TESTIDS.actionbarPass).click();
    await waitMyRollDone(page, 0);
    const after = await snap(page);
    expect(after.logCount, "真实交互后战报推进").toBeGreaterThan(before);
    expect(after.isOver).toBe(false);
  });

  test("边界③:bot 城主珍宝交涉被房间链代打,快进不卡死", async ({ page }) => {
    test.setTimeout(120_000);
    await quickStart(page, 1485, { midGameRound: 10 });
    const s = await snap(page);
    expect(s.phase).toBe("Playing");
    expect(s.turnPhase).toBe("AwaitingJinnang");
    // 交涉成交事件(引擎 gameEvents 全量,快照 events 只含当前批):卖方=bot 城主、
    // 买方=访客——决策方=城主的停相在构造器快进中被房间驱动链正常推进并结算。
    const trades = await page.evaluate(() =>
      (window as any).__dafung
        .getEngine()
        .gameEvents.filter((v: { kind: string }) => v.kind === "treasureTraded")
        .map((v: { sellerSeat: number; buyerSeat: number; treasureId: string }) => ({
          seller: v.sellerSeat,
          buyer: v.buyerSeat,
          id: v.treasureId,
        })),
    );
    expect(trades, "快进途中发生珍宝交涉成交").toContainEqual({
      seller: 1,
      buyer: 3,
      id: "hubing-17",
    });
    expect(
      trades.every((t: { seller: number }) => t.seller !== 0),
      "成交卖方恒 bot 城主(人类城主走「不交易」)",
    ).toBe(true);
  });

  test("快进+沉降墙钟三档 N=1/5/10(读数入耗时账;上限=脱钩承诺宽松闸)", async ({ page }) => {
    test.setTimeout(240_000);
    for (const n of [1, 5, 10]) {
      const t0 = Date.now();
      await quickStart(page, 1504, { midGameRound: n });
      const ms = Date.now() - t0;
      // 读数经 console 进测试报告(耗时回顾台账取数口);上限 60s = 实测个位数秒的
      // 10× 余量,只拦「到站成本随回合数爆炸」的承诺破坏,不做精细断言。
      console.log(`[midgame-cost] seed=1504 N=${n} drive+settle=${ms}ms`);
      expect(ms, `N=${n} 快进+沉降墙钟`).toBeLessThan(60_000);
    }
  });
});

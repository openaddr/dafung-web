// 中盘构造器守卫 spec(ADR-0059 示导波,#1252):守调试桥 `seedSoloToRound` 的四件事——
// 到站确定性(同 seed 两跑快照逐位一致)、到站态正确(parkMyTurn 谓词停靠)、快进应答
// 走房间命令面(cmd 行留痕)+ 沉降后真实时钟可交互、快进+沉降墙钟与回合数脱钩的宽松
// 闸;附边界③实证:react-solo.spec 头注「bot 城主珍宝交涉单机死锁」过期——房间驱动链
// 经 botAct 代打城主决策(该 spec 因本结论可退役其 force 绕行,归后续票)。
// #1254 增瞬空钩子+开口吸收守卫对(ADR-0059 决策 1;第二个 describe):瞬空钉 on/off
// 到站引擎态逐位一致(演出弃播不动引擎)+ postRoll 开口吸收新通路到站断言与新地板
// 读数(旧真播首掷链地板 3.3s 退役)。
// 种子谱(页内探针同 seed 两跑对拍选定;漂移按 how-to「种子哨兵与重钓配方」重钓):
// - 1504:快进到第 10 回合到站 turn 11/round 3/AwaitingJinnang(首个人类停靠;人类回合
//   随 draftOrder/skipTurns 漂移,到站判据=首个 turnNumber≥N 的人类决策停靠,非字面
//   第 N 回合),途中有人类购地 cmd 行(命令面留痕标记)。postRoll 新通路同谱:快进过
//   首掷后到站=首个我方决策停靠,三元组 turn 3/round 1/AwaitingDecision(人类座次
//   draftOrder 第 3 位,turnNumber ≡ 3 mod 4;首掷落咸阳停购地抉择)。
// - 1485:快进途中 bot 城主(座 1)与访客(座 3)珍宝交涉成交(hubing-17/100 两)——
//   决策方=城主(与访客身份无关)的停相被房间链代打,快进不卡死。
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  disableEncounters,
  quickStart,
  snap,
  waitFxIdle,
  waitMyRollDone,
  waitSettled,
} from "./react-helpers";
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

// ── 瞬空钩子+开口吸收守卫对(#1254,ADR-0059 决策 1)──
// 瞬空阀的引擎侧行为守恒:钉住只改演出消费(出队一律吸附档=整块弃播、直切终态),
// 引擎态(快进应答序 → RNG 流位 → 事件批 → 终态快照)与不钉逐位一致。
test.describe("瞬空钩子+开口吸收守卫(#1254)", () => {
  /** 瞬空钉住的中盘构造器到站(对拍钉跑):quickStart(midGameRound) 同款开局链与
   *  沉降,唯快进包在 setSnapPin(true/false) 里——应答序与不钉完全同一条(同一桥方法
   *  seedSoloToRound),判据=到站快照对拍逐位一致。finally 解钉:抛错不留常开档。 */
  async function quickStartPinned(page: Page, seed: number, targetRound: number): Promise<void> {
    await disableEncounters(page);
    await page.goto("/");
    await page.evaluate(
      async (o) => {
        const d = (window as any).__dafung;
        d.setSnapPin(true);
        try {
          await d.seedSoloToRound({ seed: o.seed, targetRound: o.targetRound });
        } finally {
          d.setSnapPin(false);
        }
      },
      { seed, targetRound },
    );
    await waitFxIdle(page, 60_000);
    await waitSettled(page);
  }

  test("瞬空钉 on/off 到站引擎态逐位一致(演出弃播不动引擎)", async ({ page }) => {
    test.setTimeout(120_000);
    let first = "";
    for (const pinned of [false, true]) {
      if (pinned) await quickStartPinned(page, 1504, 10);
      else await quickStart(page, 1504, { midGameRound: 10 }); // 不钉跑=守卫①同一条锚
      const s = await snap(page);
      expect(s.phase).toBe("Playing");
      expect(s.turnNumber).toBe(11);
      expect(s.round).toBe(3);
      expect(s.turnPhase).toBe("AwaitingJinnang");
      await assertArrivalInvariants(page);
      const digest = await arrivalDigest(page);
      if (!pinned) first = digest;
      else expect(digest, "瞬空 on/off 到站快照逐位一致").toBe(first);
    }
  });

  test("postRoll 开口吸收新通路:瞬空过首掷,到站=首掷后我方决策停靠", async ({ page }) => {
    test.setTimeout(120_000);
    const t0 = Date.now();
    await quickStart(page, 1504); // 默认 postRoll = #1254 新通路(构造器+瞬空一气呵成)
    const ms = Date.now() - t0;
    // 新地板读数经 console 进测试报告(耗时回顾台账取数口;旧真播 waitMyRollDone 地板 3.3s)。
    console.log(`[postroll-cost] seed=1504 新通路 quickStart=${ms}ms(旧地板 3.3s 对照)`);
    const s = await snap(page);
    // 到站=首掷后的我方决策停靠(parkMyTurn 谓词面;非反应窗瞬态、非未掷 Roll 等待态)。
    expect(s.phase).toBe("Playing");
    expect(s.activeIndex).toBe(0);
    expect(s.decisionOwner).toBe(0);
    expect(s.turnPhase.startsWith("Awaiting"), `到站非决策停靠(实际 ${s.turnPhase})`).toBe(true);
    expect(s.turnPhase).not.toBe("AwaitingReaction");
    // 首掷已发生:战报留有行军命令行(未掷停靠=开口吸收「推进过首掷」语义破坏)。
    expect(
      s.log.some((r: { brief: string }) => r.brief.includes("提交命令:行军")),
      "首掷已发生(战报有行军命令行)",
    ).toBe(true);
    // 谱钉三元组(首跑探得钉死;漂移按头注种子谱重钓):人类座次 draftOrder 第 3 位
    // (turnNumber ≡ 3 mod 4,同 T1 锚 turn 11/round 3 的座次),首掷落咸阳停购地抉择。
    expect(s.turnNumber).toBe(3);
    expect(s.round).toBe(1);
    expect(s.turnPhase).toBe("AwaitingDecision");
    await assertArrivalInvariants(page);
  });
});

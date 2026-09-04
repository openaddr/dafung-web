// 机遇引擎单测(#123):纯函数(归一/调制/加权抽取) + 引擎行为(触发开关/先于城池结算/
// 结算四路径与回退/确定性)。随机钉法:触发率配置 0/100 两端 + landActiveOn 恰落目标格
// (timing.test 同款技巧),结算路径经 testEngine.applyEncounter 指定具体事件绕过抽取。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { testEngine } from "@core/testing";
import {
  ENCOUNTERS,
  normalizeEncounterBaseRates,
  resolveEncounterConfig,
  tierShares,
  pickTier,
  pickWeighted,
  type EncounterDef,
} from "@core/encounters";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 7, encounter?: { triggerRate: number; good?: number; neutral?: number; bad?: number }): GameEngine {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    ...(encounter
      ? {
          encounter: {
            triggerRate: encounter.triggerRate,
            baseRates: { good: encounter.good ?? 34, neutral: encounter.neutral ?? 33, bad: encounter.bad ?? 33 },
          },
        }
      : {}),
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) e.aiSetupStep();
    else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

function peekDie(e: GameEngine): number {
  const probe = createDice(0);
  probe.setRngState(e.dice.getRngState());
  return probe.roll().die;
}

/** 挪位后掷骰,恰好落在 targetTile(路径不得途经都城)。 */
function landActiveOn(e: GameEngine, targetTile: number): void {
  const p = e.activePlayer;
  const die = peekDie(e);
  const n = e.board.count;
  const from = ((targetTile - die) % n + n) % n;
  const passesCapital = Array.from({ length: die }, (_, i) => (from + 1 + i) % n)
    .some((t) => t === p.capitalIndex && t !== targetTile);
  if (passesCapital) throw new Error(`场景无效:途经都城`);
  testEngine(e).placeActive(from);
  e.rollAndMove();
}

const def = (id: string, effect: EncounterDef["effect"]): EncounterDef =>
  ({ id, tier: "好运", tags: ["银两"], weight: 1, text: id, effect });

/** 找一座无主普通城并掷骰恰落其上(逐候选尝试,跳过途经都城的无效场景)。 */
function landOnFreeTile(e: GameEngine): void {
  const candidates = e.board.tiles.filter(
    (t) => t.type === "Property" && t.propertyId != null && !e.board.getBranchStart(t.index) && e.findOwner(t.propertyId) == null,
  );
  let lastError: unknown = null;
  for (const t of candidates) {
    try {
      landActiveOn(e, t.index);
      return;
    } catch (err) {
      lastError = err; // 途经都城的场景换下一座
    }
  }
  throw lastError ?? new Error("无可用无主城场景");
}

/** 剥离快照易变字段(gameId 随机/log ts 墙钟)后的确定性比较。 */
function scrubSnapshot(text: string): string {
  const o = JSON.parse(text);
  delete o.gameId;
  delete o.log; // 日志含随机 gameId/墙钟(内嵌于 header detail 字符串),确定性只比状态
  return JSON.stringify(o);
}

describe("机遇配置:归一与回退(#120 归一口径)", () => {
  it("三档和=100 → 原值直通", () => {
    const r = resolveEncounterConfig({ triggerRate: 40, baseRates: { good: 30, neutral: 45, bad: 25 } });
    expect(r.triggerRate).toBe(40);
    expect(r.shares).toEqual({ good: 30, neutral: 45, bad: 25 });
  });

  it("和≠100 → 按占比归一(10/10/10 各 1/3;1/1/98 → 1/98% 刻度)", () => {
    const even = normalizeEncounterBaseRates({ good: 10, neutral: 10, bad: 10 });
    expect(even.good).toBeCloseTo(100 / 3, 9);
    expect(even.neutral).toBeCloseTo(100 / 3, 9);
    expect(even.bad).toBeCloseTo(100 / 3, 9);
    const r = normalizeEncounterBaseRates({ good: 1, neutral: 1, bad: 98 });
    expect(r.good).toBeCloseTo(1, 6);
    expect(r.neutral).toBeCloseTo(1, 6);
    expect(r.bad).toBeCloseTo(98, 6);
  });

  it("触发率夹紧 0~100;非法三档回退默认 30/45/25", () => {
    expect(resolveEncounterConfig({ triggerRate: 250 }).triggerRate).toBe(100);
    expect(resolveEncounterConfig({ triggerRate: -7 }).triggerRate).toBe(0);
    const r = resolveEncounterConfig({ baseRates: { good: -1, neutral: Number.NaN, bad: 25 } });
    expect(r.shares).toEqual({ good: 30, neutral: 45, bad: 25 });
  });
});

describe("档位调制与抽取(纯函数)", () => {
  it("s=0 → 基准原样;s=+100 → 55/40/5;s=-100 → 5/50/45(修正拷问示意表,以公式为准)", () => {
    const base = { good: 30, neutral: 45, bad: 25 };
    expect(tierShares(0, base)).toEqual({ good: 30, neutral: 45, bad: 25 });
    expect(tierShares(100, base)).toEqual({ good: 55, neutral: 40, bad: 5 });
    expect(tierShares(-100, base)).toEqual({ good: 5, neutral: 50, bad: 45 });
  });

  it("夹紧 [5,95]:极端声望 + 偏置基准也不出 0/100 档", () => {
    const r = tierShares(-100, { good: 90, neutral: 5, bad: 5 });
    expect(r.good).toBeGreaterThanOrEqual(5);
    expect(r.bad).toBeGreaterThanOrEqual(5);
    const r2 = tierShares(100, { good: 90, neutral: 5, bad: 5 });
    expect(r2.good).toBeLessThanOrEqual(95);
  });

  it("pickTier 按累计占比;pickWeighted 按权重", () => {
    expect(pickTier(0.29, { good: 30, neutral: 45, bad: 25 })).toBe("好运");
    expect(pickTier(0.31, { good: 30, neutral: 45, bad: 25 })).toBe("中性");
    expect(pickTier(0.80, { good: 30, neutral: 45, bad: 25 })).toBe("霉运");
    const heavy = { id: "重", weight: 9 };
    const light = { id: "轻", weight: 1 };
    expect(pickWeighted([heavy, light], 0.5)).toBe(heavy);
    expect(pickWeighted([heavy, light], 0.95)).toBe(light);
  });

  it("目录 v1 = 15 条,档位 8/4/3,标签词表合法", () => {
    expect(ENCOUNTERS.length).toBe(15);
    expect(ENCOUNTERS.filter((c) => c.tier === "好运").length).toBe(8);
    expect(ENCOUNTERS.filter((c) => c.tier === "中性").length).toBe(4);
    expect(ENCOUNTERS.filter((c) => c.tier === "霉运").length).toBe(3);
    for (const c of ENCOUNTERS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.effect == null || c.choices == null).toBe(true); // 二选一
    }
  });
});

describe("机遇引擎行为", () => {
  it("触发率 0(缺省关闭)→ 落格无机遇", () => {
    const e = makeEngine(7); // 未传 encounter = 关闭
    finishSetup(e);
    landOnFreeTile(e);
    expect(testEngine(e).logText().includes("机遇「")).toBe(false);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 直接进购地决策,无机遇插戏
  });

  it("触发率 100 → 机遇先于城池结算:日志先机遇后可购,停在购地决策", () => {
    const e = makeEngine(7, { triggerRate: 100, good: 100, neutral: 0, bad: 0 });
    finishSetup(e);
    landOnFreeTile(e);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 机遇后照常进入购地决策
    const text = testEngine(e).logText();
    const encIdx = text.lastIndexOf("机遇「");
    const buyIdx = text.lastIndexOf("可购");
    expect(encIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(encIdx); // 机遇在前,城池事件在后
  });

  it("结算路径:发珍宝(牌堆扣一件)/ 得武将满 3 → 转银两", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const deckBefore = e.treasureDeck.length;
    te.applyEncounter(mover, mover.position, { id: "窖藏现世", tier: "好运", tags: ["珍宝"], weight: 1, text: "t", effect: { kind: "grantTreasure" } });
    expect(mover.treasures.length).toBe(1);
    expect(e.treasureDeck.length).toBe(deckBefore - 1);

    const full = e.activePlayer;
    full.heroes.push(
      { id: "h1", name: "甲", title: "", desc: "", skills: [], image: "" },
      { id: "h2", name: "乙", title: "", desc: "", skills: [], image: "" },
      { id: "h3", name: "丙", title: "", desc: "", skills: [], image: "" },
    );
    const cashBefore = full.cash;
    te.applyEncounter(full, full.position, { id: "义士来投", tier: "好运", tags: ["武将"], weight: 1, text: "t", effect: { kind: "grantHero", fallbackCash: 200 } });
    expect(full.heroes.length).toBe(3); // 不超容量
    expect(full.cash).toBe(cashBefore + 200); // 转银两补偿
  });

  it("结算路径:玩家转移上限=对方现金;levy 破产走 endTurn", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const opponent = e.players.find((p) => p !== mover)!;
    opponent.cash = 50;
    te.applyEncounter(mover, mover.position, { id: "纳款输诚", tier: "好运", tags: ["银两", "玩家"], weight: 1, text: "t", effect: { kind: "siphon", amount: 200 } });
    expect(opponent.cash).toBe(0); // 上限=对方现金,不打垮对方
    expect(mover.cash).toBeGreaterThanOrEqual(50);

    const loser = e.activePlayer;
    loser.cash = 10;
    loser.properties = []; // 无产可清算
    const oppCash = e.players.find((p) => p !== loser)!.cash;
    const r = te.applyEncounter(loser, loser.position, { id: "假道征粮", tier: "霉运", tags: ["银两", "玩家"], weight: 1, text: "t", effect: { kind: "levy", amount: 150 } });
    expect(r).toBe("bankrupt");
    expect(loser.isBankrupt).toBe(true);
    expect(e.players.find((p) => p !== loser)!.cash).toBe(oppCash); // 破产则对手分文未得
  });

  it("确定性:同 seed 同配置两局,完整一轮后快照逐位一致(机遇 roll 全走引擎 dice)", () => {
    const snap = (seed: number) => {
      const e = makeEngine(seed, { triggerRate: 100 });
      finishSetup(e);
      for (let i = 0; i < e.players.length && !e.isOver; i++) {
        e.rollAndMove();
        let guard = 0;
        while (e.turnPhase !== "Roll" && e.turnPhase !== "GameOver" && guard++ < 20) {
          if (e.turnPhase === "AwaitingBranch") e.selectBranch("Main");
          else if (e.turnPhase === "AwaitingDecision") e.endDecision();
          else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(1);
          else if (e.turnPhase === "AwaitingTreasureOwner") e.resolveTreasureOwner({ type: "skip" });
          else if (e.turnPhase === "AwaitingBankruptcySettle") e.confirmBankruptcySettle();
          else break;
        }
      }
      const raw = JSON.stringify(e.snapshot());
      return scrubSnapshot(raw);
    };
    expect(snap(11)).toBe(snap(11));
    expect(snap(12)).not.toBe(snap(11)); // 不同 seed 命运分岔(机遇存在的意义)
  });
});

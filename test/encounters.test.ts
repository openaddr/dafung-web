// 机遇引擎单测(#123;ADR-0035 机遇必出):纯函数(归一/调制/加权抽取) + 引擎行为
// (开关两端/先于城池结算/驻跸与天命同链/结算四路径与回退/确定性)。随机钉法:enabled
// 配置 0/1 两端 + landActiveOn 恰落目标格(timing.test 同款技巧),结算路径经
// testEngine.applyEncounter 指定具体事件绕过抽取。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct, encounterCashImpact, repCoefficient } from "@core/bot";
import { testEngine } from "@core/testing";
import { capitalSupplyOf } from "@core/movement-flow";
import { beginGameEventBatch } from "@core/game-events";
import type { GameMoment, MomentCtx } from "@core/timing";
import {
  ENCOUNTERS,
  normalizeEncounterBaseRates,
  resolveEncounterConfig,
  tierShares,
  pickTier,
  pickWeighted,
  type EncounterChoiceOption,
  type EncounterDef,
} from "@core/encounters";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
/** 锦囊门垫(#122/T2):回合开始可能停在锦囊卷轴相位,直调 rollAndMove 的测试先「今不用」。
 *  pass 不掷骰,骰流与断言不受扰。 */
function passJinnang<T extends { turnPhase: string; resolveJinnang(cardId: string | null): void }>(
  e: T,
): T {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

const MAP = loadMap(huanyouData);

function makeEngine(
  seed = 7,
  encounter?: { good?: number; neutral?: number; bad?: number },
  seats?: SeatConfig[],
): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    ...(encounter
      ? {
          encounter: {
            enabled: true,
            baseRates: {
              good: encounter.good ?? 34,
              neutral: encounter.neutral ?? 33,
              bad: encounter.bad ?? 33,
            },
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
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 发牌时已入相位的话放行
}

function peekDie(e: GameEngine): number {
  const probe = createDice(0);
  probe.setRngState(e.dice.getRngState());
  return probe.roll().die;
}

/** 包一层 dispatchMoment,记录派发的时机 + 完整 ctx(时机总线断言用,同 timing.test 口径)。 */
function recordMomentCtx(e: GameEngine): { moment: GameMoment; ctx: MomentCtx }[] {
  const entries: { moment: GameMoment; ctx: MomentCtx }[] = [];
  const orig = e.dispatchMoment.bind(e);
  (e as unknown as { dispatchMoment: (m: GameMoment, ctx: MomentCtx) => void }).dispatchMoment = (
    m,
    ctx,
  ) => {
    entries.push({ moment: m, ctx: { ...ctx } });
    return orig(m, ctx);
  };
  return entries;
}

/** 挪位后掷骰,恰好落在 targetTile(路径不得途经都城)。 */
function landActiveOn(e: GameEngine, targetTile: number): void {
  const p = e.activePlayer;
  const die = peekDie(e);
  const n = e.board.count;
  const from = (((targetTile - die) % n) + n) % n;
  const passesCapital = Array.from({ length: die }, (_, i) => (from + 1 + i) % n).some(
    (t) => t === p.capitalIndex && t !== targetTile,
  );
  if (passesCapital) throw new Error(`场景无效:途经都城`);
  testEngine(e).placeActive(from);
  passJinnang(e).rollAndMove();
}

const def = (id: string, effect: EncounterDef["effect"]): EncounterDef => ({
  id,
  tier: "好运",
  tags: ["银两"],
  weight: 1,
  text: id,
  effect,
});

/** 找一座无主普通城并掷骰恰落其上(逐候选尝试,跳过途经都城的无效场景)。 */
function landOnFreeTile(e: GameEngine): void {
  const candidates = e.board.tiles.filter(
    (t) => t.type === "Property" && t.propertyId != null && e.findOwner(t.propertyId) == null,
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

/** 中性床位(#121 退役的锦囊格):机遇解完续跑落格结算时,落此格按普通格空结算。 */
function benignTile(e: GameEngine): number {
  const t = e.board.tiles.find((x) => x.type === "Chance");
  if (!t) throw new Error("无中性床位(地图缺退役锦囊格)");
  return t.index;
}

/** 剥离快照易变字段(gameId 随机/log ts 墙钟)后的确定性比较。 */
function scrubSnapshot(text: string): string {
  const o = JSON.parse(text);
  delete o.gameId;
  delete o.log; // 日志含随机 gameId/墙钟(内嵌于 header detail 字符串),确定性只比状态
  return JSON.stringify(o);
}

describe("机遇配置:归一与回退(#120 归一口径)", () => {
  it("开关布尔直传:enabled 缺省=false(引擎隔离开关),显式 true/false 原样", () => {
    expect(resolveEncounterConfig().enabled).toBe(false);
    expect(resolveEncounterConfig({ baseRates: { good: 30, neutral: 45, bad: 25 } }).enabled).toBe(
      false,
    );
    expect(
      resolveEncounterConfig({ enabled: true, baseRates: { good: 30, neutral: 45, bad: 25 } })
        .enabled,
    ).toBe(true);
    expect(resolveEncounterConfig({ enabled: false }).enabled).toBe(false);
  });

  it("三档和=100 → 原值直通", () => {
    const r = resolveEncounterConfig({
      enabled: true,
      baseRates: { good: 30, neutral: 45, bad: 25 },
    });
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

  it("0 是合法档位(中性 100% 口径),不再触发回退;非法三档回退默认 30/45/25", () => {
    const r = resolveEncounterConfig({ baseRates: { good: 0, neutral: 100, bad: 0 } });
    expect(r.shares).toEqual({ good: 0, neutral: 100, bad: 0 });
    const bad = resolveEncounterConfig({ baseRates: { good: -1, neutral: Number.NaN, bad: 25 } });
    expect(bad.shares).toEqual({ good: 30, neutral: 45, bad: 25 });
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
    expect(pickTier(0.8, { good: 30, neutral: 45, bad: 25 })).toBe("霉运");
    const heavy = { id: "重", weight: 9 };
    const light = { id: "轻", weight: 1 };
    expect(pickWeighted([heavy, light], 0.5)).toBe(heavy);
    expect(pickWeighted([heavy, light], 0.95)).toBe(light);
  });

  it("目录 v3 = 30 条(#188 档 2 决策化扩容),档位 11/8/11,抉择 15 条占半,标签词表合法", () => {
    expect(ENCOUNTERS.length).toBe(30);
    expect(ENCOUNTERS.filter((c) => c.tier === "好运").length).toBe(11);
    expect(ENCOUNTERS.filter((c) => c.tier === "中性").length).toBe(8);
    expect(ENCOUNTERS.filter((c) => c.tier === "霉运").length).toBe(11);
    const TAGS: EncounterDef["tags"] = [
      "银两",
      "名将",
      "珍宝",
      "城池",
      "声望",
      "玩家",
      "体力",
      "锦囊",
    ];
    for (const c of ENCOUNTERS) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.effect == null || c.choices == null).toBe(true); // 二选一
      expect(c.tags.length).toBeGreaterThan(0);
      for (const t of c.tags) expect(TAGS).toContain(t);
      if (c.choices) {
        expect(c.choices.length).toBeGreaterThanOrEqual(1);
        for (const o of c.choices) {
          expect(o.text.length).toBeGreaterThan(0);
          expect(Number.isFinite(o.repDelta)).toBe(true);
          expect(Math.abs(o.repDelta)).toBeLessThanOrEqual(30); // 声望增减 ±30 档
          expect(Math.abs(o.staminaDelta ?? 0)).toBeLessThanOrEqual(30); // 体力 ±30 内
        }
      }
    }
    expect(new Set(ENCOUNTERS.map((c) => c.id)).size).toBe(30); // id 唯一
    expect(ENCOUNTERS.filter((c) => c.choices).length).toBe(15); // 抉择型占半(#188 档 2)
    expect(ENCOUNTERS.filter((c) => c.tags.includes("体力")).length).toBe(12); // 体力 tag 计数(#132/#188)
    expect(ENCOUNTERS.filter((c) => c.tags.includes("玩家")).length).toBe(7); // 玩家侧转移(#188 扩 3 条)
    expect(ENCOUNTERS.filter((c) => c.tier === "霉运" && c.choices).length).toBe(6); // 霉运「两害相权」
  });
});

describe("机遇引擎行为", () => {
  it("开关缺省关 → 落格无机遇", () => {
    const e = makeEngine(7); // 未传 encounter = 关闭
    finishSetup(e);
    landOnFreeTile(e);
    expect(testEngine(e).logText().includes("机遇「")).toBe(false);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 直接进购地决策,无机遇插戏
  });

  it("开关开(必出)→ 机遇先于城池结算:日志先机遇后可购,停在购地决策", () => {
    // 钉「落无主城抽中即时机遇」的种子:好运重仓下即时条目占多数,AwaitingDecision=已解完
    const seed = ((): number => {
      for (let s = 1; s < 200; s++) {
        const e0 = makeEngine(s, { good: 100, neutral: 0, bad: 0 });
        finishSetup(e0);
        try {
          landOnFreeTile(e0);
        } catch {
          continue; // 无可用候选场景换下一 seed
        }
        if (e0.turnPhase === "AwaitingDecision") return s;
      }
      throw new Error("无即时机遇落格种子");
    })();
    const e = makeEngine(seed, { good: 100, neutral: 0, bad: 0 });
    finishSetup(e);
    landOnFreeTile(e);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 机遇后照常进入购地决策
    const text = testEngine(e).logText();
    const encIdx = text.lastIndexOf("机遇「");
    const buyIdx = text.lastIndexOf("可购");
    expect(encIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(encIdx); // 机遇在前,城池事件在后
  });

  it("天命格零豁免(ADR-0035):必出机遇,解完再落天命 +20(机遇先于本格结算)", () => {
    // 钉「天命格抽中即时机遇」的种子(抉择机遇会停 AwaitingEncounter,不适用本场景)
    const seed = ((): number => {
      for (let s = 1; s < 200; s++) {
        const e0 = makeEngine(s, { good: 100, neutral: 0, bad: 0 });
        finishSetup(e0);
        const fate = e0.board.tiles.find((t) => t.type === "Fate");
        if (!fate) throw new Error("地图无天命格");
        try {
          landActiveOn(e0, fate.index);
        } catch {
          continue; // 途经都城等无效场景换下一 seed
        }
        if (e0.turnPhase === "Roll") return s;
      }
      throw new Error("无天命格即时机遇种子");
    })();
    const e = makeEngine(seed, { good: 100, neutral: 0, bad: 0 });
    finishSetup(e);
    const mover = e.activePlayer;
    landActiveOn(e, e.board.tiles.find((t) => t.type === "Fate")!.index);
    expect(e.turnPhase).toBe("Roll"); // 机遇(即时)+ 天命 +20 各自收尾,回合已过
    const text = testEngine(e).logText();
    const encIdx = text.lastIndexOf("机遇「");
    const fateIdx = text.lastIndexOf("天命眷顾");
    expect(encIdx).toBeGreaterThan(-1);
    expect(fateIdx).toBeGreaterThan(encIdx); // 机遇在前,天命泉在后
    expect(mover.reputation).toBe(20); // 天命泉照常落账(即时机遇无声望增减)
  });

  it("结算路径:发珍宝(牌堆扣一件)/ 得名将满 3 → 转银两", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const deckBefore = e.treasureDeck.length;
    te.applyEncounter(mover, {
      id: "窖藏现世",
      tier: "好运",
      tags: ["珍宝"],
      weight: 1,
      text: "t",
      effect: { kind: "grantTreasure" },
    });
    expect(mover.treasures.length).toBe(1);
    expect(e.treasureDeck.length).toBe(deckBefore - 1);

    const full = e.activePlayer;
    full.heroes.push(
      { id: "h1", name: "甲", title: "", image: "" },
      { id: "h2", name: "乙", title: "", image: "" },
      { id: "h3", name: "丙", title: "", image: "" },
    );
    const cashBefore = full.cash;
    te.applyEncounter(full, {
      id: "义士来投",
      tier: "好运",
      tags: ["名将"],
      weight: 1,
      text: "t",
      effect: { kind: "grantHero", fallbackCash: 200 },
    });
    expect(full.heroes.length).toBe(3); // 不超容量
    expect(full.cash).toBe(cashBefore + 200); // 转银两补偿
  });

  it("授宝遇牌堆空 → 折现 100 两两件套(#455 A2):cashChanged 事件 + CashGained 时机缺一不可", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    e.treasureDeck.length = 0; // 牌堆清空 → 「搜刮一空」折现路
    const cash0 = mover.cash;
    const entries = recordMomentCtx(e);
    beginGameEventBatch(e);
    const r = te.applyEncounter(mover, {
      id: "窖藏现世",
      tier: "好运",
      tags: ["珍宝"],
      weight: 1,
      text: "t",
      effect: { kind: "grantTreasure" },
    });
    expect(r).toBe("settled");
    expect(mover.treasures).toHaveLength(0); // 无宝可得
    expect(mover.cash).toBe(cash0 + 100); // 折现 100 两入账
    // 事件半边:cashChanged(reason=encounter,delta=100)
    const events = e.snapshot().events;
    expect(
      events.some(
        (v) =>
          v.kind === "cashChanged" &&
          v.seat === seat &&
          v.delta === 100 &&
          v.reason === "encounter",
      ),
    ).toBe(true);
    // 时机半边:CashGained(subject=折现者,amount=100)
    expect(entries.filter((x) => x.moment === "CashGained").map((x) => x.ctx)).toEqual([
      { subject: seat, amount: 100 },
    ]);
  });

  it("赐城宣告(#719 四件套):传檄而定 grantCity 产 propertyGranted 事件,得城者 Lv.0 入册", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const unowned = e.board.tiles.filter(
      (t) => t.propertyId != null && e.findOwner(t.propertyId) == null,
    );
    const count0 = mover.properties.length; // 都城在册(开局建城),赐城 = +1
    beginGameEventBatch(e);
    const r = te.applyEncounter(mover, {
      id: "传檄而定",
      tier: "好运",
      tags: ["城池"],
      weight: 1,
      text: "t",
      effect: { kind: "grantCity", fallbackCash: 300 },
    });
    expect(r).toBe("settled");
    expect(mover.properties).toHaveLength(count0 + 1); // 无主城入册 Lv.0(棋盘无主城恒有,地图守卫)
    const granted = mover.properties[mover.properties.length - 1]!;
    expect(granted.level).toBe(0);
    // 事件半边:propertyGranted(赐城易主宣告,fx=城池宣告动画)
    const events = e.snapshot().events;
    expect(
      events.some(
        (v) =>
          v.kind === "propertyGranted" && v.seat === seat && v.propertyId === granted.propertyId,
      ),
    ).toBe(true);
    expect(unowned.some((t) => t.propertyId === granted.propertyId)).toBe(true);
  });

  it("结算路径:玩家转移上限=对方现金;levy 破产走 endTurn", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    const opponent = e.players.find((p) => p !== mover)!;
    opponent.cash = 50;
    te.applyEncounter(mover, {
      id: "纳款输诚",
      tier: "好运",
      tags: ["银两", "玩家"],
      weight: 1,
      text: "t",
      effect: { kind: "siphon", amount: 200 },
    });
    expect(opponent.cash).toBe(0); // 上限=对方现金,不打垮对方
    expect(mover.cash).toBeGreaterThanOrEqual(50);

    const loser = e.activePlayer;
    loser.cash = 10;
    loser.properties = []; // 无产可清算
    const oppCash = e.players.find((p) => p !== loser)!.cash;
    const r = te.applyEncounter(loser, {
      id: "假道征粮",
      tier: "霉运",
      tags: ["银两", "玩家"],
      weight: 1,
      text: "t",
      effect: { kind: "levy", amount: 150 },
    });
    expect(r).toBe("bankrupt");
    expect(loser.isBankrupt).toBe(true);
    expect(e.players.find((p) => p !== loser)!.cash).toBe(oppCash); // 破产则对手分文未得
  });

  it("确定性:同 seed 同配置两局,完整一轮后快照逐位一致(机遇 roll 全走引擎 dice)", () => {
    const snap = (seed: number) => {
      const e = makeEngine(seed, {});
      finishSetup(e);
      for (let i = 0; i < e.players.length && !e.isOver; i++) {
        passJinnang(e).rollAndMove();
        let guard = 0;
        while (e.turnPhase !== "Roll" && e.turnPhase !== "GameOver" && guard++ < 20) {
          if (e.turnPhase === "AwaitingDecision") e.endDecision();
          else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(1);
          else if (e.turnPhase === "AwaitingEncounter") {
            // 抉择机遇(#124):选第一个可用项(结盟互市等单选项不会到这——引擎已自动执行)
            const avail = e.choicesFor().findIndex((o) => o.available);
            e.resolveEncounterChoice(Math.max(0, avail));
          } else if (e.turnPhase === "AwaitingTreasureOwner")
            e.resolveTreasureOwner({ type: "skip" });
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

// ═════════════════════ 驻跸截断 × 机遇必出(ADR-0035,#776)═════════════════════
describe("必停都城接机遇(ADR-0035):机遇→补给→结束回合,零豁免", () => {
  /** 好运重仓:98/1/1 经调制夹紧 → 好运 95。 */
  const GOOD_HEAVY = { good: 98, neutral: 1, bad: 1 };
  /** 中性重仓(同抉择机遇组口径):1/98/1 → 中性 98。 */
  const NEUTRAL = { good: 1, neutral: 98, bad: 1 };

  /** 探针:复刻引擎抽取消耗序(行军骰 → 档位 → 同档加权),不消费引擎骰。 */
  function probeNextEncounter(e: GameEngine, cfg: { good: number; neutral: number; bad: number }) {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const shares = tierShares(
      e.activePlayer.reputation,
      resolveEncounterConfig({ enabled: true, ...cfg }).shares,
    );
    const tier = pickTier(probe.nextFloat(), shares);
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 钉一个「掷骰 ≥2 步(能越过都城)且驻跸截断必抽中指定机遇」的种子。 */
  function haltSeed(id: string, cfg: { good: number; neutral: number; bad: number }): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, cfg);
      finishSetup(e);
      if (peekDie(e) < 2) continue;
      if (probeNextEncounter(e, cfg).id === id) return seed;
    }
    throw new Error(`无驻跸种子抽中 ${id}`);
  }

  /** 摆位掷骰:from = 都城前 1 格,第 1 步即踩都城、落点越过 → 必停截断。 */
  function marchToHalt(e: GameEngine): void {
    const n = e.board.count;
    const from = (((e.activePlayer.capitalIndex - 1) % n) + n) % n;
    testEngine(e).placeActive(from);
    passJinnang(e).rollAndMove();
  }

  it("开关开:驻跸截断必出机遇,先机遇后补给,补给落账、回合收尾", () => {
    const e = makeEngine(haltSeed("屯粮居奇", GOOD_HEAVY), GOOD_HEAVY);
    finishSetup(e);
    const mover = e.activePlayer;
    const { supply } = capitalSupplyOf(e, mover);
    const cash0 = mover.cash;
    marchToHalt(e);
    expect(mover.position).toBe(mover.capitalIndex); // 必停都城
    expect(e.turnPhase).toBe("Roll"); // 机遇(即时)+补给后 endTurn 收尾
    expect(mover.cash).toBe(cash0 + supply + 250); // 屯粮居奇 +250 与驻跸补给先后落账
    const text = testEngine(e).logText();
    expect(text.lastIndexOf("机遇「屯粮居奇」")).toBeGreaterThan(-1);
    expect(text.lastIndexOf("驻跸补给")).toBeGreaterThan(text.lastIndexOf("机遇「屯粮居奇」"));
    expect(e.pendingEncounterHalt).toBe(false); // 直落:续跑标记当场消费
  });

  it("开关关:驻跸截断无机遇,补给照旧(旧行为守卫)", () => {
    const e = makeEngine(haltSeed("屯粮居奇", GOOD_HEAVY)); // 同种子,但不传 encounter = 关
    finishSetup(e);
    const mover = e.activePlayer;
    const { supply } = capitalSupplyOf(e, mover);
    const cash0 = mover.cash;
    marchToHalt(e);
    expect(mover.position).toBe(mover.capitalIndex);
    expect(e.turnPhase).toBe("Roll");
    expect(mover.cash).toBe(cash0 + supply);
    expect(testEngine(e).logText().includes("机遇「")).toBe(false);
  });

  it("驻跸截断遇抉择机遇:占用落格置续跑标记,解完续跑驻跸尾(补给+结束回合)", () => {
    const e = makeEngine(haltSeed("携民渡江", NEUTRAL), NEUTRAL);
    finishSetup(e);
    const mover = e.activePlayer;
    const { supply } = capitalSupplyOf(e, mover);
    const cash0 = mover.cash;
    marchToHalt(e);
    expect(e.turnPhase).toBe("AwaitingEncounter"); // 抉择机遇占用驻跸落格
    expect(e.pendingEncounter?.id).toBe("携民渡江");
    expect(e.pendingEncounterHalt).toBe(true); // 续跑标记置位
    e.resolveEncounterChoice(1); // 径自过江(无事发生)
    expect(e.pendingEncounterHalt).toBe(false);
    expect(mover.cash).toBe(cash0 + supply); // 驻跸补给续跑落账
    expect(e.turnPhase).toBe("Roll"); // endTurn 收尾
    const text = testEngine(e).logText();
    expect(text.lastIndexOf("驻跸补给")).toBeGreaterThan(text.lastIndexOf("机遇「携民渡江」"));
  });

  it("驻跸截断 × 抉择机遇快照 round-trip:恢复后续跑标记与机遇回链俱在,解完照常补给收尾", () => {
    const e = makeEngine(haltSeed("携民渡江", NEUTRAL), NEUTRAL);
    finishSetup(e);
    const mover = e.activePlayer;
    const moverSeat = e.players.indexOf(mover);
    const { supply } = capitalSupplyOf(e, mover);
    const cash0 = mover.cash;
    marchToHalt(e);
    expect(e.turnPhase).toBe("AwaitingEncounter");
    const s = e.snapshot();
    const e2 = makeEngine(99);
    finishSetup(e2);
    e2.restoreFromSnapshot(s);
    expect(e2.turnPhase).toBe("AwaitingEncounter");
    expect(e2.pendingEncounterHalt).toBe(true); // 标记随快照走
    e2.resolveEncounterChoice(1);
    expect(e2.pendingEncounterHalt).toBe(false);
    expect(e2.players[moverSeat].cash).toBe(cash0 + supply); // 补给落到行者头上
    expect(e2.turnPhase).toBe("Roll"); // endTurn 收尾,下家已接棒
  });
});

// ═════════════════════ 抉择机遇:决策相位与选项结算(#124)═════════════════════
describe("抉择机遇(#124):入相与快照", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;
  const treasure = (id: string) => ({ id, name: `宝${id}`, level: 1, desc: "" });

  /** 探针:复刻引擎抽取消耗序(行军骰 → 档位 → 同档加权,ADR-0035 必出制无触发 roll),
   *  按当前 rng 状态算出下一次落格会抽中的机遇,不消费引擎骰。开关开 + 中性基准拉满
   *  (三档须 >0,否则 resolveEncounterConfig 回退默认 30/45/25——#120 口径),档位调制
   *  夹紧 [5,95] 后中性占 90。 */
  const NEUTRAL_HEAVY = { good: 1, neutral: 98, bad: 1 };

  function probeNextEncounter(e: GameEngine): EncounterDef {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const shares = tierShares(
      e.activePlayer.reputation,
      resolveEncounterConfig({ enabled: true, ...NEUTRAL_HEAVY }).shares,
    );
    const tier = pickTier(probe.nextFloat(), shares);
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 找一个「落格必抽中指定机遇」的种子(确定性扫描,setup 后的骰流决定抽取)。 */
  function seedDrawing(id: string): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, NEUTRAL_HEAVY);
      finishSetup(e);
      if (probeNextEncounter(e).id === id) return seed;
    }
    throw new Error(`无种子抽中 ${id}`);
  }

  it("抽中抉择机遇(真实抽取路径)→ 进 AwaitingEncounter,快照携带机遇 id/文段/选项", () => {
    const e = makeEngine(seedDrawing("携民渡江"), NEUTRAL_HEAVY);
    finishSetup(e);
    landOnFreeTile(e);
    const def = byId("携民渡江");
    expect(e.turnPhase).toBe("AwaitingEncounter");
    expect(e.pendingEncounter?.id).toBe("携民渡江");
    const s = e.snapshot();
    expect(s.choices.map((o) => o.label)).toEqual(def.choices!.map((c) => c.text)); // 选项原文
    expect(s.choices.every((o) => o.encounterId === "携民渡江")).toBe(true); // 机遇 id 过网
    expect(s.choices[0].encounterText).toBe(def.text); // 文段过网
    expect(s.choices.every((o) => o.available)).toBe(true); // 两选无门槛
    expect(s.decisionOwner).toBe(s.activeIndex); // 决策归属 = 行动者
  });

  it("抉择机遇先行:抽中后进机遇相位,城池结算等解完再继续", () => {
    const e = makeEngine(seedDrawing("携民渡江"), NEUTRAL_HEAVY);
    finishSetup(e);
    landOnFreeTile(e); // 落点是无主城:先机遇相位,解完才进购地决策
    expect(e.turnPhase).toBe("AwaitingEncounter");
    const text = testEngine(e).logText();
    expect(text.includes("机遇「携民渡江」")).toBe(true);
    expect(text.includes("可购(")).toBe(false); // 无城池事件
  });

  it("resolve:携民渡江选「携民渡江」→ 银两 −150 走支付、repDelta +10 落账、回合收尾", () => {
    const e = makeEngine(seedDrawing("携民渡江"), NEUTRAL_HEAVY);
    finishSetup(e);
    landOnFreeTile(e);
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    const turn0 = e.turnNumber;
    e.submitCommand({ type: "resolveEncounterChoice", index: 0 });
    expect(mover.cash).toBe(cash0 - 150);
    expect(mover.reputation).toBe(10);
    expect(e.pendingEncounter).toBeNull();
    // 机遇解完 → 继续本落格的城池结算(#120 决策 2):购地决策弹出,endDecision 后回合收尾
    expect(e.turnPhase).toBe("AwaitingDecision");
    e.endDecision();
    expect(e.turnPhase).toBe("Roll");
    expect(e.turnNumber).toBe(turn0 + 1);
    const text = testEngine(e).logText();
    expect(text.includes("机遇「携民渡江」抉择:携民渡江(费银 150 两,声望 +10)")).toBe(true);
    expect(text.includes("encounterChoice")).toBe(true); // 机读行:机遇 id + 所选选项
    expect(text.includes("−150") || text.includes("-150")).toBe(true);
  });

  it("repDelta 夹紧:声望 95 选「携民渡江」(+10)→ 100(±100 钳位)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.reputation = 95;
    testEngine(e).enterEncounter(byId("携民渡江"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    e.resolveEncounterChoice(0);
    expect(mover.reputation).toBe(100);
  });

  it("以宝换贤:2 珍宝换 1 名将(珍宝扣光、名将入帐、rep/银两不动)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.treasures.push(treasure("t1"), treasure("t2"));
    const cash0 = mover.cash;
    testEngine(e).placeActive(benignTile(e)); // 中性床位:解完续跑落空结算
    testEngine(e).enterEncounter(byId("以宝换贤"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    expect(e.choicesFor().every((o) => o.available)).toBe(true);
    e.resolveEncounterChoice(0);
    expect(mover.treasures.length).toBe(0);
    expect(mover.heroes.length).toBe(1);
    expect(e.recruitedHeroIds.has(mover.heroes[0].id)).toBe(true); // 名将入招贤池台账
    expect(mover.cash).toBe(cash0);
    expect(mover.reputation).toBe(0);
    expect(e.turnPhase).toBe("Roll");
  });

  it("以宝换贤门槛:珍宝不足 → 换贤不可用 reason「珍宝不足」,唯一可用项(婉言相拒)自动执行", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.treasures.push(treasure("t1")); // 1 件 < 2
    const turn0 = e.turnNumber;
    testEngine(e).placeActive(benignTile(e));
    testEngine(e).enterEncounter(byId("以宝换贤"));
    expect(e.turnPhase).toBe("Roll"); // ≤1 可用选项:自动执行,不弹相位(ADR-0013)
    expect(e.turnNumber).toBe(turn0 + 1);
    expect(mover.treasures.length).toBe(1); // 珍宝未被换走
    expect(testEngine(e).logText().includes("婉言相拒")).toBe(true);
    // 注册表口径直核(武装相位态):available/reason 单源 choices.ts
    e.pendingEncounter = byId("以宝换贤");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("珍宝不足");
    expect(opts[1].available).toBe(true);
    e.resolveEncounterChoice(0); // 不可用选项引擎硬拒绝
    expect(e.turnPhase).toBe("AwaitingEncounter"); // 拒绝后仍停在相位
  });

  it("以宝换贤门槛:麾下已满 → reason「麾下已满」", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.treasures.push(treasure("t1"), treasure("t2"));
    mover.heroes.push(
      { id: "h1", name: "甲", title: "", image: "" },
      { id: "h2", name: "乙", title: "", image: "" },
      { id: "h3", name: "丙", title: "", image: "" },
    );
    e.pendingEncounter = byId("以宝换贤");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("麾下已满");
  });

  it("结盟互市:单选项自动执行(≤1 可用,ADR-0013),双方各 +100 两、不弹相位", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const opp = e.players.find((p) => p !== mover)!;
    const cash0 = mover.cash;
    const oppCash0 = opp.cash;
    const turn0 = e.turnNumber;
    testEngine(e).placeActive(benignTile(e));
    const r = testEngine(e).enterEncounter(byId("结盟互市"));
    expect(r).toBe("deciding"); // 机遇占用本落格
    expect(e.turnPhase).toBe("Roll"); // 自动收尾,从未进 AwaitingEncounter
    expect(e.turnNumber).toBe(turn0 + 1);
    expect(mover.cash).toBe(cash0 + 100);
    expect(opp.cash).toBe(oppCash0 + 100); // 国库出,正和
    const text = testEngine(e).logText();
    expect(text.includes("机遇「结盟互市」")).toBe(true);
    expect(text.includes("各得 100 两")).toBe(true);
    // 选项文案浮字由 fx 按目录派生(单选项自动执行同产 encounterChoice,见 presentation.test)
    expect(
      e
        .snapshot()
        .events.some((ev) => ev.kind === "encounterChoice" && ev.encounterId === "结盟互市"),
    ).toBe(true);
  });

  it("抽中结盟互市(真实抽取路径)→ 单选项自动执行,机遇解完继续购地决策", () => {
    const e = makeEngine(seedDrawing("结盟互市"), NEUTRAL_HEAVY);
    finishSetup(e);
    landOnFreeTile(e);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 自动执行完 → 继续本落格的购地决策
    const text = testEngine(e).logText();
    expect(text.includes("机遇「结盟互市」")).toBe(true);
    expect(text.includes("各得 100 两")).toBe(true);
    expect(text.includes("可购(")).toBe(true);
  });

  it("快照 round-trip:AwaitingEncounter 恢复后机遇回链目录、choices 重算一致、可继续抉择", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.treasures.push(treasure("t1"), treasure("t2"));
    testEngine(e).enterEncounter(byId("以宝换贤"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    const s = e.snapshot();
    const e2 = makeEngine(99);
    finishSetup(e2);
    e2.restoreFromSnapshot(s); // 机遇 id 随 choices 过网,restore 按 id 回链目录
    expect(e2.turnPhase).toBe("AwaitingEncounter");
    expect(e2.pendingEncounter?.id).toBe("以宝换贤");
    expect(e2.snapshot().choices).toEqual(s.choices);
    e2.resolveEncounterChoice(0);
    expect(e2.players[0].treasures.length + e2.players[1].treasures.length).toBe(0);
    // 解完续跑:首位玩家落在己方都城 → 招贤纳士相位(都城落格固有机制)
    expect(e2.turnPhase).toBe("AwaitingHeroPick");
  });

  it("快照恢复:AwaitingEncounter 但 choices 无机遇标识 → 数据损坏直接抛错(零兜底)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const s = e.snapshot();
    const e2 = makeEngine(7);
    finishSetup(e2);
    e2.pendingEncounter = byId("携民渡江");
    testEngine(e2).forceTurnPhase("AwaitingEncounter");
    expect(() =>
      e2.restoreFromSnapshot({ ...s, turnPhase: "AwaitingEncounter", choices: [] }),
    ).toThrow(/抉择机遇上下文缺失/);
  });

  it("即时机遇回归:settleEncounter 叙事仍用 def.text(效果结算提取不漂移)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    testEngine(e).applyEncounter(mover, def("屯粮居奇", { kind: "cash", delta: 250 }));
    expect(mover.cash).toBe(cash0 + 250);
    expect(testEngine(e).logText().includes("机遇「屯粮居奇」:屯粮居奇 +250")).toBe(true);
  });
});

// ═════════════════════ 档 2 新抉择:结算断言(#188 决策化扩容)═════════════════════
describe("#188 档 2 新抉择:选项效果结算", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;

  /** 中性床位入相(解完续跑落空结算收尾,turnPhase 回 Roll)。 */
  function arm(e: GameEngine, id: string): void {
    testEngine(e).placeActive(benignTile(e));
    testEngine(e).enterEncounter(byId(id));
    expect(e.turnPhase).toBe("AwaitingEncounter");
  }

  it("奉迎天子:得岁赐 +300、声望 −10 落账;礼送出境无事", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    arm(e, "奉迎天子");
    e.resolveEncounterChoice(0);
    expect(mover.cash).toBe(cash0 + 300);
    expect(mover.reputation).toBe(-10);
    expect(e.turnPhase).toBe("Roll");
    expect(
      testEngine(e).logText().includes("机遇「奉迎天子」抉择:奉迎天子(得岁赐 300 两,声望 −10)"),
    ).toBe(true);
  });

  it("义释俘虏:义释 rep +8、分文不动;押质勒赎 siphon(上限=对方现金)、rep −8", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    arm(e, "义释俘虏");
    e.resolveEncounterChoice(0); // 义释归乡
    expect(mover.reputation).toBe(8);
    expect(mover.cash).toBe(cash0);
    expect(e.turnPhase).toBe("Roll");

    const e2 = makeEngine(7);
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    const opp2 = e2.players.find((p) => p !== mover2)!;
    const cash02 = mover2.cash;
    const oppCash0 = opp2.cash; // 起手现金 > 120:勒赎足额
    arm(e2, "义释俘虏");
    e2.resolveEncounterChoice(1); // 押质勒赎
    expect(mover2.cash).toBe(cash02 + 120);
    expect(opp2.cash).toBe(oppCash0 - 120);
    expect(mover2.reputation).toBe(-8);
  });

  it("两害相权:疫病入营(−200 / 体力 −25)、河堤告急(−80+体力 −15 组合)、盟镇勒币(levy 资敌)", () => {
    // 疫病入营:硬撑操练——无 effect、纯选项级 staminaDelta −25
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 80;
    const cash0 = mover.cash;
    arm(e, "疫病入营");
    e.resolveEncounterChoice(1);
    expect(mover.stamina).toBe(55);
    expect(mover.cash).toBe(cash0);
    expect(e.turnPhase).toBe("Roll");

    // 河堤告急:听天由命——effect(cash −80)与选项级 staminaDelta(−15)组合落账
    const e2 = makeEngine(7);
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    mover2.stamina = 80;
    const cash02 = mover2.cash;
    arm(e2, "河堤告急");
    e2.resolveEncounterChoice(1);
    expect(mover2.cash).toBe(cash02 - 80);
    expect(mover2.stamina).toBe(65);

    // 盟镇勒币:隐忍输币——levy 120 付给随机对手(二人局唯一对手)
    const e3 = makeEngine(7);
    finishSetup(e3);
    const mover3 = e3.activePlayer;
    const opp3 = e3.players.find((p) => p !== mover3)!;
    const cash03 = mover3.cash;
    const oppCash0 = opp3.cash;
    arm(e3, "盟镇勒币");
    e3.resolveEncounterChoice(0);
    expect(mover3.cash).toBe(cash03 - 120);
    expect(opp3.cash).toBe(oppCash0 + 120);
    expect(mover3.reputation).toBe(0);
  });
});

// ═════════════════════ bot 抉择策略(#124)═════════════════════
describe("bot 抉择策略:立即净值贪心 + 声望折银系数", () => {
  const botSeats: SeatConfig[] = [
    { name: "A", isBot: true, guohao: "魏" },
    { name: "B", isBot: true, guohao: "蜀" },
  ];
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;

  /** 武装一个自定义抉择机遇进 AwaitingEncounter(绕过抽取,直接验证 bot 打分)。 */
  function armChoices(e: GameEngine, choices: EncounterChoiceOption[]): void {
    e.pendingEncounter = {
      id: "测试机遇",
      tier: "中性",
      tags: ["银两"],
      weight: 1,
      text: "t",
      choices,
    };
    testEngine(e).forceTurnPhase("AwaitingEncounter");
  }

  it("repCoefficient ∈ [5,9]、确定性、座位间有性格差", () => {
    for (let seat = 0; seat < 16; seat++) {
      expect(repCoefficient(seat)).toBe(repCoefficient(seat)); // 确定性
      expect(repCoefficient(seat)).toBeGreaterThanOrEqual(5);
      expect(repCoefficient(seat)).toBeLessThanOrEqual(9);
    }
    expect(new Set(Array.from({ length: 16 }, (_, i) => repCoefficient(i))).size).toBeGreaterThan(
      1,
    );
  });

  it("encounterCashImpact:cash/转移按面值、levy 取负、grant 系只计 fallback、无 effect=0", () => {
    expect(encounterCashImpact({ kind: "cash", delta: -150 })).toBe(-150);
    expect(encounterCashImpact({ kind: "trade", amount: 100 })).toBe(100);
    expect(encounterCashImpact({ kind: "siphon", amount: 200 })).toBe(200);
    expect(encounterCashImpact({ kind: "levy", amount: 150 })).toBe(-150);
    expect(encounterCashImpact({ kind: "grantHero", fallbackCash: 0 })).toBe(0);
    expect(encounterCashImpact({ kind: "grantCity", fallbackCash: 300 })).toBe(300);
    expect(encounterCashImpact({ kind: "grantTreasure" })).toBe(0);
    expect(encounterCashImpact(undefined)).toBe(0);
  });

  it("纯银两贪心:+100 银选项胜过无事发生,结算后离开相位", () => {
    const e = makeEngine(7, undefined, botSeats);
    finishSetup(e);
    testEngine(e).placeActive(benignTile(e));
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    armChoices(e, [
      { text: "收下(+100)", repDelta: 0, effect: { kind: "cash", delta: 100 } },
      { text: "婉拒(无事)", repDelta: 0 },
    ]);
    botAct(e);
    expect(mover.cash).toBe(cash0 + 100);
    expect(e.turnPhase).toBe("Roll");
  });

  it("声望入账:repDelta × repCoefficient 折银比较——系数够高则舍银取义,否则取银", () => {
    const e = makeEngine(7, undefined, botSeats);
    finishSetup(e);
    testEngine(e).placeActive(benignTile(e));
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    armChoices(e, [
      { text: "舍银取义(−100,声望 +20)", repDelta: 20, effect: { kind: "cash", delta: -100 } },
      { text: "见利即取(无事)", repDelta: 0 },
    ]);
    const coef = repCoefficient(e.activeIndex);
    botAct(e);
    if (20 * coef > 100) {
      expect(mover.reputation).toBe(20); // 重声望性格:20×系数 折银超过 100
      expect(mover.cash).toBe(cash0 - 100);
    } else {
      expect(mover.reputation).toBe(0); // 轻声望性格:贪银
      expect(mover.cash).toBe(cash0);
    }
    expect(e.turnPhase).toBe("Roll"); // 无论哪种性格都完成抉择
  });

  it("目录事件口径:携民渡江(−150/+10)系数 ≤9 恒折不过 150 → bot 拒;以宝换贤不可用项被跳过", () => {
    const e = makeEngine(7, undefined, botSeats);
    finishSetup(e);
    testEngine(e).placeActive(benignTile(e)); // 中性床位:解完续跑按普通格空结算
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    e.pendingEncounter = byId("携民渡江");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    botAct(e);
    expect(mover.reputation).toBe(0);
    expect(mover.cash).toBe(cash0); // 径自过江
    expect(e.turnPhase).toBe("Roll");

    // 以宝换贤:0 珍宝直入相位(注册表拦下换贤项)→ bot 只能落婉言相拒
    const e2 = makeEngine(7, undefined, botSeats);
    finishSetup(e2);
    testEngine(e2).placeActive(benignTile(e2));
    const mover2 = e2.activePlayer;
    e2.pendingEncounter = byId("以宝换贤");
    testEngine(e2).forceTurnPhase("AwaitingEncounter");
    botAct(e2);
    expect(mover2.treasures.length).toBe(0);
    expect(e2.turnPhase).toBe("Roll");
    expect(testEngine(e2).logText().includes("婉言相拒")).toBe(true);
  });

  it("目录新事件(#188 档 2):义释俘虏按声望系数分道(轻声望勒赎/重声望义释);坚壁清野恒取焚田", () => {
    // 义释俘虏:义释得分 8×coef,勒赎得分 120−8×coef——coef>7.5 义释,否则勒赎
    const e = makeEngine(7, undefined, botSeats);
    finishSetup(e);
    testEngine(e).placeActive(benignTile(e));
    const mover = e.activePlayer;
    const opp = e.players.find((p) => p !== mover)!;
    const oppCash0 = opp.cash; // 起手现金 > 120:勒赎足额
    e.pendingEncounter = byId("义释俘虏");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const coef = repCoefficient(e.activeIndex);
    botAct(e);
    expect(e.turnPhase).toBe("Roll");
    if (coef > 7.5) {
      expect(mover.reputation).toBe(8); // 重声望性格:仁名折银超过赎金
      expect(opp.cash).toBe(oppCash0);
    } else {
      expect(mover.reputation).toBe(-8); // 轻声望性格:取赎银
      expect(opp.cash).toBe(oppCash0 - 120);
    }

    // 坚壁清野:焚田 −15×coef ∈ [−75,−135] 恒优于任劫 −200 → bot 恒取焚田清野
    const e2 = makeEngine(7, undefined, botSeats);
    finishSetup(e2);
    testEngine(e2).placeActive(benignTile(e2));
    const mover2 = e2.activePlayer;
    e2.pendingEncounter = byId("坚壁清野");
    testEngine(e2).forceTurnPhase("AwaitingEncounter");
    botAct(e2);
    expect(mover2.reputation).toBe(-15);
    expect(testEngine(e2).logText().includes("抉择:焚田清野(声望 −15)")).toBe(true);
    expect(e2.turnPhase).toBe("Roll");
  });
});

// ═════════════════════ 机遇体力接线(#132)═════════════════════
describe("机遇体力(#132):staminaDelta 落账与耗竭接线", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;

  /** 给 seat 一座指定等级的非都城房产(stamina.test 同款):保证耗竭可用选项 ≥2。 */
  function giveProperty(e: GameEngine, seat: number, level: number): string {
    const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
    const tile = MAP.board.tiles.find(
      (t) => t.type === "Property" && t.propertyId && !taken.has(t.propertyId),
    )!;
    const d = MAP.catalog.get(tile.propertyId)!;
    e.players[seat].properties.push({
      propertyId: d.id,
      group: d.group,
      level,
      maxLevel: d.maxLevel,
    });
    return d.id;
  }

  /** 霉运重仓配置:三档 1/1/98 经声望夹紧 [5,95] → 好运 5/中性 0/霉运 95。 */
  const BAD_HEAVY = { good: 1, neutral: 1, bad: 98 };

  /** 探针:复刻引擎抽取消耗序(行军骰 → 档位 → 同档加权,ADR-0035 必出制无触发 roll),
   *  按当前 rng 状态算出下一次落格会抽中的机遇,不消费引擎骰(#124 抉择测试同款技巧)。 */
  function probeNextEncounter(e: GameEngine): EncounterDef {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const shares = tierShares(
      e.activePlayer.reputation,
      resolveEncounterConfig({ enabled: true, ...BAD_HEAVY }).shares,
    );
    const tier = pickTier(probe.nextFloat(), shares);
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 找一个「落格必抽中指定机遇」的种子(确定性扫描,setup 后的骰流决定抽取)。 */
  function seedDrawing(id: string): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, BAD_HEAVY);
      finishSetup(e);
      if (probeNextEncounter(e).id === id) return seed;
    }
    throw new Error(`无种子抽中 ${id}`);
  }

  it("目录调重生效:粮道被劫 −250 两/体力 −25;漕船倾覆 −100 两/体力 −20;假道征粮 levy 50/体力 −15", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    mover.stamina = 70; // 三连扣 25+20+15=60,不归 0(耗竭路径另有专测)
    const cash0 = mover.cash;
    te.applyEncounter(mover, byId("粮道被劫"));
    expect(mover.cash).toBe(cash0 - 250);
    expect(mover.stamina).toBe(45);

    te.applyEncounter(mover, byId("漕船倾覆"));
    expect(mover.cash).toBe(cash0 - 350);
    expect(mover.stamina).toBe(25);

    te.applyEncounter(mover, byId("假道征粮"));
    expect(mover.cash).toBe(cash0 - 400);
    expect(mover.stamina).toBe(10);
  });

  it("霉运机遇扣体力:浮字「体力 −25」+ 对局日志 detail 补 stamina=落账值", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 60;
    const r = testEngine(e).applyEncounter(mover, byId("粮道被劫"));
    expect(r).toBe("settled");
    expect(mover.stamina).toBe(35);
    // 浮字由 fx 消费 staminaChanged 派生(见 presentation.test):锚事件的实际差
    expect(
      e
        .snapshot()
        .events.some(
          (ev) => ev.kind === "staminaChanged" && ev.reason === "encounter" && ev.delta === -25,
        ),
    ).toBe(true);
    const text = testEngine(e).logText();
    expect(text.includes("机遇「粮道被劫」:粮道遭山贼劫掠,损失折银 250 两,体力 −25")).toBe(true);
    expect(text.includes("encounterStamina")).toBe(true);
    expect(text.includes("stamina=35")).toBe(true);
  });

  it("体力不足扣到负:战报增量记实际差(#568 病 B)——体力 20 吃 −25 记「体力 −20」", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 20;
    testEngine(e).applyEncounter(mover, byId("粮道被劫"));
    const text = testEngine(e).logText();
    expect(text.includes("体力 −20")).toBe(true); // 实际差 0−20=−20,非请求数 −25
    expect(text.includes("体力 −25")).toBe(false);
  });

  it("体力不足归 0 → 耗竭相位接管本落格:rollAndMove 门线跳过购地,房产降级可 resolve", () => {
    const e = makeEngine(seedDrawing("粮道被劫"), BAD_HEAVY);
    finishSetup(e);
    const seat = e.activeIndex;
    const mover = e.activePlayer;
    giveProperty(e, seat, 2);
    giveProperty(e, seat, 1); // 两座有级房产:耗竭可用选项 ≥2 → 进相位而非自动执行
    mover.stamina = 20;
    landOnFreeTile(e); // 真实抽取路径:抽中粮道被劫 → 体力 20−25 → 0
    expect(e.turnPhase).toBe("AwaitingExhaustion"); // 门线:耗竭占用落格,不进购地决策
    expect(e.pendingLand).toBeNull(); // 购地决策未弹出
    expect(mover.stamina).toBe(0);
    expect(testEngine(e).logText().includes("可购(")).toBe(false); // 城池结算确实被跳过
    const opts = e.choicesFor();
    expect(opts.length).toBe(2);
    expect(opts.every((o) => o.exhaustionKind === "downgrade")).toBe(true);
    const victim = opts[0].holdingPropertyId!;
    e.resolveExhaustionChoice(0);
    expect(mover.properties.find((h) => h.propertyId === victim)!.level).toBe(1); // 2 → 1
    expect(mover.skipTurns).toBe(1);
    expect(mover.stamina).toBe(100); // 耗竭善后重置
    expect(e.turnPhase).toBe("Roll");
  });

  it("回血抉择:温泉疗养付 150 两入浴 → 银两 −150、体力 +30(选项级 staminaDelta)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 60;
    const cash0 = mover.cash;
    testEngine(e).placeActive(benignTile(e)); // 中性床位:解完续跑落空结算
    testEngine(e).enterEncounter(byId("温泉疗养"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    expect(e.snapshot().choices.map((o) => o.label)).toEqual([
      "付 150 两入浴(+30 体力)",
      "不去(无事发生)",
    ]);
    e.resolveEncounterChoice(0);
    expect(mover.cash).toBe(cash0 - 150);
    expect(mover.stamina).toBe(90);
    // 浮字由 fx 消费 staminaChanged 派生:锚事件的实际差(60+30 无夹紧)
    expect(
      e
        .snapshot()
        .events.some(
          (ev) => ev.kind === "staminaChanged" && ev.reason === "encounter" && ev.delta === 30,
        ),
    ).toBe(true);
    expect(testEngine(e).logText().includes("stamina=90")).toBe(true);
    expect(e.turnPhase).toBe("Roll"); // 中性床位:机遇解完落空结算收尾
  });

  it("纯体力事件:神医行诊 +25 体力、银两不动,日志/浮字不出现「+0」", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 50;
    const cash0 = mover.cash;
    testEngine(e).applyEncounter(mover, byId("神医行诊"));
    expect(mover.stamina).toBe(75);
    expect(mover.cash).toBe(cash0);
    // 浮字由 fx 消费 staminaChanged 派生:锚事件的实际差
    expect(
      e
        .snapshot()
        .events.some(
          (ev) => ev.kind === "staminaChanged" && ev.reason === "encounter" && ev.delta === 25,
        ),
    ).toBe(true);
    expect(e.snapshot().events.some((ev) => ev.kind === "cashChanged" && ev.delta === 0)).toBe(
      false,
    ); // 无 0 金额宣告(现金零不落账,浮字随之无)
    const text = testEngine(e).logText();
    expect(text.includes("机遇「神医行诊」:神医路过举家调理,体力 +25")).toBe(true);
    expect(text.includes("+0")).toBe(false); // cash 0 特判生效:全日志无 "+0"
    expect(text.includes("stamina=75")).toBe(true);
  });

  it("抉择扣体力归 0:夜行军连夜赶路 → +150 两,耗竭自动结算收尾回合、不续跑落格", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 20; // 仅 0 级都城在册:耗竭无可用选项 → 自动执行(无可处置)
    const cash0 = mover.cash;
    const turn0 = e.turnNumber;
    testEngine(e).placeActive(benignTile(e));
    testEngine(e).enterEncounter(byId("夜行军"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    e.resolveEncounterChoice(0); // 连夜赶路(+150 两,体力 −20)
    expect(mover.cash).toBe(cash0 + 150);
    expect(e.turnPhase).toBe("Roll"); // 耗竭 auto 内已 endTurn 收尾
    expect(e.turnNumber).toBe(turn0 + 1); // 恰一次收尾:耗竭占用落格,未续跑落格结算
    expect(mover.skipTurns).toBe(1);
    expect(mover.stamina).toBe(100);
    expect(e.pendingEncounter).toBeNull();
  });
});

describe("耗竭自动收口 × 出牌阶段(#452):唯一选项自动路径不吞下家回合", () => {
  /** 给 seat 一座指定等级的非都城房产(上块 giveProperty 同款,不跨文件 import):
   *  恰一座 >0 级城 → 耗竭可用选项 =1 → 走 settleExhaustionChoice 自动执行路径。 */
  function giveOneProperty(e: GameEngine, seat: number, level: number): void {
    const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
    const tile = MAP.board.tiles.find(
      (t) => t.type === "Property" && t.propertyId && !taken.has(t.propertyId),
    )!;
    const d = MAP.catalog.get(tile.propertyId)!;
    e.players[seat].properties.push({
      propertyId: d.id,
      group: d.group,
      level,
      maxLevel: d.maxLevel,
    });
  }

  /** 开局并保留起手锦囊(下家须持可用牌,出牌阶段才开窗——老用例清空手牌故测不到 #452);
   *  仅活跃玩家收卷停 Roll。 */
  function finishSetupKeepHands(e: GameEngine): void {
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
    if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  }

  it("唯一可用选项自动执行后:下家照常入出牌阶段且可行动,turnNumber 恰 +1", () => {
    const e = makeEngine(7, undefined, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetupKeepHands(e);
    const mover = e.activePlayer;
    const nextSeat = (e.activeIndex + 1) % e.players.length;
    expect(e.players.every((p) => p.jinnangHandCount > 0)).toBe(true); // 场景前提:人人持牌
    giveOneProperty(e, e.activeIndex, 1);
    const turn0 = e.turnNumber;
    testEngine(e).applyEncounter(mover, {
      id: "夜行军",
      tier: "霉运",
      tags: ["体力"],
      weight: 1,
      text: "t",
      effect: { kind: "cash", delta: 0, staminaDelta: -100 }, // 纯体力事件:直落 0 触发耗竭
    });
    expect(mover.skipTurns).toBe(1); // 耗竭惩罚落账
    expect(mover.stamina).toBe(100);
    expect(e.activeIndex).toBe(nextSeat); // 下家回合照常开始(不被吞)
    expect(e.turnNumber).toBe(turn0 + 1); // 恰一次收尾:自动路径内已 endTurn,不得补第二枪
    expect(e.turnPhase).toBe("AwaitingJinnang"); // 下家出牌阶段开窗
    expect(e.choicesFor().length).toBeGreaterThan(0); // 卷轴有真实选项,可行动
  });
});

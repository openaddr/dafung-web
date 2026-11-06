// 机遇引擎单测(#123;ADR-0035 机遇必出):纯函数(softmax 调制/加权抽取) + 引擎行为
// (开关两端/先于城池结算/驻跸与天命同链/结算四路径与回退/确定性)。随机钉法:enabled
// 配置 0/1 两端 + landActiveOn 恰落目标格(timing.test 同款技巧),结算路径经
// testEngine.applyEncounter 指定具体事件绕过抽取。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct, encounterCashImpact, repCoefficient } from "@core/bot";
import { armHero, sweepTestHeroes, testEngine } from "@core/testing";
import { capitalSupplyOf } from "@core/movement-flow";
import { beginGameEventBatch } from "@core/game-events";
import type { GameMoment, MomentCtx } from "@core/timing";
import {
  ENCOUNTERS,
  assertChoicesNotFlagLocked,
  assertFlagGatePoolsDrawable,
  assertGrantHeroCostDeclared,
  drawableEncounters,
  tierShares,
  pickTier,
  pickWeighted,
  type EncounterChoiceOption,
  type EncounterDef,
  type EncounterEffect,
  type EncounterSwitch,
} from "@core/encounters";
import { HEROES } from "@core/heroes";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
/** 锦囊门垫(#122/T2):回合开始可能停在锦囊卷轴相位,直调 rollAndMove 的测试先「今不用」。
 *  pass 不掷骰,骰流与断言不受扰。 */
function passJinnang<T extends { turnPhase: string; resolveJinnang(cardId: string | null): void }>(
  e: T,
): T {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

const MAP = loadMap(guanzhongData);

// 合成名将(h1/h2/h3 等)经 armHero 登记进名将表,afterEach 精确清退防泄漏(#785)
afterEach(() => sweepTestHeroes());

function makeEngine(seed = 7, encounter?: EncounterSwitch, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    ...(encounter ? { encounter } : {}),
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
    (t) => t.event == null && t.propertyId != null && e.findOwner(t.propertyId) == null,
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

/** 中性床位(#826 全城池制改用他人无宝城):机遇解完续跑落格结算时,落此格走
 *  「他人城主无宝 → 无事发生」终端(Noop + 收回合),与旧功能格空结算同观感。
 *  取无主、无固定事件、避开两都城的城,现场过户给对手(无宝)。 */
function benignTile(e: GameEngine): number {
  const mover = e.activePlayer;
  const other = e.players.find((p) => p !== mover)!;
  const t = e.board.tiles.find(
    (x) =>
      x.event == null &&
      x.propertyId != null &&
      x.index !== mover.capitalIndex &&
      x.index !== other.capitalIndex &&
      e.findOwner(x.propertyId) == null,
  );
  if (t == null || t.propertyId == null) throw new Error("无中性床位(地图缺无主普城)");
  const def = e.catalog.get(t.propertyId)!;
  other.properties.push({
    propertyId: def.id,
    group: def.group,
    level: 0,
    maxLevel: def.maxLevel,
  });
  return t.index;
}

/** 剥离快照易变字段(gameId 随机/log ts 墙钟)后的确定性比较。 */
function scrubSnapshot(text: string): string {
  const o = JSON.parse(text);
  delete o.gameId;
  delete o.log; // 日志含随机 gameId/墙钟(内嵌于 header detail 字符串),确定性只比状态
  return JSON.stringify(o);
}

describe("档位调制:softmax 三元拉锯(#1090 纯函数)", () => {
  it("s=0 → 三档各 1/3;和恒=100", () => {
    const r = tierShares(0);
    expect(r.good).toBeCloseTo(100 / 3, 9);
    expect(r.neutral).toBeCloseTo(100 / 3, 9);
    expect(r.bad).toBeCloseTo(100 / 3, 9);
    expect(r.good + r.neutral + r.bad).toBeCloseTo(100, 9);
  });

  it("锚点:s=+100 → 57.14/28.57/14.29;s=+300 → 87.67/10.96/1.37", () => {
    const r = tierShares(100);
    expect(r.good).toBeCloseTo(57.14, 2);
    expect(r.neutral).toBeCloseTo(28.57, 2);
    expect(r.bad).toBeCloseTo(14.29, 2);
    const r3 = tierShares(300);
    expect(r3.good).toBeCloseTo(87.67, 2);
    expect(r3.neutral).toBeCloseTo(10.96, 2);
    expect(r3.bad).toBeCloseTo(1.37, 2);
  });

  it("和恒=100(代表点正负扫描)", () => {
    for (const s of [0, 1, -1, 10, -10, 30, 60, 90, 100, -100, 300, -300, 1000, -1000]) {
      const r = tierShares(s);
      expect(r.good + r.neutral + r.bad).toBeCloseTo(100, 6);
    }
  });

  it("镜像性:tierShares(−s) 与 tierShares(s) 好运霉运互换,中性不变", () => {
    for (const s of [1, 10, 37, 100, 300]) {
      const pos = tierShares(s);
      const neg = tierShares(-s);
      expect(neg.good).toBeCloseTo(pos.bad, 9);
      expect(neg.bad).toBeCloseTo(pos.good, 9);
      expect(neg.neutral).toBeCloseTo(pos.neutral, 9);
    }
  });

  it("量程:任意有限声望无溢出——极端处精确落 100/0/0 极限(softmax 平移归一,#1090 评审必修)", () => {
    const hi = tierShares(1e6);
    expect(hi.good).toBe(100);
    expect(hi.neutral).toBe(0);
    expect(hi.bad).toBe(0);
    const lo = tierShares(-1e6);
    expect(lo.good).toBe(0);
    expect(lo.neutral).toBe(0);
    expect(lo.bad).toBe(100);
  });

  it("单调性:s≥0 好运单调不减、霉运单调不增;三档恒 >0 且 <100(代表点扫描)", () => {
    let prevGood = -1;
    let prevBad = 101;
    for (const s of [0, 5, 10, 20, 40, 60, 90, 120, 200, 500, 1000]) {
      const r = tierShares(s);
      expect(r.good).toBeGreaterThanOrEqual(prevGood); // 好运单调不减
      expect(r.bad).toBeLessThanOrEqual(prevBad); // 霉运单调不增
      for (const v of [r.good, r.neutral, r.bad]) {
        expect(v).toBeGreaterThan(0); // 两端极限永不可达
        expect(v).toBeLessThan(100);
      }
      prevGood = r.good;
      prevBad = r.bad;
    }
  });

  it("pickTier 按累计占比;pickWeighted 按权重", () => {
    const even = tierShares(0); // 各 1/3
    expect(pickTier(0.3, even)).toBe("好运"); // 30 < 33.33
    expect(pickTier(0.4, even)).toBe("中性");
    expect(pickTier(0.8, even)).toBe("霉运");
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
    // 钉「落无主城抽中即时机遇」的种子:声望 0 三档均衡,约半数条目为即时型,
    // AwaitingDecision=已解完(抉择型停 AwaitingEncounter,换下一 seed)
    const seed = ((): number => {
      for (let s = 1; s < 200; s++) {
        const e0 = makeEngine(s, { enabled: true });
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
    const e = makeEngine(seed, { enabled: true });
    finishSetup(e);
    landOnFreeTile(e);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 机遇后照常进入购地决策
    const text = testEngine(e).logText();
    const encIdx = text.lastIndexOf("机遇「");
    const buyIdx = text.lastIndexOf("可购");
    expect(encIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(encIdx); // 机遇在前,城池事件在后
  });

  it("普通城零豁免(ADR-0035):必出机遇,解完再走城池结算(机遇先于本格结算)", () => {
    // #826 起天命格退役(天命城免掷、例外口径由 city-event 系钉住),本例改钉普通城:
    // 钉「普通城抽中即时机遇」的种子(抉择机遇会停 AwaitingEncounter,不适用本场景)
    const seed = ((): number => {
      for (let s = 1; s < 200; s++) {
        const e0 = makeEngine(s, { enabled: true });
        finishSetup(e0);
        try {
          landActiveOn(e0, benignTile(e0)); // 他人无宝城:机遇解完空结算收尾(见 benignTile 注)
        } catch {
          continue; // 途经都城等无效场景换下一 seed
        }
        if (e0.turnPhase === "Roll") return s;
      }
      throw new Error("无普通城即时机遇种子");
    })();
    const e = makeEngine(seed, { enabled: true });
    finishSetup(e);
    landActiveOn(e, benignTile(e));
    expect(e.turnPhase).toBe("Roll"); // 机遇(即时)+ 城池结算各自收尾,回合已过
    const text = testEngine(e).logText();
    const encIdx = text.lastIndexOf("机遇「");
    expect(encIdx).toBeGreaterThan(-1);
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
    armHero(e, full, { id: "h1", name: "甲", title: "", image: "", skillPool: [] });
    armHero(e, full, { id: "h2", name: "乙", title: "", image: "", skillPool: [] });
    armHero(e, full, { id: "h3", name: "丙", title: "", image: "", skillPool: [] });
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

  it("结算路径:玩家转移上限=对方现金;levy 封顶以其现有银两为限(不送清算)", () => {
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

    const payer = e.activePlayer;
    payer.cash = 10;
    const oppCash = e.players.find((p) => p !== payer)!.cash;
    const r = te.applyEncounter(payer, {
      id: "假道征粮",
      tier: "霉运",
      tags: ["银两", "玩家"],
      weight: 1,
      text: "t",
      effect: { kind: "levy", amount: 150 },
    });
    expect(r).toBe("settled"); // 红线(#1153):输币封顶以其现有银两为限,不送清算
    expect(payer.cash).toBe(0); // 实付=min(150, 10)
    expect(payer.isBankrupt).toBe(false);
    expect(e.players.find((p) => p !== payer)!.cash).toBe(oppCash + 10); // 实付额照付对手,资敌语义不变
  });

  it("确定性:同 seed 同配置两局,完整一轮后快照逐位一致(机遇 roll 全走引擎 dice)", () => {
    const snap = (seed: number) => {
      const e = makeEngine(seed, { enabled: true });
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
  /** 档位偏置声望(#1090 softmax 档位偏置):+300 → 好运 87.7%;
   *  中性在声望 0 处占比最大(三档各 1/3), BiasRep 0 即中性偏置。 */
  const GOOD_BIAS_REP = 300;
  const NEUTRAL_BIAS_REP = 0;

  /** 探针:复刻引擎抽取消耗序(行军骰 → 档位 → 同档加权),不消费引擎骰。
   *  档位概率由行者声望现算(tierShares),调用前先把声望钉到偏置值。 */
  function probeNextEncounter(e: GameEngine) {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const tier = pickTier(probe.nextFloat(), tierShares(e.activePlayer.reputation));
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 钉一个「掷骰 ≥2 步(能越过都城)且驻跸截断必抽中指定机遇」的种子。 */
  function haltSeed(id: string, rep: number): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, { enabled: true });
      finishSetup(e);
      e.activePlayer.reputation = rep;
      if (peekDie(e) < 2) continue;
      if (probeNextEncounter(e).id === id) return seed;
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
    const e = makeEngine(haltSeed("屯粮居奇", GOOD_BIAS_REP), { enabled: true });
    finishSetup(e);
    const mover = e.activePlayer;
    mover.reputation = GOOD_BIAS_REP; // 与钉种探针同偏置:好运重仓
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
    const e = makeEngine(haltSeed("屯粮居奇", GOOD_BIAS_REP)); // 同种子,但不传 encounter = 关
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
    const e = makeEngine(haltSeed("携民渡江", NEUTRAL_BIAS_REP), { enabled: true }); // 声望 0:三档均衡,中性占比最大
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
    const e = makeEngine(haltSeed("携民渡江", NEUTRAL_BIAS_REP), { enabled: true });
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
   *  按当前 rng 状态与行者声望(#1090 softmax)算出下一次落格会抽中的机遇,不消费引擎骰。
   *  中性偏置 = 声望 0(三档各 1/3,中性占比最大点)。 */
  function probeNextEncounter(e: GameEngine): EncounterDef {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const tier = pickTier(probe.nextFloat(), tierShares(e.activePlayer.reputation));
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 找一个「落格必抽中指定机遇」的种子(确定性扫描,setup 后的骰流决定抽取)。 */
  function seedDrawing(id: string): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, { enabled: true });
      finishSetup(e);
      if (probeNextEncounter(e).id === id) return seed;
    }
    throw new Error(`无种子抽中 ${id}`);
  }

  it("抽中抉择机遇(真实抽取路径)→ 进 AwaitingEncounter,快照携带机遇 id/文段/选项", () => {
    const e = makeEngine(seedDrawing("携民渡江"), { enabled: true });
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
    const e = makeEngine(seedDrawing("携民渡江"), { enabled: true });
    finishSetup(e);
    landOnFreeTile(e); // 落点是无主城:先机遇相位,解完才进购地决策
    expect(e.turnPhase).toBe("AwaitingEncounter");
    const text = testEngine(e).logText();
    expect(text.includes("机遇「携民渡江」")).toBe(true);
    expect(text.includes("可购(")).toBe(false); // 无城池事件
  });

  it("resolve:携民渡江选「携民渡江」→ 银两 −150 走支付、repDelta +10 落账、回合收尾", () => {
    const e = makeEngine(seedDrawing("携民渡江"), { enabled: true });
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

  it("repDelta 无夹紧(#1090):声望 95 选「携民渡江」(+10)→ 105(越界累加)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.reputation = 95;
    testEngine(e).enterEncounter(byId("携民渡江"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    e.resolveEncounterChoice(0);
    expect(mover.reputation).toBe(105);
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
    expect(e.recruitedHeroIds.has(mover.heroes[0].heroId)).toBe(true); // 名将入招贤池台账
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
    armHero(e, mover, { id: "h1", name: "甲", title: "", image: "", skillPool: [] });
    armHero(e, mover, { id: "h2", name: "乙", title: "", image: "", skillPool: [] });
    armHero(e, mover, { id: "h3", name: "丙", title: "", image: "", skillPool: [] });
    e.pendingEncounter = byId("以宝换贤");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("麾下已满");
  });

  it("grantHero 选项缺 treasureCost → 换贤代价声明守卫当场抛错(含条目 id,#1067)", () => {
    const bad: EncounterDef = {
      id: "欠声明条目",
      tier: "中性",
      tags: ["名将"],
      weight: 1,
      text: "未声明 treasureCost 的数据 bug 条目",
      choices: [{ text: "换将", repDelta: 0, effect: { kind: "grantHero", fallbackCash: 0 } }],
    };
    expect(() => assertGrantHeroCostDeclared([bad])).toThrow(/欠声明条目.*treasureCost/);
    // 生产目录已过同守卫(模块初始化即验):此处复验不抛 = 表内 grantHero 选项全声明
    expect(() => assertGrantHeroCostDeclared(ENCOUNTERS)).not.toThrow();
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
    const e = makeEngine(seedDrawing("结盟互市"), { enabled: true });
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

  it("两害相权:疫病入营(−120 / 体力 −25)、河堤告急(−80+体力 −15 组合)、盟镇勒币(levy 资敌)", () => {
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

  it("体力折银入分(#789):卖价 90 < 20×5 → 夜行军拒(安营);折银同分 → 温泉照单全收(目录序先)", () => {
    // 夜行军:连夜赶路 90 − 20×STAMINA_CASH_RATE(5) = −10 < 安营 0 → bot 婉拒。
    // 符号守卫:staminaDelta 为负值直接乘折银率(曾写反成「扣体力反而加分」,模拟器归因抓出)。
    const e = makeEngine(7, undefined, botSeats);
    finishSetup(e);
    testEngine(e).placeActive(benignTile(e));
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    const stamina0 = mover.stamina;
    e.pendingEncounter = byId("夜行军");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    botAct(e);
    expect(mover.cash).toBe(cash0); // 没卖体力
    expect(mover.stamina).toBe(stamina0);
    expect(testEngine(e).logText().includes("抉择:安营扎寨(无事发生)")).toBe(true);

    // 温泉疗养:付 150 = −30×5 折银同分(0 vs 不去 0)→ 同分取目录序先 = 照价购买
    const e2 = makeEngine(7, undefined, botSeats);
    finishSetup(e2);
    testEngine(e2).placeActive(benignTile(e2));
    const mover2 = e2.activePlayer;
    const cash02 = mover2.cash;
    mover2.stamina = 50; // 留出回血空间(满体力买温泉=纯浪费,但打分同分,行为不变)
    e2.pendingEncounter = byId("温泉疗养");
    testEngine(e2).forceTurnPhase("AwaitingEncounter");
    botAct(e2);
    expect(mover2.cash).toBe(cash02 - 150);
    expect(mover2.stamina).toBe(80);
  });
});

// ═════════════════════ 机遇体力接线(#132)═════════════════════
describe("机遇体力(#132):staminaDelta 落账与耗竭接线", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;

  /** 给 seat 一座指定等级的非都城房产(stamina.test 同款):保证耗竭可用选项 ≥2。 */
  function giveProperty(e: GameEngine, seat: number, level: number): string {
    const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
    const tile = MAP.board.tiles.find(
      (t) => t.event == null && t.propertyId && !taken.has(t.propertyId),
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

  /** 霉运偏置声望(#1090 softmax 档位偏置):−300 → 霉运 87.7%。 */
  const BAD_BIAS_REP = -300;

  /** 探针:复刻引擎抽取消耗序(行军骰 → 档位 → 同档加权,ADR-0035 必出制无触发 roll),
   *  按当前 rng 状态与行者声望算出下一次落格会抽中的机遇,不消费引擎骰
   *  (#124 抉择测试同款技巧;调用前先把声望钉到 BAD_BIAS_REP)。 */
  function probeNextEncounter(e: GameEngine): EncounterDef {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    const tier = pickTier(probe.nextFloat(), tierShares(e.activePlayer.reputation));
    return pickWeighted(
      ENCOUNTERS.filter((c) => c.tier === tier),
      probe.nextFloat(),
    );
  }

  /** 找一个「落格必抽中指定机遇」的种子(确定性扫描,setup 后的骰流决定抽取)。 */
  function seedDrawing(id: string): number {
    for (let seed = 1; seed < 500; seed++) {
      const e = makeEngine(seed, { enabled: true });
      finishSetup(e);
      e.activePlayer.reputation = BAD_BIAS_REP;
      if (probeNextEncounter(e).id === id) return seed;
    }
    throw new Error(`无种子抽中 ${id}`);
  }

  it("目录调重生效(#789):粮道被劫 −250 两/体力 −10;漕船倾覆 −100 两/体力 −8;假道征粮 levy 50/体力 −7", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const te = testEngine(e);
    const mover = e.activePlayer;
    mover.stamina = 40; // 三连扣 10+8+7=25,不归 0(耗竭路径另有专测)
    const cash0 = mover.cash;
    te.applyEncounter(mover, byId("粮道被劫"));
    expect(mover.cash).toBe(cash0 - 250);
    expect(mover.stamina).toBe(30);

    te.applyEncounter(mover, byId("漕船倾覆"));
    expect(mover.cash).toBe(cash0 - 350);
    expect(mover.stamina).toBe(22);

    te.applyEncounter(mover, byId("假道征粮"));
    expect(mover.cash).toBe(cash0 - 400);
    expect(mover.stamina).toBe(15);
  });

  it("霉运机遇扣体力:浮字「体力 −10」+ 对局日志 detail 补 stamina=落账值", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 60;
    const r = testEngine(e).applyEncounter(mover, byId("粮道被劫"));
    expect(r).toBe("settled");
    expect(mover.stamina).toBe(50);
    // 浮字由 fx 消费 staminaChanged 派生(见 presentation.test):锚事件的实际差
    expect(
      e
        .snapshot()
        .events.some(
          (ev) => ev.kind === "staminaChanged" && ev.reason === "encounter" && ev.delta === -10,
        ),
    ).toBe(true);
    const text = testEngine(e).logText();
    expect(text.includes("机遇「粮道被劫」:粮道遭山贼劫掠,损失折银 250 两,体力 −10")).toBe(true);
    expect(text.includes("encounterStamina")).toBe(true);
    expect(text.includes("stamina=50")).toBe(true);
  });

  it("体力不足扣到负:战报增量记实际差(#568 病 B)——体力 6 吃 −10 记「体力 −6」", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 6;
    testEngine(e).applyEncounter(mover, byId("粮道被劫"));
    const text = testEngine(e).logText();
    expect(text.includes("体力 −6")).toBe(true); // 实际差 0−6=−6,非请求数 −10
    expect(text.includes("体力 −10")).toBe(false);
  });

  it("体力不足归 0 → 耗竭相位接管本落格:rollAndMove 门线跳过购地,房产降级可 resolve", () => {
    const e = makeEngine(seedDrawing("粮道被劫"), { enabled: true });
    finishSetup(e);
    const seat = e.activeIndex;
    const mover = e.activePlayer;
    mover.reputation = BAD_BIAS_REP; // 与钉种探针同偏置:霉运重仓
    giveProperty(e, seat, 2);
    giveProperty(e, seat, 1); // 两座有级房产:耗竭可用选项 ≥2 → 进相位而非自动执行
    mover.stamina = 6; // #789 后粮道被劫体力 −10:垫 6 保归 0
    landOnFreeTile(e); // 真实抽取路径:抽中粮道被劫 → 体力 6−10 → 0
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

  it("抉择扣体力归 0:夜行军连夜赶路 → +90 两,耗竭自动结算收尾回合、不续跑落格", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 20; // 仅 0 级都城在册:耗竭无可用选项 → 自动执行(无可处置)
    const cash0 = mover.cash;
    const turn0 = e.turnNumber;
    testEngine(e).placeActive(benignTile(e));
    testEngine(e).enterEncounter(byId("夜行军"));
    expect(e.turnPhase).toBe("AwaitingEncounter");
    e.resolveEncounterChoice(0); // 连夜赶路(+90 两,体力 −20)
    expect(mover.cash).toBe(cash0 + 90);
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
      (t) => t.event == null && t.propertyId && !taken.has(t.propertyId),
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

// ═════════════════════ #1153 新红线「机遇不送清算」与原语微扩 ═════════════════════
describe("#1153 自动现金闸与保底放行(红线:机遇不送清算)", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;

  it("现金自动闸:现金 < 负 cash 代价 → 灰显「银两不足」,全目录追溯(携民渡江 −150)", () => {
    // 守住:现金闸是引擎规则(kind 推导),不是逐条数据——目录既有付费条目自动适用
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.cash = 100;
    e.pendingEncounter = byId("携民渡江");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false); // 费银 150 > 现金 100
    expect(opts[0].reason).toBe("银两不足");
    expect(opts[1].available).toBe(true); // 径自过江无代价
  });

  it("levy 输币同受现金闸:疫病入营「隐忍输币」现金不足灰显,与 cash 同款引擎规则", () => {
    // 守住:levy 是定向资敌的现金代价——入自动闸(钱不够选不了),不留逐条豁口
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.cash = 100;
    e.pendingEncounter = byId("疫病入营");
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false); // 隐忍输币 levy 120 > 现金 100
    expect(opts[0].reason).toBe("银两不足");
    expect(opts[1].available).toBe(true); // 撕毁盟约无现金代价
  });

  it("保底放行:双付费选项全灰显(河堤告急 −120/−80)→ 放行现金代价最低者并自动执行,不送清算", () => {
    // 守住:全灰卷轴的出路拍板——保底放行最便宜付费项(≤1 可用即 ADR-0013 自动执行,
    // 卷轴不全灰);放行后的实付由负现金封顶兜底(最多付光现金,不送清算)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.cash = 79;
    const turn0 = e.turnNumber;
    testEngine(e).placeActive(benignTile(e)); // 中性床位:解完续跑空结算收尾
    testEngine(e).enterEncounter(byId("河堤告急"));
    expect(e.turnPhase).toBe("Roll"); // 唯一保底放行项:自动执行,不弹相位
    expect(e.turnNumber).toBe(turn0 + 1);
    expect(mover.cash).toBe(0); // 封顶:79 现金付 80 代价 → 实损 79,不送清算
    expect(mover.isBankrupt).toBe(false);
    expect(testEngine(e).logText().includes("抉择:听天由命")).toBe(true);
    // 注册表口径直核(武装相位态):保底放行的 available/reason 形状
    const e2 = makeEngine(7);
    finishSetup(e2);
    e2.activePlayer.cash = 79;
    e2.pendingEncounter = byId("河堤告急");
    testEngine(e2).forceTurnPhase("AwaitingEncounter");
    const opts = e2.choicesFor();
    expect(opts[0].available).toBe(false); // 征夫抢修 −120:仍灰显
    expect(opts[0].reason).toBe("银两不足");
    expect(opts[1].available).toBe(true); // 听天由命 −80:保底放行
    expect(opts[1].reason).toBeUndefined();
  });

  it("负现金封顶:粮道被劫 −250 而现金 100 → 实损 100 现金归 0,settled 不清算不破产", () => {
    // 守住:新红线本体——机遇负现金以其现有银两为限,不再逼清算卖城(旧行为会进清算/破产)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.cash = 100;
    const r = testEngine(e).applyEncounter(mover, byId("粮道被劫"));
    expect(r).toBe("settled");
    expect(mover.cash).toBe(0);
    expect(mover.isBankrupt).toBe(false);
    expect(e.pendingDebt).toBeNull();
  });
});

describe("#1153 原语:效果级 repDelta 与指定招揽 heroId", () => {
  it("效果级 repDelta:即时机遇落声望走 addReputation 唯一写口,emit reputationChanged", () => {
    // 守住:即时条目声望通道——落账走唯一写口、事件面带实际差值(先例=选项级 repDelta)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    beginGameEventBatch(e);
    const r = testEngine(e).applyEncounter(mover, {
      id: "流言中伤(测试)",
      tier: "霉运",
      tags: ["声望"],
      weight: 1,
      text: "t",
      effect: { kind: "cash", delta: 0, repDelta: -6 },
    });
    expect(r).toBe("settled");
    expect(mover.reputation).toBe(-6);
    expect(
      e
        .snapshot()
        .events.some((v) => v.kind === "reputationChanged" && v.seat === seat && v.delta === -6),
    ).toBe(true);
  });

  it("指定招揽 heroId:点名可得 → 该将入麾下(非随机);已被招揽 → fallbackCash 折现", () => {
    // 守住:指定招揽的授将与折现两路——点名必中、占池即折现(麾下满/名将尽同口径)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const zhuge = { id: "test-kongming", name: "孔明", title: "", image: "", skillPool: [] };
    HEROES.push(zhuge);
    try {
      const r = testEngine(e).applyEncounter(mover, {
        id: "三顾茅庐(测试)",
        tier: "好运",
        tags: ["名将"],
        weight: 1,
        text: "t",
        effect: { kind: "grantHero", fallbackCash: 200, heroId: "test-kongming" },
      });
      expect(r).toBe("settled");
      expect(mover.heroes.map((s) => s.heroId)).toContain("test-kongming"); // 点名必中
      expect(e.recruitedHeroIds.has("test-kongming")).toBe(true);

      // 已被招揽(他帐占池)→ 折现 fallbackCash,不入槽
      const e2 = makeEngine(7);
      finishSetup(e2);
      const mover2 = e2.activePlayer;
      const opp2 = e2.players.find((p) => p !== mover2)!;
      armHero(e2, opp2, zhuge); // 布场对手槽位(zhuge 已在表,不重复注册)
      e2.recruitedHeroIds.add("test-kongming"); // 占池:他帐已招揽(zhuge 台账外,显式占)
      const cash0 = mover2.cash;
      const r2 = testEngine(e2).applyEncounter(mover2, {
        id: "三顾茅庐(测试)",
        tier: "好运",
        tags: ["名将"],
        weight: 1,
        text: "t",
        effect: { kind: "grantHero", fallbackCash: 200, heroId: "test-kongming" },
      });
      expect(r2).toBe("settled");
      expect(mover2.heroes.map((s) => s.heroId)).not.toContain("test-kongming");
      expect(mover2.cash).toBe(cash0 + 200); // 折现
    } finally {
      HEROES.splice(HEROES.indexOf(zhuge), 1); // 手工入表手工清退(armHero 台账外)
    }
  });

  it("指定将不可用闸 + 既有三连检:reason 各报其因(#1153 扩展,#124 口径不变)", () => {
    // 守住:换贤闸门的完整 reason 词表与优先序——珍宝不足→麾下已满→名将已尽→指定将已被招揽
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const opp = e.players.find((p) => p !== mover)!;
    const zilong = { id: "test-zilong", name: "子龙", title: "", image: "", skillPool: [] };
    armHero(e, opp, zilong); // 已被招揽(占池)
    mover.treasures.push(
      { id: "t1", name: "宝", level: 1, desc: "" },
      { id: "t2", name: "宝", level: 1, desc: "" },
    );
    const armChoice = (effect: EncounterEffect) => {
      e.pendingEncounter = {
        id: "点将(测试)",
        tier: "好运",
        tags: ["名将"],
        weight: 1,
        text: "t",
        choices: [
          { text: "点名", repDelta: 0, effect, treasureCost: 2 },
          { text: "婉拒(无事发生)", repDelta: 0 },
        ],
      };
      testEngine(e).forceTurnPhase("AwaitingEncounter");
    };
    // 指定将已被招揽(珍宝/麾下/池三关全过,只卡指定将)
    armChoice({ kind: "grantHero", fallbackCash: 0, heroId: "test-zilong" });
    let opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("指定名将已被招揽");
    expect(opts[1].available).toBe(true);
    // 珍宝不足(1 < 2):三连检首位不动
    mover.treasures.length = 1;
    armChoice({ kind: "grantHero", fallbackCash: 0 });
    opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("珍宝不足");
    // 麾下已满:补足珍宝、填满麾下
    mover.treasures.push({ id: "t3", name: "宝", level: 1, desc: "" });
    armHero(e, mover, { id: "h1", name: "甲", title: "", image: "", skillPool: [] });
    armHero(e, mover, { id: "h2", name: "乙", title: "", image: "", skillPool: [] });
    armHero(e, mover, { id: "h3", name: "丙", title: "", image: "", skillPool: [] });
    armChoice({ kind: "grantHero", fallbackCash: 0 });
    opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("麾下已满");
    // 名将已尽:全池占满(清空麾下隔离麾下满闸)
    for (const h of HEROES) e.recruitedHeroIds.add(h.id);
    mover.heroes = [];
    armChoice({ kind: "grantHero", fallbackCash: 0 });
    opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toBe("名将已尽");
  });
});

describe("#1153 机遇章(P2 跨事件标记):setsFlags 写点与章闸", () => {
  it("写点两路:即时路 def.setsFlags 与抉择路 option.setsFlags 去重落章", () => {
    // 守住:章写点与章册本体——两路结算都落章、重复结算不重章(经历记录语义)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const inst: EncounterDef = {
      id: "获章即时(测试)",
      tier: "好运",
      tags: ["声望"],
      weight: 1,
      text: "t",
      setsFlags: ["元直荐书"],
      effect: { kind: "cash", delta: 0 },
    };
    testEngine(e).applyEncounter(mover, inst);
    expect(mover.encounterFlags).toEqual(["元直荐书"]);
    // 抉择路:选项结算写 option.setsFlags
    const e2 = makeEngine(7);
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    testEngine(e2).placeActive(benignTile(e2)); // 中性床位:解完续跑空结算收尾
    testEngine(e2).enterEncounter({
      id: "获章抉择(测试)",
      tier: "中性",
      tags: ["声望"],
      weight: 1,
      text: "t",
      choices: [
        { text: "接下荐书", repDelta: 0, setsFlags: ["元直荐书", "怀玺"] },
        { text: "婉拒(无事发生)", repDelta: 0 },
      ],
    });
    expect(e2.turnPhase).toBe("AwaitingEncounter");
    e2.resolveEncounterChoice(0);
    expect(mover2.encounterFlags).toEqual(["元直荐书", "怀玺"]);
    // 去重:同章再结算不重章
    testEngine(e2).applyEncounter(mover2, inst);
    expect(mover2.encounterFlags).toEqual(["元直荐书", "怀玺"]);
  });

  it("中断路章照写:耗竭中断仍落章;破产不清章(拍板③⑥)", () => {
    // 守住:拍板③(中断路章照写——机遇致清算/破产已随红线封顶消失,可及中断向量=体力
    // 耗竭)与拍板⑥(破产不清章——章是经历记录,破产向量=payOrLiquidate 购地/租金刚性支出)
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.stamina = 50;
    const r = testEngine(e).applyEncounter(mover, {
      id: "耗竭获章(测试)",
      tier: "霉运",
      tags: ["银两", "玩家", "体力"],
      weight: 1,
      text: "t",
      setsFlags: ["怀玺"],
      effect: { kind: "cash", delta: -150, staminaDelta: -1000 },
    });
    expect(r).toBe("exhausted");
    expect(mover.encounterFlags).toContain("怀玺");

    mover.encounterFlags = ["元直荐书"];
    mover.cash = 10;
    mover.properties = []; // 无产可清算 → 破产
    e.payOrLiquidate(mover, null, 150);
    expect(mover.isBankrupt).toBe(true);
    expect(mover.encounterFlags).toContain("元直荐书");
  });

  it("快照成对:章册随 SNAPSHOT_FIELDS 读写往返(旧记录缺键不兜底,拍板④)", () => {
    // 守住:章册的序列化集成——snapshot 键与 restore 回灌成对(玩家级键集无自动断言,显式钉)
    const e = makeEngine(7);
    finishSetup(e);
    e.activePlayer.encounterFlags = ["元直荐书", "怀玺"];
    const s = e.snapshot();
    expect(s.players[0].encounterFlags).toEqual(["元直荐书", "怀玺"]);
    const e2 = makeEngine(99);
    finishSetup(e2);
    e2.restoreFromSnapshot(s);
    expect(e2.players[0].encounterFlags).toEqual(["元直荐书", "怀玺"]);
  });

  it("章闸守卫:全选项带 requiresFlags 的条目当场抛错;生产目录过同守卫", () => {
    // 守住:唯一新护栏——「整条选项集被 flag 锁死」的目录 bug 在模块初始化当场炸出
    const bad: EncounterDef = {
      id: "章锁条目(测试)",
      tier: "中性",
      tags: ["声望"],
      weight: 1,
      text: "t",
      requiresFlags: ["元直荐书"],
      choices: [
        { text: "甲", repDelta: 0, requiresFlags: ["元直荐书"] },
        { text: "乙", repDelta: 0, requiresFlags: ["元直荐书"] },
      ],
    };
    expect(() => assertChoicesNotFlagLocked([bad])).toThrow(/章闸锁死/);
    // 生产目录已过同守卫(模块初始化即验):复验不抛 = 表内带章闸条目全保有无章闸选项
    expect(() => assertChoicesNotFlagLocked(ENCOUNTERS)).not.toThrow();
  });

  it("选项章闸:未持章不可用 reason 写持章要求;持章解锁;无章闸选项恒可用", () => {
    // 守住:章闸的闸门语义——reason 指名所缺章,持章即解;守卫保证的无章闸选项不受扰
    const e = makeEngine(7);
    finishSetup(e);
    e.pendingEncounter = {
      id: "章闸(测试)",
      tier: "中性",
      tags: ["声望"],
      weight: 1,
      text: "t",
      choices: [
        { text: "持章者专属", repDelta: 5, requiresFlags: ["元直荐书"] },
        { text: "婉拒(无事发生)", repDelta: 0 },
      ],
    };
    testEngine(e).forceTurnPhase("AwaitingEncounter");
    const opts = e.choicesFor();
    expect(opts[0].available).toBe(false);
    expect(opts[0].reason).toContain("元直荐书");
    expect(opts[1].available).toBe(true);
    e.activePlayer.encounterFlags.push("元直荐书");
    expect(e.choicesFor()[0].available).toBe(true);
  });

  it("章闸抽取过滤:未持章者抽池不见后编,持章者可见(drawableEncounters 单源)", () => {
    // 守住:def 级 requiresFlags 的抽取闸——链式后编高权重(weight 2.5)只对持章者
    // 生效的设计前提(#1133:非持章者抽取时被过滤)
    const gated: EncounterDef = {
      id: "后编(测试)",
      tier: "好运",
      tags: ["名将"],
      weight: 2.5,
      text: "t",
      requiresFlags: ["元直荐书"],
    };
    const open: EncounterDef = {
      id: "无门槛(测试)",
      tier: "好运",
      tags: ["名将"],
      weight: 1,
      text: "t",
    };
    expect(drawableEncounters([gated, open], []).map((d) => d.id)).toEqual(["无门槛(测试)"]);
    expect(drawableEncounters([gated, open], ["元直荐书"]).length).toBe(2);
  });

  it("章闸抽取池守卫:档内全被章闸占=当场抛错;生产目录过同守卫", () => {
    // 守住:每档在无章玩家视角必须有序可抽——否则抽中该档即空池(pickWeighted 炸)
    const bad: EncounterDef[] = [
      {
        id: "甲(测试)",
        tier: "中性",
        tags: ["声望"],
        weight: 1,
        text: "t",
        requiresFlags: ["怀玺"],
      },
      {
        id: "乙(测试)",
        tier: "中性",
        tags: ["声望"],
        weight: 1,
        text: "t",
        requiresFlags: ["元直荐书"],
      },
    ];
    expect(() => assertFlagGatePoolsDrawable(bad)).toThrow(/空池/);
    // 生产目录已过同守卫(模块初始化即验):复验不抛 = 每档都有无章闸条目
    expect(() => assertFlagGatePoolsDrawable(ENCOUNTERS)).not.toThrow();
  });
});

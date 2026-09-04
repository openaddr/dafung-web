// 机遇引擎单测(#123):纯函数(归一/调制/加权抽取) + 引擎行为(触发开关/先于城池结算/
// 结算四路径与回退/确定性)。随机钉法:触发率配置 0/100 两端 + landActiveOn 恰落目标格
// (timing.test 同款技巧),结算路径经 testEngine.applyEncounter 指定具体事件绕过抽取。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { botAct, encounterCashImpact, repCoefficient } from "@core/bot";
import { testEngine } from "@core/testing";
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
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

function makeEngine(
  seed = 7,
  encounter?: { triggerRate: number; good?: number; neutral?: number; bad?: number },
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

  it("0 是合法档位(中性 100% 口径),不再触发回退", () => {
    const r = resolveEncounterConfig({ baseRates: { good: 0, neutral: 100, bad: 0 } });
    expect(r.shares).toEqual({ good: 0, neutral: 100, bad: 0 });
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
          else if (e.turnPhase === "AwaitingEncounter") {
            // 抉择机遇(#124):选第一个可用项(结盟互市等单选项不会到这——引擎已自动执行)
            const avail = e.choicesFor().findIndex((o) => o.available);
            e.resolveEncounterChoice(Math.max(0, avail));
          }
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

// ═════════════════════ 抉择机遇:决策相位与选项结算(#124)═════════════════════
describe("抉择机遇(#124):入相与快照", () => {
  const byId = (id: string): EncounterDef => ENCOUNTERS.find((c) => c.id === id)!;
  const treasure = (id: string) => ({ id, name: `宝${id}`, level: 1, desc: "" });

  /** 探针:复刻引擎抽取消耗序(行军骰 → 触发 → 档位 → 同档加权),按当前 rng 状态
   *  算出下一次落格会抽中的机遇,不消费引擎骰。触发率 100 + 中性基准拉满(三档须 >0,
   *  否则 resolveEncounterConfig 回退默认 30/45/25——#120 口径),档位调制夹紧 [5,95]
   *  后中性占 90。 */
  const NEUTRAL_HEAVY = { triggerRate: 100, good: 1, neutral: 98, bad: 1 };

  function probeNextEncounter(e: GameEngine): EncounterDef {
    const probe = createDice(0);
    probe.setRngState(e.dice.getRngState());
    probe.roll(); // 行军骰
    probe.nextFloat(); // 触发 roll(恒过)
    const shares = tierShares(e.activePlayer.reputation, resolveEncounterConfig(NEUTRAL_HEAVY).shares);
    const tier = pickTier(probe.nextFloat(), shares);
    return pickWeighted(ENCOUNTERS.filter((c) => c.tier === tier), probe.nextFloat());
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

  it("以宝换贤:2 珍宝换 1 武将(珍宝扣光、武将入帐、rep/银两不动)", () => {
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
    expect(e.recruitedHeroIds.has(mover.heroes[0].id)).toBe(true); // 贤士入招贤池台账
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
      { id: "h1", name: "甲", title: "", desc: "", skills: [], image: "" },
      { id: "h2", name: "乙", title: "", desc: "", skills: [], image: "" },
      { id: "h3", name: "丙", title: "", desc: "", skills: [], image: "" },
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
    const fs = e.presentation.drainFloaters();
    expect(fs.some((f) => f.kind === "msg" && f.text.includes("结盟互市"))).toBe(true);
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
    expect(() => e2.restoreFromSnapshot({ ...s, turnPhase: "AwaitingEncounter", choices: [] })).toThrow(/抉择机遇上下文缺失/);
  });

  it("即时机遇回归:settleEncounter 叙事仍用 def.text(效果结算提取不漂移)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const mover = e.activePlayer;
    const cash0 = mover.cash;
    testEngine(e).applyEncounter(mover, mover.position, def("屯粮居奇", { kind: "cash", delta: 250 }));
    expect(mover.cash).toBe(cash0 + 250);
    expect(testEngine(e).logText().includes("机遇「屯粮居奇」:屯粮居奇 +250")).toBe(true);
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
    e.pendingEncounter = { id: "测试机遇", tier: "中性", tags: ["银两"], weight: 1, text: "t", choices };
    testEngine(e).forceTurnPhase("AwaitingEncounter");
  }

  it("repCoefficient ∈ [5,9]、确定性、座位间有性格差", () => {
    for (let seat = 0; seat < 16; seat++) {
      expect(repCoefficient(seat)).toBe(repCoefficient(seat)); // 确定性
      expect(repCoefficient(seat)).toBeGreaterThanOrEqual(5);
      expect(repCoefficient(seat)).toBeLessThanOrEqual(9);
    }
    expect(new Set(Array.from({ length: 16 }, (_, i) => repCoefficient(i))).size).toBeGreaterThan(1);
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
});

// 时机框架单测:派发点位正确性 / 座位序×技能序确定性 / scope 四过滤 / cooldown /
// 破产玩家不触发 / 递归派发防护 / 未知 EffectId 抛错。
// 现有 3 武将的行为等价断言(moveBonus+1 / 曹丕+50 / 星彩+20)在 game.test.ts,此处测框架本身。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { EFFECTS } from "@core/effects";
import type { HeroDef, TriggerSkill } from "@core/types";
import type { GameMoment } from "@core/timing";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(人类选第一个空城,bot 自动)。 */
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

/** 驱动当前玩家完成回合(默认抉择),直到进入下一玩家 Roll 或 GameOver。 */
function autoResolve(e: GameEngine) {
  let guard = 0;
  while (e.turnPhase !== "Roll" && e.turnPhase !== "GameOver" && guard++ < 20) {
    if (e.turnPhase === "AwaitingBranch") e.selectBranch("Main");
    else if (e.turnPhase === "AwaitingDecision") e.endDecision();
    else if (e.turnPhase === "AwaitingHeroPick") e.resolveHeroPick(1); // 选跳过位之外的第 2 项,避免招入名士干扰断言
    else if (e.turnPhase === "AwaitingTreasureOwner") e.resolveTreasureOwner({ type: "skip" });
    else if (e.turnPhase === "AwaitingBankruptcySettle") e.confirmBankruptcySettle();
    else break;
  }
}

/** 打满一整轮(每位玩家各行动一次)。 */
function playFullRound(e: GameEngine) {
  for (let i = 0; i < e.players.length && !e.isOver; i++) {
    e.rollAndMove();
    autoResolve(e);
  }
}

/** 测试用名士:按需构造技能(与 HEROES 同形状,不入招贤池)。 */
function heroWith(skills: TriggerSkill[], id = "test-hero"): HeroDef {
  return { id, name: "测试名士", title: "", desc: "", skills, image: "/assets/heroes/hero-zhouyu-sgs.png" };
}

/** 得银技能速写(可覆盖 scope/cooldown)。 */
const gain = (id: string, when: GameMoment, amount: number, extra: Partial<TriggerSkill> = {}): TriggerSkill =>
  ({ id, when, effect: "gainCash", params: { amount }, ...extra });

/** 某技能的击发次数(按战报 skill 行统计,抗其他现金变化干扰)。 */
const fireCount = (e: GameEngine, skillId: string) =>
  e.log.filter((l) => l.category === "skill" && l.detail.includes(`skill=${skillId} `)).length;

/** 包一层 dispatchMoment,记录派发的时机序列(仅测试观察用)。 */
function recordMoments(e: GameEngine): string[] {
  const calls: string[] = [];
  const orig = e.dispatchMoment.bind(e);
  (e as { dispatchMoment: (m: GameMoment, ctx: { subject: number }) => void }).dispatchMoment = (m, ctx) => {
    calls.push(m);
    return orig(m, ctx);
  };
  return calls;
}

describe("时机框架:派发点位", () => {
  it("开局首回合进 Playing 时触发 TurnStart", () => {
    const e = makeEngine(1);
    const calls = recordMoments(e);
    finishSetup(e);
    expect(calls).toEqual(["TurnStart"]);
  });

  it("一回合的时机序列:BeforeMarch→DieRolled→AfterMarch→TurnEnd→(回合切换)TurnStart;回锚点时 TurnEnd→RoundEnd→RoundStart→TurnStart", () => {
    const e = makeEngine(1);
    const calls = recordMoments(e);
    finishSetup(e);
    e.rollAndMove();
    autoResolve(e); // 第一位玩家完整回合
    e.rollAndMove();
    autoResolve(e); // 第二位玩家完整回合 → 回到锚点 → 轮次 +1
    expect(e.round).toBe(2);
    // seed=1 下第二位玩家落格触发一次被动失银(CashLost 恰在 AfterMarch 之后、TurnEnd 之前),如实钉住
    expect(calls).toEqual([
      "TurnStart", // 开局首回合
      "BeforeMarch", "DieRolled", "AfterMarch", "TurnEnd", // 第一位玩家
      "TurnStart", // 第二位玩家回合开始
      "BeforeMarch", "DieRolled", "AfterMarch", "CashLost", "TurnEnd", // 第二位玩家(落税/事件格失银)
      "RoundEnd", "RoundStart", "TurnStart", // 轮次交替 + 新轮首位玩家
    ]);
  });

  it("TurnStart 触发 +现金技能 → 回合开始现金变化(每人每回合一次)", () => {
    const e = makeEngine(1);
    e.players[0].heroes.push(heroWith([gain("ts-0", "TurnStart", 100)]));
    e.players[1].heroes.push(heroWith([gain("ts-1", "TurnStart", 100)]));
    finishSetup(e);
    // 开局首回合只触发首位玩家(= roundAnchor)的技能:现金 = 10000 - 建城费 + 100
    const first = e.roundAnchor;
    expect(fireCount(e, `ts-${first}`)).toBe(1);
    expect(fireCount(e, `ts-${1 - first}`)).toBe(0);
    const capDef = e.catalog.get(e.board.at(e.players[first].capitalIndex).propertyId!)!;
    expect(e.players[first].cash).toBe(10000 - capDef.buildCost + 100);
    // 打满一整轮:TurnStart 计数 = 首动者 2 次(开局首回合 + 新轮首回合)、另一人 1 次
    playFullRound(e);
    expect(fireCount(e, `ts-${first}`)).toBe(2);
    expect(fireCount(e, `ts-${1 - first}`)).toBe(1);
  });

  it("RoundEnd/RoundStart 仅在轮次交替时各触发一次,subject=轮次锚点", () => {
    const e = makeEngine(1);
    e.players[0].heroes.push(heroWith([gain("re", "RoundEnd", 10, { scope: "any" }), gain("rs", "RoundStart", 10, { scope: "any" })]));
    finishSetup(e);
    playFullRound(e);
    expect(e.round).toBe(2);
    expect(fireCount(e, "re")).toBe(1);
    expect(fireCount(e, "rs")).toBe(1);
    const anchor = e.players[e.roundAnchor];
    expect(e.log.some((l) => l.detail.includes("moment=RoundEnd") && l.detail.includes(`subject=${anchor.id}`))).toBe(true);
    playFullRound(e);
    expect(e.round).toBe(3);
    expect(fireCount(e, "re")).toBe(2);
    expect(fireCount(e, "rs")).toBe(2);
  });

  it("BeforeMarch 在掷骰前(位置未动/无骰面),AfterMarch 在移动完成后(位置=最终落点)", () => {
    const captured: { when: GameMoment; pos: number; die: number | null }[] = [];
    EFFECTS["test-capture"] = (engine, ctx) => {
      captured.push({
        when: ctx.moment,
        pos: engine.players[ctx.subject].position,
        die: engine.presentation.lastRoll?.die ?? null,
      });
      return true;
    };
    try {
      const e = makeEngine(1);
      const captureHero = () =>
        heroWith([
          { id: "cap-before", when: "BeforeMarch", effect: "test-capture", scope: "any" },
          { id: "cap-after", when: "AfterMarch", effect: "test-capture", scope: "any" },
        ]);
      // 两位玩家都挂(首动者由 seed 决定,capture 技能只在本人行军时留痕)
      e.players[0].heroes.push(captureHero());
      e.players[1].heroes.push(captureHero());
      finishSetup(e);
      const mover = e.activePlayer;
      const from = mover.position;
      e.rollAndMove();
      autoResolve(e);
      const before = captured.find((c) => c.when === "BeforeMarch")!;
      const after = captured.find((c) => c.when === "AfterMarch")!;
      expect(before.pos).toBe(from); // 掷骰前:尚未移动
      expect(before.die).toBeNull(); // 掷骰前:还没有骰面
      expect(after.pos).toBe(mover.position); // 移动完成后:位置已是最终落点
      expect(after.die).toBe(e.presentation.lastRoll!.die); // DieRolled 之后骰面可读
    } finally {
      delete EFFECTS["test-capture"];
    }
  });
});

describe("时机框架:确定性与 scope", () => {
  it("派发顺序确定:座位序 × 技能数组序;固定 seed 两局序列完全一致", () => {
    const seats: SeatConfig[] = [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ];
    const run = (): string[] => {
      const e = makeEngine(7, seats);
      [0, 1, 2].forEach((seat) =>
        e.players[seat].heroes.push(heroWith([
          gain(`p${seat}-a`, "DieRolled", 1, { scope: "any" }),
          gain(`p${seat}-b`, "DieRolled", 2, { scope: "any" }),
        ]))
      );
      finishSetup(e);
      for (let t = 0; t < 6 && !e.isOver; t++) {
        e.rollAndMove();
        autoResolve(e);
      }
      return e.log
        .filter((l) => l.category === "skill")
        .map((l) => l.detail.match(/skill=(\S+)/)![1]);
    };
    const seq1 = run();
    const seq2 = run();
    expect(seq1.length).toBeGreaterThanOrEqual(12); // 6 回合 × 每掷至少 2 次击发(首掷 6 次)
    expect(seq2).toEqual(seq1); // 同 seed 同序列:触发顺序快照稳定
    // 首次掷骰后的派发序 = 座位序(0→1→2)× 技能数组序(a→b)
    expect(seq1.slice(0, 6)).toEqual(["p0-a", "p0-b", "p1-a", "p1-b", "p2-a", "p2-b"]);
  });

  it("scope 四过滤:self/others/any/actor(缺省=self)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const active = e.activeIndex;
    const holderSeat = 1 - active; // 非当前行动玩家的持有者
    const holder = e.players[holderSeat];
    holder.heroes.push(heroWith([
      gain("sc-self", "CashLost", 11, { scope: "self" }),
      gain("sc-others", "CashLost", 22, { scope: "others" }),
      gain("sc-any", "CashLost", 33, { scope: "any" }),
      gain("sc-actor", "CashLost", 44, { scope: "actor" }),
      gain("sc-default", "CashLost", 55), // 缺省 = self
    ]));
    let cash = holder.cash;
    // 主体=当前行动玩家(≠属主):others/any/actor 触发,self 与缺省不触发
    e.dispatchMoment("CashLost", { subject: active, amount: 100 });
    expect(holder.cash).toBe(cash + 22 + 33 + 44);
    cash = holder.cash;
    // 主体=属主自己(非行动玩家):self/缺省/any 触发,others/actor 不触发
    e.dispatchMoment("CashLost", { subject: holderSeat, amount: 100 });
    expect(holder.cash).toBe(cash + 11 + 55 + 33);
  });
});

describe("时机框架:冷却 / 破产 / 防护", () => {
  it("cooldown 生效:冷却内不触发,冷却完再触发(单位=轮,键=skill.id)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.players[0];
    p.heroes.push(heroWith([gain("cd", "CashLost", 7, { cooldown: 2 })])); // 缺省 scope=self
    const cash0 = p.cash;
    e.round = 1;
    e.dispatchMoment("CashLost", { subject: 0 });
    expect(p.cash).toBe(cash0 + 7); // 首次触发
    expect(p.heroLastFired["cd"]).toBe(1);
    e.dispatchMoment("CashLost", { subject: 0 });
    expect(p.cash).toBe(cash0 + 7); // 同轮再派发:冷却内不触发
    e.round = 2;
    e.dispatchMoment("CashLost", { subject: 0 });
    expect(p.cash).toBe(cash0 + 7); // 2-1=1 < 2:冷却内
    e.round = 3;
    e.dispatchMoment("CashLost", { subject: 0 });
    expect(p.cash).toBe(cash0 + 14); // 3-1=2 ≥ 2:冷却完再触发
    expect(p.heroLastFired["cd"]).toBe(3);
    e.round = 4;
    e.dispatchMoment("CashLost", { subject: 0 });
    expect(p.cash).toBe(cash0 + 14); // 4-3=1 < 2:又进冷却
  });

  it("真实对局中的 cooldown:RoundStart 冷却 2 轮的技能每 2 轮触发一次", () => {
    const e = makeEngine(1);
    e.players[0].heroes.push(heroWith([gain("rc", "RoundStart", 10, { cooldown: 2, scope: "any" })]));
    finishSetup(e);
    playFullRound(e); // round 1→2:触发(无冷却记录),heroLastFired=2
    playFullRound(e); // round 2→3:3-2=1 < 2 不触发
    playFullRound(e); // round 3→4:4-2=2 ≥ 2 触发,heroLastFired=4
    expect(e.round).toBe(4);
    expect(fireCount(e, "rc")).toBe(2);
  });

  it("破产玩家的技能不触发", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.players[0];
    const cash0 = p.cash;
    p.isBankrupt = true;
    p.heroes.push(heroWith([gain("bk", "CashLost", 99, { scope: "any" })]));
    e.dispatchMoment("CashLost", { subject: 1, amount: 100 });
    expect(p.cash).toBe(cash0);
    expect(fireCount(e, "bk")).toBe(0);
  });

  it("递归派发抛错:效果内同步再派发时机,第 3 层直接抛错", () => {
    EFFECTS["test-recursive"] = (engine) => {
      engine.dispatchMoment("CashLost", { subject: 0 });
      return true;
    };
    try {
      const e = makeEngine(1);
      finishSetup(e);
      e.players[0].heroes.push(heroWith([{ id: "rec", when: "CashLost", effect: "test-recursive", scope: "any" }]));
      expect(() => e.dispatchMoment("CashLost", { subject: 1 })).toThrow(/嵌套超过 2 层/);
    } finally {
      delete EFFECTS["test-recursive"];
    }
  });

  it("一层嵌套派发允许(顶层 + 1 层;第 3 层才是递归 bug)", () => {
    EFFECTS["test-nested-once"] = (engine) => {
      engine.dispatchMoment("RoundStart", { subject: 0 }); // 内层时机无技能挂载 → 正常返回
      return true;
    };
    try {
      const e = makeEngine(1);
      finishSetup(e);
      e.players[0].heroes.push(heroWith([{ id: "nest", when: "CashLost", effect: "test-nested-once", scope: "any" }]));
      e.dispatchMoment("CashLost", { subject: 1 }); // 不抛
      expect(fireCount(e, "nest")).toBe(1);
    } finally {
      delete EFFECTS["test-nested-once"];
    }
  });

  it("未知 EffectId 抛错(注册表查不到=数据 bug,零兜底)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(heroWith([{ id: "bad", when: "CashLost", effect: "no-such-effect" }]));
    expect(() => e.dispatchMoment("CashLost", { subject: 0 })).toThrow(/未知效果/);
  });

  it("效果必填参数缺失抛错(零兜底)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.players[0].heroes.push(heroWith([{ id: "no-params", when: "CashLost", effect: "gainCash", params: {} }]));
    expect(() => e.dispatchMoment("CashLost", { subject: 0 })).toThrow(/参数缺失/);
  });
});

describe("时机框架:效果注册表(行为等价)", () => {
  it("moveBonus 效果:BeforeMarch 累计行军加成(多技能叠加)", () => {
    const e = makeEngine(1);
    const withBonus = () =>
      heroWith([
        { id: "mb-a", when: "BeforeMarch", effect: "moveBonus", params: { steps: 1 }, scope: "self" },
        { id: "mb-b", when: "BeforeMarch", effect: "moveBonus", params: { steps: 2 }, scope: "self" },
      ]);
    // 两位玩家都挂(scope=self,首动者由 seed 决定,其本人掷骰时两个技能叠加)
    e.players[0].heroes.push(withBonus());
    e.players[1].heroes.push(withBonus());
    finishSetup(e);
    e.rollAndMove();
    autoResolve(e);
    const rollLog = e.log.filter((l) => l.category === "roll").pop()!;
    expect(rollLog.detail).toContain("bonus=3"); // 1 + 2 叠加
  });

  it("gainIfFace 效果:DieRolled 骰面匹配才生效,不匹配静默跳过(不记战报/冷却)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.players[0];
    p.heroes.push(heroWith([{ id: "gif", when: "DieRolled", effect: "gainIfFace", params: { face: 6, amount: 20 }, scope: "any" }]));
    const cash0 = p.cash;
    e.dispatchMoment("DieRolled", { subject: 0, die: 6 });
    expect(p.cash).toBe(cash0 + 20);
    expect(p.heroLastFired["gif"]).toBe(e.round); // 生效才记冷却
    delete p.heroLastFired["gif"];
    const cash1 = p.cash;
    e.dispatchMoment("DieRolled", { subject: 0, die: 3 });
    expect(p.cash).toBe(cash1); // 条件不满足:无现金变化
    expect(p.heroLastFired["gif"]).toBeUndefined(); // 也不记冷却
  });
});

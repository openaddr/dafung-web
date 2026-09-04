// 时机框架单测:派发点位正确性 / 座位序×技能序确定性 / scope 四过滤 / cooldown /
// 破产玩家不触发 / 递归派发防护 / 未知 EffectId 抛错 / 26 时机各挂点至少一例
// (18 个新时机的场景构造:peekDie 预读骰面 + landActiveOn 恰落目标格)。
// 现有 3 武将的行为等价断言(moveBonus+1 / 曹丕+50 / 星彩+20)在 game.test.ts,此处测框架本身。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import { EFFECTS } from "@core/effects";
import type { HeroDef, TriggerSkill } from "@core/types";
import type { GameMoment, MomentCtx } from "@core/timing";
import { testEngine } from "@core/testing";
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

/** 包一层 dispatchMoment,记录派发的时机 + 完整 ctx(新时机 ctx 字段断言用)。 */
function recordMomentCtx(e: GameEngine): { moment: GameMoment; ctx: MomentCtx }[] {
  const entries: { moment: GameMoment; ctx: MomentCtx }[] = [];
  const orig = e.dispatchMoment.bind(e);
  (e as { dispatchMoment: (m: GameMoment, ctx: MomentCtx) => void }).dispatchMoment = (m, ctx) => {
    entries.push({ moment: m, ctx: { ...ctx } });
    return orig(m, ctx);
  };
  return entries;
}

/** 预读下一次骰面:牺牲骰复制引擎 rng 状态掷一次,不动引擎 rng(联机确定性同款保证)。 */
function peekDie(e: GameEngine): number {
  const probe = createDice(0);
  probe.setRngState(e.dice.getRngState());
  return probe.roll().die;
}

/** 把当前活跃玩家挪位后掷骰,恰好落在 targetTile。路径不得途经其都城(必停会截断,场景无效即抛错)。 */
function landActiveOn(e: GameEngine, targetTile: number): void {
  const p = e.activePlayer;
  const die = peekDie(e);
  const n = e.board.count;
  const from = ((targetTile - die) % n + n) % n;
  const passesCapital = Array.from({ length: die }, (_, i) => (from + 1 + i) % n)
    .some((t) => t === p.capitalIndex && t !== targetTile);
  if (passesCapital) throw new Error(`测试场景无效:落 #${targetTile} 的路径途经都城 #${p.capitalIndex}(必停截断)`);
  testEngine(e).placeActive(from);
  e.rollAndMove();
}

/** 任选一座无主普通城(非任何人都城、非辅路起点):构造购城/落城/途经场景。 */
function freePropertyTile(e: GameEngine) {
  return e.board.tiles.find(
    (t) =>
      t.type === "Property" &&
      t.propertyId != null &&
      !e.board.getBranchStart(t.index) &&
      e.findOwner(t.propertyId) == null &&
      e.capitalOwnerOf(t.index) == null,
  )!;
}

describe("时机框架:派发点位", () => {
  it("开局时机序列:SetupComplete(最后落子者)→ GameStart(roundAnchor)→ TurnStart(首回合)", () => {
    const e = makeEngine(1);
    const calls = recordMoments(e);
    finishSetup(e);
    expect(calls).toEqual(["SetupComplete", "GameStart", "TurnStart"]);
  });

  it("一回合的时机序列:BeforeMarch→BeforeRoll→DieRolled→AfterMarch→TurnEnd→(回合切换)TurnStart;回锚点时 TurnEnd→RoundEnd→RoundStart→TurnStart", () => {
    const e = makeEngine(1);
    const calls = recordMoments(e);
    finishSetup(e);
    e.rollAndMove();
    autoResolve(e); // 第一位玩家完整回合
    e.rollAndMove();
    autoResolve(e); // 第二位玩家完整回合 → 回到锚点 → 轮次 +1
    expect(e.round).toBe(2);
    // seed=1 下第二位玩家落天命格:#121 后天命格改为 +20 声望(不再抽随机坏事),
    // 故 AfterMarch 之后无 CashLost,直接 TurnEnd,如实钉住
    expect(calls).toEqual([
      "SetupComplete", "GameStart", // 开局收尾(最后落子者 → 对局开始)
      "TurnStart", // 开局首回合
      "BeforeMarch", "BeforeRoll", "DieRolled", "AfterMarch", "TurnEnd", // 第一位玩家
      "TurnStart", // 第二位玩家回合开始
      "BeforeMarch", "BeforeRoll", "DieRolled", "AfterMarch", "TurnEnd", // 第二位玩家(落天命格,+20 声望无时机)
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

describe("时机框架:生命周期(GameStart/SetupComplete/GameOver)", () => {
  it("SetupComplete→GameStart→TurnStart:主体依次=最后落子者/roundAnchor/roundAnchor,GameStart 可挂技能", () => {
    const e = makeEngine(1);
    const entries = recordMomentCtx(e);
    e.players[0].heroes.push(heroWith([gain("gs", "GameStart", 100, { scope: "any" })]));
    finishSetup(e);
    const lastPicker = e.draftOrder[e.draftOrder.length - 1];
    expect(entries.map((x) => x.moment)).toEqual(["SetupComplete", "GameStart", "TurnStart"]);
    expect(entries[0].ctx.subject).toBe(lastPicker); // SetupComplete:最后一位选都落子者
    expect(entries[1].ctx.subject).toBe(e.roundAnchor); // GameStart:对局开始,主体=首动者
    expect(entries[2].ctx.subject).toBe(e.roundAnchor); // TurnStart:开局首回合
    expect(fireCount(e, "gs")).toBe(1); // GameStart 已可挂技能(选都完成前的英雄池注入)
  });

  it("GameOver(净资产达标):endTurn 胜负判定确定处派发,主体=胜者,为终局最后一个时机", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const entries = recordMomentCtx(e);
    const winner = e.activeIndex;
    e.activePlayer.cash = e.targetNetWorth + 1000; // 身价=仅现金;+1000 抗落格支出
    e.rollAndMove();
    autoResolve(e);
    expect(e.isOver).toBe(true);
    expect(e.winReason).toBe("TargetNetWorth");
    const go = entries.filter((x) => x.moment === "GameOver");
    expect(go).toHaveLength(1);
    expect(go[0].ctx.subject).toBe(winner);
    expect(entries[entries.length - 1].moment).toBe("GameOver"); // 其后再无时机(无 TurnStart)
  });
});

describe("时机框架:掷骰与行军细化(BeforeRoll/BranchEntered/BranchExited)", () => {
  it("BeforeRoll 在 BeforeMarch 之后、DieRolled 之前;掷骰前位置未动、骰面尚未产生", () => {
    const captured: { when: GameMoment; pos: number; die: number | null }[] = [];
    EFFECTS["test-capture"] = (engine, ctx) => {
      captured.push({ when: ctx.moment, pos: engine.players[ctx.subject].position, die: engine.presentation.lastRoll?.die ?? null });
      return true;
    };
    try {
      const e = makeEngine(1);
      const captureHero = () =>
        heroWith([
          { id: "cap-march", when: "BeforeMarch", effect: "test-capture", scope: "any" },
          { id: "cap-roll", when: "BeforeRoll", effect: "test-capture", scope: "any" },
          { id: "cap-die", when: "DieRolled", effect: "test-capture", scope: "any" },
        ]);
      e.players[0].heroes.push(captureHero());
      e.players[1].heroes.push(captureHero());
      finishSetup(e);
      const calls = recordMoments(e);
      e.rollAndMove();
      autoResolve(e);
      // 先后顺序:BeforeMarch < BeforeRoll < DieRolled(首掷序列内钉死)
      expect(calls.indexOf("BeforeMarch")).toBeLessThan(calls.indexOf("BeforeRoll"));
      expect(calls.indexOf("BeforeRoll")).toBeLessThan(calls.indexOf("DieRolled"));
      const march = captured.find((c) => c.when === "BeforeMarch")!;
      const roll = captured.find((c) => c.when === "BeforeRoll")!;
      const die = captured.find((c) => c.when === "DieRolled")!;
      expect(march.pos).toBe(roll.pos); // 两者都在掷骰前:位置未动
      expect(roll.die).toBeNull(); // 首掷:BeforeRoll 时骰面尚未产生
      expect(die.die).toBe(e.presentation.lastRoll!.die); // DieRolled 时骰面已定
      expect(die.pos).toBe(march.pos); // DieRolled 在行军计算前:位置仍未动
    } finally {
      delete EFFECTS["test-capture"];
    }
  });

  it("BranchEntered:selectBranch(\"Branch\") 置待入辅路态后派发(主体=抉择者),随后直接 TurnEnd", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const entries = recordMomentCtx(e);
    const chooser = e.activePlayer;
    testEngine(e).placeActive(e.board.branch!.startNode); // 摆在辅路入口(真实场景由落格触发)
    testEngine(e).forceTurnPhase("AwaitingBranch");
    e.selectBranch("Branch");
    const be = entries.filter((x) => x.moment === "BranchEntered");
    expect(be).toHaveLength(1);
    expect(be[0].ctx.subject).toBe(e.players.indexOf(chooser));
    expect(be[0].ctx.tileIndex).toBe(e.board.branch!.startNode);
    expect(chooser.onBranch).toEqual({ step: -1 }); // 已置「待入辅路」
    // 入辅路=本回合结束:紧随其后的是本回合 TurnEnd(此后才是下一位玩家 TurnStart)
    expect(entries[entries.findIndex((x) => x.moment === "BranchEntered") + 1].moment).toBe("TurnEnd");
  });

  it("BranchExited:辅路推进汇入主路时派发一次(tileIndex=主路落点),先于 AfterMarch", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    // 挂 +10 行军加成:辅路 5 格,骰 1-6 + 10 必然汇入主路
    mover.heroes.push(heroWith([{ id: "mb10", when: "BeforeMarch", effect: "moveBonus", params: { steps: 10 }, scope: "self" }]));
    mover.onBranch = { step: 0 }; // 在辅路第 0 格
    testEngine(e).placeActive(e.board.branch!.startNode); // 辅路行军时主路位置=入口占位
    const entries = recordMomentCtx(e);
    e.rollAndMove();
    autoResolve(e);
    const bx = entries.filter((x) => x.moment === "BranchExited");
    expect(bx).toHaveLength(1); // 恰好一次(汇入主路)
    expect(bx[0].ctx.subject).toBe(e.players.indexOf(mover));
    expect(bx[0].ctx.tileIndex).toBe(mover.position); // 主路落点
    expect(mover.onBranch).toBeNull(); // 已清辅路态
    // 同回合内先于 AfterMarch
    const after = entries.findIndex((x) => x.moment === "AfterMarch");
    expect(entries.findIndex((x) => x.moment === "BranchExited")).toBeLessThan(after);
  });
});

describe("时机框架:落格与路径(CapitalHalt/LandedOnProperty/PassedPlayer)", () => {
  it("CapitalHalt:必停都城(AfterMarch 后、驻跸补给前),tileIndex=都城,补给尾随 CashGained", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const n = e.board.count;
    // 都城前 1 格 + 至少 2 步(挂 +1 加成)→ 途经都城必停(落点非都城)
    mover.heroes.push(heroWith([{ id: "mb1", when: "BeforeMarch", effect: "moveBonus", params: { steps: 1 }, scope: "self" }]));
    testEngine(e).placeActive((mover.capitalIndex - 1 + n) % n);
    const { supply } = e.capitalSupplyOf(mover);
    const entries = recordMomentCtx(e);
    e.rollAndMove();
    expect(mover.position).toBe(mover.capitalIndex); // 必停都城
    const halt = entries.filter((x) => x.moment === "CapitalHalt");
    expect(halt).toHaveLength(1);
    expect(halt[0].ctx.subject).toBe(e.players.indexOf(mover));
    expect(halt[0].ctx.tileIndex).toBe(mover.capitalIndex);
    // 顺序:AfterMarch → CapitalHalt → CashGained(驻跸补给)
    const iAfter = entries.findIndex((x) => x.moment === "AfterMarch");
    const iHalt = entries.findIndex((x) => x.moment === "CapitalHalt");
    const iGain = entries.findIndex((x) => x.moment === "CashGained");
    expect(iAfter).toBeLessThan(iHalt);
    expect(iHalt).toBeLessThan(iGain);
    expect(entries[iGain].ctx).toMatchObject({ subject: e.players.indexOf(mover), amount: supply });
  });

  it("LandedOnProperty:落他人城派发(subject=访客,ctx.ownerSeat/propertyId/tileIndex),城主无珍宝也触发", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const visitorSeat = e.activeIndex;
    const ownerSeat = 1 - visitorSeat;
    const tile = freePropertyTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    e.players[ownerSeat].properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    autoResolve(e);
    const lp = entries.filter((x) => x.moment === "LandedOnProperty");
    expect(lp).toHaveLength(1);
    expect(lp[0].ctx).toEqual({ subject: visitorSeat, ownerSeat, propertyId: def.id, tileIndex: tile.index });
  });

  it("PassedPlayer:途经他人棋子逐个派发(passedSeat=被途经者,tileIndex=途经格);破产者不触发", () => {
    const seats: SeatConfig[] = [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ];
    const e = makeEngine(1, seats);
    finishSetup(e);
    const moverSeat = e.activeIndex;
    const tile = freePropertyTile(e);
    // B(存活)与 C(破产)同站落点格:落点也在 traversed 内 → B 触发一次、C 被滤掉
    const bSeat = [0, 1, 2].find((s) => s !== moverSeat && !e.players[s].isBankrupt)!;
    const cSeat = [0, 1, 2].find((s) => s !== moverSeat && s !== bSeat)!;
    const t = testEngine(e);
    t.place(bSeat, tile.index);
    t.place(cSeat, tile.index);
    e.players[cSeat].isBankrupt = true;
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    autoResolve(e);
    const pp = entries.filter((x) => x.moment === "PassedPlayer");
    expect(pp).toHaveLength(1);
    expect(pp[0].ctx).toEqual({ subject: moverSeat, passedSeat: bSeat, tileIndex: tile.index });
  });
});

describe("时机框架:资产与交易(PropertyBought/PropertyUpgraded/HeroRecruited/TreasureGained/TreasureSold/TradeSettled)", () => {
  it("PropertyBought:buyProperty 成功尾派发(subject=买家,ctx.propertyId)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const buyerSeat = e.activeIndex;
    const tile = freePropertyTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 买得起 + 有委任状 → 真实抉择
    e.buyProperty();
    const pb = entries.filter((x) => x.moment === "PropertyBought");
    expect(pb).toHaveLength(1);
    expect(pb[0].ctx).toEqual({ subject: buyerSeat, propertyId: def.id });
  });

  it("PropertyUpgraded:扩军成功尾派发(subject=城主,ctx.propertyId)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = freePropertyTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    mover.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index); // 落己城 → 扩军抉择
    expect(e.turnPhase).toBe("AwaitingDecision");
    e.upgradeProperty();
    const pu = entries.filter((x) => x.moment === "PropertyUpgraded");
    expect(pu).toHaveLength(1);
    expect(pu[0].ctx).toEqual({ subject: e.players.indexOf(mover), propertyId: def.id });
    expect(mover.properties.find((h) => h.propertyId === def.id)!.level).toBe(1);
  });

  it("HeroRecruited:招贤选定名士后派发(subject=招贤者,ctx.heroId);落都城补给另派 CashGained", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const { supply } = e.capitalSupplyOf(mover);
    const entries = recordMomentCtx(e);
    landActiveOn(e, mover.capitalIndex); // 恰落自己都城:补给 + 招贤纳士
    expect(e.turnPhase).toBe("AwaitingHeroPick");
    const hid = e.offeredHeroes[0].id;
    e.resolveHeroPick(0);
    const hr = entries.filter((x) => x.moment === "HeroRecruited");
    expect(hr).toHaveLength(1);
    expect(hr[0].ctx).toEqual({ subject: e.players.indexOf(mover), heroId: hid });
    expect(mover.heroes.some((h) => h.id === hid)).toBe(true);
    const cg = entries.filter((x) => x.moment === "CashGained");
    expect(cg).toHaveLength(1);
    expect(cg[0].ctx).toMatchObject({ subject: e.players.indexOf(mover), amount: supply }); // 落都城补给
  });

  it("TreasureGained:宝物城拼点得宝派发(subject=得宝者,ctx.treasureId)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const tile = e.board.tiles.find((t) => t.type === "TreasureCity")!;
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1 }]; // Lv1:双骰 2-12 恒 ≥ 1
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    autoResolve(e);
    const tg = entries.filter((x) => x.moment === "TreasureGained");
    expect(tg).toHaveLength(1);
    expect(tg[0].ctx).toEqual({ subject: e.players.indexOf(mover), treasureId: "probe-t" });
    expect(mover.treasures.some((t) => t.id === "probe-t")).toBe(true);
  });

  it("公道买卖成交(买家付清):交割点四时机 + 成交升级,ctx 逐字段(主体/买家/卖家/金额)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const visitorSeat = e.activeIndex;
    const ownerSeat = 1 - visitorSeat;
    const tile = freePropertyTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    e.players[ownerSeat].properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    e.players[ownerSeat].treasures.push({ id: "trade-t", name: "交割测试宝", level: 1 });
    const price = 100; // guidePriceOf(1) = 100 分
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner"); // 城主有宝 → 交涉
    e.resolveTreasureOwner({ type: "fair", treasureId: "trade-t" });
    // 落城 → 公道成交升级 → 交割四连:得宝(买家)→ 售宝(卖家)→ 成交 → 收款(卖家)
    expect(entries.filter((x) => x.moment === "LandedOnProperty").map((x) => x.ctx)).toEqual([
      { subject: visitorSeat, ownerSeat, propertyId: def.id, tileIndex: tile.index },
    ]);
    expect(entries.filter((x) => x.moment === "PropertyUpgraded").map((x) => x.ctx)).toEqual([
      { subject: ownerSeat, propertyId: def.id },
    ]);
    expect(entries.filter((x) => x.moment === "TreasureGained").map((x) => x.ctx)).toEqual([
      { subject: visitorSeat, treasureId: "trade-t" },
    ]);
    expect(entries.filter((x) => x.moment === "TreasureSold").map((x) => x.ctx)).toEqual([
      { subject: ownerSeat, treasureId: "trade-t", amount: price },
    ]);
    expect(entries.filter((x) => x.moment === "TradeSettled").map((x) => x.ctx)).toEqual([
      { subject: ownerSeat, buyerSeat: visitorSeat, sellerSeat: ownerSeat, amount: price },
    ]);
    expect(entries.filter((x) => x.moment === "CashGained").map((x) => x.ctx)).toEqual([
      { subject: ownerSeat, amount: price }, // 卖家收款
    ]);
    expect(e.players[visitorSeat].treasures.some((t) => t.id === "trade-t")).toBe(true); // 宝已交割
    expect(e.players[ownerSeat].properties.find((h) => h.propertyId === def.id)!.level).toBe(1); // 城已升级
  });

  it("买家破产退宝:交割三时机(TreasureSold/TradeSettled/交割 TreasureGained)与收款不触发;PlayerBankrupt→GameOver(群雄尽灭)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const visitorSeat = e.activeIndex;
    const ownerSeat = 1 - visitorSeat;
    const tile = freePropertyTile(e);
    const def = e.catalog.get(tile.propertyId!)!;
    e.players[ownerSeat].properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    e.players[ownerSeat].treasures.push({ id: "trade-t", name: "退宝测试宝", level: 1 });
    e.players[visitorSeat].cash = 0; // 买家无现金且无可变卖资产(仅都城)→ 直接破产
    const entries = recordMomentCtx(e);
    landActiveOn(e, tile.index);
    e.resolveTreasureOwner({ type: "fair", treasureId: "trade-t" });
    for (const m of ["TreasureSold", "TradeSettled", "CashGained", "TreasureGained"] as const)
      expect(entries.filter((x) => x.moment === m)).toHaveLength(0); // 未成交:不派发
    expect(entries.filter((x) => x.moment === "PlayerBankrupt").map((x) => x.ctx.subject)).toEqual([visitorSeat]);
    expect(e.players[ownerSeat].treasures.some((t) => t.id === "trade-t")).toBe(true); // 托管退回卖家
    expect(e.isOver).toBe(true); // 群雄尽灭 → 终局
    expect(e.winReason).toBe("LastStanding");
    expect(entries.filter((x) => x.moment === "GameOver").map((x) => x.ctx.subject)).toEqual([ownerSeat]);
  });
});

describe("时机框架:玩家状态(CashGained 防连锁/PlayerBankrupt/BankruptcySettle)", () => {
  it("CashGained 防连锁:效果层得银(grantSkillCash)不再触发 CashGained——技能给钱恰触发一次", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.players[0];
    p.heroes.push(heroWith([gain("cg-chain", "CashGained", 50, { scope: "any" })]));
    const cash0 = p.cash;
    e.dispatchMoment("CashGained", { subject: 1, amount: 100 }); // 模拟经济结算点派发一次
    expect(fireCount(e, "cg-chain")).toBe(1); // 若递归,技能会再次触发(或第 3 层抛错)
    expect(p.cash).toBe(cash0 + 50); // 恰好得一次
  });

  it("PlayerBankrupt:finalizeBankruptcy 善后尾派发(subject=破产者);变卖殆尽仍不足 → 出局+终局", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.cash = 0; // 一无所有:确认清算时仍不足 → settleDebt + finalizeBankruptcy(公共清算路径)
    const entries = recordMomentCtx(e);
    e.pendingDebt = { amount: 200, creditor: null };
    testEngine(e).forceTurnPhase("AwaitingBankruptcySettle");
    e.confirmBankruptcySettle();
    expect(entries.filter((x) => x.moment === "PlayerBankrupt").map((x) => x.ctx)).toEqual([{ subject: e.players.indexOf(mover) }]);
    expect(mover.isBankrupt).toBe(true);
    expect(e.isOver).toBe(true); // 2 人局:一人出局即终局(群雄尽灭)
    expect(entries.filter((x) => x.moment === "GameOver")).toHaveLength(1);
  });

  it("BankruptcySettle:变卖珍宝/变卖城池成功尾各派发一次(ctx.amount=变卖所得),凑足即止", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const extra = freePropertyTile(e);
    const extraDef = e.catalog.get(extra.propertyId!)!;
    mover.cash = 50; // 欠 200 → 差 150,进清算
    mover.treasures.push({ id: "bk-t", name: "自救宝", level: 1 }); // 变卖得 100,仍差 50
    mover.properties.push({ propertyId: extraDef.id, group: extraDef.group, purchasePrice: extraDef.purchasePrice, level: 0, maxLevel: extraDef.maxLevel });
    const entries = recordMomentCtx(e);
    e.pendingDebt = { amount: 200, creditor: null };
    testEngine(e).forceTurnPhase("AwaitingBankruptcySettle");
    e.sellTreasureBankruptcy("bk-t");
    e.sellPropertyBankruptcy(extraDef.id);
    const settle = entries.filter((x) => x.moment === "BankruptcySettle");
    const propGain = extraDef.valueByLevel[0];
    expect(settle.map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(mover), amount: 100 }, // 珍宝按指导价(Lv1=100)
      { subject: e.players.indexOf(mover), amount: propGain }, // 城按等级价值
    ]);
    const sold = entries.filter((x) => x.moment === "TreasureSold").map((x) => x.ctx);
    expect(sold).toEqual([{ subject: e.players.indexOf(mover), treasureId: "bk-t", amount: 100 }]); // 破产变卖也走 TreasureSold
    e.confirmBankruptcySettle();
    expect(mover.isBankrupt).toBe(false); // 凑足自救
    expect(e.turnPhase as string).toBe("Roll"); // 对局继续(轮到下一位)
  });

  it("BankruptcySettle:遣散名士成功尾派发(ctx.amount=200)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.cash = 0;
    mover.heroes.push(heroWith([], "bk-hero")); // 名士换银 200 恰好抵债
    const entries = recordMomentCtx(e);
    e.pendingDebt = { amount: 200, creditor: null };
    testEngine(e).forceTurnPhase("AwaitingBankruptcySettle");
    e.cashHeroBankruptcy("bk-hero");
    expect(entries.filter((x) => x.moment === "BankruptcySettle").map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(mover), amount: 200 },
    ]);
    e.confirmBankruptcySettle();
    expect(mover.isBankrupt).toBe(false); // 200 恰清偿
    expect(mover.cash).toBe(0);
  });
});

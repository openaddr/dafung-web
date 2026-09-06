// ADR-0013 决策相位选项集(choice-set)+ 唯一选项自动执行:
// - 注册表各相位选项/available/reason;
// - 自动执行:≤1 真实选项 → 不进决策相位,直接默认行为(战报 + 文案浮字);
// - ≥2 真实选项绝不自动执行;破产清算 excludedFromAuto 例外;
// - bot 先经 choicesFor 过滤后启发式(口径收敛,行为不回归);
// - 快照 choices 派生字段 round-trip 一致。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { EXCLUDED_FROM_AUTO, type ChoiceOption } from "@core/choices";
import { HEROES } from "@core/heroes";
import { botAct } from "@core/bot";
import { testEngine } from "@core/testing";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[], target = 30000, difficulty: "Simple" | "Normal" = "Normal") {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: target,
    difficulty,
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
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

const opt = (opts: ChoiceOption[], id: string): ChoiceOption | undefined =>
  opts.find((o) => o.id === id);

/** 强制 AwaitingDecision(注册表按 pendingLand 分购地/扩军选项;窄口置决策上下文)。 */
function armDecision(e: GameEngine, kind: "PropertyAvailable" | "OwnProperty", propId: string) {
  testEngine(e).armDecision(kind, propId);
}

/** 找一座无主普通城(规避 finishSetup 选都占位的不确定性)。 */
function freeProperty(e: GameEngine) {
  const tile = e.board.tiles.find((t) => t.type === "Property" && t.propertyId && e.findOwner(t.propertyId) == null)!;
  return { tile, def: e.catalog.get(tile.propertyId)! };
}

// ─────────────────────── 注册表:各相位选项集 ───────────────────────
describe("选项集注册表(choices.ts)", () => {
  it("购地:买得起 → buy+skip 两选均可用", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { def } = freeProperty(e);
    p.cash = def.purchasePrice;
    p.warrants = 1;
    armDecision(e, "PropertyAvailable", def.id);
    const opts = e.choicesFor();
    expect(opts.map((o) => o.id)).toEqual(["buy", "skip"]);
    expect(opt(opts, "buy")!.available).toBe(true);
    expect(opt(opts, "skip")!.available).toBe(true);
  });

  it("购地:买不起 → buy 不可用 reason 银两不足,只剩 skip", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { def } = freeProperty(e);
    p.cash = def.purchasePrice - 1;
    p.warrants = 3;
    armDecision(e, "PropertyAvailable", def.id);
    const buy = opt(e.choicesFor(), "buy")!;
    expect(buy.available).toBe(false);
    expect(buy.reason).toBe("银两不足");
  });

  it("购地:无委任状 → reason 无委任状(现金也不足时委任优先报)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { def } = freeProperty(e);
    p.cash = 0;
    p.warrants = 0;
    armDecision(e, "PropertyAvailable", def.id);
    const buy = opt(e.choicesFor(), "buy")!;
    expect(buy.available).toBe(false);
    expect(buy.reason).toBe("无委任状");
  });

  it("扩军:未满级可用;满级 → 不可用 reason 已满级,只剩 skip", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { def } = freeProperty(e);
    p.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    armDecision(e, "OwnProperty", def.id);
    expect(opt(e.choicesFor(), "upgrade")!.available).toBe(true);
    // 满级
    const h = p.properties.find((x) => x.propertyId === def.id)!;
    h.level = def.maxLevel;
    const up = opt(e.choicesFor(), "upgrade")!;
    expect(up.available).toBe(false);
    expect(up.reason).toBe("已满级");
  });

  it("珍宝交涉:fair/premium/decline 三选全可用(城主抉择,永不自动)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const owner = e.players.find((x) => x !== e.activePlayer)!;
    e.treasureVisitor = { def: e.catalog.get("prop-changan")!, ownerIdx: e.players.indexOf(owner) };
    testEngine(e).forceTurnPhase("AwaitingTreasureOwner");
    const opts = e.choicesFor();
    expect(opts.map((o) => o.id)).toEqual(["fair", "premium", "decline"]);
    expect(opts.every((o) => o.available)).toBe(true);
  });

  it("择路:main/branch 两选", () => {
    const e = makeEngine(1);
    finishSetup(e);
    testEngine(e).forceTurnPhase("AwaitingBranch");
    const opts = e.choicesFor();
    expect(opts.map((o) => o.id)).toEqual(["main", "branch"]);
    expect(opts.every((o) => o.available)).toBe(true);
  });

  it("招贤:每位候选名将一选项(三选一)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    e.offeredHeroes = HEROES.slice(0, 3);
    testEngine(e).forceTurnPhase("AwaitingHeroPick");
    const opts = e.choicesFor();
    expect(opts).toHaveLength(3);
    expect(opts[0].id).toBe(`hero:${HEROES[0].id}`);
    expect(opts.every((o) => o.available)).toBe(true);
  });

  it("破产清算:各资产变卖 + 认赔;凑足后变卖不可用;excludedFromAuto 例外", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" });
    p.heroes.push(HEROES[0]);
    const { def } = freeProperty(e); // 一座非都城地产(都城不可变卖)
    p.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    e.pendingDebt = { amount: 99999, creditor: null };
    testEngine(e).forceTurnPhase("AwaitingBankruptcySettle");
    const opts = e.choicesFor();
    expect(opts.map((o) => o.id)).toContain("sell-treasure:t1");
    expect(opts.map((o) => o.id)).toContain(`cash-hero:${HEROES[0].id}`);
    expect(opts.some((o) => o.id === `sell-property:${def.id}`)).toBe(true); // 非都城地产可变卖
    expect(opts.some((o) => o.id === `sell-property:${e.catalog.get(e.board.at(p.capitalIndex).propertyId)!.id}`)).toBe(false); // 都城不可变卖
    const settle = opt(opts, "settle")!;
    expect(settle.available).toBe(true);
    // ADR-0013 决议 3:重大不可逆事件,唯一选项也不自动执行
    expect(EXCLUDED_FROM_AUTO.has("AwaitingBankruptcySettle")).toBe(true);
    // 凑足即止:现金 ≥ 债务后变卖全部不可用
    e.pendingDebt = { amount: 100, creditor: null };
    for (const o of e.choicesFor()) {
      if (o.id === "settle") expect(o.available).toBe(true);
      else {
        expect(o.available).toBe(false);
        expect(o.reason).toBe("已凑足债务");
      }
    }
  });

  it("未注册相位(Roll/Land)返回空数组", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    t.forceTurnPhase("Roll");
    expect(e.choicesFor()).toEqual([]);
    t.forceTurnPhase("Land");
    expect(e.choicesFor()).toEqual([]);
  });
});

// ─────────────────────── 唯一选项自动执行 ───────────────────────
describe("唯一选项自动执行(≤1 真实选项 → 默认行为 + 浮字)", () => {
  it("银两不足落无主城:不进 AwaitingDecision + 战报 + 浮字「银两不足,未能购城」", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { tile, def } = freeProperty(e);
    const turn0 = e.turnNumber;
    p.cash = def.purchasePrice - 1;
    p.warrants = 3;
    testEngine(e).landActiveAt(tile.index); // 窄口:摆位 + Land + 私有落格结算
    expect(e.turnPhase).not.toBe("AwaitingDecision");
    expect(e.turnNumber).toBe(turn0 + 1); // 直接结束回合
    expect(e.log.some((ev) => ev.detail.includes("skipAvailable") && ev.detail.includes(def.id))).toBe(true);
    const fs = e.presentation.drainFloaters();
    expect(fs.some((f) => f.kind === "msg" && f.text === "银两不足,未能购城")).toBe(true);
  });

  it("无委任状落无主城:不进 AwaitingDecision + 战报 + 浮字「无委任状,不可购」", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { tile, def } = freeProperty(e);
    p.cash = 10000;
    p.warrants = 0;
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).not.toBe("AwaitingDecision");
    expect(e.log.some((ev) => ev.brief.includes("无委任状") && ev.detail.includes(def.id))).toBe(true);
    const fs = e.presentation.drainFloaters();
    expect(fs.some((f) => f.kind === "msg" && f.text === "无委任状,不可购")).toBe(true);
  });

  it("满级己城:自动按兵不动 + 战报「城已满级,按兵不动」+ 浮字(不再弹假选择)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const me = e.activePlayer;
    const capDef = e.catalog.get(e.board.at(me.capitalIndex).propertyId)!;
    const tile = e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capDef.id && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    me.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: def.maxLevel, maxLevel: def.maxLevel });
    const turn0 = e.turnNumber;
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase).not.toBe("AwaitingDecision");
    expect(e.turnNumber).toBe(turn0 + 1);
    expect(e.log.some((ev) => ev.detail.includes("skipMaxed") && ev.detail.includes(def.id))).toBe(true);
    expect(e.log.some((ev) => ev.brief.includes("城已满级,按兵不动"))).toBe(true);
    const fs = e.presentation.drainFloaters();
    expect(fs.some((f) => f.kind === "msg" && f.text === "城已满级,按兵不动")).toBe(true);
  });

  it("有两个真实选项时绝不自动执行:买得起必弹购地卷轴相位", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const { tile, def } = freeProperty(e);
    p.cash = def.purchasePrice;
    p.warrants = 1;
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase as string).toBe("AwaitingDecision");
    expect(e.presentation.drainFloaters()).toEqual([]); // 无浮字
  });

  it("未满级己城:必弹扩军卷轴相位", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const me = e.activePlayer;
    const capDef = e.catalog.get(e.board.at(me.capitalIndex).propertyId)!;
    const tile = e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capDef.id && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    me.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    testEngine(e).landActiveAt(tile.index);
    expect(e.turnPhase as string).toBe("AwaitingDecision");
  });
});

// ─────────────────────── bot 对齐(先经 choicesFor,再启发式) ───────────────────────
describe("bot 对齐:决策经选项集过滤后行为不回归", () => {
  const botSeats: SeatConfig[] = [
    { name: "A", isBot: true, guohao: "魏" },
    { name: "B", isBot: true, guohao: "蜀" },
  ];

  it("可购相位:Simple/Normal botAct 均推进(buy 或 endDecision 都离开决策相位)", () => {
    for (const difficulty of ["Simple", "Normal"] as const) {
      const e = makeEngine(5, botSeats, 30000, difficulty);
      finishSetup(e);
      const p = e.activePlayer;
      const { def } = freeProperty(e);
      p.cash = def.purchasePrice * 2; // 两档启发式都可能买
      p.warrants = 3;
      armDecision(e, "PropertyAvailable", def.id);
      const props0 = p.properties.length;
      botAct(e);
      expect(e.turnPhase).not.toBe("AwaitingDecision");
      expect(p.properties.length - props0).toBeLessThanOrEqual(1); // 买或没买,不越界
    }
  });

  it("可扩军相位:Normal bot 必扩军;满级位引擎已自动按兵不动,bot 不再触达", () => {
    const e = makeEngine(5, botSeats, 30000, "Normal");
    finishSetup(e);
    const p = e.activePlayer;
    const capDef = e.catalog.get(e.board.at(p.capitalIndex).propertyId)!;
    const tile = e.board.tiles.find((t) => t.type === "Property" && t.propertyId !== capDef.id && e.findOwner(t.propertyId!) == null)!;
    const def = e.catalog.get(tile.propertyId)!;
    p.properties.push({ propertyId: def.id, group: def.group, purchasePrice: def.purchasePrice, level: 0, maxLevel: def.maxLevel });
    armDecision(e, "OwnProperty", def.id);
    botAct(e);
    expect(e.turnPhase).not.toBe("AwaitingDecision");
    expect(p.properties.find((x) => x.propertyId === def.id)!.level).toBe(1); // Normal 必扩
  });
});

// ─────────────────────── 快照契约:choices 派生字段 ───────────────────────
describe("快照 choices 派生字段", () => {
  it("snapshot.choices 与 choicesFor() 一致;恢复 round-trip 后重算一致", () => {
    const e1 = makeEngine(9);
    finishSetup(e1);
    const p = e1.activePlayer;
    const { def } = freeProperty(e1);
    p.cash = def.purchasePrice - 1; // 买不起 → buy 不可用带 reason
    p.warrants = 3;
    armDecision(e1, "PropertyAvailable", def.id);
    const s1 = e1.snapshot();
    expect(s1.choices).toEqual(e1.choicesFor());
    expect(s1.choices.some((o) => o.id === "skip" && o.available)).toBe(true);
    // 联机路径:恢复到同构新引擎后重算,结果一致(纯派生,零序列化负担)
    const e2 = makeEngine(2);
    e2.restoreFromSnapshot(s1);
    expect(e2.snapshot().choices).toEqual(s1.choices);
  });
});

// 事件词汇补全测试(#384,折叠切换②):新增六类事件的序列断言——名将被动技击发
// (skillFired)/主动技发动(heroSkillActivated)/抽锦囊进手(jinnangDrawn)/声望变更
// (reputationChanged)/体力变更(staminaChanged)/跳过回合(turnSkipped),以及
// playerBankrupt 的债主座位字段;尾部为 #385 缺口闭合的演出映射事件(六处缺口)。
// 词汇表与产出两口见 src/core/game-events.ts;
// 批界与折叠口径同 game-events.test.ts(白盒触达的转移用 beginGameEventBatch 显式开批)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { testEngine } from "@core/testing";
import { HEROES } from "@core/heroes";
import { ENCOUNTERS } from "@core/encounters";
import { beginGameEventBatch, type GameEvent } from "@core/game-events";
import sanguoData from "../public/maps/sanguo.json";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]) {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 事件 kind 序列速读。 */
const kinds = (events: GameEvent[]) => events.map((ev) => ev.kind);

/** 驱动选都到完成并清手牌(与 game-events.test.ts 同款垫子)。 */
function finishSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      if (!e.aiSetupStep()) break;
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  });
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

describe("事件流(#384):名将被动技击发 skillFired", () => {
  it("周瑜疾行:rollAndMove 产出 [skillFired, diceRolled, marchArrived],座位=技属主", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    mover.heroes = [HEROES.find((h) => h.id === "zhouyu")!]; // 疾行(BeforeMarch·moveBonus+1)
    const die = createDice(e.dice.getRngState()).roll().die; // 探针骰,不消耗引擎 rng
    const steps = die + 1; // 疾行加成一并计入路径预言
    const target = MAP.board.tiles.find((tile) => {
      if (tile.propertyId == null) return false;
      const path = MAP.board.computePath(tile.index, steps, mover.capitalIndex, null);
      if (path.passedCapital || path.landBranchStep != null) return false;
      if (MAP.board.getBranchStart(path.landIndex)) return false;
      const land = MAP.board.at(path.landIndex);
      return (
        land.type === "Property" && land.propertyId != null && e.findOwner(land.propertyId) == null
      );
    });
    expect(target).toBeDefined();
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["skillFired", "diceRolled", "marchArrived"]);
    expect(events[0]).toMatchObject({
      kind: "skillFired",
      seat,
      heroId: "zhouyu",
      skillId: "zhouyu-move+1",
      moment: "BeforeMarch",
    });
    expect(mover.heroLastFired["zhouyu-move+1"]).toBe(e.round); // 击发=落账+记冷却
  });
});

describe("事件流(#384):名将主动技发动 heroSkillActivated", () => {
  it("擂鼓(none 域):[heroSkillActivated] 单事件,无 targetSeat,步数加成入引擎", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const seat = e.players.indexOf(user);
    user.heroes = [HEROES.find((h) => h.id === "zhangxingcai")!];
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("zhangxingcai-leigu");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroSkillActivated"]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      seat,
      skillId: "zhangxingcai-leigu",
      skillKind: "warDrum",
    });
    expect("targetSeat" in events[0]).toBe(false); // none 域无目标字段
    expect(e.heroDiceBonus).toBe(2);
  });

  it("征辟(other 域):targetSeat 随事件;目标得银随 grantSkillCash 产 cashChanged(reason=skill,#385)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const otherSeat = userSeat === 0 ? 1 : 0;
    const targetCash0 = e.players[otherSeat].cash;
    const warrants0 = user.warrants;
    user.heroes = [HEROES.find((h) => h.id === "caopi")!];
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("caopi-zhengpi"); // other 域:先入目标段
    e.resolveHeroSkill("caopi-zhengpi", [otherSeat]); // 选定目标,发动
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroSkillActivated", "cashChanged"]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      seat: userSeat,
      skillId: "caopi-zhengpi",
      skillKind: "patronage",
      targetSeat: otherSeat,
    });
    expect(events[1]).toMatchObject({
      kind: "cashChanged",
      seat: otherSeat,
      delta: 50,
      reason: "skill",
    });
    expect(user.warrants).toBe(warrants0 + 1);
    expect(e.players[otherSeat].cash).toBe(targetCash0 + 50); // 国库补偿落账
  });
});

describe("事件流(#384):体力变更 staminaChanged", () => {
  it("赈济(any 域):[heroSkillActivated, staminaChanged],delta=夹紧后实际增减", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    user.stamina = 90; // 满 30 上限只回 10:锁「实际增减」口径
    const cash0 = user.cash;
    user.heroes = [HEROES.find((h) => h.id === "huatuo")!];
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("huatuo-zhenji"); // any 域:先入目标段
    e.resolveHeroSkill("huatuo-zhenji", [userSeat]); // 选定自己,发动
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroSkillActivated", "staminaChanged"]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      skillKind: "relief",
      targetSeat: userSeat,
    });
    expect(events[1]).toMatchObject({
      kind: "staminaChanged",
      seat: userSeat,
      delta: 10,
      reason: "heroRelief",
    });
    expect(user.stamina).toBe(100);
    expect(user.cash).toBe(cash0 - 100); // 主动付款不产 cashChanged(金额在技事件内,参数查表)
  });

  it("耗竭重置:exhaustIfDepleted 无可处置路径产出 staminaChanged(reason=exhaustion)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    e.addStamina(seat, -100); // 归 0(耗竭线上)
    beginGameEventBatch(e);
    expect(e.exhaustIfDepleted(seat)).toBe("auto"); // 无房产可处置 → 纯跳回合
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["staminaChanged"]);
    expect(events[0]).toMatchObject({
      kind: "staminaChanged",
      seat,
      delta: 100,
      reason: "exhaustion",
    });
    expect(mover.stamina).toBe(100);
    expect(mover.skipTurns).toBe(1);
  });
});

describe("事件流(#384):声望变更 reputationChanged 与抽锦囊进手 jinnangDrawn", () => {
  it("天命格:[reputationChanged, turnEnded, turnStarted],delta=+20,reason=fate", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const fate = MAP.board.tiles.find((tile) => tile.type === "Fate");
    expect(fate).toBeDefined(); // sanguo 设天命格(数据不变量)
    beginGameEventBatch(e);
    t.landActiveAt(fate!.index);
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["reputationChanged", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "reputationChanged",
      seat,
      delta: 20,
      reason: "fate",
    });
  });

  it("天命格夹紧:声望 95 再 +20,delta=+5(实际增减,非名义增量)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    mover.reputation = 95;
    beginGameEventBatch(e);
    t.landActiveAt(MAP.board.tiles.find((tile) => tile.type === "Fate")!.index);
    const events = e.snapshot().events;
    expect(events[0]).toMatchObject({ kind: "reputationChanged", delta: 5, reason: "fate" });
    expect(mover.reputation).toBe(100);
  });

  it("声望献计里程碑:跨 30 产出 [jinnangDrawn],count=实际入手,不写牌名(ADR-0016)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    mover.reputation = 29;
    beginGameEventBatch(e);
    e.addReputation(seat, 1); // 跨 30:献计一封 → drawJinnangTraced(reason=repMilestone)
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["jinnangDrawn"]);
    expect(events[0]).toMatchObject({
      kind: "jinnangDrawn",
      seat,
      count: 1,
      reason: "repMilestone",
    });
    // 隐私口径:事件字段里没有牌 id(与对局日志「抽了一张锦囊」同口径)
    expect(Object.keys(events[0]).sort()).toEqual([
      "count",
      "kind",
      "reason",
      "round",
      "seat",
      "turn",
    ]);
    expect(mover.jinnangHandCount).toBe(1);
    expect(mover.repMilestones).toContain(30);
  });
});

describe("事件流(#384):跳过回合 turnSkipped 与破产债主 creditorSeat", () => {
  it("辅路中伏:标记回合不产 skip 事件;下回合到点消费产出 [turnEnded, turnSkipped, turnStarted]", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    const ambushed = e.activePlayer;
    const seat = e.players.indexOf(ambushed);
    const branchStart = MAP.board.tiles.findIndex((tile) => tile.name === "许昌"); // 辅路起点(game.test.ts 同款)
    expect(branchStart).toBeGreaterThanOrEqual(0);
    ambushed.onBranch = { step: 4 }; // 辅路第 4 格 = 中伏(penalty)
    t.placeActive(branchStart);
    t.forceTurnPhase("Land");
    beginGameEventBatch(e);
    t.resolveBranchCell(ambushed, e.board.branch!.cells[4]); // 中伏:skipTurns=1 + endTurn
    expect(kinds(e.snapshot().events)).toEqual(["turnEnded", "turnStarted"]); // 标记侧无 skip 事件
    e.turnPhase = "AwaitingDecision";
    beginGameEventBatch(e);
    e.endDecision(); // 对家收尾 → 推进到中伏者 → 跳过
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["turnEnded", "turnSkipped", "turnStarted"]);
    expect(events[1]).toMatchObject({ kind: "turnSkipped", seat });
    expect(ambushed.skipTurns).toBe(0);
  });

  it("playerBankrupt 债主座位:无债主=null;有债主=债主座位(#384 传参接线)", () => {
    // 无债主(归银行)
    const e1 = makeEngine(5);
    finishSetup(e1);
    const t1 = testEngine(e1);
    const mover1 = e1.activePlayer;
    mover1.cash = 50;
    mover1.properties = []; // 仅都城不可变卖 → 无可变卖资产
    beginGameEventBatch(e1);
    expect(t1.payOrLiquidate(mover1, null, 200)).toBe("bankrupt");
    expect(e1.snapshot().events[0]).toMatchObject({
      kind: "playerBankrupt",
      seat: e1.players.indexOf(mover1),
      creditorSeat: null,
    });
    // 有债主(资转债主)
    const e2 = makeEngine(5);
    finishSetup(e2);
    const t2 = testEngine(e2);
    const mover2 = e2.activePlayer;
    const creditorSeat = e2.players.indexOf(mover2) === 0 ? 1 : 0;
    mover2.cash = 50;
    mover2.properties = [];
    beginGameEventBatch(e2);
    expect(t2.payOrLiquidate(mover2, e2.players[creditorSeat], 200)).toBe("bankrupt");
    expect(e2.snapshot().events[0]).toMatchObject({
      kind: "playerBankrupt",
      seat: e2.players.indexOf(mover2),
      creditorSeat,
    });
  });
});

// ─────────────── #385 缺口闭合:演出映射事件(六处缺口的事件侧) ───────────────
describe("事件流(#385 缺口 1):购地被拒/按兵不动 propertyRejected", () => {
  it("银两不足:无主城自动不取,产出 [propertyRejected(insufficient-cash), turnEnded, turnStarted]", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    const p = e.activePlayer;
    const tile = MAP.board.tiles.find(
      (x) => x.propertyId != null && e.findOwner(x.propertyId) == null,
    )!;
    const def = e.catalog.get(tile.propertyId)!;
    p.cash = def.purchasePrice - 1; // 银两不足(委任状足额)
    p.warrants = 3;
    beginGameEventBatch(e);
    t.landActiveAt(tile.index);
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["propertyRejected", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "propertyRejected",
      seat: e.players.indexOf(p),
      propertyId: def.id,
      reason: "insufficient-cash",
    });
  });

  it("委任状不足:reason=no-warrant(文案浮字由 fx 按 reason 派生)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    const p = e.activePlayer;
    const tile = MAP.board.tiles.find(
      (x) => x.propertyId != null && e.findOwner(x.propertyId) == null,
    )!;
    const def = e.catalog.get(tile.propertyId)!;
    p.cash = def.purchasePrice + 500;
    p.warrants = 0;
    beginGameEventBatch(e);
    t.landActiveAt(tile.index);
    expect(e.snapshot().events[0]).toMatchObject({
      kind: "propertyRejected",
      propertyId: def.id,
      reason: "no-warrant",
    });
  });

  it("城已满级:己城扩军不可行,reason=maxed(按兵不动)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    const p = e.activePlayer;
    const tile = MAP.board.tiles.find(
      (x) => x.propertyId != null && e.findOwner(x.propertyId) == null,
    )!;
    const def = e.catalog.get(tile.propertyId)!;
    p.properties.push({
      propertyId: def.id,
      group: "g",
      purchasePrice: 100,
      level: def.maxLevel, // 已满级 → 扩军不可用,仅剩按兵不动假选择
      maxLevel: def.maxLevel,
    });
    beginGameEventBatch(e);
    t.landActiveAt(tile.index);
    expect(e.snapshot().events[0]).toMatchObject({
      kind: "propertyRejected",
      propertyId: def.id,
      reason: "maxed",
    });
  });
});

describe("事件流(#385 缺口 2):破产清算逐城易主 assetTransferred", () => {
  it("破产清算:都城转债主,产出 [assetTransferred, playerBankrupt],toSeat=债主座位", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const creditorSeat = seat === 0 ? 1 : 0;
    const capPropId = e.board.at(mover.capitalIndex).propertyId!;
    mover.cash = 50; // 仅都城在手(无可变卖资产)→ 直落破产,清算把都城转债主
    beginGameEventBatch(e);
    expect(t.payOrLiquidate(mover, e.players[creditorSeat], 200)).toBe("bankrupt");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["assetTransferred", "playerBankrupt"]);
    expect(events[0]).toMatchObject({
      kind: "assetTransferred",
      seat,
      propertyId: capPropId,
      toSeat: creditorSeat,
    });
  });
});

describe("事件流(#385 缺口 3):行军路径随事件 marchArrived.path", () => {
  it("主路行军:path.from=起点、landIndex=落点、traversed=逐格(合并批多段各播各段的数据基础)", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const die = createDice(e.dice.getRngState()).roll().die; // 探针骰,不消耗引擎 rng
    const target = MAP.board.tiles.find((tile) => {
      if (tile.propertyId == null) return false;
      const path = MAP.board.computePath(tile.index, die, mover.capitalIndex, null);
      if (path.passedCapital || path.landBranchStep != null) return false;
      if (MAP.board.getBranchStart(path.landIndex)) return false;
      const land = MAP.board.at(path.landIndex);
      return (
        land.type === "Property" && land.propertyId != null && e.findOwner(land.propertyId) == null
      );
    });
    expect(target).toBeDefined();
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["diceRolled", "marchArrived"]); // 落无主城进决策,回合未收尾
    const march = events[1] as Extract<GameEvent, { kind: "marchArrived" }>;
    expect(march.tileIndex).toBe(mover.position);
    expect(march.path.from).toBe(target!.index);
    expect(march.path.landIndex).toBe(march.tileIndex);
    expect(march.path.traversed).toHaveLength(die);
    expect(march.path.landBranchStep).toBeNull();
  });

  it("驻跸必停:capitalHalt 路径截断到都城(时机映射表从引擎 lastMove 取)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const t = testEngine(e);
    const p = e.activePlayer;
    t.placeActive((p.capitalIndex - 2 + e.board.count) % e.board.count); // 距都城 2 步:die>=3 必停
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    if (e.presentation.lastRoll!.die < 3) return; // 未必停(骰面相关):不作断言
    const halt = events.find(
      (ev): ev is Extract<GameEvent, { kind: "capitalHalt" }> => ev.kind === "capitalHalt",
    );
    expect(halt).toBeDefined();
    expect(halt!.path.landIndex).toBe(p.capitalIndex);
    expect(halt!.path.traversed[halt!.path.traversed.length - 1]).toBe(p.capitalIndex);
  });
});

describe("事件流(#385 缺口 4):辅路落位行军 marchArrived", () => {
  it("待入辅路掷骰:辅路落位产出 marchArrived(路径 landBranchStep/branchWaypoints 齐备)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const branchStart = MAP.board.tiles.findIndex((tile) => tile.name === "许昌"); // 辅路起点
    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(e.board.branch).not.toBeNull();
    mover.onBranch = { step: -1 }; // 待入辅路
    t.place(seat, branchStart);
    const die = createDice(e.dice.getRngState()).roll().die;
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(events[0]).toMatchObject({ kind: "diceRolled", seat });
    const march = events[1] as Extract<GameEvent, { kind: "marchArrived" }>;
    if (march?.path.landBranchStep == null) return; // 骰步溢出汇入主路:走主路落格口径,另案覆盖
    expect(kinds(events).indexOf("marchArrived")).toBe(1); // 骰后紧随(辅路格结算事件在其后)
    expect(march.tileIndex).toBe(branchStart); // 主路锚点占位(辅路落位不改 position)
    expect(march.path.landBranchStep).toBe(die - 1);
    expect(march.path.branchWaypoints).toHaveLength(die);
  });
});

describe("事件流(#385 缺口 5):拦检失败/中招/窃宝/技得银", () => {
  it("拦检失败:拼点平/负产出 reactionFailed(点数与拦检城随事件;拦停成功则无)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const moverSeat = e.players.indexOf(mover);
    const ownerSeat = moverSeat === 0 ? 1 : 0;
    const owner = e.players[ownerSeat];
    const tile = MAP.board.tiles.find((x) => {
      if (x.type !== "Property" || x.propertyId == null) return false;
      if (MAP.board.getBranchStart(x.index)) return false;
      if (x.index === mover.capitalIndex || x.index === owner.capitalIndex) return false;
      const prev = MAP.board.at((x.index - 1 + MAP.board.count) % MAP.board.count);
      return (
        prev.type !== "Fate" && (prev.propertyId == null || e.findOwner(prev.propertyId) == null)
      );
    });
    expect(tile).toBeDefined();
    owner.properties.push({
      propertyId: tile!.propertyId!,
      group: "g",
      purchasePrice: 100,
      level: 0,
      maxLevel: 3,
    });
    owner.jinnangHand = ["半路杀出"];
    owner.jinnangHandCount = 1;
    t.place(moverSeat, (tile!.index - 1 + MAP.board.count) % MAP.board.count); // 前一格起行:必经城主城
    beginGameEventBatch(e);
    e.rollAndMove();
    if (e.turnPhase !== "AwaitingReaction") return; // 未开窗(骰步相关落点差异):不作断言
    // 拼点预言:同种子探针骰续掷两把 = 城主/行人点数(resolveDuel 共用公共拼点)
    const probe = createDice(e.dice.getRngState());
    const aRoll = probe.rollDie();
    const bRoll = probe.rollDie();
    const expectFail = aRoll <= bRoll; // 平/负=城主拦检失败
    beginGameEventBatch(e);
    e.respondReaction(ownerSeat, true, "半路杀出");
    const events = e.snapshot().events;
    expect(events[0]).toMatchObject({ kind: "reactionAnswered", seat: ownerSeat, use: true });
    const fail = events.find(
      (ev): ev is Extract<GameEvent, { kind: "reactionFailed" }> => ev.kind === "reactionFailed",
    );
    expect(fail != null).toBe(expectFail);
    if (fail != null) {
      expect(fail).toMatchObject({
        seat: ownerSeat,
        windowKind: "march",
        tileIndex: tile!.index,
        aRoll,
        bRoll,
      });
    }
  });

  it("缓兵之计中招:产出 [jinnangAnnounced, jinnangInflicted],targetSeat=中招者", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const otherSeat = userSeat === 0 ? 1 : 0;
    user.jinnangHand = ["缓兵之计"];
    user.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveJinnang("缓兵之计"); // one 域:入目标段
    e.resolveJinnang("缓兵之计", [otherSeat]); // 选定目标,执行
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["jinnangAnnounced", "jinnangInflicted"]);
    expect(events[1]).toMatchObject({
      kind: "jinnangInflicted",
      seat: userSeat,
      cardId: "缓兵之计",
      targetSeat: otherSeat,
    });
    expect(e.players[otherSeat].skipTurns).toBe(1);
  });

  it("窃玉偷香:产出 [jinnangAnnounced, treasureStolen],失主/珍宝名随事件(id 带流水号,名字不入查表)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const otherSeat = userSeat === 0 ? 1 : 0;
    e.players[otherSeat].treasures.push({
      id: "seal-1",
      name: "传国玉玺",
      level: 10,
      count: 1,
      desc: "",
    });
    user.jinnangHand = ["窃玉偷香"];
    user.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveJinnang("窃玉偷香"); // one 域:入目标段
    e.resolveJinnang("窃玉偷香", [otherSeat]);
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["jinnangAnnounced", "treasureStolen"]);
    expect(events[1]).toMatchObject({
      kind: "treasureStolen",
      seat: userSeat,
      victimSeat: otherSeat,
      treasureId: "seal-1",
      treasureName: "传国玉玺",
    });
    expect(e.players[otherSeat].treasures).toHaveLength(0);
    expect(user.treasures.map((x) => x.id)).toEqual(["seal-1"]);
  });

  it("被动技得银:grantSkillCash 产出 cashChanged(reason=skill),浮字与金额同口径", () => {
    const e = makeEngine(3);
    finishSetup(e);
    beginGameEventBatch(e);
    e.grantSkillCash(0, 50);
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["cashChanged"]);
    expect(events[0]).toMatchObject({ kind: "cashChanged", seat: 0, delta: 50, reason: "skill" });
  });
});

describe("事件流(#385 缺口 6):机遇抉择/耗竭处置的目录文案事件", () => {
  it("机遇抉择:resolveEncounterChoice 产出 encounterChoice(id+下标,成品文案不入事件)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const def = ENCOUNTERS.find(
      (c) =>
        c.choices != null &&
        c.choices.length >= 2 &&
        c.choices.every((o) => o.effect?.kind !== "grantHero"),
    )!; // 无门槛双选项:两路都可用,恒入 AwaitingEncounter
    beginGameEventBatch(e);
    expect(t.enterEncounter(def)).toBe("deciding");
    expect(e.turnPhase).toBe("AwaitingEncounter");
    e.resolveEncounterChoice(0);
    const events = e.snapshot().events;
    expect(events[0]).toMatchObject({
      kind: "encounterChoice",
      seat,
      encounterId: def.id,
      choiceIndex: 0,
    });
    expect("text" in events[0]).toBe(false); // 静态目录案:文案由 fx 查 ENCOUNTERS 派生
  });

  it("耗竭处置:唯一可处置城自动执行,产出 [exhaustionChoice, staminaChanged](明细在前供 fx 合成)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const tile = MAP.board.tiles.find(
      (x) =>
        x.propertyId != null && x.index !== mover.capitalIndex && e.findOwner(x.propertyId) == null,
    )!;
    mover.properties.push({
      propertyId: tile.propertyId!,
      group: "g",
      purchasePrice: 100,
      level: 1, // 唯一 Lv>0 城:降级单选项 → 自动执行(仍走 settleExhaustionChoice 同口)
      maxLevel: 3,
    });
    e.addStamina(seat, -100); // 体力归 0(耗竭线上)
    beginGameEventBatch(e);
    expect(e.exhaustIfDepleted(seat)).toBe("auto");
    const events = e.snapshot().events;
    expect(events[0]).toMatchObject({
      kind: "exhaustionChoice",
      seat,
      propertyId: tile.propertyId,
      exhaustionKind: "downgrade",
    });
    expect(events[1]).toMatchObject({
      kind: "staminaChanged",
      seat,
      delta: 100,
      reason: "exhaustion",
    });
  });
});

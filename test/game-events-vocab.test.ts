// 事件词汇补全测试(#384,折叠切换②):新增六类事件的序列断言——名将被动技击发
// (skillFired)/主动技发动(heroSkillActivated)/抽锦囊进手(jinnangDrawn)/声望变更
// (reputationChanged)/体力变更(staminaChanged)/跳过回合(turnSkipped),以及
// playerBankrupt 的债主座位字段。词汇表与产出两口见 src/core/game-events.ts;
// 批界与折叠口径同 game-events.test.ts(白盒触达的转移用 beginGameEventBatch 显式开批)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { testEngine } from "@core/testing";
import { HEROES } from "@core/heroes";
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

  it("征辟(other 域):targetSeat 随事件;目标得银走 grantSkillCash 不产 cashChanged", () => {
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
    expect(kinds(events)).toEqual(["heroSkillActivated"]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      seat: userSeat,
      skillId: "caopi-zhengpi",
      skillKind: "patronage",
      targetSeat: otherSeat,
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

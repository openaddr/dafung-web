// 事件词汇补全测试(#384,折叠切换②):新增六类事件的序列断言——名将被动技击发
// (skillFired)/主动技发动(heroSkillActivated)/抽锦囊进手(jinnangDrawn)/体力变更(staminaChanged)/跳过回合(turnSkipped),以及
// playerBankrupt 的债主座位字段;尾部为 #385 缺口闭合的演出映射事件(六处缺口)。
// 词汇表与产出两口见 src/core/game-events.ts;
// 批界与折叠口径同 game-events.test.ts(白盒触达的转移用 beginGameEventBatch 显式开批)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type { EngineConfig, SeatConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { loadMap } from "@dafung/core/engine/board-loader";
import { testEngine, armHero } from "@dafung/core/engine/testing";
import { fullDefenseOf } from "@dafung/core/engine/defense";
import { grantProperty, setDefense } from "@dafung/core/engine/planter";
import { HEROES } from "@dafung/core/engine/heroes";
import { beginGameEventBatch, type GameEvent } from "@dafung/core/engine/game-events";
import guanzhongData from "../packages/core/maps/guanzhong.json";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 1, seats?: SeatConfig[]) {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
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
  it("疾行(张星彩池,#1390 后周瑜出池):rollAndMove 产出 [skillFired, diceRolled, marchArrived],座位=技属主", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    armHero(
      e,
      mover,
      HEROES.find((h) => h.id === "zhangxingcai")!,
      ["jixing"],
    ); // 疾行 jixing(BeforeMarch·moveBonus+1;#1390 周瑜池换血后载体随张星彩池,窄授免掷金互扰)
    const die = createDice(e.dice.getRngState()).roll().die; // 探针骰,不消耗引擎 rng
    const steps = die + 1; // 疾行加成一并计入路径预言
    const target = MAP.board.tiles.find((tile) => {
      if (tile.propertyId == null) return false;
      const path = MAP.board.computePath(tile.index, steps, mover.capitalIndex);
      if (path.passedCapital) return false;
      const land = MAP.board.at(path.landIndex);
      return land.event == null && land.propertyId != null && e.findOwner(land.propertyId) == null;
    });
    expect(target).toBeDefined();
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["skillFired", "diceRolled", "marchArrived", "landingResolved"]);
    expect(events[0]).toMatchObject({
      kind: "skillFired",
      seat,
      heroId: "zhangxingcai",
      skillId: "jixing",
      moment: "BeforeMarch",
    });
    expect(mover.heroes[0].lastFired["jixing"]).toBe(e.round); // 击发=落账+记冷却
  });
});

describe("事件流(#384):名将主动技发动 heroSkillActivated", () => {
  it("擂鼓(none 域):[heroSkillActivated] 单事件,无 targetSeat,步数加成入引擎", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const seat = e.players.indexOf(user);
    armHero(
      e,
      user,
      HEROES.find((h) => h.id === "zhangxingcai")!,
    );
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("zhangxingcai", "leigu");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroSkillActivated", "jinnangPhaseResumed"]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      seat,
      heroId: "zhangxingcai",
      skillId: "leigu",
      skillKind: "warDrum",
    });
    expect("targetSeat" in events[0]).toBe(false); // none 域无目标字段
    expect(e.heroDiceBonus).toBe(2);
  });

  it("火攻发动后下发目标城伤害和即时奖励", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const otherSeat = userSeat === 0 ? 1 : 0;
    armHero(
      e,
      user,
      HEROES.find((h) => h.id === "zhouyu")!,
    );
    // 布场(#1388 城目标域):射程内给对手授一座 Lv>0 城(placePlayer 布距离 + grantProperty)
    const victim = e.players[otherSeat];
    const spare = e.board.tiles.find(
      (t) =>
        t.event == null && t.propertyId != null && e.board.distance(user.position, t.index) <= 5,
    )!;
    grantProperty(e, otherSeat, spare.propertyId!, 2);
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("zhouyu", "huogong"); // 城目标域:先入目标段
    e.resolveHeroSkill("zhouyu", "huogong", [spare.index]); // 选定目标城(tileIndex 提交),发动
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual([
      "heroSkillActivated",
      "propertyDamaged",
      "cashChanged",
      "jinnangPhaseResumed",
    ]);
    expect(events[0]).toMatchObject({
      kind: "heroSkillActivated",
      seat: userSeat,
      skillId: "huogong",
      skillKind: "fireBlast",
    });
    expect("targetSeat" in events[0]).toBe(false); // 城目标域不带座位字段
    expect(victim.properties.find((h) => h.propertyId === spare.propertyId)?.defense).toBe(
      fullDefenseOf(2) - 10,
    ); // 火焰伤害 10 点落账(防御值 30→20)
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
    armHero(
      e,
      user,
      HEROES.find((h) => h.id === "huatuo")!,
    );
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveHeroSkill("huatuo", "zhenji"); // any 域:先入目标段
    e.resolveHeroSkill("huatuo", "zhenji", [userSeat]); // 选定自己,发动
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroSkillActivated", "staminaChanged", "jinnangPhaseResumed"]);
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
    // 战报增量=实际差(#568 病 B):请求 +30、实际 +10,战报不得写请求数
    const text = testEngine(e).logText();
    expect(text).toContain("体力 +10(现 100)");
    expect(text).not.toContain("体力 +30");
  });

  it("只持有已打空都城时，耗竭产出休整事件，无城损事件", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const capital = e.board.at(mover.capitalIndex).propertyId!;
    setDefense(e, seat, capital, 0);
    beginGameEventBatch(e);
    expect(e.damageStamina(seat, 100, null)).toBe(0);
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 4)).toEqual([
      "staminaChanged",
      "exhaustionResolved",
      "turnEnded",
      "turnStarted",
    ]);
    expect(events[1]).toMatchObject({
      kind: "exhaustionResolved",
      seat,
      sourceSeat: null,
      downgradedPropertyIds: [],
      lostPropertyIds: [],
      restTurns: 2,
    });
    expect(mover.stamina).toBe(0); // 归 0 当刻不回血,休整期满才回满
    expect(mover.skipTurns).toBe(2);
    expect(mover.resting).toBe(true);
  });
});

describe("事件流(#384):跳过回合 turnSkipped 与破产债主 creditorSeat", () => {
  it("跳过回合:标记回合不产 skip 事件;下回合到点消费产出 [turnEnded, turnSkipped, turnStarted]", () => {
    // seed 3(ADR-0034 重钓):双都城皆普通城(凉州/剑阁),回合收尾不带链尾探宝事件干扰断言
    const e = makeEngine(3);
    finishSetup(e);
    const t = testEngine(e);
    const skipped = e.activePlayer;
    const seat = e.players.indexOf(skipped);
    skipped.skipTurns = 1; // 标记侧(耗竭善后/缓兵之计共用 skipTurns)
    t.forceTurnPhase("AwaitingDecision");
    beginGameEventBatch(e);
    e.endDecision(); // 标记回合收尾(本回合不产 skip 事件)
    expect(kinds(e.snapshot().events)).not.toContain("turnSkipped");
    t.forceTurnPhase("AwaitingDecision");
    beginGameEventBatch(e);
    e.endDecision(); // 回合收尾 → 推进到被跳过者 → 跳过
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 5)).toEqual([
      "turnEnded",
      "roundEnded",
      "roundStarted",
      "turnSkipped",
      "turnStarted",
    ]);
    expect(events.find((event) => event.kind === "turnSkipped")).toMatchObject({ seat });
    expect(skipped.skipTurns).toBe(0);
  });

  it("playerBankrupt 债主座位:无债主=null;有债主=债主座位(#384 传参接线)", () => {
    // 无债主(归银行)
    const e1 = makeEngine(5);
    finishSetup(e1);
    const mover1 = e1.activePlayer;
    mover1.cash = 50;
    mover1.properties = []; // 仅都城不可变卖 → 无可变卖资产
    beginGameEventBatch(e1);
    expect(e1.payOrLiquidate(mover1, null, 200)).toBe("liquidating");
    e1.declareBankruptcy();
    expect(e1.snapshot().events[0]).toMatchObject({
      kind: "playerBankrupt",
      seat: e1.players.indexOf(mover1),
      creditorSeat: null,
    });
    // 有债主(资转债主)
    const e2 = makeEngine(5);
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    const creditorSeat = e2.players.indexOf(mover2) === 0 ? 1 : 0;
    mover2.cash = 50;
    mover2.properties = [];
    beginGameEventBatch(e2);
    expect(e2.payOrLiquidate(mover2, e2.players[creditorSeat], 200)).toBe("liquidating");
    e2.declareBankruptcy();
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
    p.cash = def.purchasePrice - 1; // 银两不足
    beginGameEventBatch(e);
    t.landActiveAt(tile.index);
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 3)).toEqual(["propertyRejected", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "propertyRejected",
      seat: e.players.indexOf(p),
      propertyId: def.id,
      reason: "insufficient-cash",
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
      burning: null,
      damageRanking: [],
      propertyId: def.id,
      group: "g",
      level: def.maxLevel, // 已满级 → 扩军不可用,仅剩按兵不动假选择
      maxLevel: def.maxLevel,
      defense: fullDefenseOf(def.maxLevel),
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
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const creditorSeat = seat === 0 ? 1 : 0;
    const capPropId = e.board.at(mover.capitalIndex).propertyId!;
    mover.cash = 50; // 仅都城在手(无可变卖资产)→ 直落破产,清算把都城转债主
    beginGameEventBatch(e);
    expect(e.payOrLiquidate(mover, e.players[creditorSeat], 200)).toBe("liquidating");
    e.declareBankruptcy();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["assetTransferred", "playerBankrupt", "turnEnded", "gameOver"]);
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
      const path = MAP.board.computePath(tile.index, die, mover.capitalIndex);
      if (path.passedCapital) return false;
      const land = MAP.board.at(path.landIndex);
      return land.event == null && land.propertyId != null && e.findOwner(land.propertyId) == null;
    });
    expect(target).toBeDefined();
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["diceRolled", "marchArrived", "landingResolved"]); // 落无主城进决策,回合未收尾
    const march = events[1] as Extract<GameEvent, { kind: "marchArrived" }>;
    expect(march.tileIndex).toBe(mover.position);
    expect(march.path.from).toBe(target!.index);
    expect(march.path.landIndex).toBe(march.tileIndex);
    expect(march.path.traversed).toHaveLength(die);
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
      if (x.event != null || x.propertyId == null) return false; // 普通城(#826 全城池制)
      if (x.index === mover.capitalIndex || x.index === owner.capitalIndex) return false;
      const prev = MAP.board.at((x.index - 1 + MAP.board.count) % MAP.board.count);
      return (
        prev.event == null && (prev.propertyId == null || e.findOwner(prev.propertyId) == null)
      );
    });
    expect(tile).toBeDefined();
    owner.properties.push({
      burning: null,
      damageRanking: [],
      propertyId: tile!.propertyId!,
      group: "g",
      level: 1,
      maxLevel: 4,
      defense: 40,
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
    expect(kinds(events)).toEqual(["jinnangAnnounced", "jinnangInflicted", "jinnangPhaseResumed"]);
    expect(events[1]).toMatchObject({
      kind: "jinnangInflicted",
      seat: userSeat,
      cardId: "缓兵之计",
      targetSeat: otherSeat,
    });
    expect(e.players[otherSeat].skipTurns).toBe(1);
  });

  it("窃玉偷香:产出 [jinnangAnnounced, treasureGained, treasureStolen](#455 A4 增派 TreasureGained 时机→事件),失主/珍宝名随事件(id 带流水号,名字不入查表)", () => {
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
    expect(kinds(events)).toEqual([
      "jinnangAnnounced",
      "treasureGained",
      "treasureStolen",
      "jinnangPhaseResumed",
    ]);
    expect(events[1]).toMatchObject({
      kind: "treasureGained",
      seat: userSeat, // subject=窃方
      treasureId: "seal-1",
    });
    expect(events[2]).toMatchObject({
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

describe("事件流(#385 缺口 6):耗竭处置的文案事件", () => {
  it("耗竭先同步城损，再宣告实际的降级清单和休整回合数", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    const tile = MAP.board.tiles.find(
      (x) =>
        x.propertyId != null && x.index !== mover.capitalIndex && e.findOwner(x.propertyId) == null,
    )!;
    grantProperty(e, seat, tile.propertyId!, 2);
    beginGameEventBatch(e);
    expect(e.damageStamina(seat, 100, null)).toBe(0);
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 4)).toEqual([
      "staminaChanged",
      "propertyDamaged", // 都城打空
      "propertyDamaged", // 普通城降级
      "exhaustionResolved",
    ]);
    expect(events[3]).toMatchObject({
      kind: "exhaustionResolved",
      seat,
      sourceSeat: null,
      downgradedPropertyIds: [tile.propertyId],
      lostPropertyIds: [],
      restTurns: 2,
    });
    expect(mover.skipTurns).toBe(2);
    expect(mover.stamina).toBe(0); // 归 0 当刻不回血(回满在休整期满,reason=rest 另条)
  });
});

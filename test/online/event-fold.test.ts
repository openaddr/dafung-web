// 折叠投影器单测(#386 两族,#387 全覆盖,ADR-0020 折叠切换⑤):事件批 → 本地引擎副本
// 字段的投影契约,按字段族分组断言「事件序列 → 状态」——回合/胜负、掷骰/行军(含权威落格
// 事实:相位/pendingLand/落格表现态/交涉到来)、城池、金钱(含相邻回填)、珍宝、名将、
// 锦囊(含反应窗)、体力、跳过、破产;以及契约边界(未知 kind 忽略 = 范围
// 定义、无主座位/事件序违反当场炸)与快照对账(折叠漂移被水合无条件校正,快照=校准锚)。
// 真实命令与 JSON 下行的决策续行接缝见同目录 local-hydration.test.ts。
import { describe, it, expect, spyOn } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type {
  EngineConfig,
  GameCommand,
  SeatConfig,
  TurnPhase,
} from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { applyCityDamage } from "@dafung/core/engine/defense";
import type { MovePath } from "@dafung/core/engine/board";
import { HEROES } from "@dafung/core/engine/heroes";
import { TREASURES, makeSkillBook } from "@dafung/core/engine/treasures";
import {
  armPhase,
  armVisitor,
  giveJinnang,
  giveTreasure,
  grantProperty,
  pinDice,
  placePlayer,
  setCash,
  setDefense,
  setJinnangPiles,
} from "@dafung/core/engine/planter";
import { cmdMsg, eventsMsg, type InboundMsg, type ServerMsg } from "@dafung/core/protocol/wire";
import { REACTION_WINDOW_MS } from "@dafung/core/engine/constants";
import {
  beginGameEventBatch,
  type GameEvent,
  type GameEventBody,
} from "@dafung/core/engine/game-events";
import { armHero } from "@dafung/core/engine/testing";
import guanzhongData from "../../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";
import { extractBatchEvents } from "@app/fx/event-extract";
import { foldEventBatch } from "@app/net/event-fold";
import { redactEvents, redactSnapshotForSeat } from "@dafung/core/room/seat-projection";

const MAP = loadMap(guanzhongData);

// 关中地图锚点(4×7 满格螺旋):长安=P0 蛇头(tile 0)、洛阳=P27 腹地收尾(tile 27)。
const CHANGAN = 0;
const LUOYANG = MAP.board.tiles.find((t) => t.propertyId === "prop-luoyang")!.index;

function makeEngine(seed = 7): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: false, guohao: "魏" },
    { name: "B", isBot: false, guohao: "蜀" },
  ];
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 事件首部三件套(折叠认 kind/seat + 族字段 + round/turn 首部摸照)。 */
function ev<B extends GameEventBody>(seat: number | null, body: B): GameEvent {
  return { ...body, seat, round: 1, turn: 1 };
}

/** 最小 MovePath 形状(折叠器读 tileIndex,路径字段随类型契约补齐)。 */
function path(landIndex: number): MovePath {
  return {
    from: 0,
    traversed: [],
    landIndex,
    passedCapital: false,
    capitalIndex: -1,
    waypoints: [],
  };
}

describe("折叠投影器 foldEventBatch · #386 两族基线", () => {
  it("银行债清偿后推进回合，事件使持牌者收下反应锦囊，其余座位只见张数", () => {
    const e = makeEngine();
    e.doDraftRoll();
    while (e.phase === "Setup")
      e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
    const debtor = e.activeIndex;
    const nextSeat = 1 - debtor;
    giveJinnang(e, nextSeat, []);
    setJinnangPiles(e, ["半路杀出"], []);
    grantProperty(e, debtor, "prop-jinyang", 1); // 关中晋阳 1 级变卖价 900
    setCash(e, debtor, 50);
    e.payOrLiquidate(e.activePlayer, null, 400);
    const replica = makeEngine();
    replica.restoreFromSnapshot(redactSnapshotForSeat(e.snapshot(), nextSeat));
    const otherReplica = makeEngine();
    otherReplica.restoreFromSnapshot(redactSnapshotForSeat(e.snapshot(), debtor));
    const message = JSON.parse(
      cmdMsg({
        type: "confirmBankruptcySettle",
        assets: [{ kind: "property", id: "prop-jinyang" }],
      }),
    ) as Extract<InboundMsg, { type: "cmd" }>;

    e.submitCommand(message.cmd);
    for (const [viewer, copy] of [
      [nextSeat, replica],
      [debtor, otherReplica],
    ] as const) {
      const downlink = JSON.parse(eventsMsg(redactEvents(e.gameEvents, viewer))) as Extract<
        ServerMsg,
        { type: "events" }
      >;
      foldEventBatch(copy, downlink.events);
    }

    expect(e.players[debtor].cash).toBe(550);
    expect(replica.players[debtor].cash).toBe(550);
    expect(e.pendingDebt).toBeNull();
    expect(replica.pendingDebt).toBeNull();
    expect(e.activeIndex).toBe(nextSeat);
    expect(replica.activeIndex).toBe(nextSeat);
    expect(e.turnPhase).toBe("Roll");
    expect(replica.turnPhase).toBe("Roll");
    expect(replica.players[nextSeat]).toMatchObject({
      jinnangHand: ["半路杀出"],
      jinnangHandCount: 1,
    });
    expect(otherReplica.players[nextSeat]).toMatchObject({ jinnangHand: [], jinnangHandCount: 1 });
    expect(replica.jinnangDeckCount).toBe(0);
    expect(otherReplica.turnNumber).toBe(e.turnNumber);
    const recovered = JSON.parse(JSON.stringify(redactSnapshotForSeat(e.snapshot(), debtor)));
    expect(recovered.events).toContainEqual({
      kind: "jinnangDrawn",
      count: 1,
      reason: "turnStart",
      seat: nextSeat,
      round: e.round,
      turn: e.turnNumber,
    });
    otherReplica.restoreFromSnapshot(recovered);
    expect(otherReplica.players[nextSeat]).toMatchObject({ jinnangHand: [], jinnangHandCount: 1 });
  });

  it("跳过座位不摸牌，实际回合洗回后先摸再出牌，双空直接进入掷骰", () => {
    const e = makeEngine();
    e.doDraftRoll();
    while (e.phase === "Setup")
      e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
    const active = e.activeIndex;
    const skipped = 1 - active;
    giveJinnang(e, active, ["缓兵之计"]);
    giveJinnang(e, skipped, []);
    armPhase(e, { turnPhase: "AwaitingJinnang" });
    e.submitCommand({ type: "useJinnang", cardId: "缓兵之计" });
    e.submitCommand({ type: "useJinnang", cardId: "缓兵之计", targets: [skipped] });
    setJinnangPiles(e, [], ["横征暴敛"]);
    const replica = makeEngine();
    replica.restoreFromSnapshot(redactSnapshotForSeat(e.snapshot(), active));

    const finishTurn = () => {
      armPhase(e, { turnPhase: "AwaitingDecision" });
      e.submitCommand({ type: "endDecision" });
      foldEventBatch(replica, JSON.parse(eventsMsg(redactEvents(e.gameEvents, active))).events);
    };
    finishTurn();
    expect(e.gameEvents.filter((ev) => ev.kind === "turnSkipped").map((ev) => ev.seat)).toEqual([
      skipped,
    ]);
    expect(e.activeIndex).toBe(active);
    expect(replica.players[skipped].jinnangHandCount).toBe(0);
    expect(replica.players[active].jinnangHand).toEqual(["横征暴敛"]);
    expect(replica.jinnangDiscard).toEqual([]);
    expect(replica.jinnangDeckCount).toBe(0);
    expect(replica.turnPhase).toBe("AwaitingJinnang");
    expect(e.choicesFor().find((option) => option.id === "横征暴敛")?.available).toBe(true);

    e.submitCommand({ type: "useJinnang", cardId: null });
    finishTurn();
    expect(e.activeIndex).toBe(skipped);
    expect(e.gameEvents.filter((ev) => ev.kind.startsWith("jinnang"))).toEqual([
      expect.objectContaining({ kind: "jinnangExhausted", seat: skipped }),
    ]);
    expect(replica.players[skipped].jinnangHandCount).toBe(0);
    expect(replica.jinnangDeckCount).toBe(0);
    expect(replica.turnPhase).toBe("Roll");
  });

  it("批量清偿命令经线上编码后保留重复数量,真实事件批只消费所卖册数", () => {
    const e = makeEngine();
    e.doDraftRoll();
    while (e.phase === "Setup")
      e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
    const seat = e.activeIndex;
    const book = makeSkillBook("jixing");
    giveTreasure(e, seat, [book, book, book]);
    setCash(e, seat, 0);
    e.payOrLiquidate(e.activePlayer, null, 400);
    const replica = makeEngine();
    replica.restoreFromSnapshot(e.snapshot());
    const message = JSON.parse(
      cmdMsg({
        type: "confirmBankruptcySettle",
        assets: [
          { kind: "treasure", id: book.id },
          { kind: "treasure", id: book.id },
        ],
      }),
    ) as Extract<InboundMsg, { type: "cmd" }>;

    e.submitCommand(message.cmd);
    foldEventBatch(replica, JSON.parse(JSON.stringify(e.gameEvents)));

    expect(e.players[seat].treasures).toHaveLength(1);
    expect(replica.players[seat].treasures.map((t) => t.id)).toEqual([book.id]);
  });

  it("卖出同技书自救后交割另一册托管书,不误删卖家的同标识余册", () => {
    const e = makeEngine();
    e.doDraftRoll();
    while (e.phase === "Setup")
      e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
    const buyer = e.activeIndex;
    const seller = 1 - buyer;
    const book = makeSkillBook("jixing");
    giveTreasure(e, seller, [book, book, book]);
    giveTreasure(e, buyer, [book]);
    setCash(e, buyer, 0);
    const sellerCash = e.players[seller].cash;
    armVisitor(e, e.players[seller].properties[0].propertyId, seller);
    armPhase(e, { turnPhase: "AwaitingTreasureOwner" });
    e.resolveTreasureOwner({ type: "fair", treasureId: book.id });
    const replica = makeEngine();
    replica.restoreFromSnapshot(e.snapshot());

    e.submitCommand({
      type: "confirmBankruptcySettle",
      assets: [{ kind: "treasure", id: book.id }],
    });
    foldEventBatch(replica, JSON.parse(JSON.stringify(e.gameEvents)));

    expect(e.players[seller].treasures).toHaveLength(2);
    expect(replica.players[seller].treasures).toHaveLength(2);
    expect(replica.players[buyer].treasures.map((t) => t.id)).toEqual([book.id]);
    expect(e.players[buyer].cash).toBe(0);
    expect(e.players[seller].cash).toBe(sellerCash + 200);
    expect(replica.players[buyer].cash).toBe(0);
    expect(replica.players[seller].cash).toBe(sellerCash + 200);
    expect(replica.pendingDebt).toBeNull();
    expect(replica.escrowTreasure).toBeNull();
  });

  it("cashChanged 批内逐条累加(delta 带符号,跨座位各自结算)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    const cash1 = e.players[1].cash;

    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 500, reason: "supply" }),
      ev(1, { kind: "cashChanged", delta: -200, reason: "stock" }),
      ev(0, { kind: "cashChanged", delta: -100, reason: "stock" }),
    ]);

    expect(e.players[0].cash).toBe(cash0 + 400);
    expect(e.players[1].cash).toBe(cash1 - 200);
  });

  it("marchArrived/capitalHalt 落定位置(批内后写覆盖先写)", () => {
    const e = makeEngine();
    e.players[0].position = 2;
    e.players[1].position = 3;

    foldEventBatch(e, [
      ev(0, { kind: "marchArrived", tileIndex: 7, path: path(7) }),
      ev(1, { kind: "capitalHalt", tileIndex: 5, path: path(5) }),
      ev(0, { kind: "marchArrived", tileIndex: 9, path: path(9) }),
    ]);

    expect(e.players[0].position).toBe(9);
    expect(e.players[1].position).toBe(5);
  });

  it("零操作档与线上未知 kind 忽略:档位表口径(范围定义非吞错,#430)", () => {
    const e = makeEngine();
    e.players[0].position = 4;
    const cash0 = e.players[0].cash;
    e.players[1].treasures.push({ ...TREASURES[0], id: "edict-0" });

    // 档位表(core/event-tiers EVENT_TIERS)口径:
    // - diceRolled = must-fold 档,正常折;
    // - treasureStolen = calibration-only 档(校准兜底五项之二,宣告不转移),default 忽略;
    // - futureKind = 词汇表将来扩展的线上透传形状,不在档位联合内 → 忽略(ADR-0020 既定
    //   口径)。已登记 kind 不可能漏档位:satisfies 映射在写码那刻强制登记。
    const future = {
      kind: "futureKind",
      someField: 1,
      seat: 0,
      round: 1,
      turn: 1,
    } as unknown as GameEvent;
    foldEventBatch(e, [
      ev(0, { kind: "diceRolled", die: 3 }),
      future,
      ev(1, {
        kind: "treasureStolen",
        victimSeat: 0,
        treasureId: "edict-0",
        treasureName: "带血的诏书",
      }),
    ]);

    expect(e.players[0].position).toBe(4);
    expect(e.players[0].cash).toBe(cash0);
    expect(e.players[1].treasures).toHaveLength(1); // 窃玉不折:珍宝列表由校准覆盖
    expect(e.players[0].treasures).toHaveLength(0);
  });

  it("无有效座位(seat=null/越界)的折叠族事件当场炸(产出契约违反,零兜底)", () => {
    const e = makeEngine();
    expect(() =>
      foldEventBatch(e, [ev(null, { kind: "cashChanged", delta: 100, reason: "supply" })]),
    ).toThrow(/无有效座位/);
    expect(() =>
      foldEventBatch(e, [ev(null, { kind: "marchArrived", tileIndex: 3, path: path(3) })]),
    ).toThrow(/无有效座位/);
    expect(() =>
      foldEventBatch(e, [
        ev(null, {
          kind: "heroRecruited",
          heroId: "zhouyu",
          skillIds: ["jixing", "huogong", "leigu"],
        }),
      ]),
    ).toThrow(/无有效座位/);
  });
});

describe("折叠投影器 · 回合/胜负族", () => {
  it("gameStarted+turnStarted 开局批:phase=Playing、首动者就位、turnNumber 取首部本值", () => {
    const e = makeEngine();
    const start: GameEvent = { kind: "gameStarted", seat: 1, round: 1, turn: 1 };
    const turn: GameEvent = { kind: "turnStarted", seat: 1, round: 1, turn: 1 };
    foldEventBatch(e, [start, turn]);

    expect(e.phase).toBe("Playing");
    expect(e.turnPhase).toBe("Roll");
    expect(e.activeIndex).toBe(1);
    expect(e.roundAnchor).toBe(1);
    expect(e.turnNumber).toBe(1); // 开局首回合:引擎 finishSetup 即置 1,不 +1
  });

  it("turnStarted 中盘批:activeIndex 翻页、回合开账清场、turnNumber=首部+1", () => {
    const e = makeEngine();
    e.activeIndex = 0;
    const suspended: TurnPhase = "AwaitingDecision"; // 经变量赋值,避免字面量收窄断言
    e.turnPhase = suspended;
    e.pendingLand = { kind: "PropertyAvailable", propertyId: "prop-changan" };
    e.lastLandOutcome = { kind: "Noop" };
    e.treasureVisitor = { def: MAP.catalog.get("prop-luoyang")!, ownerIdx: 1 };
    e.pendingReaction = null;
    const turn: GameEvent = { kind: "turnStarted", seat: 1, round: 2, turn: 5 };
    foldEventBatch(e, [turn]);

    expect(e.activeIndex).toBe(1);
    expect<TurnPhase>(e.turnPhase).toBe("Roll"); // 显式宽化:避开赋值字面量收窄
    expect(e.turnNumber).toBe(6); // 引擎派发 TurnStart 后自增
    expect(e.round).toBe(2);
    expect(e.pendingLand).toBeNull();
    expect(e.lastLandOutcome).toBeNull();
    expect(e.treasureVisitor).toBeNull(); // 交涉窗口收口(turnEnded 相邻同口径)
  });

  it("roundStarted/roundEnded 定轮次锚点;gameOver 定胜负终局", () => {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(1, { kind: "roundEnded" }),
      ev(1, { kind: "roundStarted" }),
      ev(0, { kind: "gameOver", reason: "TargetNetWorth" }),
    ]);

    expect(e.roundAnchor).toBe(1);
    expect(e.isOver).toBe(true);
    expect(e.winner).toBe(e.players[0]);
    expect(e.winReason).toBe("TargetNetWorth");
    expect(e.phase).toBe("GameOver");
    expect(e.turnPhase).toBe("GameOver");
  });
});

describe("折叠投影器 · 掷骰/行军族", () => {
  it("diceRolled 落 lastRoll 并消费擂鼓加成", () => {
    const e = makeEngine();
    e.heroDiceBonus = 2;
    foldEventBatch(e, [ev(0, { kind: "diceRolled", die: 5 })]);

    expect(e.lastRoll).toEqual({ die: 5 });
    expect(e.heroDiceBonus).toBe(0); // 擂鼓加成掷骰时点消费
  });

  it("capitalHalt 落位,补给金额由相邻 cashChanged·supply 回填", () => {
    const e = makeEngine();
    e.players[0].capitalIndex = CHANGAN;
    e.players[0].position = 10;
    const cash0 = e.players[0].cash;

    foldEventBatch(e, [
      ev(0, { kind: "capitalHalt", tileIndex: CHANGAN, path: path(CHANGAN) }),
      ev(0, { kind: "cashChanged", delta: 800, reason: "supply" }),
    ]);

    expect(e.players[0].position).toBe(CHANGAN);
    expect(e.lastMove?.landIndex).toBe(CHANGAN);
    expect(e.turnPhase).toBe("Land");
    expect(e.lastLandOutcome).toEqual({ kind: "OwnProperty", resupply: 800 });
    expect(e.players[0].cash).toBe(cash0 + 800);
  });

  it("marchArrived 仅落位，等权威事件开启城池决策", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "marchArrived", tileIndex: CHANGAN, path: path(CHANGAN) })]);
    expect(e.players[0].position).toBe(CHANGAN);
    expect(e.turnPhase).toBe("Land");
    expect(e.pendingLand).toBeNull();
    expect(e.lastLandOutcome).toBeNull();
    expect(e.treasureVisitor).toBeNull();
  });
});

describe("折叠投影器 · 城池族", () => {
  it("火烧连营对不同购入价的敌城逐城扣防发银，事件批同步伤害和到账金额", () => {
    const e = makeEngine();
    armPhase(e, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
    // 临淄购入价 1800，下邳 3000。两座城都剩 1 点防御。
    for (const propertyId of ["prop-linzi", "prop-xiapi"]) {
      grantProperty(e, 1, propertyId, 3);
      setDefense(e, 1, propertyId, 1);
    }
    giveJinnang(e, 0, ["火烧连营"]);
    e.submitCommand({ type: "useJinnang", cardId: "火烧连营" });
    const replica = makeEngine();
    replica.restoreFromSnapshot(JSON.parse(JSON.stringify(redactSnapshotForSeat(e.snapshot(), 1))));
    const linzi = MAP.board.tiles.find((tile) => tile.propertyId === "prop-linzi")!;
    const message = JSON.parse(
      cmdMsg({ type: "useJinnang", cardId: "火烧连营", targets: [linzi.index] }),
    ) as Extract<InboundMsg, { type: "cmd" }>;
    using dispatchMoment = spyOn(e, "dispatchMoment");

    e.submitCommand(message.cmd);
    const events: GameEvent[] = JSON.parse(JSON.stringify(redactEvents(e.gameEvents, 1)));
    foldEventBatch(replica, events);

    expect(events.filter((event) => event.kind === "cashChanged")).toMatchObject([
      { seat: 0, reason: "city-damage", delta: 5 },
      { seat: 0, reason: "city-damage", delta: 5 },
    ]);
    expect(e.players[0].cash).toBe(10010);
    expect(replica.players[0].cash).toBe(10010);
    expect(e.players[1].properties).toMatchObject([
      { propertyId: "prop-linzi", level: 2, defense: 30, damageRanking: [{ seat: 0, damage: 1 }] },
      { propertyId: "prop-xiapi", level: 2, defense: 30, damageRanking: [{ seat: 0, damage: 1 }] },
    ]);
    expect(replica.players[1].properties).toEqual(e.players[1].properties);
    expect(
      dispatchMoment.mock.calls.filter(([moment]) => moment === "CashGained").map(([, ctx]) => ctx),
    ).toEqual([
      { subject: 0, amount: 5 },
      { subject: 0, amount: 5 },
    ]);
    expect(e.log.filter(({ detail }) => detail.startsWith("cityDamageReward"))).toMatchObject([
      { brief: expect.stringContaining("「临淄」造成 1 点伤害，得即时奖励 5 两"), amount: 5 },
      { brief: expect.stringContaining("「下邳」造成 1 点伤害，得即时奖励 5 两"), amount: 5 },
    ]);
    expect(
      extractBatchEvents(replica, events).filter((event) => event.kind === "cashDelta"),
    ).toMatchObject([
      { playerId: e.players[0].id, amount: 5 },
      { playerId: e.players[0].id, amount: 5 },
    ]);
  });

  it("capitalSelected 入册都城(现金不入折叠,#386 口径)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [
      ev(0, {
        kind: "capitalSelected",
        tileIndex: CHANGAN,
        propertyId: "prop-changan",
        cost: 2000,
      }),
    ]);

    expect(e.takenCapitalIndices.has(CHANGAN)).toBe(true);
    expect(e.players[0].capitalIndex).toBe(CHANGAN);
    expect(e.players[0].position).toBe(CHANGAN);
    expect(e.players[0].properties).toEqual([
      {
        propertyId: "prop-changan",
        group: "a",
        level: 1,
        maxLevel: 4,
        defense: 40,
        burning: null,
        damageRanking: [],
      },
    ]);
    expect(e.players[0].cash).toBe(cash0); // Setup 期现金由开局校准覆盖
  });

  it("购城扣价入册，升城同步等级与防御", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [
      ev(0, { kind: "propertyBought", propertyId: "prop-changan", price: 4000 }),
      ev(0, { kind: "propertyUpgraded", propertyId: "prop-changan", newLevel: 2 }),
    ]);

    expect(e.players[0].cash).toBe(cash0 - 4000);
    expect(e.players[0].properties[0]?.level).toBe(2);
  });

  it("propertyRejected 无状态转移(声明性)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [
      ev(0, { kind: "propertyRejected", propertyId: "prop-changan", reason: "insufficient-cash" }),
    ]);
    expect(e.players[0].cash).toBe(cash0);
    expect(e.players[0].properties).toEqual([]);
  });

  it("assetTransferred 破产逐城易主:承让方接册保等级,无债主回无主", () => {
    const e = makeEngine();
    grantProperty(e, 0, "prop-luoyang", 3);
    foldEventBatch(e, [ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat: 1 })]);

    expect(e.players[0].properties).toEqual([]);
    expect(e.players[1].properties[0]).toMatchObject({
      propertyId: "prop-luoyang",
      level: 3,
      defense: 20,
    });

    const e2 = makeEngine();
    grantProperty(e2, 0, "prop-luoyang", 3);
    foldEventBatch(e2, [
      ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat: null }),
    ]);
    expect(e2.players[0].properties).toEqual([]);
    expect(e2.players[1].properties).toEqual([]);
  });

  it("assetTransferred 引用了旧城主未持有的城池时报事件契约错误", () => {
    const e = makeEngine();
    for (const toSeat of [1, null]) {
      expect(() =>
        foldEventBatch(e, [
          ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat }),
        ]),
      ).toThrow(/prop-luoyang.*不在原城主/);
    }
  });
});

describe("折叠投影器 · 珍宝族", () => {
  it("treasureGained 入册(流水号实例 id 按静态表回溯)", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "treasureGained", treasureId: "edict-0" })]);

    expect(e.players[0].treasures).toEqual([
      { ...TREASURES.find((t) => t.id === "edict")!, id: "edict-0" },
    ]);
  });

  it("treasureSold 卖家出册、现金不双计(交割价随 treasureTraded)", () => {
    const e = makeEngine();
    e.players[0].treasures.push({ ...TREASURES[1], id: "seal-1" });
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [ev(0, { kind: "treasureSold", treasureId: "seal-1", amount: 3000 })]);

    expect(e.players[0].treasures).toEqual([]);
    expect(e.players[0].cash).toBe(cash0);
  });

  it("treasureTraded 交割:escrow/visitor 收口,买卖双方按价动账", () => {
    const e = makeEngine();
    e.escrowTreasure = {
      treasure: { ...TREASURES[0], id: "edict-0" },
      buyerIdx: 0,
      sellerIdx: 1,
      price: 2200,
    };
    e.treasureVisitor = { def: MAP.catalog.get("prop-luoyang")!, ownerIdx: 1 };
    const cash0 = e.players[0].cash;
    const cash1 = e.players[1].cash;
    foldEventBatch(e, [
      ev(1, {
        kind: "treasureTraded",
        buyerSeat: 0,
        sellerSeat: 1,
        treasureId: "edict-0",
        price: 2200,
      }),
    ]);

    expect(e.escrowTreasure).toBeNull();
    expect(e.treasureVisitor).toBeNull();
    expect(e.players[0].cash).toBe(cash0 - 2200);
    expect(e.players[1].cash).toBe(cash1 + 2200);
  });
});

describe("折叠投影器 · 金钱族相邻回填", () => {
  it.each([
    { seed: 7, own: false, direction: "上涨", kind: "PropertyAvailable", crossesPrice: true },
    { seed: 1, own: false, direction: "下跌", kind: "PropertyAvailable" },
    { seed: 7, own: true, direction: "上涨", kind: "OwnProperty" },
    { seed: 1, own: true, direction: "下跌", kind: "OwnProperty" },
  ])("商市%s交易链与权威一致", ({ seed, own, kind, direction, crossesPrice }) => {
    const e = makeEngine(seed);
    const market = MAP.board.tiles.find((t) => t.event === "market")!;
    armPhase(e, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
    placePlayer(e, 0, market.index - 1);
    if (own) grantProperty(e, 0, market.propertyId!, 1);
    if (crossesPrice) setCash(e, 0, MAP.catalog.get(market.propertyId!)!.purchasePrice - 50);
    pinDice(e, "march", [1]);
    const replica = makeEngine();
    replica.restoreFromSnapshot(e.snapshot());

    e.submitCommand({ type: "rollAndMove" });
    const batch: GameEvent[] = JSON.parse(JSON.stringify(e.gameEvents));
    const swing = batch.find((event) => event.kind === "cashChanged" && event.reason === "stock");
    if (swing?.kind !== "cashChanged") throw new Error("商市真实事件批缺行情结算");
    expect(Math.sign(swing.delta)).toBe(direction === "上涨" ? 1 : -1);
    expect(e.pendingLand).toEqual({ kind, propertyId: market.propertyId! });
    foldEventBatch(replica, batch);

    expect({
      cash: replica.activePlayer.cash,
      turnPhase: replica.turnPhase,
      pendingLand: replica.pendingLand,
      lastLandOutcome: replica.snapshot().lastLandOutcome,
      choices: replica.choicesFor(),
    }).toEqual({
      cash: e.activePlayer.cash,
      turnPhase: e.turnPhase,
      pendingLand: e.pendingLand,
      lastLandOutcome: e.snapshot().lastLandOutcome,
      choices: e.choicesFor(),
    });
  });
});

describe("折叠投影器 · 现金契约", () => {
  it("现金穿零 = 副本漂移,契约违反当场炸出", () => {
    const e = makeEngine();
    e.players[0].cash = 150;
    expect(() =>
      foldEventBatch(e, [ev(0, { kind: "cashChanged", delta: -200, reason: "stock" })]),
    ).toThrow(/现金穿零/);
  });
});

describe("折叠投影器 · 名将族", () => {
  it("heroRecruited 入槽 + 占招贤池(skillIds=权威授技,建槽不重掷)", () => {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(0, {
        kind: "heroRecruited",
        heroId: "zhouyu",
        skillIds: ["jixing", "huogong", "leigu"],
      }),
    ]);

    expect(e.players[0].heroes).toEqual([
      // marks 恒置空表(#1380 折叠建槽与引擎标记感知构造同形;空容器=规范缺省)
      { heroId: "zhouyu", skillIds: ["jixing", "huogong", "leigu"], lastFired: {}, marks: {} },
    ]);
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(true);
  });

  it("麾下一致性(#785):快照往返与事件折叠同形(槽位全量=heroId+授技+冷却账,折叠不重掷)", () => {
    const e = makeEngine();
    // 布场=显式授技(同槽异技:非整池)+冷却账有值
    armHero(
      e,
      e.players[0],
      HEROES.find((h) => h.id === "zhangxingcai")!,
      ["leigu", "zhijin"],
    );
    e.recruitedHeroIds.add("zhangxingcai");
    e.players[0].heroes[0].lastFired["leigu"] = 1; // 与折叠事件首部 round 对齐
    // 快照往返:麾下槽位全量保真(授技/冷却账是游戏状态,展示字段另回查表补);
    // 恢复恒置标记容器(#1380:读侧重建 marks={},布场 testing.armHero 槽无此键,
    // 比对按恢复形归一——空容器=规范缺省,语义等价)
    const mirror = makeEngine();
    mirror.restoreFromSnapshot(e.snapshot());
    expect(mirror.players[0].heroes).toEqual(e.players[0].heroes.map((s) => ({ marks: {}, ...s })));
    expect(mirror.recruitedHeroIds.has("zhangxingcai")).toBe(true);
    // 事件折叠:heroRecruited 携权威授技建槽,冷却按槽落账——与引擎槽逐字段同形
    const replica = makeEngine();
    foldEventBatch(replica, [
      ev(0, {
        kind: "heroRecruited",
        heroId: "zhangxingcai",
        skillIds: ["leigu", "zhijin"],
      }),
      ev(0, {
        kind: "skillFired",
        heroId: "zhangxingcai",
        skillId: "leigu",
        moment: "BeforeMarch",
      }),
    ]);
    // 折叠建槽恒置标记容器(#1380),与恢复形同归一(见上)
    expect(replica.players[0].heroes).toEqual(
      e.players[0].heroes.map((s) => ({ marks: {}, ...s })),
    );
    expect(replica.recruitedHeroIds.has("zhangxingcai")).toBe(true);
  });

  it("skillFired/heroSkillActivated 记冷却(heroId 定槽,槽内 lastFired 键=skillId)", () => {
    const e = makeEngine();
    armHero(e, e.players[0], HEROES[0]);
    foldEventBatch(e, [
      ev(0, {
        kind: "skillFired",
        heroId: "zhouyu",
        skillId: "jixing",
        moment: "BeforeMarch",
      }),
      ev(0, {
        kind: "heroSkillActivated",
        heroId: "zhouyu",
        skillId: "huogong",
        skillKind: "fireBlast", // #1388 T2:城目标域必带目标城(判别联合,#585 口径)
        targetPropertyId: "changangan",
        targetTileIndex: 0,
      }),
    ]);

    expect(e.players[0].heroes[0].lastFired["jixing"]).toBe(1);
    expect(e.players[0].heroes[0].lastFired["huogong"]).toBe(1);
  });

  it("主动技三类落账:warDrum 加成(骰时消费)/relief 付费/fireBlast 独立城损事件", () => {
    const e = makeEngine();
    armHero(e, e.players[0], HEROES[0]); // 周瑜:火攻槽位归属(事件按 heroId 定槽)
    armHero(e, e.players[0], HEROES[2]);
    armHero(e, e.players[0], HEROES[3]);
    const cash0 = e.players[0].cash;
    const stamina1 = e.players[1].stamina;
    foldEventBatch(e, [
      ev(0, {
        kind: "heroSkillActivated",
        heroId: "zhangxingcai",
        skillId: "leigu",
        skillKind: "warDrum",
      }),
      ev(1, { kind: "staminaChanged", delta: 30, reason: "heroRelief" }), // 赈济目标体力
      ev(0, {
        kind: "heroSkillActivated",
        heroId: "huatuo",
        skillId: "zhenji",
        skillKind: "relief",
        targetSeat: 1,
      }),
      ev(0, {
        kind: "heroSkillActivated",
        heroId: "zhouyu",
        skillId: "huogong",
        skillKind: "fireBlast",
        targetPropertyId: "changangan",
        targetTileIndex: 0,
      }),
    ]);

    expect(e.heroDiceBonus).toBe(2); // 擂鼓 +2(掷骰事件另行消费)
    expect(e.players[0].cash).toBe(cash0 - 100); // 赈济付 100
    expect(e.players[1].stamina).toBe(stamina1 + 30);
  });

  it("assetLiquidated 两类变卖:现金+所得、珍宝和城池出册", () => {
    const e = makeEngine();
    e.players[0].treasures.push({ ...TREASURES[0], id: "edict-0" });
    grantProperty(e, 0, "prop-luoyang", 2);
    const cash0 = e.players[0].cash;

    foldEventBatch(e, [
      ev(0, { kind: "treasureSold", treasureId: "edict-0", amount: 2200 }),
      ev(0, { kind: "assetLiquidated", asset: { kind: "treasure", id: "edict-0" }, amount: 2200 }),
      ev(0, {
        kind: "assetLiquidated",
        asset: { kind: "property", id: "prop-luoyang" },
        amount: 2400,
      }),
    ]);

    expect(e.players[0].cash).toBe(cash0 + 2200 + 2400);
    expect(e.players[0].treasures).toEqual([]);
    expect(e.players[0].properties).toEqual([]);
    expect(e.players[0].heroes).toEqual([]);
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false);
  });
});

describe("折叠投影器 · 锦囊族", () => {
  it("jinnangDrawn 仅给出张数时折叠手牌数和牌库余数", () => {
    const e = makeEngine();
    e.jinnangDeckCount = 10;
    foldEventBatch(e, [ev(0, { kind: "jinnangDrawn", count: 2, reason: "turnStart" })]);

    expect(e.players[0].jinnangHandCount).toBe(2);
    expect(e.jinnangDeckCount).toBe(8);
    expect(e.players[0].jinnangHand).toEqual([]); // 暗牌内容不折(ADR-0016)
  });

  it("jinnangAnnounced 消耗手牌并将牌移入弃牌堆", () => {
    const e = makeEngine();
    e.players[0].jinnangHand = ["连环计"];
    e.players[0].jinnangHandCount = 1;
    foldEventBatch(e, [ev(0, { kind: "jinnangAnnounced", cardId: "连环计", targetSeats: [1, 2] })]);

    expect(e.players[0].jinnangHandCount).toBe(0);
    expect(e.jinnangDiscard).toEqual(["连环计"]);
    expect(e.players[0].jinnangHand).toEqual([]);
  });

  it("peekApplied 零折(#575):窥探即时一次性,无任何客户端状态(声明性零转移)", () => {
    const e = makeEngine();
    e.players[0].jinnangHand = ["连环计"];
    e.players[0].jinnangHandCount = 1;
    e.turnPhase = "Roll";
    foldEventBatch(e, [
      ev(0, {
        kind: "peekApplied",
        viewerSeat: 0,
        targetSeat: 1,
        cardId: "军情密探",
        hand: ["连环计"],
      }),
    ]);
    // 零折:窥探不落任何副本字段(手牌数/相位等一概不动;弹层纯演出归表现面)
    expect(e.players[0].jinnangHandCount).toBe(1);
    expect(e.turnPhase).toBe("Roll");
  });

  it("jinnangAnnounced 军情密探:窥探不再随宣布入册(#575 抢跑入册退役,生效归 peekApplied)", () => {
    const e = makeEngine();
    e.players[0].jinnangHandCount = 1;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangAnnounced", cardId: "军情密探", targetSeats: [1] }),
      ev(0, { kind: "jinnangDrawn", count: 0, reason: "turnStart" }),
    ]);
    // 只折出牌扣账,窥探零入册(被识破不再残留幻影窥探——存量偏差随 #575 消解)
    expect(e.players[0].jinnangHandCount).toBe(0);
    expect(e.jinnangDiscard).toEqual(["军情密探"]);
  });

  it("真实下行跨批保留反识破争夺城，最终折叠两座受击城和即时奖励", () => {
    const authority = makeEngine();
    armPhase(authority, { phase: "Playing", activeIndex: 0, turnPhase: "AwaitingJinnang" });
    giveJinnang(authority, 0, ["火烧连营", "识破诡计"]);
    giveJinnang(authority, 1, ["识破诡计"]);
    grantProperty(authority, 1, "prop-jinyang", 3);
    grantProperty(authority, 1, "prop-youzhou", 3);
    const replica = makeEngine();
    replica.restoreFromSnapshot(redactSnapshotForSeat(authority.snapshot(), 1));

    function submit(command: GameCommand) {
      const { cmd } = JSON.parse(cmdMsg(command)) as Extract<InboundMsg, { type: "cmd" }>;
      authority.submitCommand(cmd);
      foldEventBatch(replica, JSON.parse(JSON.stringify(redactEvents(authority.gameEvents, 1))));
    }

    submit({ type: "useJinnang", cardId: "火烧连营" });
    submit({ type: "useJinnang", cardId: "火烧连营", targets: [1] });
    expect(replica.snapshot().reaction).toMatchObject({
      cardId: "火烧连营",
      targetSeats: [1, 2],
      queriedBySeat: [1],
    });
    submit({ type: "respondReaction", seat: 1, use: true, cardId: "识破诡计", shareSeat: 2 });
    expect(replica.snapshot().reaction).toMatchObject({
      cardId: "识破诡计",
      targetSeats: [2],
      queriedBySeat: [-1],
      counter: { rootCardId: "火烧连营", rootUserSeat: 0, protects: true },
    });
    const recovered = makeEngine();
    const projected = redactSnapshotForSeat(authority.snapshot(), 1);
    recovered.restoreFromSnapshot(JSON.parse(JSON.stringify(projected)));
    expect(recovered.snapshot().reaction).toEqual(replica.snapshot().reaction);
    expect(recovered.pendingReaction?.seq).toBe(replica.pendingReaction?.seq);
    expect(projected.events.find((event) => event.kind === "reactionOpened")?.view).toMatchObject({
      queriedBySeat: [-1],
    });

    submit({ type: "respondReaction", seat: 0, use: true, cardId: "识破诡计" });
    expect(replica.pendingReaction).toBeNull();
    expect(replica.players.map((p) => p.jinnangHandCount)).toEqual([0, 0]);
    expect(replica.players.map((p) => p.jinnangHand)).toEqual([[], []]);
    expect(replica.jinnangDiscard).toEqual(["火烧连营", "识破诡计", "识破诡计"]);
    for (const engine of [authority, replica]) {
      expect(engine.players[1].properties).toMatchObject([
        { propertyId: "prop-jinyang", defense: 12, damageRanking: [{ seat: 0, damage: 8 }] },
        { propertyId: "prop-youzhou", defense: 12, damageRanking: [{ seat: 0, damage: 8 }] },
      ]);
      expect(engine.players[0].cash).toBe(10080); // 两座城各扣 8 点防御，各发 40 两
    }
  });

  it("开窗消息直接采用权威窗号和时长，收到最终应答后闭窗", () => {
    const e = makeEngine();
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangAnnounced", cardId: "缓兵之计", targetSeats: [1] }),
      ev(0, {
        kind: "reactionOpened",
        seq: 7,
        view: {
          kind: "jinnang",
          cardId: "缓兵之计",
          userSeat: 0,
          targetSeats: [1],
          queriedBySeat: [1],
          windowMs: 3750,
        },
      }),
    ]);

    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(e.pendingReaction?.seq).toBe(7);
    expect(e.pendingReaction?.view).toEqual({
      kind: "jinnang",
      cardId: "缓兵之计",
      userSeat: 0,
      targetSeats: [1],
      queriedBySeat: [1],
      windowMs: 3750,
    });
    expect(e.pendingReaction?.answers).toEqual([]);

    foldEventBatch(e, [ev(1, { kind: "reactionAnswered", use: false, spentCards: [] })]);
    expect(e.pendingReaction).toBeNull(); // 应答齐即闭窗
  });

  it("行军窗:闭窗应答点扣拦检牌(胜负两路同折);reactionFailed 无状态转移", () => {
    const e = makeEngine();
    e.players[1].jinnangHand = ["半路杀出"];
    e.players[1].jinnangHandCount = 1;
    const discard0 = e.jinnangDiscard.length;
    foldEventBatch(e, [
      ev(0, {
        kind: "reactionOpened",
        seq: 1,
        view: {
          kind: "march",
          cardId: "半路杀出",
          userSeat: 0,
          ownerSeat: 1,
          tileIndex: LUOYANG,
          windowMs: REACTION_WINDOW_MS.march,
        },
      }),
      ev(1, {
        kind: "reactionAnswered",
        use: true,
        cardId: "半路杀出",
        spentCards: [{ seat: 1, cardId: "半路杀出" }],
      }),
      ev(1, {
        kind: "reactionFailed",
        windowKind: "march",
        tileIndex: LUOYANG,
        aRoll: 2,
        bRoll: 5,
      }),
    ]);

    expect(e.pendingReaction).toBeNull();
    expect(e.players[1].jinnangHandCount).toBe(0); // 拦检牌胜负两路皆扣(折于闭窗应答点)
    expect(e.jinnangDiscard.slice(discard0)).toEqual(["半路杀出"]);
  });

  it("闭窗算术以 per-seat 脱敏询问集为分母(#461):非应答端首答不误闭窗,应答齐才收", () => {
    // #461 面:联机下行把查询集投影成「自己保留 + 他人匿名 -1」(redactEvents/
    // redactReactionView 同口径:身份匿名、数量保留)——折叠器闭窗算术(answers 数 ≥
    // queriedOf(view).length)按该数组长度收窗:他人首答不得误闭非应答端的窗(修复前
    // 校准快照把查询集污染成长度 1,host 首答即误闭 guest 的窗、应答入口丢失,玩家被
    // 超时代发兜底);应答齐(2/2)才收。快照水合路径的咬合另见 seat-projection.test
    // 「快照投影 × 折叠咬合」,此处钉事件路径与算术本身。
    const seats: SeatConfig[] = [
      { name: "甲", isBot: false, guohao: "魏" },
      { name: "乙", isBot: false, guohao: "蜀" },
      { name: "丙", isBot: true, guohao: "吴" },
    ];
    const e = new GameEngine(MAP.board, MAP.catalog, createDice(7), {
      seats,
      targetNetWorth: 30000,
      startingCash: 10000,
      startingTreasures: 0,
    });
    // 客户端(座位 1 视角)收到的开窗批就是脱敏批:查询集 [-1, 1]
    foldEventBatch(e, [
      ev(2, { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [0, 1] }),
      ...redactEvents(
        [
          ev(2, {
            kind: "reactionOpened",
            seq: 1,
            view: {
              kind: "jinnang",
              cardId: "横征暴敛",
              userSeat: 2,
              targetSeats: [0, 1],
              queriedBySeat: [0, 1],
              windowMs: REACTION_WINDOW_MS.jinnang,
            },
          }),
        ],
        1,
      ),
    ]);
    const view = e.pendingReaction?.view;
    expect(view?.kind).toBe("jinnang");
    expect(view?.kind === "jinnang" && view.queriedBySeat).toEqual([-1, 1]);
    // 他人(host,座位 0)首答:1 < 2 → 非应答端(guest)窗不得误闭(#461 回归判据)
    foldEventBatch(e, [ev(0, { kind: "reactionAnswered", use: false })]);
    expect(e.pendingReaction).not.toBeNull();
    expect(e.pendingReaction?.answers).toEqual([{ seat: 0, use: false }]);
    // 自己应答:2 ≥ 2 → 收窗
    foldEventBatch(e, [ev(1, { kind: "reactionAnswered", use: false, spentCards: [] })]);
    expect(e.pendingReaction).toBeNull();
  });

  it("应答无窗时报告事件序错误", () => {
    const e = makeEngine();
    expect(() => foldEventBatch(e, [ev(1, { kind: "reactionAnswered", use: false })])).toThrow(
      /事件序契约违反/,
    );
  });
});

describe("折叠投影器 · 体力/跳过族", () => {
  it("无来源耗竭的事件批同步城损、易主、奖励和休整", () => {
    const e = makeEngine(1);
    armPhase(e, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
    grantProperty(e, 0, "prop-jinyang", 1);
    applyCityDamage(e, e.players[0], "prop-jinyang", 1, e.players[1]);
    grantProperty(e, 0, "prop-luoyang", 3);
    setDefense(e, 0, "prop-luoyang", 1);
    expect(e.damageStamina(0, 94, 1)).toBe(6);

    const replica = makeEngine();
    replica.restoreFromSnapshot(JSON.parse(JSON.stringify(redactSnapshotForSeat(e.snapshot(), 1))));
    beginGameEventBatch(e);
    e.damageStamina(0, 10, null);
    const events = JSON.parse(JSON.stringify(redactEvents(e.snapshot().events, 1)));
    foldEventBatch(replica, events);

    expect(events).toContainEqual(
      expect.objectContaining({ kind: "staminaChanged", delta: -6, reason: "damage" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "exhaustionResolved", sourceSeat: null }),
    );
    expect(e.players[0].properties).toMatchObject([
      { propertyId: "prop-luoyang", level: 2, defense: 30, damageRanking: [] },
    ]);
    expect(e.players[1].properties).toMatchObject([
      { propertyId: "prop-jinyang", level: 1, defense: 40, damageRanking: [] },
    ]);
    expect(e.players[1].cash).toBe(10180); // 先前布下伤害，接城领取 180 两结算奖励
    expect(replica.players[0].properties).toEqual(e.players[0].properties);
    expect(replica.players[1].properties).toEqual(e.players[1].properties);
    expect(replica.players[1].cash).toBe(10180);
    expect(replica.players[0]).toMatchObject({ stamina: 0, skipTurns: 2, resting: true });
    expect([replica.activeIndex, replica.turnPhase]).toEqual([1, "Roll"]);
  });

  it("turnSkipped 消费侧 -1;jinnangInflicted 标记侧目标 +1", () => {
    const e = makeEngine();
    e.players[1].skipTurns = 1;
    e.players[1].resting = true;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangInflicted", cardId: "缓兵之计", targetSeat: 1 }),
      ev(1, { kind: "turnSkipped" }),
    ]);

    expect(e.players[1].skipTurns).toBe(1); // +1(标记)后 -1(消费)
    expect(e.players[1].resting).toBe(true);

    foldEventBatch(e, [ev(1, { kind: "turnSkipped" })]);
    expect(e.players[1]).toMatchObject({ skipTurns: 0, resting: false });
  });
});

describe("折叠投影器 · 破产族", () => {
  it("真实破产把都城交给债主、释放名将并将手牌清入弃堆", () => {
    const e = makeEngine();
    e.doDraftRoll();
    while (e.phase === "Setup")
      e.pickCapital(e.currentSetupPlayerIndex, e.firstAvailableCapitalIndex());
    const debtor = e.activeIndex;
    const creditor = 1 - debtor;
    const capital = e.tileIndexOfProperty(e.activePlayer.properties[0].propertyId);
    const city = e.board.at(capital).propertyId!;
    const discardedBefore = [...e.jinnangDiscard];
    const hero = HEROES[0];
    armHero(e, e.activePlayer, hero);
    giveJinnang(e, debtor, ["连环计"]);
    setCash(e, debtor, 50);
    e.payOrLiquidate(e.activePlayer, e.players[creditor], 200);
    const replica = makeEngine();
    replica.restoreFromSnapshot(e.snapshot());

    e.submitCommand({ type: "declareBankruptcy" });
    foldEventBatch(replica, JSON.parse(JSON.stringify(e.gameEvents)));

    expect(replica.players[debtor]).toMatchObject({
      isBankrupt: true,
      capitalIndex: -1,
      heroes: [],
      jinnangHandCount: 0,
    });
    expect(replica.findOwner(city)).toBe(replica.players[creditor]);
    expect(replica.recruitedHeroIds.has(hero.id)).toBe(false);
    expect(replica.jinnangDiscard).toEqual([...discardedBefore, "连环计"]);
  });
});

describe("折叠对账:快照=校准锚(#386,ADR-0020 决策 3)", () => {
  it("折叠漂移后,快照水合无条件以快照值校正全字段(抽查扩围族)", () => {
    const e = makeEngine();
    const snap = e.snapshot();
    const snapCash = snap.players.map((p) => p.cash);
    const snapPos = snap.players.map((p) => p.position);
    const snapStamina = snap.players.map((p) => p.stamina);

    // 人为制造折叠漂移:现金/位置错账 + 体力/跳过/破产/城池错账
    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 777, reason: "drift" }),
      ev(0, { kind: "marchArrived", tileIndex: 11, path: path(11) }),
      ev(1, { kind: "capitalHalt", tileIndex: 8, path: path(8) }),
      ev(0, { kind: "staminaChanged", delta: -40, reason: "drift" }),
      ev(0, { kind: "jinnangInflicted", cardId: "缓兵之计", targetSeat: 0 }),
      ev(0, {
        kind: "heroRecruited",
        heroId: "zhouyu",
        skillIds: ["jixing", "huogong", "leigu"],
      }),
      ev(0, { kind: "propertyBought", propertyId: "prop-changan", price: 4000 }),
      ev(0, { kind: "playerBankrupt", creditorSeat: 1 }),
    ]);
    expect(e.players[0].cash).toBe(snapCash[0] + 777 - 4000);
    expect(e.players[1].position).toBe(8);
    expect(e.players[0].isBankrupt).toBe(true);

    // 快照到达:水合覆盖全量字段,漂移当场纠正(快照=校准锚)
    e.restoreFromSnapshot(snap);
    expect(e.players.map((p) => p.cash)).toEqual(snapCash);
    expect(e.players.map((p) => p.position)).toEqual(snapPos);
    expect(e.players.map((p) => p.stamina)).toEqual(snapStamina);
    expect(e.players.map((p) => p.isBankrupt)).toEqual([false, false]);
    expect(e.players[0].properties).toEqual([]);
    expect(e.players[0].heroes).toEqual([]);
    expect(e.players[0].skipTurns).toBe(0);
    expect(e.recruitedHeroIds.size).toBe(0);
    expect(e.takenCapitalIndices.size).toBe(0);
  });
});

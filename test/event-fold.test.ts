// 折叠投影器单测(#386 两族,#387 全覆盖,ADR-0020 折叠切换⑤):事件批 → 本地引擎副本
// 字段的投影契约,按字段族分组断言「事件序列 → 状态」——回合/胜负、掷骰/行军(含落格
// 推演:相位/pendingLand/落格表现态/交涉到来)、城池、金钱(含相邻回填)、珍宝、名将、
// 锦囊(含反应窗)、声望/体力、跳过、破产、机遇;以及契约边界(未知 kind 忽略 = 范围
// 定义、无主座位/事件序违反当场炸)与快照对账(折叠漂移被水合无条件校正,快照=校准锚)。
// 折叠的联机接线(消息到达→折叠→sync)归 e2e/react-online.spec.ts 的双端一致断言覆盖。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig, TurnPhase } from "@core/authority";
import { createDice } from "@core/dice";
import type { MovePath } from "@core/board";
import { HEROES } from "@core/heroes";
import { TREASURES } from "@core/treasures";
import { REACTION_WINDOW_MS } from "@core/constants";
import type { GameEvent, GameEventBody } from "@core/game-events";
import { beginGameEventBatch } from "@core/game-events";
import { armHero, testEngine } from "@core/testing";
import huanyouData from "../public/maps/huanyou.json";
import { loadMap } from "@core/board-loader";
import { foldEventBatch } from "@app/net/event-fold";

const MAP = loadMap(huanyouData);

// huanyou 地图锚点:长安=tile 0(购价 4000)、洛阳=tile 22。
const CHANGAN = 0;
const LUOYANG = 22;

function makeEngine(): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: false, guohao: "魏" },
    { name: "B", isBot: false, guohao: "蜀" },
  ];
  const cfg: EngineConfig = { seats, targetNetWorth: 30000 };
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), cfg);
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

/** 副本侧入册一座城(模拟水合后的持有态)。 */
function grantHolding(e: GameEngine, seat: number, propertyId: string, level: number): void {
  const def = MAP.catalog.get(propertyId)!;
  e.players[seat].properties.push({
    propertyId: def.id,
    group: def.group,
    level,
    maxLevel: def.maxLevel,
  });
}

describe("折叠投影器 foldEventBatch · #386 两族基线", () => {
  it("cashChanged 批内逐条累加(delta 带符号,跨座位各自结算)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    const cash1 = e.players[1].cash;

    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 500, reason: "supply" }),
      ev(1, { kind: "cashChanged", delta: -200, reason: "tax" }),
      ev(0, { kind: "cashChanged", delta: -100, reason: "encounter" }),
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
    e.jinnangUsedTags = ["谋"];
    const turn: GameEvent = { kind: "turnStarted", seat: 1, round: 2, turn: 5 };
    foldEventBatch(e, [turn]);

    expect(e.activeIndex).toBe(1);
    expect<TurnPhase>(e.turnPhase).toBe("Roll"); // 显式宽化:避开赋值字面量收窄
    expect(e.turnNumber).toBe(6); // 引擎派发 TurnStart 后自增
    expect(e.round).toBe(2);
    expect(e.pendingLand).toBeNull();
    expect(e.lastLandOutcome).toBeNull();
    expect(e.treasureVisitor).toBeNull(); // 交涉窗口收口(turnEnded 相邻同口径)
    expect(e.jinnangUsedTags).toEqual([]); // 标签名额清零
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

  it("marchArrived 无主城且购得起:pendingLand 置决策 + AwaitingDecision", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "marchArrived", tileIndex: CHANGAN, path: path(CHANGAN) })]);

    expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "prop-changan" });
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.lastLandOutcome?.kind).toBe("PropertyAvailable");
    expect(e.lastLandOutcome?.property?.id).toBe("prop-changan");
  });

  it("marchArrived 无主城购不起:引擎自动按兵不动路,无决策载荷(相位由同批 turnStarted 收场)", () => {
    const e = makeEngine();
    e.players[0].cash = 0;
    e.players[0].warrants = 0;
    foldEventBatch(e, [ev(0, { kind: "marchArrived", tileIndex: CHANGAN, path: path(CHANGAN) })]);

    expect(e.pendingLand).toBeNull();
    expect(e.turnPhase).toBe("Land");
    expect(e.lastLandOutcome?.kind).toBe("PropertyAvailable"); // 表现态仍在
  });

  it("marchArrived 己城:未满级挂决策,满级自动按兵不动", () => {
    const e = makeEngine();
    grantHolding(e, 0, "prop-luoyang", 1);
    foldEventBatch(e, [ev(0, { kind: "marchArrived", tileIndex: LUOYANG, path: path(LUOYANG) })]);
    expect(e.pendingLand).toEqual({ kind: "OwnProperty", propertyId: "prop-luoyang" });
    expect(e.turnPhase).toBe("AwaitingDecision");

    const e2 = makeEngine();
    grantHolding(e2, 0, "prop-luoyang", MAP.catalog.get("prop-luoyang")!.maxLevel);
    foldEventBatch(e2, [ev(0, { kind: "marchArrived", tileIndex: LUOYANG, path: path(LUOYANG) })]);
    expect(e2.pendingLand).toBeNull();
    expect(e2.turnPhase).toBe("Land");
  });

  it("marchArrived 他人城:城主有珍宝 → 交涉到来;无珍宝 → 无事发生", () => {
    const e = makeEngine();
    grantHolding(e, 1, "prop-luoyang", 0);
    e.players[1].treasures.push({ ...TREASURES[0], id: "edict-0" });
    foldEventBatch(e, [ev(0, { kind: "marchArrived", tileIndex: LUOYANG, path: path(LUOYANG) })]);

    expect(e.treasureVisitor?.def.id).toBe("prop-luoyang"); // 引擎态形状:{def, ownerIdx}
    expect(e.treasureVisitor?.ownerIdx).toBe(1);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner");
    expect(e.lastLandOutcome?.kind).toBe("TreasureTrade");

    const e2 = makeEngine();
    grantHolding(e2, 1, "prop-luoyang", 0);
    foldEventBatch(e2, [ev(0, { kind: "marchArrived", tileIndex: LUOYANG, path: path(LUOYANG) })]);
    expect(e2.treasureVisitor).toBeNull();
    expect(e2.turnPhase).toBe("Land");
    expect(e2.lastLandOutcome?.kind).toBe("Noop");
  });
});

describe("折叠投影器 · 城池族", () => {
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
        level: 0,
        maxLevel: 3,
      },
    ]);
    expect(e.players[0].cash).toBe(cash0); // Setup 期现金由开局校准覆盖
  });

  it("propertyBought 扣价扣委任状入册;propertyUpgraded 对齐等级(副本无持有按事件补册)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [
      ev(0, { kind: "propertyBought", propertyId: "prop-changan", price: 4000 }),
      ev(0, { kind: "propertyUpgraded", propertyId: "prop-changan", newLevel: 2 }),
    ]);

    expect(e.players[0].cash).toBe(cash0 - 4000);
    expect(e.players[0].warrants).toBe(makeEngine().players[0].warrants - 1);
    expect(e.players[0].properties[0]?.level).toBe(2);

    const e2 = makeEngine(); // 赐城缺口级联:副本无持有,按事件面补册
    foldEventBatch(e2, [
      ev(0, { kind: "propertyUpgraded", propertyId: "prop-luoyang", newLevel: 3 }),
    ]);
    expect(e2.players[0].properties[0]).toMatchObject({ propertyId: "prop-luoyang", level: 3 });
  });

  it("propertyGranted 机遇赐城 Lv.0 入册(#719,原级联缺口闭合)", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "propertyGranted", propertyId: "prop-luoyang" })]);
    expect(e.players[0].properties).toEqual([
      { propertyId: "prop-luoyang", group: "a", level: 0, maxLevel: 3 },
    ]);
  });

  it("propertyRejected 无状态转移(声明性)", () => {
    const e = makeEngine();
    const cash0 = e.players[0].cash;
    foldEventBatch(e, [
      ev(0, { kind: "propertyRejected", propertyId: "prop-changan", reason: "no-warrant" }),
    ]);
    expect(e.players[0].cash).toBe(cash0);
    expect(e.players[0].properties).toEqual([]);
  });

  it("exhaustionChoice 降级 -1 级/失城回无主(处置对象随事件点名)", () => {
    const e = makeEngine();
    grantHolding(e, 0, "prop-luoyang", 2);
    foldEventBatch(e, [
      ev(0, { kind: "exhaustionChoice", propertyId: "prop-luoyang", exhaustionKind: "downgrade" }),
    ]);
    expect(e.players[0].properties[0]?.level).toBe(1);

    const e2 = makeEngine();
    grantHolding(e2, 0, "prop-luoyang", 2);
    foldEventBatch(e2, [
      ev(0, { kind: "exhaustionChoice", propertyId: "prop-luoyang", exhaustionKind: "lose" }),
    ]);
    expect(e2.players[0].properties).toEqual([]);
  });

  it("assetTransferred 破产逐城易主:承让方接册保等级,无债主回无主", () => {
    const e = makeEngine();
    grantHolding(e, 0, "prop-luoyang", 2);
    foldEventBatch(e, [ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat: 1 })]);

    expect(e.players[0].properties).toEqual([]);
    expect(e.players[1].properties[0]).toMatchObject({ propertyId: "prop-luoyang", level: 2 });

    const e2 = makeEngine();
    grantHolding(e2, 0, "prop-luoyang", 2);
    foldEventBatch(e2, [
      ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat: null }),
    ]);
    expect(e2.players[0].properties).toEqual([]);
    expect(e2.players[1].properties).toEqual([]);
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
  it("tax 落格表现态 TaxPaid;批内先破产 → causedBankruptcy 相邻标记", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "cashChanged", delta: -200, reason: "tax" })]);
    expect(e.lastLandOutcome).toEqual({ kind: "TaxPaid", amount: 200, causedBankruptcy: false });

    const e2 = makeEngine();
    e2.players[0].heroes = [];
    foldEventBatch(e2, [
      ev(0, { kind: "playerBankrupt", creditorSeat: null }),
      ev(0, { kind: "cashChanged", delta: -200, reason: "tax" }),
    ]);
    expect(e2.lastLandOutcome).toEqual({ kind: "TaxPaid", amount: 200, causedBankruptcy: true });
  });

  it("stock 落格表现态 Noop + 破产标记", () => {
    const e = makeEngine();
    foldEventBatch(e, [ev(0, { kind: "cashChanged", delta: -150, reason: "stock" })]);
    expect(e.lastLandOutcome).toEqual({ kind: "Noop", causedBankruptcy: false });
  });
});

describe("折叠投影器 · 破产扫账平记对齐(#652)", () => {
  // #652 真实批序构造:现金 < 税且无可变卖资产(仅剩都城)落税关 → payOrLiquidate 破产
  // 支路:引擎 settleDebt 先整扫现金归零,批内先产 playerBankrupt(finalizeBankruptcy
  // 派发时机同步产事件),随后 movement-flow 仍平记整额负 delta(浮字同口径,非状态
  // 转移)。副本锁步折叠该平记会穿零成负现金 —— 渲染端 formatMoney 负数契约被折叠
  // 中间态击穿(soak 5 次渲染期崩溃的崩点);折叠器以批内破产锚对齐引擎真值(落 0)。
  function taxBankruptEngine(seed = 5): GameEngine {
    const seats: SeatConfig[] = [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ];
    const e = new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
      seats,
      targetNetWorth: 30000,
    });
    e.doDraftRoll();
    let guard = 0;
    while (e.phase === "Setup" && guard++ < 50) {
      const idx = e.currentSetupPlayerIndex;
      if (idx < 0) break;
      if (e.players[idx].isBot) {
        e.aiSetupStep();
        continue;
      }
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
    e.players.forEach((p) => {
      p.jinnangHand = [];
      p.jinnangHandCount = 0;
    });
    if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
    return e;
  }

  it("税关破产批序折叠:平记 delta 不穿零,副本落 0 = 引擎真值(崩溃批序回归)", () => {
    const e = taxBankruptEngine();
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    mover.cash = 150; // < 税 200;无可变卖资产(仅剩都城)→ 破产支路
    mover.properties = [];
    mover.heroes = [];
    mover.treasures = [];
    const taxTile = MAP.board.tiles.find((tile) => tile.type === "Tax")!;

    t.placeActive(taxTile.index);
    const preSnap = e.snapshot(); // 联机时序:上一校准快照先到(现金 150)
    beginGameEventBatch(e);
    t.land();
    const events = e.snapshot().events;
    const kinds = events.map((x) => x.kind);
    expect(kinds.slice(0, 2)).toEqual(["playerBankrupt", "cashChanged"]); // 折叠锚的批序前提:破产宣告恒先于平记
    expect(events[1]).toMatchObject({ kind: "cashChanged", delta: -200, reason: "tax" });
    expect(mover.cash).toBe(0); // 引擎真值:整扫归零

    const replica = taxBankruptEngine();
    replica.restoreFromSnapshot(preSnap);
    foldEventBatch(replica, events);
    expect(replica.players[seat].cash).toBe(0); // 修复前:-50(平记穿零)= formatMoney 崩点
    expect(replica.players[seat].isBankrupt).toBe(true);
  });

  it("穿零且本批无破产锚 = 副本漂移,契约违反当场炸出(不静默钳零)", () => {
    const e = makeEngine();
    e.players[0].cash = 150;
    expect(() =>
      foldEventBatch(e, [ev(0, { kind: "cashChanged", delta: -200, reason: "tax" })]),
    ).toThrow(/穿零且本批无破产锚/);
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
      { heroId: "zhouyu", skillIds: ["jixing", "huogong", "leigu"], lastFired: {} },
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
    // 快照往返:麾下槽位全量保真(授技/冷却账是游戏状态,展示字段另回查表补)
    const mirror = makeEngine();
    mirror.restoreFromSnapshot(e.snapshot());
    expect(mirror.players[0].heroes).toEqual(e.players[0].heroes);
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
    expect(replica.players[0].heroes).toEqual(e.players[0].heroes);
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
        skillKind: "demolish",
        targetSeat: 1,
      }),
    ]);

    expect(e.players[0].heroes[0].lastFired["jixing"]).toBe(1);
    expect(e.players[0].heroes[0].lastFired["huogong"]).toBe(1);
  });

  it("主动技四类落账:warDrum 加成(骰时消费)/patronage 委任状/relief 付费/demolish 不折", () => {
    const e = makeEngine();
    armHero(e, e.players[0], HEROES[0]); // 周瑜:火攻槽位归属(事件按 heroId 定槽)
    armHero(e, e.players[0], HEROES[2]);
    armHero(e, e.players[0], HEROES[1]);
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
      ev(0, {
        kind: "heroSkillActivated",
        heroId: "caopi",
        skillId: "zhengpi",
        skillKind: "patronage",
        targetSeat: 1,
      }),
      ev(0, { kind: "cashChanged", delta: 50, reason: "skill" }), // 征辟目标补偿(grantSkillCash)
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
        skillKind: "demolish",
        targetSeat: 1,
      }),
    ]);

    expect(e.heroDiceBonus).toBe(2); // 擂鼓 +2(掷骰事件另行消费)
    expect(e.players[0].warrants).toBe(makeEngine().players[0].warrants + 1);
    expect(e.players[0].cash).toBe(cash0 + 50 - 100); // 征辟补偿入目标账,赈济付 100
    expect(e.players[1].stamina).toBe(stamina1 + 30);
  });

  it("assetLiquidated 三变卖:现金+所得、变卖物出册;遣散名将释放回招贤池", () => {
    const e = makeEngine();
    e.players[0].treasures.push({ ...TREASURES[0], id: "edict-0" });
    grantHolding(e, 0, "prop-luoyang", 1);
    armHero(e, e.players[0], HEROES[0]);
    e.recruitedHeroIds.add("zhouyu");
    const cash0 = e.players[0].cash;

    foldEventBatch(e, [
      ev(0, { kind: "assetLiquidated", asset: { kind: "treasure", id: "edict-0" }, amount: 2200 }),
      ev(0, {
        kind: "assetLiquidated",
        asset: { kind: "property", id: "prop-luoyang" },
        amount: 2400,
      }),
      ev(0, { kind: "assetLiquidated", asset: { kind: "hero", id: "zhouyu" }, amount: 200 }),
    ]);

    expect(e.players[0].cash).toBe(cash0 + 2200 + 2400 + 200);
    expect(e.players[0].treasures).toEqual([]);
    expect(e.players[0].properties).toEqual([]);
    expect(e.players[0].heroes).toEqual([]);
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false);
  });
});

describe("折叠投影器 · 锦囊族", () => {
  it("jinnangDrawn 手牌数/牌库数对账(内容=暗牌不折)", () => {
    const e = makeEngine();
    e.jinnangDeckCount = 10;
    foldEventBatch(e, [ev(0, { kind: "jinnangDrawn", count: 2, reason: "encounter" })]);

    expect(e.players[0].jinnangHandCount).toBe(2);
    expect(e.jinnangDeckCount).toBe(8);
    expect(e.players[0].jinnangHand).toEqual([]); // 暗牌内容不折(ADR-0016)
  });

  it("jinnangAnnounced 出牌扣账:手牌数-1/入弃堆/标签占名额", () => {
    const e = makeEngine();
    e.players[0].jinnangHand = ["连环计"];
    e.players[0].jinnangHandCount = 1;
    foldEventBatch(e, [ev(0, { kind: "jinnangAnnounced", cardId: "连环计", targetSeats: [1, 2] })]);

    expect(e.players[0].jinnangHandCount).toBe(0);
    expect(e.jinnangDiscard).toEqual(["连环计"]);
    expect(e.jinnangUsedTags).toEqual(["谋"]);
  });

  it("peekApplied 零折(#575):窥探即时一次性,无任何客户端状态(声明性零转移)", () => {
    const e = makeEngine();
    e.players[0].jinnangHand = ["连环计"];
    e.players[0].jinnangHandCount = 1;
    e.turnPhase = "Roll";
    foldEventBatch(e, [
      ev(0, { kind: "peekApplied", viewerSeat: 0, targetSeat: 1, hand: ["连环计"] }),
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
      ev(0, { kind: "jinnangDrawn", count: 0, reason: "noop" }),
    ]);
    // 只折出牌扣账,窥探零入册(被识破不再残留幻影窥探——存量偏差随 #575 消解)
    expect(e.jinnangUsedTags).toEqual(["谋"]);
    expect(e.jinnangDiscard).toEqual(["军情密探"]);
  });

  it("reactionOpened 置窗(view/seq/windowMs 派生)+ AwaitingReaction;应答齐闭窗", () => {
    const e = makeEngine();
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangAnnounced", cardId: "缓兵之计", targetSeats: [1] }),
      ev(0, {
        kind: "reactionOpened",
        windowKind: "jinnang",
        cardId: "缓兵之计",
        queriedSeats: [1],
      }),
    ]);

    expect(e.turnPhase).toBe("AwaitingReaction");
    expect(e.pendingReaction?.seq).toBe(1); // 留痕退役后窗实例号取首个流水(#412)
    expect(e.pendingReaction?.view).toEqual({
      kind: "jinnang",
      cardId: "缓兵之计",
      userSeat: 0,
      targetSeats: [1],
      queriedBySeat: [1],
      windowMs: REACTION_WINDOW_MS.JinnangAnnounced,
    });
    expect(e.pendingReaction?.answers).toEqual([]);

    foldEventBatch(e, [ev(1, { kind: "reactionAnswered", use: true, cardId: "识破诡计" })]);
    expect(e.pendingReaction).toBeNull(); // 应答齐即闭窗
  });

  it("jinnangVoided 识破扣账(应答按座位配对,shareSeat 不参与折叠)", () => {
    const e = makeEngine();
    e.players[1].jinnangHand = ["识破诡计"];
    e.players[1].jinnangHandCount = 1;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangAnnounced", cardId: "缓兵之计", targetSeats: [1] }),
      ev(0, {
        kind: "reactionOpened",
        windowKind: "jinnang",
        cardId: "缓兵之计",
        queriedSeats: [1],
      }),
      ev(1, { kind: "reactionAnswered", use: true, cardId: "识破诡计" }),
      ev(1, { kind: "jinnangVoided", cardId: "缓兵之计" }),
    ]);

    expect(e.players[1].jinnangHandCount).toBe(0); // 识破牌扣账
    expect(e.jinnangDiscard).toEqual(["缓兵之计", "识破诡计"]);

    const e2 = makeEngine(); // AOE:shareSeat 明传,按份配对生效应答
    e2.players[0].jinnangHand = ["横征暴敛"];
    e2.players[0].jinnangHandCount = 1;
    e2.players[1].jinnangHand = ["识破诡计"];
    e2.players[1].jinnangHandCount = 1;
    foldEventBatch(e2, [
      ev(0, { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [1] }),
      ev(0, {
        kind: "reactionOpened",
        windowKind: "jinnang",
        cardId: "横征暴敛",
        queriedSeats: [1],
      }),
      ev(1, { kind: "reactionAnswered", use: true, cardId: "识破诡计", shareSeat: 1 }),
      ev(1, { kind: "jinnangVoided", cardId: "横征暴敛", shareSeat: 1 }),
    ]);
    expect(e2.jinnangDiscard).toEqual(["横征暴敛", "识破诡计"]);
  });

  it("行军窗:闭窗应答点扣拦检牌(胜负两路同折);reactionFailed 无状态转移", () => {
    const e = makeEngine();
    e.players[1].jinnangHand = ["半路杀出"];
    e.players[1].jinnangHandCount = 1;
    const discard0 = e.jinnangDiscard.length;
    foldEventBatch(e, [
      ev(0, {
        kind: "reactionOpened",
        windowKind: "march",
        cardId: "半路杀出",
        queriedSeats: [1],
      }),
      ev(1, { kind: "reactionAnswered", use: true, cardId: "半路杀出" }),
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

  it("事件序契约违反当场炸:识破无同批窗、应答无窗、行军窗非单座询问", () => {
    const e = makeEngine();
    expect(() => foldEventBatch(e, [ev(1, { kind: "jinnangVoided", cardId: "缓兵之计" })])).toThrow(
      /事件序契约违反/,
    );
    expect(() => foldEventBatch(e, [ev(1, { kind: "reactionAnswered", use: false })])).toThrow(
      /事件序契约违反/,
    );
    expect(() =>
      foldEventBatch(e, [
        ev(0, {
          kind: "reactionOpened",
          windowKind: "march",
          cardId: "半路杀出",
          queriedSeats: [],
        }),
      ]),
    ).toThrow(/事件产出契约违反/);
  });
});

describe("折叠投影器 · 声望/体力/跳过族", () => {
  it("reputationChanged 直加实际增减,里程碑向上穿越仅首次", () => {
    const e = makeEngine();
    e.players[0].reputation = 25;
    foldEventBatch(e, [
      ev(0, { kind: "reputationChanged", delta: 10, reason: "encounter" }),
      ev(0, { kind: "reputationChanged", delta: 10, reason: "encounter" }),
    ]);

    expect(e.players[0].reputation).toBe(45);
    expect(e.players[0].repMilestones).toEqual([30]); // 仅首次穿越入册
  });

  it("staminaChanged 直加实际增减;reason=exhaustion 相邻 skipTurns+1(耗竭善后标记侧)", () => {
    const e = makeEngine();
    e.players[0].stamina = 20;
    foldEventBatch(e, [
      ev(0, { kind: "staminaChanged", delta: -20, reason: "encounter" }),
      ev(0, { kind: "exhaustionChoice", propertyId: "prop-luoyang", exhaustionKind: "lose" }),
      ev(0, { kind: "staminaChanged", delta: 100, reason: "exhaustion" }),
    ]);

    expect(e.players[0].stamina).toBe(100);
    expect(e.players[0].skipTurns).toBe(1);
  });

  it("turnSkipped 消费侧 -1;jinnangInflicted 标记侧目标 +1", () => {
    const e = makeEngine();
    e.players[1].skipTurns = 1;
    foldEventBatch(e, [
      ev(0, { kind: "jinnangInflicted", cardId: "缓兵之计", targetSeat: 1 }),
      ev(1, { kind: "turnSkipped" }),
    ]);

    expect(e.players[1].skipTurns).toBe(1); // +1(标记)后 -1(消费)
  });
});

describe("折叠投影器 · 机遇族", () => {
  it("encounterTriggered 抉择型置 AwaitingEncounter;选项落定回 Land(续跑落格)", () => {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(0, { kind: "encounterTriggered", encounterId: "奉迎天子", tier: "好运" }),
    ]);
    expect(e.turnPhase).toBe("AwaitingEncounter");
    expect(e.lastLandOutcome?.kind).toBe("Noop");

    foldEventBatch(e, [
      ev(0, { kind: "encounterChoice", encounterId: "奉迎天子", choiceIndex: 0 }),
    ]);
    expect(e.turnPhase).toBe("Land"); // 结算后续跑本落格(相位由后续事件/水合精修)
  });

  it("encounterTriggered 即时型不动相位(落格推演值保持)", () => {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(0, { kind: "encounterTriggered", encounterId: "屯粮居奇", tier: "好运" }),
      ev(0, { kind: "cashChanged", delta: 250, reason: "encounter" }),
    ]);
    expect(e.turnPhase).toBe("Roll"); // 未动相位
    expect(e.players[0].cash).toBe(makeEngine().players[0].cash + 250);
  });
});

describe("折叠投影器 · 破产族", () => {
  it("playerBankrupt 出局善后:isBankrupt/清都城/释放名将/锦囊清手入弃堆", () => {
    const e = makeEngine();
    e.players[0].capitalIndex = LUOYANG;
    armHero(e, e.players[0], HEROES[0]);
    e.recruitedHeroIds.add("zhouyu");
    e.players[0].jinnangHand = ["连环计"];
    e.players[0].jinnangHandCount = 1;

    foldEventBatch(e, [
      ev(0, { kind: "assetTransferred", propertyId: "prop-luoyang", toSeat: 1 }),
      ev(0, { kind: "playerBankrupt", creditorSeat: 1 }),
    ]);

    expect(e.players[0].isBankrupt).toBe(true);
    expect(e.players[0].capitalIndex).toBe(-1);
    expect(e.players[0].heroes).toEqual([]);
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false);
    expect(e.players[0].jinnangHandCount).toBe(0);
    expect(e.jinnangDiscard).toEqual(["连环计"]);
  });
});

describe("折叠对账:快照=校准锚(#386,ADR-0020 决策 3)", () => {
  it("折叠漂移后,快照水合无条件以快照值校正全字段(抽查扩围族)", () => {
    const e = makeEngine();
    const snap = e.snapshot();
    const snapCash = snap.players.map((p) => p.cash);
    const snapPos = snap.players.map((p) => p.position);
    const snapRep = snap.players.map((p) => p.reputation);
    const snapStamina = snap.players.map((p) => p.stamina);

    // 人为制造折叠漂移:现金/位置错账 + 声望/体力/跳过/破产/城池错账
    foldEventBatch(e, [
      ev(0, { kind: "cashChanged", delta: 777, reason: "drift" }),
      ev(0, { kind: "marchArrived", tileIndex: 11, path: path(11) }),
      ev(1, { kind: "capitalHalt", tileIndex: 8, path: path(8) }),
      ev(0, { kind: "reputationChanged", delta: 33, reason: "drift" }),
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
    expect(e.players[0].reputation).toBe(snapRep[0] + 33);
    expect(e.players[0].isBankrupt).toBe(true);

    // 快照到达:水合覆盖全量字段,漂移当场纠正(快照=校准锚)
    e.restoreFromSnapshot(snap);
    expect(e.players.map((p) => p.cash)).toEqual(snapCash);
    expect(e.players.map((p) => p.position)).toEqual(snapPos);
    expect(e.players.map((p) => p.reputation)).toEqual(snapRep);
    expect(e.players.map((p) => p.stamina)).toEqual(snapStamina);
    expect(e.players.map((p) => p.isBankrupt)).toEqual([false, false]);
    expect(e.players[0].properties).toEqual([]);
    expect(e.players[0].heroes).toEqual([]);
    expect(e.players[0].skipTurns).toBe(0);
    expect(e.recruitedHeroIds.size).toBe(0);
    expect(e.takenCapitalIndices.size).toBe(0);
  });
});

describe("折叠投影器 · 宝物城并权(ADR-0024 落格镜像)", () => {
  // huanyou 咸阳 = 宝物城(ADR-0027 环位 P24;并权后带 propertyId,走城池三分折叠路径)。
  const XIANGLAND = MAP.board.tiles.find((t) => t.propertyId === "prop-xianyang")!.index;

  it("无主宝物城:足额 → AwaitingDecision + pendingLand(与普通城同路径)", () => {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(0, { kind: "marchArrived", tileIndex: XIANGLAND, path: path(XIANGLAND) }),
    ]);
    expect(e.players[0].position).toBe(XIANGLAND);
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "prop-xianyang" });
    expect(e.lastLandOutcome?.kind).toBe("PropertyAvailable");
  });

  it("己方宝物城:未满级 → AwaitingDecision(OwnProperty);满级 → Land 收场", () => {
    const e = makeEngine();
    grantHolding(e, 0, "prop-xianyang", 0);
    foldEventBatch(e, [
      ev(0, { kind: "marchArrived", tileIndex: XIANGLAND, path: path(XIANGLAND) }),
    ]);
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.pendingLand).toEqual({ kind: "OwnProperty", propertyId: "prop-xianyang" });
    expect(e.lastLandOutcome?.kind).toBe("OwnProperty");

    const e2 = makeEngine();
    grantHolding(e2, 0, "prop-xianyang", 3); // 满级:自动按兵不动(相位由同批 turnStarted 收场)
    foldEventBatch(e2, [
      ev(0, { kind: "marchArrived", tileIndex: XIANGLAND, path: path(XIANGLAND) }),
    ]);
    expect(e2.turnPhase).toBe("Land");
    expect(e2.pendingLand).toBeNull();
  });

  it("他人宝物城:城主有宝 → AwaitingTreasureOwner 到来;无宝 → Land 收场", () => {
    const e = makeEngine();
    grantHolding(e, 1, "prop-xianyang", 0);
    e.players[1].treasures.push({ ...TREASURES[0]!, id: "fold-probe" });
    foldEventBatch(e, [
      ev(0, { kind: "marchArrived", tileIndex: XIANGLAND, path: path(XIANGLAND) }),
    ]);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner");
    expect(e.treasureVisitor?.ownerIdx).toBe(1);
    expect(e.treasureVisitor?.def.id).toBe("prop-xianyang");
    expect(e.lastLandOutcome?.kind).toBe("TreasureTrade");

    const e2 = makeEngine();
    grantHolding(e2, 1, "prop-xianyang", 0); // 无宝:无事发生
    foldEventBatch(e2, [
      ev(0, { kind: "marchArrived", tileIndex: XIANGLAND, path: path(XIANGLAND) }),
    ]);
    expect(e2.turnPhase).toBe("Land");
    expect(e2.treasureVisitor).toBeNull();
    expect(e2.lastLandOutcome?.kind).toBe("Noop");
  });
});

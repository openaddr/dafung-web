// 保密后补单测(#381,ADR-0020 决策 2 发送总口单点):三道闸——
//   ① redactEvents 逐 kind 隐私档位:38 kind 全量普查(37 透传逐字相等 + reactionOpened
//      jinnang 窗身份匿名保数量 + march 窗全公开透传)、未知 kind 当场炸(零兜底)、纯函数;
//   ② 摘要/校准投影复活路径(clientView 带座位):guest 摘要无 host 手牌内容、有 count、
//      牌库只见数量——冻结函数 redactSnapshotForSeat 在 open/flush 校准两处的口径锚;
//   ③ 过滤 × 折叠咬合:过滤批折叠(god-view 批折叠为对照)在「该座位可见面」等价——
//      询问集数量/自我成员一致、闭窗时机一致(数量保留的反证:清零会在首条应答误闭窗)、
//      锦囊数量账在暗牌数组恒空(redacted 水合形态)下仍自洽。
// 发送面接线(消息真实到达客户端)归 e2e/react-online-secrecy.spec.ts。
import { describe, it, expect } from "bun:test";
import { redactEvents, clientView } from "../scripts/seat-projection";
import { RoomRegistry } from "../scripts/room";
import { MAP } from "../scripts/engine-helpers";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import type { LoadedMap } from "../src/core/board-loader";
import { GameEngine, type SeatConfig } from "../src/core/authority";
import type { GameEvent, GameEventBody } from "../src/core/game-events";
import type { MovePath } from "../src/core/board";
import { createDice } from "../src/core/dice";
import { foldEventBatch } from "@app/net/event-fold";
import { reactionQueriesSeat } from "@app/controllers/reaction";

// ──────────────────────────── ① redactEvents 隐私档位 ────────────────────────────

/** 事件首部三件套(同 event-fold.test 口径)。 */
function ev<B extends GameEventBody>(seat: number | null, body: B): GameEvent {
  return { ...body, seat, round: 1, turn: 1 } as GameEvent;
}

/** 最小 MovePath 形状(透传普查只需字段随类型契约在场)。 */
function path(landIndex: number): MovePath {
  return {
    from: 0,
    traversed: [],
    landIndex,
    passedCapital: false,
    capitalIndex: -1,
    waypoints: [],
    landBranchStep: null,
    branchWaypoints: [],
  };
}

/** 37 个透传 kind 的最小事件体(每种一条;redactEvents 只认 kind,字段面不审计)。 */
const PASSTHROUGH_BODIES: GameEventBody[] = [
  { kind: "gameStarted" },
  { kind: "setupCompleted" },
  { kind: "turnEnded" },
  { kind: "turnStarted" },
  { kind: "roundEnded" },
  { kind: "roundStarted" },
  { kind: "gameOver", reason: "TargetNetWorth" },
  { kind: "diceRolled", die: 3 },
  { kind: "marchArrived", tileIndex: 7, path: path(7) },
  { kind: "capitalHalt", tileIndex: 5, path: path(5) },
  { kind: "capitalSelected", tileIndex: 2, propertyId: "chengdu", cost: 1000 },
  { kind: "propertyBought", propertyId: "changangan", price: 4000 },
  { kind: "propertyUpgraded", propertyId: "luoyang", newLevel: 2 },
  { kind: "propertyRejected", propertyId: "xuchang", reason: "no-warrant" },
  { kind: "cashChanged", delta: -200, reason: "tax", counterpartSeat: 1 },
  { kind: "treasureGained", treasureId: "golden-seal-1" },
  { kind: "treasureSold", treasureId: "golden-seal-1", amount: 800 },
  { kind: "treasureTraded", buyerSeat: 0, sellerSeat: 1, treasureId: "golden-seal-1", price: 900 },
  { kind: "treasureStolen", victimSeat: 1, treasureId: "golden-seal-1", treasureName: "传国玉玺" },
  { kind: "assetLiquidated", asset: { kind: "treasure", id: "golden-seal-1" }, amount: 800 },
  { kind: "assetTransferred", propertyId: "changangan", toSeat: 2 },
  { kind: "heroRecruited", heroId: "guanyu" },
  { kind: "playerBankrupt", creditorSeat: 1 },
  { kind: "skillFired", heroId: "guanyu", skillId: "wusheng", moment: "TurnStart" },
  { kind: "heroSkillActivated", skillId: "warDrumZhangfei", skillKind: "warDrum", targetSeat: 1 },
  { kind: "jinnangDrawn", count: 1, reason: "encounter" },
  { kind: "reputationChanged", delta: 10, reason: "encounter" },
  { kind: "staminaChanged", delta: -15, reason: "encounter" },
  { kind: "turnSkipped" },
  { kind: "encounterTriggered", encounterId: "shibei", tier: "中性" },
  { kind: "encounterChoice", encounterId: "shibei", choiceIndex: 0 },
  { kind: "exhaustionChoice", propertyId: "luoyang", exhaustionKind: "downgrade" },
  { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [1, 2] },
  { kind: "reactionAnswered", use: false },
  { kind: "reactionFailed", windowKind: "march", tileIndex: 3, aRoll: 2, bRoll: 5 },
  { kind: "jinnangVoided", cardId: "横征暴敛", shareSeat: 1 },
  { kind: "jinnangInflicted", cardId: "缓兵之计", targetSeat: 1 },
];

describe("redactEvents · 逐 kind 隐私档位(#381)", () => {
  it("37 个透传 kind:任意座位视角逐字相等(全桌公开面零裁剪)", () => {
    const god = PASSTHROUGH_BODIES.map((b, i) => ev(i % 3, b));
    for (const seat of [0, 1, 2]) {
      expect(JSON.stringify(redactEvents(god, seat))).toBe(JSON.stringify(god));
    }
  });

  it("jinnang 窗 queriedSeats:身份匿名、数量保留、自己座位保留", () => {
    // 三席被询问 [0,1,2],viewer=1 → 自己在列可见,他人全匿
    const opened = ev(3, {
      kind: "reactionOpened",
      windowKind: "jinnang",
      cardId: "横征暴敛",
      queriedSeats: [0, 1, 2],
    });
    const view1 = redactEvents([opened], 1)[0]!;
    expect(view1).toEqual({ ...opened, queriedSeats: [-1, 1, -1] } as typeof opened);
    // viewer 不在列:全匿,数量不动
    const viewer9 = redactEvents([opened], 9)[0] as Extract<GameEvent, { kind: "reactionOpened" }>;
    expect(viewer9.queriedSeats).toEqual([-1, -1, -1]);
    // 单人窗:被询问者见 [自己]
    const solo = redactEvents(
      [
        ev(3, {
          kind: "reactionOpened",
          windowKind: "jinnang",
          cardId: "缓兵之计",
          queriedSeats: [1],
        }),
      ],
      1,
    )[0] as Extract<GameEvent, { kind: "reactionOpened" }>;
    expect(solo.queriedSeats).toEqual([1]);
  });

  it("march 窗原样透传(城主归属棋盘可推导,全公开)", () => {
    const opened = ev(0, {
      kind: "reactionOpened",
      windowKind: "march",
      cardId: "半路杀出",
      queriedSeats: [1],
    });
    for (const seat of [0, 1, 2]) {
      expect(redactEvents([opened], seat)).toEqual([opened]);
    }
  });

  it("未知 kind 当场炸(零兜底:新增事件必须先登记隐私档位)", () => {
    const future = {
      kind: "futureKind",
      someField: 1,
      seat: 0,
      round: 1,
      turn: 1,
    } as unknown as GameEvent;
    expect(() => redactEvents([future], 0)).toThrow(/未登记隐私档位/);
  });

  it("纯函数:不改输入批", () => {
    const batch = [
      ev(0, { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [1] }),
      ev(0, {
        kind: "reactionOpened",
        windowKind: "jinnang",
        cardId: "横征暴敛",
        queriedSeats: [1, 2],
      }),
    ];
    const before = JSON.stringify(batch);
    redactEvents(batch, 2);
    expect(JSON.stringify(batch)).toBe(before);
  });
});

// ──────────────────────────── ② 摘要/校准投影复活路径 ────────────────────────────

class InMemoryPersistence implements RoomPersistence {
  private readonly m = new Map<string, RoomRecord>();
  save(rec: RoomRecord): void {
    this.m.set(rec.roomId, rec);
  }
  load(roomId: string): RoomRecord | null {
    return this.m.get(roomId) ?? null;
  }
  remove(roomId: string): void {
    this.m.delete(roomId);
  }
  exists(roomId: string): boolean {
    return this.m.has(roomId);
  }
  listIds(): string[] {
    return [...this.m.keys()];
  }
}

const VALID_MAP_IDS = new Set(["sanguo"]);
const testMapProvider = (_id: string): LoadedMap => MAP;

/** 开一局已进 Playing 的双人类房(seat0=host / seat1=guest;发牌在 finishSetup)。 */
async function roomAtPlaying() {
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({
    seatCount: 2,
    botIdx: new Set(),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  reg.joinSeat(roomId);
  reg.setMap(roomId, "sanguo", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e.phase === "Setup"; i++)
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]);
  // 保证 host 手牌有内容可断言(起手 1 张之外再补)
  e.drawJinnang(0, 2);
  return { reg, roomId };
}

describe("clientView 带座位 · 摘要/校准投影复活(#381)", () => {
  it("guest 摘要:无 host 手牌内容、有 count;牌库只给数量;god-view 对照仍全量", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    const guestSummary = clientView(room, online, 1) as Record<string, any>;
    const hostSummary = clientView(room, online, 0) as Record<string, any>;
    const god = clientView(room, online) as Record<string, any>;
    // 他人(座位 0)手牌内容不出网:guest/host 视角互裁,god-view 照旧(重放/调试语义)
    expect(guestSummary.players[0].jinnangHand).toEqual([]);
    expect(hostSummary.players[1].jinnangHand).toEqual([]);
    expect(god.players[0].jinnangHand.length).toBeGreaterThan(0);
    // 数量走引擎态照发(公开信息)
    expect(guestSummary.players[0].jinnangHandCount).toBe(god.players[0].jinnangHand.length);
    // 自己恒全量
    expect(guestSummary.players[1].jinnangHand).toEqual(god.players[1].jinnangHand);
    // 牌库牌序只裁不给,剩余数照发;弃牌堆(明置)原样
    expect(guestSummary.jinnangDeck).toEqual([]);
    expect(guestSummary.jinnangDeckCount).toBe(god.jinnangDeckCount);
    expect(guestSummary.jinnangDeckCount).toBeGreaterThan(0);
    expect(guestSummary.jinnangDiscard).toEqual(god.jinnangDiscard);
    // 房间字段随车(客户端从任一消息得到完整房间态)
    expect(guestSummary.type).toBe("snapshot");
    expect(guestSummary.seatCount).toBe(2);
  });
});

// ──────────────────────────── ③ 过滤 × 折叠咬合 ────────────────────────────

/** 三席副本引擎(同 event-fold.test 口径;三席为造 AOE 双询问窗:user 与被询问者分离)。 */
function makeEngine(): GameEngine {
  const seats: SeatConfig[] = [
    { name: "A", isBot: false, guohao: "魏" },
    { name: "B", isBot: false, guohao: "蜀" },
    { name: "C", isBot: false, guohao: "吴" },
  ];
  return new GameEngine(MAP.board, MAP.catalog, createDice(7), {
    seats,
    targetNetWorth: 30000,
  });
}

describe("过滤批 × 折叠器咬合(#381:事件到了就是「我能看的」)", () => {
  /** AOE 窗场景(三席:seat2 用横征暴敛,seat0/seat1 各持识破):宣布+开窗(同一结算
   *  转移=一批)→ B 先不用(一批)→ A 识破+识破生效(应答齐闭窗续结算=一批)。
   *  批界与引擎真实 flush 节奏一致。 */
  function scenarioBatches(): GameEvent[][] {
    return [
      [
        ev(2, { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [0, 1] }),
        ev(2, {
          kind: "reactionOpened",
          windowKind: "jinnang",
          cardId: "横征暴敛",
          queriedSeats: [0, 1],
        }),
      ],
      [ev(1, { kind: "reactionAnswered", use: false })],
      [
        ev(0, { kind: "reactionAnswered", use: true, cardId: "识破诡计" }),
        ev(0, { kind: "jinnangVoided", cardId: "横征暴敛", shareSeat: 1 }),
      ],
    ];
  }

  /** 副本对:god = god-view 水合(暗牌数组在场);filtered = redacted 水合(数组恒空,
   *  数量账为准)。手牌状态按场景补齐。 */
  function enginePair(hands: { p0: number; p1: number; p2: number }) {
    const god = makeEngine();
    god.players[0].jinnangHand = Array(hands.p0).fill("识破诡计");
    god.players[0].jinnangHandCount = hands.p0;
    god.players[1].jinnangHand = Array(hands.p1).fill("识破诡计");
    god.players[1].jinnangHandCount = hands.p1;
    god.players[2].jinnangHand = Array(hands.p2).fill("横征暴敛");
    god.players[2].jinnangHandCount = hands.p2;
    const filtered = makeEngine();
    for (const p of filtered.players) {
      p.jinnangHand = [];
      p.jinnangHandCount = 0;
    }
    filtered.players[0].jinnangHandCount = hands.p0;
    filtered.players[1].jinnangHandCount = hands.p1;
    filtered.players[2].jinnangHandCount = hands.p2;
    return { god, filtered };
  }

  it("viewer=1(被询问):过滤批折叠后与 god-view 折叠在可见面等价", () => {
    const batches = scenarioBatches();
    const { god, filtered } = enginePair({ p0: 1, p1: 1, p2: 1 });

    // 开窗批后:窗挂着——询问集数量一致、自己成员一致、他人身份不见
    foldEventBatch(god, batches[0]!);
    foldEventBatch(filtered, redactEvents(batches[0]!, 1));
    const godView = god.pendingReaction!.view;
    const myView = filtered.pendingReaction!.view;
    expect(godView.kind).toBe("jinnang");
    expect(godView.kind === "jinnang" && godView.queriedBySeat).toEqual([0, 1]);
    expect(myView.kind === "jinnang" && myView.queriedBySeat).toEqual([-1, 1]);
    // 控制器可见面(reactionQueriesSeat)两视角判定一致:自己是被询问者
    expect(reactionQueriesSeat(myView, 1)).toBe(true);
    expect(reactionQueriesSeat(myView, 0)).toBe(false);
    expect(reactionQueriesSeat(godView, 1)).toBe(true);

    // 应答批:首条应答后窗必须仍开着(god 与 filtered 同步;清零口径会在此误闭窗)
    foldEventBatch(god, batches[1]!);
    foldEventBatch(filtered, redactEvents(batches[1]!, 1));
    expect(god.pendingReaction).not.toBeNull();
    expect(filtered.pendingReaction).not.toBeNull();

    // 应答齐批:闭窗+识破生效(两视角同时;第二条应答不炸「无挂起反应窗」)
    foldEventBatch(god, batches[2]!);
    foldEventBatch(filtered, redactEvents(batches[2]!, 1));
    expect(god.pendingReaction).toBeNull();
    expect(filtered.pendingReaction).toBeNull();

    // 可见面等价:弃堆/数量账(暗牌数组差异不外显)
    expect(filtered.players[0].jinnangHandCount).toBe(god.players[0].jinnangHandCount);
    expect(filtered.players[1].jinnangHandCount).toBe(god.players[1].jinnangHandCount);
    expect(filtered.jinnangDiscard).toEqual(god.jinnangDiscard);
    expect(filtered.turnPhase).toBe(god.turnPhase);
  });

  it("viewer=2(使用者,不在询问列):只匿他人身份,闭窗时机与可见面照旧", () => {
    const batches = scenarioBatches();
    const { god, filtered } = enginePair({ p0: 1, p1: 1, p2: 1 });
    for (const b of batches) {
      foldEventBatch(god, b);
      foldEventBatch(filtered, redactEvents(b, 2));
    }
    // 全程无炸;窗已收;开窗批里询问集对 viewer=2 全匿(数量保留)
    expect(filtered.pendingReaction).toBeNull();
    const opened = (redactEvents(batches[0]!, 2)[1] ?? null) as Extract<
      GameEvent,
      { kind: "reactionOpened" }
    > | null;
    expect(opened?.queriedSeats).toEqual([-1, -1]);
    expect(filtered.players[2].jinnangHandCount).toBe(god.players[2].jinnangHandCount);
    expect(filtered.jinnangDiscard).toEqual(god.jinnangDiscard);
  });
});

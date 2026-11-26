// 保密后补单测(#381,ADR-0020 决策 2 发送总口单点):三道闸——
//   ① redactEvents 逐 kind 隐私档位:全 kind 普查(透传逐字相等 + reactionOpened
//      jinnang 窗身份匿名保数量 + march 窗全公开透传 + peekApplied 非 viewer 裁空(#575);
//      逐座位隐私行为详见 room.test 窥探投影)、未知 kind 当场炸(零兜底)、纯函数;
//   ② 摘要/校准投影复活路径(clientView 带座位):guest 摘要无 host 手牌内容、有 count、
//      牌库只见数量——冻结函数 redactSnapshotForSeat 在 open/flush 校准两处的口径锚;
//   ③ 过滤 × 折叠咬合:过滤批折叠(god-view 批折叠为对照)在「该座位可见面」等价——
//      询问集数量/自我成员一致、闭窗时机一致(数量保留的反证:清零会在首条应答误闭窗)、
//      锦囊数量账在暗牌数组恒空(redacted 水合形态)下仍自洽。
// 发送面接线(消息真实到达客户端)归 test/online/protocol-online.test.ts(ADR-0055)。
import { describe, it, expect } from "bun:test";
import {
  assembleGameLogDelta,
  redactEvents,
  clientView,
  redactSnapshotForSeat,
} from "@dafung/core/room/seat-projection";
import { RoomRegistry } from "@dafung/core/room/room";
import { MAP } from "../../scripts/engine-helpers";
import type { RoomPersistence } from "@dafung/core/room/room-persistence";
import type { RoomRecord } from "@dafung/core/room/room-record";
import type { LoadedMap } from "@dafung/core/engine/board-loader";
import { GameEngine, type GameCommand, type SeatConfig } from "@dafung/core/engine/authority";
import { cmdMsg, dispatchInbound } from "@dafung/core/protocol/wire";
import type { GameEvent, GameEventBody } from "@dafung/core/engine/game-events";
import type { MovePath } from "@dafung/core/engine/board";
import { createDice } from "@dafung/core/engine/dice";
import {
  armDebt,
  armHero,
  armLanding,
  armPhase,
  giveJinnang,
  placePlayer,
  setCash,
  setStamina,
} from "@dafung/core/engine/planter";
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
  };
}

/** 每个透传 kind 的最小事件体(每种一条;redactEvents 只认 kind,字段面不审计)。 */
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
  {
    kind: "landingResolved",
    turnPhase: "AwaitingDecision",
    pendingLand: { kind: "PropertyAvailable", propertyId: "prop-changan" },
    pendingCityEvent: false,
    treasureVisitor: null,
    outcome: {
      kind: "PropertyAvailable",
      propertyId: "prop-changan",
      ownerSeat: null,
      amount: null,
      resupply: null,
      causedBankruptcy: null,
    },
  },
  { kind: "capitalHalt", tileIndex: 5, path: path(5) },
  { kind: "capitalSelected", tileIndex: 2, propertyId: "chengdu", cost: 1000 },
  { kind: "propertyBought", propertyId: "changangan", price: 4000 },
  { kind: "propertyUpgraded", propertyId: "luoyang", newLevel: 2 },
  { kind: "propertyRejected", propertyId: "xuchang", reason: "insufficient-cash" },
  {
    kind: "propertyDamaged",
    propertyId: "xuchang",
    level: 1,
    defense: 32,
    impact: "hit",
    origin: "fireBlast",
    burning: null,
    damageRanking: [],
  },
  { kind: "fireWallImpact", castSeq: 1, propertyId: "xuchang", impact: "conquest" },
  { kind: "cashChanged", delta: -200, reason: "stock", counterpartSeat: 1 },
  { kind: "treasureGained", treasureId: "golden-seal-1" },
  { kind: "treasureSold", treasureId: "golden-seal-1", amount: 800 },
  { kind: "treasureTraded", buyerSeat: 0, sellerSeat: 1, treasureId: "golden-seal-1", price: 900 },
  { kind: "treasureStolen", victimSeat: 1, treasureId: "golden-seal-1", treasureName: "传国玉玺" },
  { kind: "assetLiquidated", asset: { kind: "treasure", id: "golden-seal-1" }, amount: 800 },
  { kind: "bankruptcySettled", cashAfter: 300, creditor: { seat: 1, cashAfter: 1200 } },
  { kind: "assetTransferred", propertyId: "changangan", toSeat: 2 },
  { kind: "heroRecruited", heroId: "guanyu", skillIds: ["wusheng"] },
  { kind: "playerBankrupt", creditorSeat: 1 },
  { kind: "skillFired", heroId: "guanyu", skillId: "wusheng", moment: "TurnStart" },
  { kind: "skillMarksChanged", heroId: "caopi", skillId: "fangzhu", marks: 39 },
  {
    kind: "skillChoiceOpened",
    choice: { heroId: "caopi", skillId: "fangzhu", ownerSeat: 0, subjectSeat: 0 },
    marks: 65,
  },
  {
    kind: "skillChoiceAnswered",
    heroId: "caopi",
    skillId: "fangzhu",
    targetSeat: 1,
    skipTurns: 1,
    remainingMarks: 0,
    resumePhase: "Land",
  },
  {
    kind: "heroSkillActivated",
    heroId: "guanyu",
    skillId: "warDrumZhangfei",
    skillKind: "warDrum",
  },
  { kind: "jinnangDrawn", count: 1, reason: "turnStart" },
  { kind: "staminaChanged", delta: -15, reason: "damage" },
  { kind: "turnSkipped" },
  {
    kind: "exhaustionResolved",
    sourceSeat: 1,
    downgradedPropertyIds: ["luoyang"],
    lostPropertyIds: [],
    strongestImpact: "demolished",
    restTurns: 2,
  },
  { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [1, 2] },
  { kind: "reactionAnswered", use: false },
  { kind: "reactionFailed", windowKind: "march", tileIndex: 3, aRoll: 2, bRoll: 5 },
  {
    kind: "duelResolved",
    sides: [
      { seat: 0, roll: 6 },
      { seat: 1, roll: 2 },
    ],
    winnerSeat: 0,
  },
  {
    kind: "jinnangVoided",
    cardId: "横征暴敛",
    result: { kind: "share", target: { kind: "seat", id: 1 } },
  },
  { kind: "jinnangRestored", cardId: "横征暴敛" },
  { kind: "jinnangInflicted", cardId: "缓兵之计", targetSeat: 1 },
  { kind: "jinnangReshuffled", count: 3 },
  { kind: "jinnangExhausted" },
];

describe("redactEvents · 逐 kind 隐私档位(#381)", () => {
  it("透传 kind:任意座位视角逐字相等(全桌公开面零裁剪)", () => {
    const god = PASSTHROUGH_BODIES.map((b, i) => ev(i % 3, b));
    for (const seat of [0, 1, 2]) {
      expect(JSON.stringify(redactEvents(god, seat))).toBe(JSON.stringify(god));
    }
  });

  it("jinnang 窗 queriedSeats:身份匿名、数量保留、自己座位保留", () => {
    // 三席被询问 [0,1,2],viewer=1 → 自己在列可见,他人全匿
    const opened = ev(3, {
      kind: "reactionOpened",
      seq: 1,
      view: {
        kind: "jinnang",
        cardId: "横征暴敛",
        userSeat: 3,
        targets: { kind: "seat", ids: [0, 1, 2], requiresSelection: true },
        queriedBySeat: [0, 1, 2],
        windowMs: 15000,
      },
    });
    const view1 = redactEvents([opened], 1)[0]!;
    expect(view1).toMatchObject({
      seq: 1,
      view: {
        targets: { kind: "seat", ids: [0, 1, 2], requiresSelection: true },
        queriedBySeat: [-1, 1, -1],
      },
    });
    // viewer 不在列:全匿,数量不动
    const viewer9 = redactEvents([opened], 9)[0] as Extract<GameEvent, { kind: "reactionOpened" }>;
    expect(viewer9.view).toMatchObject({ queriedBySeat: [-1, -1, -1] });
    // 单人窗:被询问者见 [自己]
    const solo = redactEvents(
      [
        ev(3, {
          kind: "reactionOpened",
          seq: 1,
          view: {
            kind: "jinnang",
            cardId: "缓兵之计",
            userSeat: 3,
            targets: { kind: "seat", ids: [1], requiresSelection: false },
            queriedBySeat: [1],
            windowMs: 15000,
          },
        }),
      ],
      1,
    )[0] as Extract<GameEvent, { kind: "reactionOpened" }>;
    expect(solo.view).toMatchObject({ queriedBySeat: [1] });
  });

  it("march 窗原样透传(城主归属棋盘可推导,全公开)", () => {
    const opened = ev(0, {
      kind: "reactionOpened",
      seq: 1,
      view: {
        kind: "march",
        cardId: "半路杀出",
        userSeat: 0,
        ownerSeat: 1,
        tileIndex: 11,
        windowMs: 15000,
      },
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
        seq: 1,
        view: {
          kind: "jinnang",
          cardId: "横征暴敛",
          userSeat: 0,
          targets: { kind: "seat", ids: [1, 2], requiresSelection: true },
          queriedBySeat: [1, 2],
          windowMs: 15000,
        },
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

const VALID_MAP_IDS = new Set(["guanzhong"]);
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
  reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e.phase === "Setup"; i++)
    await reg.pickCapital(roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]);
  // 保证 host 手牌有内容可断言(起手 1 张之外再补)
  e.drawJinnang(0, 2);
  return { reg, roomId, token: created.token };
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

  it("座位摘要与日志尾段隐去暗牌操作及询问身份，保留公开结算和行序", () => {
    const game = makeEngine();
    armPhase(game, { phase: "Playing", turnPhase: "AwaitingJinnang", activeIndex: 0 });
    giveJinnang(game, 0, ["连环计", "横征暴敛"]);
    giveJinnang(game, 1, ["识破诡计"]);
    const offset = game.log.length;

    game.submitCommand({ type: "useJinnang", cardId: "连环计" });
    game.submitCommand({ type: "useJinnang", cardId: "连环计", targets: [1] });
    game.submitCommand({ type: "useJinnang", cardId: "连环计" });
    game.submitCommand({ type: "useJinnang", cardId: "连环计", cancel: true });
    game.submitCommand({ type: "useJinnang", cardId: "横征暴敛" });
    game.submitCommand({
      type: "respondReaction",
      seat: 1,
      use: true,
      cardId: "半路杀出",
      target: { kind: "seat", id: 2 },
    });
    game.submitCommand({ type: "respondReaction", seat: 1, use: false });
    game.submitCommand({ type: "useJinnang", cardId: null });

    const snapshot = redactSnapshotForSeat(game.snapshot(), 2);
    const delta = assembleGameLogDelta(game, offset, 123);
    if (delta === null) throw new Error("命令后缺少日志尾段");
    expect(snapshot.log).toHaveLength(game.log.length);
    expect(delta.offset).toBe(offset);
    expect(delta.lines).toEqual(snapshot.log.slice(offset));
    expect(
      delta.lines.filter((line) => line.category === "cmd").map((line) => JSON.parse(line.detail)),
    ).toEqual([
      { type: "useJinnang" },
      { type: "useJinnang" },
      { type: "useJinnang" },
      { type: "useJinnang", cancel: true },
      { type: "useJinnang" },
      { type: "respondReaction", use: true },
      { type: "respondReaction", use: false },
      { type: "useJinnang", cardId: null },
    ]);
    const visible = JSON.stringify(snapshot.log);
    expect(visible).not.toContain("连环计");
    expect(visible).not.toContain("半路杀出");
    expect(visible).not.toContain("queried=p1");
    expect(visible).toContain("queriedCount=1");
    expect(visible).toContain("jinnangCancel player=p0");
    expect(visible).toContain("[警告] 命令与当前操作步骤不符");
    expect(visible).toContain("jinnangUse player=p0 card=横征暴敛");
    const authority = JSON.stringify(game.log);
    expect(authority).toContain("warn: 目标段命令与载荷不符:连环计");
    expect(authority).toContain("半路杀出");
    expect(authority).toContain("queried=p1");
  });

  it("编号回执和座位日志给出公开的权威拒绝理由", async () => {
    const { reg, roomId, token } = await roomAtPlaying();
    const game = reg.get(roomId)!.engine!;

    async function expectWarning(
      cmd: GameCommand,
      requestId: number,
      reason: string,
      detail: string,
    ): Promise<string> {
      const seat = game.decisionOwner;
      const offset = game.log.length;
      const receipts: unknown[] = [];
      function unexpectedCommand(): never {
        throw new Error("预期对局命令");
      }
      const result = await dispatchInbound(
        cmdMsg(cmd, requestId),
        {
          cmd: (message, report) =>
            reg.applyCommandFromSeat(roomId, seat, message, undefined, report),
          pickCapital: unexpectedCommand,
          setAutoPilot: unexpectedCommand,
        },
        { sendCommandResult: (raw) => receipts.push(JSON.parse(raw) as unknown) },
      );
      expect(result).toEqual({ ok: true, requestId });
      expect(receipts).toEqual([
        { type: "commandResult", requestId, outcome: "warning", reason, logOffset: offset + 1 },
      ]);
      const projected = redactSnapshotForSeat(game.snapshot(), 1 - seat).log.slice(offset);
      expect(assembleGameLogDelta(game, offset, 15)?.lines).toEqual(projected);
      expect(projected[1]).toMatchObject({ detail: `warn: ${reason}，原文见服务器日志` });
      expect(projected[1]).not.toHaveProperty("warning");
      expect(game.log[offset + 1].detail).toBe(detail);
      return JSON.stringify(projected);
    }

    try {
      const buyerSeat = game.activeIndex;
      const turnNumber = game.turnNumber;
      const city = MAP.properties.find(
        ({ id, purchasePrice }) => purchasePrice > 0 && game.findOwner(id) === null,
      );
      if (city === undefined) throw new Error("缺少可用于购地的无主城");
      setCash(game, buyerSeat, 0);
      placePlayer(game, buyerSeat, game.tileIndexOfProperty(city.id));
      armPhase(game, { turnPhase: "AwaitingDecision" });
      armLanding(game, { kind: "PropertyAvailable", propertyId: city.id });
      await expectWarning(
        { type: "buyProperty" },
        85,
        "银两不足",
        `warn: 购地 ${city.id} 失败（InsufficientFunds）`,
      );
      expect(game.findOwner(city.id)).toBeNull();
      expect(game.players[buyerSeat].cash).toBe(0);
      expect(game.pendingLand).toBeNull();
      expect(game.activeIndex).toBe(1 - buyerSeat);
      expect(game.turnNumber).toBe(turnNumber + 1);

      const seat = game.activeIndex;
      armHero(game, seat, "caopi", ["fangzhu"]);
      setStamina(game, seat, 30);
      await expectWarning(
        { type: "respondSkillChoice", seat, use: true, targetSeat: game.players.length },
        86,
        "目标座位无效",
        "warn: respondSkillChoice:目标座位无效",
      );
      expect(game.turnPhase).toBe("AwaitingSkillChoice");
      game.respondSkillChoice(seat, false);

      const capitalId = game.board.at(game.activePlayer.capitalIndex).propertyId;
      if (capitalId === null) throw new Error("开局后缺少都城");
      armDebt(game, game.activePlayer.cash + 1, null);
      const projected = await expectWarning(
        { type: "confirmBankruptcySettle", assets: [{ kind: "property", id: capitalId }] },
        87,
        "都城不可变卖",
        "warn: 清偿:都城不可变卖",
      );
      expect(projected).not.toContain(capitalId);
      expect(game.turnPhase).toBe("AwaitingBankruptcySettle");
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });

  it("座位日志仅保留公开命令字段，权威警告原文留在服务器", () => {
    const game = makeEngine();
    game.beginCapitalSelection();
    const offset = game.log.length;
    const seat = game.currentSetupPlayerIndex;
    const tileIndex = game.offeredCapitals[0];
    expect(game.pickCapital(seat, tileIndex).ok).toBe(true);
    armPhase(game, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
    const trade = {
      type: "resolveTreasureOwner",
      action: { type: "fair", treasureId: "seal-1", token: "nested-extra-field" },
      wsUrl: "command-extra-field",
    } as const;
    game.submitCommand(trade);
    game.submitCommand({
      type: "resolveTreasureOwner",
      action: { type: "premium", treasureId: "unrecognized-treasure" },
    });
    game.submitCommand({
      type: "useHeroSkill",
      heroId: "unrecognized-hero",
      skillId: "unrecognized-skill",
    });
    game.submitCommand({ type: "useHeroSkill", heroId: "zhangxingcai", skillId: "leigu" });
    game.submitCommand({
      type: "useBookSkill",
      treasureId: "skillbook-leigu",
      heroId: "zhangxingcai",
    });
    game.submitCommand({
      type: "confirmBankruptcySettle",
      assets: [
        { kind: "treasure", id: "skillbook-unrecognized-book" },
        { kind: "treasure", id: "seal-1" },
        { kind: "property", id: "unrecognized-property" },
      ],
    });
    game.warn("AI 无可选都城,跳过");

    const projected = redactSnapshotForSeat(game.snapshot(), 1).log.slice(offset);
    expect(assembleGameLogDelta(game, offset, 10)?.lines).toEqual(projected);
    expect(projected).toHaveLength(game.log.length - offset);
    expect(
      projected.filter((line) => line.category === "cmd").map((line) => JSON.parse(line.detail)),
    ).toEqual([
      { type: "pickCapital", seat, tileIndex },
      { type: "resolveTreasureOwner", action: { type: "fair", treasureId: "seal-1" } },
      { type: "resolveTreasureOwner", action: { type: "premium" } },
      { type: "useHeroSkill" },
      { type: "useHeroSkill", heroId: "zhangxingcai", skillId: "leigu" },
      { type: "useBookSkill", treasureId: "skillbook-leigu", heroId: "zhangxingcai" },
      {
        type: "confirmBankruptcySettle",
        assets: [{ kind: "treasure" }, { kind: "treasure", id: "seal-1" }, { kind: "property" }],
      },
    ]);
    const warnings = projected.filter((line) => line.brief.startsWith("[警告]"));
    expect(warnings.at(-1)).toMatchObject({
      category: "system",
      brief: "[警告] 对局产生警告，原文见服务器日志",
    });
    const authority = JSON.stringify(game.log);
    expect(authority).toContain("nested-extra-field");
    expect(authority).toContain("unrecognized-hero");
    expect(game.log.at(-1)?.detail).toBe("warn: AI 无可选都城,跳过");
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
    startingCash: 10000,
    startingTreasures: 0,
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
          seq: 1,
          view: {
            kind: "jinnang",
            cardId: "横征暴敛",
            userSeat: 2,
            targets: { kind: "seat", ids: [0, 1], requiresSelection: true },
            queriedBySeat: [0, 1],
            windowMs: 15000,
          },
        }),
      ],
      [ev(1, { kind: "reactionAnswered", use: false })],
      [
        ev(0, {
          kind: "reactionAnswered",
          use: true,
          cardId: "识破诡计",
          spentCards: [{ seat: 0, cardId: "识破诡计" }],
        }),
        ev(0, {
          kind: "jinnangVoided",
          cardId: "横征暴敛",
          result: { kind: "share", target: { kind: "seat", id: 1 } },
        }),
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
    expect(opened?.view).toMatchObject({ queriedBySeat: [-1, -1] });
    expect(filtered.players[2].jinnangHandCount).toBe(god.players[2].jinnangHandCount);
    expect(filtered.jinnangDiscard).toEqual(god.jinnangDiscard);
  });
});

// ──────────────────────────── ④ 快照投影 × 折叠咬合(#461)────────────────────────────
describe("redactSnapshotForSeat · 快照路径查询集数量语义(#461)", () => {
  /** 开窗态快照:三席 AOE 窗挂着(seat2 用横征暴敛,询问集 [0,1]),走真实折叠器置窗。 */
  function snapshotAtOpenWindow() {
    const e = makeEngine();
    foldEventBatch(e, [
      ev(2, { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [0, 1] }),
      ev(2, {
        kind: "reactionOpened",
        seq: 1,
        view: {
          kind: "jinnang",
          cardId: "横征暴敛",
          userSeat: 2,
          targets: { kind: "seat", ids: [0, 1], requiresSelection: true },
          queriedBySeat: [0, 1],
          windowMs: 15000,
        },
      }),
    ]);
    return e.snapshot();
  }

  it("被询问座位:投影保查询集数量([-1,1]),水合覆盖折叠态后首答不误闭窗", () => {
    const mine = redactSnapshotForSeat(snapshotAtOpenWindow(), 1);
    // 投影形状:身份匿名、数量保留(与 redactEvents 同一口径)——开窗拍校准全量快照
    // 会无条件覆盖折叠态,查询集若被覆盖成长度 1,折叠器闭窗算术(answers 数 ≥ 查询数)
    // 在首条应答即全员误闭窗(#461 根因:非应答端横幅提前消失)。
    const view = mine.pendingReaction?.view;
    expect(view?.kind).toBe("jinnang");
    expect(view?.kind === "jinnang" && view.queriedBySeat).toEqual([-1, 1]);
    // 公开派生载荷同口径(wire 双份同裁;客户端本地派生跟随挂起态)
    const pub = mine.reaction;
    expect(pub?.kind).toBe("jinnang");
    expect(pub?.kind === "jinnang" && pub.queriedBySeat).toEqual([-1, 1]);
    // 控制器可见面:自己仍判定被询问,他人身份不可见
    expect(reactionQueriesSeat(mine.pendingReaction!.view, 1)).toBe(true);
    expect(reactionQueriesSeat(mine.pendingReaction!.view, 0)).toBe(false);

    // 咬合(校准拍真实次序=水合覆盖折叠态):首条应答后窗必须仍开着——修复前此处
    // 挂长度 1 的查询集,host 应答批一到副本即误闭窗(非应答端横幅提前消失)。
    const restored = makeEngine();
    restored.restoreFromSnapshot(mine);
    expect(restored.pendingReaction).not.toBeNull();
    foldEventBatch(restored, [ev(0, { kind: "reactionAnswered", use: false })]);
    expect(restored.pendingReaction).not.toBeNull();
  });

  it("非被询问座位:全匿数量保留([-1,-1]),判定不被询问", () => {
    const other = redactSnapshotForSeat(snapshotAtOpenWindow(), 2);
    const view = other.pendingReaction?.view;
    expect(view?.kind === "jinnang" && view.queriedBySeat).toEqual([-1, -1]);
    expect(reactionQueriesSeat(other.pendingReaction!.view, 2)).toBe(false);
  });
});

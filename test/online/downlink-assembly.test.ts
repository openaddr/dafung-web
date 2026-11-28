// 下行装配单口单测(#431,ADR-0020 决策 2「发送总口单点」执行体 assembleDownlinkShot):
//   ① 两种传输按入座者装配首连、校准和事件批，公开反应公告与本席的私有抉择分别交付。
//   ② redaction 必经步:裁剪发生在装配内部而非调用纪律——未知 kind 带座位装配当场炸
//      (零兜底),绕过 redactEvents 的装配实现在此红。
//   ③ 全 kind 普查(底册=#430 档位表):逐 kind 过装配(viewer 模式)不炸;
//      fixture 集对 EVENT_TIERS 键域穷尽——词汇表新增 kind 漏 fixture = 运行期红,
//      与 redactEvents 编译期穷尽 switch 构成双道防遗漏机器。
//   ④ 节拍形状:空批 events=null;withSnapshot=false snapshot=null(联机非校准
//      flush 免 O(log) 白序列化);withSnapshot=true 恒有摘要。
// 发送面接线(消息真实到达客户端)归 test/online/protocol-online.test.ts(ADR-0055)。
import { submitCapitalForSetup } from "./room-capitals";
import { describe, it, expect } from "bun:test";
import { assembleDownlinkShot } from "@dafung/core/room/seat-projection";
import { RoomRegistry } from "@dafung/core/room/room";
import { MAP } from "../../scripts/engine-helpers";
import type { RoomPersistence } from "@dafung/core/room/room-persistence";
import { createEngine, type RoomRecord } from "@dafung/core/room/room-record";
import { foldEventBatch } from "@dafung/core/protocol/event-fold";
import { hydrateSeatReplica, readSeatReplica } from "@dafung/core/protocol/seat-replica";
import type { LoadedMap } from "@dafung/core/engine/board-loader";
import type { GameEvent, GameEventBody } from "@dafung/core/engine/game-events";
import { EVENT_TIERS, type EventKind } from "@dafung/core/engine/event-tiers";
import { armHero, armPhase, giveJinnang } from "@dafung/core/engine/planter";
import type { EventBatchMsg, PlayerSubmission, SnapshotMsg } from "@dafung/core/protocol/wire";

/** 事件首部三件套(同 seat-projection.test 口径)。 */
function ev<B extends GameEventBody>(seat: number | null, body: B): GameEvent {
  return { ...body, seat, round: 1, turn: 1 } as GameEvent;
}

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

/** 开全真人房并完成选都。 */
async function roomAtPlaying(seatCount = 2) {
  const reg = new RoomRegistry(new InMemoryPersistence());
  const created = reg.createRoom({
    seatCount,
    botIdx: new Set(),
    hostConfig: { seed: 42 },
  });
  const roomId = created.room.roomId;
  for (let seat = 1; seat < seatCount; seat++) reg.joinSeat(roomId);
  reg.setMap(roomId, "guanzhong", created.token, VALID_MAP_IDS);
  await reg.startGame(roomId, created.token, undefined, testMapProvider);
  const e = reg.get(roomId)!.engine!;
  for (let i = 0; i < 20 && e.phase === "Setup"; i++)
    await submitCapitalForSetup(reg, roomId, e.currentSetupPlayerIndex, e.offeredCapitals[0]);
  // 保证 host 手牌有内容可断言(起手 1 张之外再补)
  e.drawJinnang(0, 2);
  const online = new Set(created.room.seats.map((_, seat) => seat));
  const summary = (seat: number): SnapshotMsg =>
    JSON.parse(assembleDownlinkShot(created.room, online, seat, [], true).snapshot);
  async function submit(seat: number, submissionId: string, cmd: PlayerSubmission["cmd"]) {
    const { decisionPoint } = summary(seat);
    expect(typeof decisionPoint).toBe("string");
    const result = await reg.submitFromSeat(roomId, seat, {
      roomId,
      seat,
      submissionId,
      decisionPoint: decisionPoint!,
      cmd,
    });
    expect(result.outcome).toBe("accepted");
  }
  return { reg, roomId, engine: e, token: created.token, summary, submit };
}

/** 隐私样本批:jinnang 窗询问 [0,1](身份=per-seat private 档,数量=折叠算术依赖)。 */
function privacyBatch(): GameEvent[] {
  return [
    ev(0, {
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
  ];
}

describe("assembleDownlinkShot · 座位下行", () => {
  it("座位看见自己的手牌、牌库余量及匿名询问人数", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    const shot = assembleDownlinkShot(room, online, 1, privacyBatch(), true);
    // 事件批消息:queriedSeats 非自己座位置换 -1,数量保留
    const msg = JSON.parse(shot.events!) as { type: string; events: GameEvent[] };
    expect(msg.type).toBe("events");
    expect(msg.events).toHaveLength(1);
    expect(msg.events[0]).toMatchObject({ view: { queriedBySeat: [-1, 1] } });
    // 摘要消息:他人(host)手牌内容不出网、数量照发;牌库只给数量;自己手牌恒全量;
    // 反应窗询问集同口径(只留「我是否被询问」)
    const snap: SnapshotMsg = JSON.parse(shot.snapshot);
    expect(snap.type).toBe("snapshot");
    expect(snap.players[0].jinnangHand).toEqual([]);
    expect(snap.players[0].jinnangHandCount).toBeGreaterThan(0);
    expect(snap.players[1].jinnangHand.length).toBeGreaterThan(0);
    expect(snap.jinnangDeck).toEqual([]);
    expect(snap.jinnangDeckCount).toBeGreaterThan(0);
    expect(snap).not.toHaveProperty("rngState");
    expect(
      JSON.parse(snap.log.find((line) => line.category === "header")!.detail),
    ).not.toHaveProperty("seed");
    expect(snap.treasureDeck).toEqual([]);
    expect(snap.players[0].treasures).toEqual(room.engine!.snapshot().players[0].treasures);
    expect(snap.pendingReaction).toBeNull(); // 本批未折进引擎,挂起态为空属正常
  });

  it("连环计的选牌和首目标只给决策席，出牌后全桌看见目标、本席还可核对手牌位置", async () => {
    const { reg, roomId, token, engine, summary, submit } = await roomAtPlaying(3);
    try {
      armPhase(engine, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
      giveJinnang(engine, 0, ["连环计", "火烧连营", "连环计"]);
      expect(summary(0).players[0].jinnangHand).toEqual(["连环计", "火烧连营", "连环计"]);
      expect(summary(0).choices).toContainEqual(
        expect.objectContaining({ id: "连环计", available: true }),
      );
      expect(summary(1).choices).toEqual([]);
      expect(summary(1).decisionPoint).toBeNull();
      const publicLog = summary(1).log;

      const play = { type: "useJinnang", cardId: "连环计", handIndex: 2 } as const;
      await submit(0, "选牌", play);
      await submit(0, "首个目标", { ...play, targets: [1] });
      const room = reg.get(roomId)!;
      const online = new Set([0, 1, 2]);
      const privateStep = assembleDownlinkShot(room, online, 0, engine.gameEvents, false);
      expect(privateStep.events).not.toBeNull();
      const actorBatch: EventBatchMsg = JSON.parse(privateStep.events!);
      const actor = summary(0);
      expect(actorBatch.events).toEqual([
        expect.objectContaining({
          kind: "jinnangTargetStepChanged",
          seat: 0,
          pendingJinnang: actor.pendingJinnang,
          choices: actor.choices,
        }),
      ]);
      expect(actorBatch.decisionPoint).toBe(actor.decisionPoint);
      for (const otherSeat of [1, 2]) {
        expect(
          assembleDownlinkShot(room, online, otherSeat, engine.gameEvents, false).events,
        ).toBeNull();
        expect(summary(otherSeat).events).toEqual([]);
      }
      expect(actor.pendingJinnang).toMatchObject({ cardId: "连环计", stage: "two-b", picked: [1] });
      expect(actor.choices).toContainEqual(
        expect.objectContaining({ targetSeat: 2, available: true }),
      );
      const other = summary(1);
      expect(other.players[0]).toMatchObject({ jinnangHand: [], jinnangHandCount: 3 });
      expect(other.choices).toEqual([]);
      expect(other.pendingJinnang).toBeNull();
      expect(other.log).toEqual(publicLog);

      await submit(0, "第二个目标", { ...play, targets: [2] });
      for (const seat of [0, 1]) {
        const shot = assembleDownlinkShot(room, online, seat, engine.gameEvents, true);
        const batch: EventBatchMsg = JSON.parse(shot.events!);
        const snapshot: SnapshotMsg = JSON.parse(shot.snapshot);
        expect(snapshot.events).toEqual([]);
        const announced = batch.events.find((event) => event.kind === "jinnangAnnounced");
        expect(announced).toMatchObject({ seat: 0, cardId: "连环计", targetSeats: [1, 2] });
        if (seat === 0) expect(announced).toHaveProperty("handIndex", 2);
        else expect(announced).not.toHaveProperty("handIndex");
      }
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });

  it("空批 events=null(withSnapshot=true 摘要照发);withSnapshot=false snapshot=null", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    const quiet = assembleDownlinkShot(room, online, 1, [], true);
    expect(quiet.events).toBeNull();
    expect(quiet.snapshot).not.toBeNull();
    // 联机非校准 flush 的免白序列化拍:摘要半边缺席,事件半边照常
    const eventsOnly = assembleDownlinkShot(room, online, 1, privacyBatch(), false);
    expect(eventsOnly.events).not.toBeNull();
    expect(eventsOnly.snapshot).toBeNull();
  });

  it("军情密探仅在生效事件交付牌面，校准与重连保留公开的窥探动作", async () => {
    const { reg, roomId, token, engine, submit } = await roomAtPlaying(3);
    const room = reg.get(roomId)!;
    const online = new Set([0, 1, 2]);
    try {
      armPhase(engine, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
      giveJinnang(engine, 0, ["军情密探"]);
      giveJinnang(engine, 1, ["连环计", "火烧连营"]);
      giveJinnang(engine, 2, []);
      const card = { type: "useJinnang", cardId: "军情密探", handIndex: 0 } as const;
      await submit(0, "选军情密探", card);
      await submit(0, "确认密探目标", { ...card, targets: [1] });
      for (const seat of [0, 2]) {
        const shot = assembleDownlinkShot(room, online, seat, engine.gameEvents, true);
        const batch: EventBatchMsg = JSON.parse(shot.events!);
        const peek = { kind: "peekApplied", viewerSeat: 0, targetSeat: 1 };
        expect(batch.events.find((event) => event.kind === "peekApplied")).toMatchObject({
          ...peek,
          hand: seat === 0 ? ["连环计", "火烧连营"] : [],
        });
        const snapshot: SnapshotMsg = JSON.parse(shot.snapshot);
        expect(snapshot.players[1]).toMatchObject({ jinnangHand: [], jinnangHandCount: 2 });
        expect(snapshot.log).toContainEqual(
          expect.objectContaining({
            detail: "jinnangUse player=p0 card=军情密探 peek viewer=0 target=1",
          }),
        );
      }
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });

  it("反应公告和已应答座位公开，本席选份回读与权威续结算分开", async () => {
    const { reg, roomId, token, engine, summary, submit } = await roomAtPlaying(3);
    try {
      armPhase(engine, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
      giveJinnang(engine, 0, ["横征暴敛"]);
      giveJinnang(engine, 1, ["识破诡计"]);
      giveJinnang(engine, 2, ["识破诡计"]);
      await submit(0, "横征暴敛", { type: "useJinnang", cardId: "横征暴敛", handIndex: 0 });
      const beforeAnswer = [summary(1), summary(2)];
      const target = { kind: "seat", id: 2 } as const;
      await submit(1, "应答", {
        type: "respondReaction",
        seat: 1,
        use: true,
        cardId: "识破诡计",
        handIndex: 0,
        target,
      });
      for (const seat of [1, 2]) {
        const shot = assembleDownlinkShot(
          reg.get(roomId)!,
          new Set([0, 1, 2]),
          seat,
          engine.gameEvents,
          true,
        );
        const snapshot: SnapshotMsg = JSON.parse(shot.snapshot);
        const batch: EventBatchMsg = JSON.parse(shot.events!);
        if (seat === 1) expect(snapshot.decisionPoint).toBeNull();
        else expect(typeof snapshot.decisionPoint).toBe("string");
        expect(batch.decisionPoint).toBe(snapshot.decisionPoint);
        const answer = { seat: 1, use: true, cardId: "识破诡计" };
        expect(snapshot.pendingReaction).not.toHaveProperty("payload");
        const visibleAnswer = seat === 1 ? { ...answer, handIndex: 0, target } : answer;
        expect(snapshot.pendingReaction?.answers).toEqual([visibleAnswer]);
        const event = batch.events.find((entry) => entry.kind === "reactionAnswered");
        expect(event).toMatchObject(visibleAnswer);
        if (seat === 2) {
          expect(event).not.toHaveProperty("target");
          expect(event).not.toHaveProperty("handIndex");
        }

        const before = beforeAnswer[seat - 1];
        const replica = createEngine(
          {
            seats: before.players,
            mapId: "guanzhong",
            startingCash: before.startingCash,
            startingTreasures: MAP.startingTreasures,
            targetNetWorth: before.targetNetWorth,
          },
          false,
          MAP,
        );
        hydrateSeatReplica(replica, before);
        foldEventBatch(replica, batch.events);
        expect(readSeatReplica(replica, seat).pendingReaction?.answers).toEqual([visibleAnswer]);
        expect(snapshot.reaction).toMatchObject({
          cardId: "横征暴敛",
          targets: { kind: "seat", ids: [1, 2] },
        });
        expect(snapshot.log.some(({ detail }) => detail.includes("share=2"))).toBe(false);
      }
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });

  it("选择和作罢主动技只给决策席目标选项，日志保留已发动的技能和目标", async () => {
    const { reg, roomId, token, engine, summary, submit } = await roomAtPlaying();
    try {
      armPhase(engine, { turnPhase: "AwaitingJinnang", activeIndex: 0 });
      armHero(engine, 0, "huatuo", ["zhenji"]);
      const skill = { type: "useHeroSkill", heroId: "huatuo", skillId: "zhenji" } as const;
      const publicLog = summary(1).log;
      await submit(0, "选择赈济", skill);
      expect(summary(0).pendingSkill).toEqual({ heroId: "huatuo", skillId: "zhenji" });
      const waiting = summary(1);
      expect(waiting.pendingSkill).toBeNull();
      expect(waiting.choices).toEqual([]);
      expect(waiting.log).toEqual(publicLog);
      await submit(0, "作罢赈济", { ...skill, cancel: true });
      expect(summary(1).log).toEqual(publicLog);
      await submit(0, "重选赈济", skill);
      await submit(0, "发动赈济", { ...skill, targets: [1] });
      const shot = assembleDownlinkShot(
        reg.get(roomId)!,
        new Set([0, 1]),
        1,
        engine.gameEvents,
        false,
      );
      const batch: EventBatchMsg = JSON.parse(shot.events!);
      expect(batch.events).toContainEqual(
        expect.objectContaining({
          kind: "heroSkillActivated",
          skillId: "zhenji",
          targetSeat: 1,
        }),
      );
      expect(summary(1).log.slice(publicLog.length)).toContainEqual(
        expect.objectContaining({
          category: "skill",
          detail: "heroSkill owner=p0 skill=zhenji kind=relief target=p1",
        }),
      );
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });

  it("招贤候选仅入招贤者的摘要，录用名将全桌可见", async () => {
    const { reg, roomId, token, engine, summary, submit } = await roomAtPlaying();
    try {
      armPhase(engine, { activeIndex: 0 });
      engine.tryRecruitHero(engine.activePlayer);
      const offers = summary(0).offeredHeroes;
      expect(offers).toHaveLength(3);
      const other = summary(1);
      expect(other.offeredHeroes).toEqual([]);
      expect(other.log.find((line) => line.detail.startsWith("offerHeroes "))).toMatchObject({
        detail: "offerHeroes player=p0 count=3",
      });
      await submit(0, "招将", { type: "resolveHeroPick", index: 0 });
      expect(summary(1).players[0].heroes).toContainEqual(
        expect.objectContaining({
          heroId: offers[0].id,
          skillIds: offers[0].skillIds,
        }),
      );
    } finally {
      reg.dismissRoom(roomId, token);
    }
  });
});

describe("assembleDownlinkShot · redaction 必经步(#431)", () => {
  it("未知 kind 带座位装配当场炸(裁剪在装配内部,非调用方自觉)", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const future = {
      kind: "futureKind",
      someField: 1,
      seat: 0,
      round: 1,
      turn: 1,
    } as unknown as GameEvent;
    expect(() =>
      assembleDownlinkShot(reg.get(roomId)!, new Set([0, 1]), 1, [future], true),
    ).toThrow(/未登记隐私档位/);
  });
});

// ──────────────────────────── ③ 全 kind 普查(底册=#430 档位表)────────────────────────────

/** 全 kind 最小事件体(透传同 seat-projection.test 口径 + reactionOpened 双窗)。 */
const ALL_KIND_BODIES: GameEventBody[] = [
  { kind: "gameStarted" },
  { kind: "setupCompleted" },
  { kind: "turnEnded" },
  { kind: "turnStarted" },
  { kind: "roundEnded" },
  { kind: "roundStarted" },
  { kind: "gameOver", reason: "TargetNetWorth" },
  { kind: "diceRolled", die: 3 },
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
  {
    kind: "marchArrived",
    tileIndex: 7,
    path: {
      from: 0,
      traversed: [],
      landIndex: 7,
      passedCapital: false,
      capitalIndex: -1,
      waypoints: [],
    },
  },
  {
    kind: "capitalHalt",
    tileIndex: 5,
    path: {
      from: 0,
      traversed: [],
      landIndex: 5,
      passedCapital: false,
      capitalIndex: -1,
      waypoints: [],
    },
  },
  {
    kind: "capitalSelected",
    tileIndex: 2,
    propertyId: "chengdu",
    cost: 1000,
    holding: {
      propertyId: "chengdu",
      group: "a",
      level: 1,
      maxLevel: 4,
      defense: 40,
      burning: null,
      damageRanking: [],
    },
  },
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
  {
    kind: "propertyBurningChanged",
    propertyId: "xuchang",
    burning: { sourceSeat: 1, marks: 2, progress: 0, ignitedTurn: 1 },
  },
  { kind: "propertyBurningTicked", propertyId: "xuchang", marks: 3 },
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
  { kind: "heroDismissed", heroId: "guanyu", skillIds: ["wusheng"] }, // #1147 遣散
  { kind: "skillLearned", heroId: "guanyu", skillId: "wusheng", treasureId: "skillbook-wusheng" }, // #1146 用书学技
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
  { kind: "jinnangReshuffled", count: 3 },
  { kind: "jinnangExhausted" },
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
  { kind: "jinnangTargetStepChanged", pendingJinnang: null, choices: [] },
  { kind: "jinnangAnnounced", cardId: "横征暴敛", targetSeats: [1, 2] },
  { kind: "jinnangPhaseResumed", turnPhase: "Roll" },
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
  { kind: "peekApplied", viewerSeat: 0, targetSeat: 1, cardId: "军情密探", hand: ["连环计"] },
  {
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
  },
  {
    kind: "reactionOpened",
    seq: 1,
    view: {
      kind: "march",
      cardId: "半路杀出",
      userSeat: 0,
      ownerSeat: 1,
      tileIndex: 3,
      windowMs: 15000,
    },
  },
];

describe("assembleDownlinkShot · 全 kind 普查(#431 防遗漏机器,底册 EVENT_TIERS)", () => {
  it("档位表键域逐个过装配(viewer 模式)不炸;fixture 漏 kind = 运行期红", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    // fixture 对档位表键域穷尽:词汇表新增 kind 未进本普查 = 此行红(强制补 fixture,
    // 补后逐个流经装配的 redaction 必经步)
    const tierKinds = new Set(Object.keys(EVENT_TIERS) as EventKind[]);
    expect(new Set(ALL_KIND_BODIES.map((b) => b.kind))).toEqual(tierKinds);
    for (const body of ALL_KIND_BODIES) {
      const viewer = body.kind === "jinnangTargetStepChanged" ? 0 : 1;
      const shot = assembleDownlinkShot(room, online, viewer, [ev(0, body)], true);
      const msg = JSON.parse(shot.events!) as { type: string; events: GameEvent[] };
      expect(msg.events).toHaveLength(1);
    }
  });
});

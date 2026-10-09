// 下行装配单口单测(#431,ADR-0020 决策 2「发送总口单点」执行体 assembleDownlinkShot):
//   ① 双模式(缺一即红):viewerSeat=座位 → 联机必裁(事件批 queriedSeats 身份匿名
//      保数量 + 摘要过 redactSnapshotForSeat);viewerSeat=null → 单机显式 god-view
//      (事件批原样 + 摘要全量)。两模式的保密面必须恰好相反。
//   ② redaction 必经步:裁剪发生在装配内部而非调用纪律——未知 kind 带座位装配当场炸
//      (零兜底),绕过 redactEvents 的装配实现在此红。
//   ③ 全 kind 普查(底册=#430 档位表):38 kind 逐个过装配(viewer 模式)不炸;
//      fixture 集对 EVENT_TIERS 键域穷尽——词汇表新增 kind 漏 fixture = 运行期红,
//      与 redactEvents 编译期穷尽 switch 构成双道防遗漏机器。
//   ④ 节拍形状:空批 events=null;withSnapshot=false snapshot=null(联机非校准
//      flush 免 O(log) 白序列化);withSnapshot=true 恒有摘要。
// 发送面接线(消息真实到达客户端)归 e2e/react-online-secrecy.spec.ts。
import { describe, it, expect } from "bun:test";
import { assembleDownlinkShot } from "../scripts/seat-projection";
import { RoomRegistry } from "../scripts/room";
import { MAP } from "../scripts/engine-helpers";
import type { RoomPersistence, RoomRecord } from "../scripts/room-persistence";
import type { LoadedMap } from "../src/core/board-loader";
import type { GameEvent, GameEventBody } from "../src/core/game-events";
import { EVENT_TIERS, type EventKind } from "../src/core/event-tiers";

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

/** 隐私样本批:jinnang 窗询问 [0,1](身份=per-seat private 档,数量=折叠算术依赖)。 */
function privacyBatch(): GameEvent[] {
  return [
    ev(0, {
      kind: "reactionOpened",
      windowKind: "jinnang",
      cardId: "横征暴敛",
      queriedSeats: [0, 1],
    }),
  ];
}

describe("assembleDownlinkShot · 双模式(#431:单机显式 god-view、联机必裁)", () => {
  it("联机必裁:viewerSeat=1 → 事件批身份匿名保数量,摘要无 host 手牌/无牌库序", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    const shot = assembleDownlinkShot(room, online, 1, privacyBatch(), true);
    // 事件批消息:queriedSeats 非自己座位置换 -1,数量保留
    const msg = JSON.parse(shot.events!) as { type: string; events: GameEvent[] };
    expect(msg.type).toBe("events");
    expect(msg.events).toHaveLength(1);
    expect((msg.events[0] as { queriedSeats: number[] }).queriedSeats).toEqual([-1, 1]);
    // 摘要消息:他人(host)手牌内容不出网、数量照发;牌库只给数量;自己手牌恒全量;
    // 反应窗询问集同口径(只留「我是否被询问」)
    const snap = JSON.parse(shot.snapshot!) as Record<string, any>;
    expect(snap.type).toBe("snapshot");
    expect(snap.players[0].jinnangHand).toEqual([]);
    expect(snap.players[0].jinnangHandCount).toBeGreaterThan(0);
    expect(snap.players[1].jinnangHand.length).toBeGreaterThan(0);
    expect(snap.jinnangDeck).toEqual([]);
    expect(snap.jinnangDeckCount).toBeGreaterThan(0);
    expect(snap.pendingReaction).toBeNull(); // 本批未折进引擎,挂起态为空属正常
  });

  it("单机显式 god-view:viewerSeat=null → 事件批原样逐字,摘要全量(手牌/牌序在场)", async () => {
    const { reg, roomId } = await roomAtPlaying();
    const room = reg.get(roomId)!;
    const online = new Set([0, 1]);
    const batch = privacyBatch();
    const shot = assembleDownlinkShot(room, online, null, batch, true);
    // 事件批原样(与输入逐字相等——god-view 不裁,单机内存直连唯一合法取值)
    expect(JSON.parse(shot.events!)).toEqual({ type: "events", events: batch });
    // 摘要全量:他人手牌内容与牌库牌序在场(god-view 语义,重放/调试同门)
    const snap = JSON.parse(shot.snapshot!) as Record<string, any>;
    expect(snap.players[0].jinnangHand.length).toBeGreaterThan(0);
    expect(snap.jinnangDeck.length).toBeGreaterThan(0);
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

/** 38 kind 最小事件体(37 透传同 seat-projection.test 口径 + reactionOpened 双窗)。 */
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
    kind: "marchArrived",
    tileIndex: 7,
    path: {
      from: 0,
      traversed: [],
      landIndex: 7,
      passedCapital: false,
      capitalIndex: -1,
      waypoints: [],
      landBranchStep: null,
      branchWaypoints: [],
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
      landBranchStep: null,
      branchWaypoints: [],
    },
  },
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
  { kind: "reactionOpened", windowKind: "jinnang", cardId: "横征暴敛", queriedSeats: [0, 1] },
  { kind: "reactionOpened", windowKind: "march", cardId: "半路杀出", queriedSeats: [1] },
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
      const shot = assembleDownlinkShot(room, online, 1, [ev(0, body)], true);
      const msg = JSON.parse(shot.events!) as { type: string; events: GameEvent[] };
      expect(msg.events).toHaveLength(1);
    }
  });
});

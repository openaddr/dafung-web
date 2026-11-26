// 事件序列测试(#375,测试缝 2):对已知状态转移断言引擎产出的事件序列——
// 词汇表见 src/core/game-events.ts,快照经 `events` 字段透出当前批。批界 = 编排
// 入口开批(submitCommand/botAct/开局驱动);测试对白盒触达的转移用 beginGameEventBatch
// 显式开批(与编排入口同纪律),逐转移断言本批 kind 序列与关键字段。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type { EngineConfig, SeatConfig } from "@dafung/core/engine/authority";
import { createDice } from "@dafung/core/engine/dice";
import { loadMap } from "@dafung/core/engine/board-loader";
import { testEngine } from "@dafung/core/engine/testing";
import { guidePriceOf } from "@dafung/core/engine/treasures";
import { HEROES } from "@dafung/core/engine/heroes";
import { jinnangCardOf } from "@dafung/core/engine/jinnang";
import { beginGameEventBatch, type GameEvent } from "@dafung/core/engine/game-events";
import type { TurnPhase } from "@dafung/core/engine/authority";
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

/** 相位读取(经函数调用,解开 TS 对 e.turnPhase 的赋值收窄——引擎在别处推进相位)。 */
const phaseOf = (e: GameEngine): TurnPhase => e.turnPhase;

/** 事件 kind 序列速读。 */
const kinds = (events: GameEvent[]) => events.map((ev) => ev.kind);

/** 驱动选都到完成并清手牌(锦囊相位 inert,与 game.test.ts 同款垫子);
 *  返回逐编排步折叠出的事件全史(每步读一步的批)。 */
function finishSetup(e: GameEngine): GameEvent[] {
  e.beginCapitalSelection();
  const history: GameEvent[] = [];
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
    history.push(...e.snapshot().events); // 每个编排步一批,折叠成全史
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  });
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return history;
}

describe("事件流(#375):开局与批语义", () => {
  it("开局全史包含选都、开局、首回合与摸牌", () => {
    const e = makeEngine(7, [
      { name: "A", isBot: true, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
    ]);
    const events = finishSetup(e);
    expect(kinds(events).slice(0, 6)).toEqual([
      "capitalSelected",
      "capitalSelected",
      "setupCompleted",
      "gameStarted",
      "turnStarted",
      "jinnangDrawn",
    ]);
    for (const ev of events) {
      if (ev.kind === "capitalSelected") {
        expect(ev.cost).toBeGreaterThan(0);
        expect(e.board.at(ev.tileIndex).isCapitalEligible).toBe(true);
      }
      expect(ev.seat).not.toBeNull();
      expect(ev.round).toBeGreaterThan(0);
    }
    // 末批 = 最后一次编排步的产出(收尾四连发生在最后一位落子的同一步内)
    expect(kinds(e.snapshot().events).slice(0, 5)).toEqual([
      "capitalSelected",
      "setupCompleted",
      "gameStarted",
      "turnStarted",
      "jinnangDrawn",
    ]);
  });

  it("批语义:开批弃旧批;快照非破坏性(同批多次读取幂等);恢复随批走", () => {
    const e = makeEngine(7);
    finishSetup(e);
    beginGameEventBatch(e);
    expect(e.snapshot().events).toEqual([]); // 开批即空
    e.turnPhase = "AwaitingDecision";
    e.endDecision();
    const first = e.snapshot().events;
    expect(kinds(first).slice(0, 3)).toEqual(["turnEnded", "turnStarted", "jinnangDrawn"]);
    expect(e.snapshot().events).toEqual(first); // 非破坏性:同一转移的快照幂等
    // 随批走:恢复端继承当前批,直到它自己的下一编排步开批
    const mirror = makeEngine(1);
    mirror.restoreFromSnapshot(e.snapshot());
    expect(mirror.snapshot().events).toEqual(first);
    beginGameEventBatch(mirror);
    expect(mirror.snapshot().events).toEqual([]);
    // 序列化友好(红线 5):无函数/循环引用,JSON 往返保真
    const roundTrip = JSON.parse(JSON.stringify(first)) as GameEvent[];
    expect(roundTrip).toEqual(first);
  });

  it("submitCommand 入口开批:上一命令的批被弃,本批只含本次命令的产出", () => {
    const e = makeEngine(5);
    finishSetup(e);
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 编排入口:自动开批
    const first = e.snapshot().events;
    expect(kinds(first).slice(0, 2)).toEqual(["turnEnded", "turnStarted"]);
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 新命令 = 新批,上一批弃(本座末位:连带轮次收尾)
    expect(kinds(e.snapshot().events).slice(0, 4)).toEqual([
      "turnEnded",
      "roundEnded",
      "roundStarted",
      "turnStarted",
    ]);
  });
});

describe("事件流(#375):掷骰行军与购地", () => {
  it("rollAndMove 产出行军到达与最终落格决策(落无主城进决策,回合未收尾)", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    // 预言骰面:同种子探针骰不消耗引擎 rng(mulberry32 状态续掷语义)
    const die = createDice(e.dice.getRngState()).roll().die;
    // 找一个摆位:掷 die 后落无主城、途中不驻跸
    const target = MAP.board.tiles.find((tile) => {
      if (tile.propertyId == null) return false;
      const path = MAP.board.computePath(tile.index, die, mover.capitalIndex);
      if (path.passedCapital) return false;
      const land = MAP.board.at(path.landIndex);
      return land.event == null && land.propertyId != null && e.findOwner(land.propertyId) == null;
    });
    expect(target).toBeDefined(); // 关中必有无主城可达(数据不变量)
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["diceRolled", "marchArrived", "landingResolved"]);
    expect(events[0]).toMatchObject({ kind: "diceRolled", seat, die });
    expect(events[1]).toMatchObject({ kind: "marchArrived", seat, tileIndex: mover.position });
    expect(phaseOf(e)).toBe("AwaitingDecision"); // 购地决策挂起,回合未收尾
  });

  it("buyProperty 产出 [propertyBought, turnEnded, turnStarted],金额与对象齐全", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const buyer = e.activePlayer;
    const tile = MAP.board.tiles.find(
      (x) => x.event == null && x.propertyId != null && e.findOwner(x.propertyId) == null,
    )!;
    buyer.cash = e.catalog.get(tile.propertyId!)!.purchasePrice + 100; // 买得起且低于目标身价(不触发终局)
    t.landActiveAt(tile.index);
    expect(phaseOf(e)).toBe("AwaitingDecision");
    const propertyId = e.pendingLand!.propertyId;
    const price = e.catalog.get(propertyId)!.purchasePrice;
    beginGameEventBatch(e);
    e.buyProperty();
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 3)).toEqual(["propertyBought", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "propertyBought",
      seat: e.players.indexOf(buyer),
      propertyId,
      price,
    });
  });
});

describe("事件流(#375):金钱变更", () => {
  it("落己都城补给产出 cashChanged(reason=supply),招贤相位挂起不收尾", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    t.placeActive(mover.capitalIndex);
    beginGameEventBatch(e);
    t.land();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["cashChanged", "landingResolved"]);
    expect(events[0]).toMatchObject({
      kind: "cashChanged",
      seat: e.players.indexOf(mover),
      reason: "supply",
      delta: e.capitalSupplyOf(mover).supply,
    });
    expect(phaseOf(e)).toBe("AwaitingHeroPick");
  });
});

describe("事件流(#375):锦囊出牌与反应窗", () => {
  it("自域锦囊:求贤令产出 [jinnangAnnounced, heroRecruited](无人持识破,不开窗)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    user.jinnangHand = ["求贤令"];
    user.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang"; // 出牌阶段摆位(#122/T2 白盒)
    beginGameEventBatch(e);
    e.resolveJinnang("求贤令");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["jinnangAnnounced", "heroRecruited", "jinnangPhaseResumed"]);
    expect(events[0]).toMatchObject({
      kind: "jinnangAnnounced",
      seat: userSeat,
      targetSeats: [userSeat],
    });
    const heroId = (events[1] as { kind: "heroRecruited"; heroId: string }).heroId;
    expect(HEROES.some((h) => h.id === heroId)).toBe(true);
    expect(user.jinnangHand.length).toBe(0); // 出牌扣账(留下的相位视新将主动技而定,非本测主题)
  });

  it("识破窗全程:jinnangAnnounced → reactionOpened → reactionAnswered → jinnangVoided(AOE 份被保)", () => {
    const e = makeEngine(3);
    finishSetup(e);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const otherSeat = userSeat === 0 ? 1 : 0;
    user.jinnangHand = ["横征暴敛"];
    user.jinnangHandCount = 1;
    e.players[otherSeat].jinnangHand = ["识破诡计"];
    e.players[otherSeat].jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    beginGameEventBatch(e);
    e.resolveJinnang("横征暴敛"); // AOE:开识破窗等应答
    expect(phaseOf(e)).toBe("AwaitingReaction");
    e.respondReaction(otherSeat, true, "识破诡计", otherSeat); // 保自己那份
    const events = e.snapshot().events;
    // #571 反识破链:识破打出也公开宣布——链环 jinnangAnnounced(识破诡计)插在
    // 应答与判定之间;无人可反不开第二窗,链即终,jinnangVoided 判定落账
    expect(kinds(events)).toEqual([
      "jinnangAnnounced",
      "reactionOpened",
      "reactionAnswered",
      "jinnangAnnounced",
      "jinnangVoided",
      "jinnangPhaseResumed",
    ]);
    expect(events[0]).toMatchObject({
      kind: "jinnangAnnounced",
      seat: userSeat,
      cardId: "横征暴敛",
    });
    expect(events[1]).toMatchObject({
      kind: "reactionOpened",
      view: {
        kind: "jinnang",
        cardId: "横征暴敛",
        queriedBySeat: [otherSeat],
        targetSeats: [otherSeat],
      },
    });
    expect(events[2]).toMatchObject({
      kind: "reactionAnswered",
      seat: otherSeat,
      use: true,
      cardId: "识破诡计",
      spentCards: [{ seat: otherSeat, cardId: "识破诡计" }],
    });
    expect(events[3]).toMatchObject({
      kind: "jinnangAnnounced",
      seat: otherSeat,
      cardId: "识破诡计",
      targetSeats: [otherSeat],
    });
    expect(events[4]).toMatchObject({
      kind: "jinnangVoided",
      seat: otherSeat,
      cardId: "横征暴敛",
      shareSeat: otherSeat,
    });
    expect(jinnangCardOf("横征暴敛").effect.kind).toBe("levyAll"); // 词汇对照:被保份免征,无银两动账
    expect(phaseOf(e)).toBe("Roll");
  });
});

describe("事件流(#375):回合推进与轮次", () => {
  it("普通回合收尾产出 [turnEnded, turnStarted]", () => {
    const e = makeEngine(5);
    finishSetup(e);
    e.turnPhase = "AwaitingDecision"; // 按兵不动白盒摆位
    beginGameEventBatch(e);
    e.endDecision();
    expect(kinds(e.snapshot().events).slice(0, 3)).toEqual([
      "turnEnded",
      "turnStarted",
      "jinnangDrawn",
    ]);
  });

  it("轮末收尾产出 [turnEnded, roundEnded, roundStarted, turnStarted](回到锚点,轮 +1;经 submitCommand 验批界)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 首个座位收尾 → 轮到下家(入口自动开批)
    const first = e.snapshot().events;
    expect(kinds(first).slice(0, 2)).toEqual(["turnEnded", "turnStarted"]);
    const before = e.round;
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 末座收尾 → 回到轮次锚点(新命令弃上一批)
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 5)).toEqual([
      "turnEnded",
      "roundEnded",
      "roundStarted",
      "turnStarted",
      "jinnangDrawn",
    ]);
    expect(e.round).toBe(before + 1);
  });
});

describe("事件流(#375):破产、招贤、珍宝交割", () => {
  it("无可变卖资产付不起 → playerBankrupt(善后完成点产出)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const mover = e.activePlayer;
    mover.cash = 50;
    mover.properties = []; // 仅都城不可变卖 → 无可变卖资产
    beginGameEventBatch(e);
    const r = e.payOrLiquidate(mover, null, 200);
    expect(r).toBe("liquidating");
    e.declareBankruptcy();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["playerBankrupt", "turnEnded", "gameOver"]);
    expect(events[0]).toMatchObject({ kind: "playerBankrupt", seat: e.players.indexOf(mover) });
    expect(mover.isBankrupt).toBe(true);
  });

  it("招贤选定产出 [heroRecruited, turnEnded, turnStarted],heroId=所选候选", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    t.placeActive(mover.capitalIndex);
    t.land(); // 己都城:补给 + 三选一
    expect(phaseOf(e)).toBe("AwaitingHeroPick");
    beginGameEventBatch(e);
    const expectedHeroId = e.offeredHeroes[0].def.id;
    e.resolveHeroPick(0);
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 3)).toEqual(["heroRecruited", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "heroRecruited",
      seat: e.players.indexOf(mover),
      heroId: expectedHeroId,
    });
  });

  it("公道买卖交割产出 [propertyUpgraded, treasureGained, treasureSold, treasureTraded, turnEnded, turnStarted]", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const visitor = e.activePlayer; // 访客 = 当前活跃座位
    const owner = e.players[e.players.indexOf(visitor) === 0 ? 1 : 0]; // 城主 = 对座
    const tile = MAP.board.tiles.find(
      (x) => x.event == null && x.propertyId != null && x.index !== visitor.capitalIndex,
    )!;
    owner.properties.push({
      burning: null,
      damageRanking: [],
      propertyId: tile.propertyId!,
      group: "a",
      level: 1,
      maxLevel: 4,
      defense: 40,
    });
    owner.treasures.push({ id: "锦囊袋", name: "锦囊袋", level: 1, desc: "" });
    t.place(e.players.indexOf(visitor), tile.index);
    e.turnPhase = "Land";
    e.resolveLanding();
    expect(phaseOf(e)).toBe("AwaitingTreasureOwner");
    beginGameEventBatch(e);
    visitor.cash = guidePriceOf(1) + 100; // 付得起且低于目标身价(不触发终局)
    e.resolveTreasureOwner({ type: "fair", treasureId: "锦囊袋" });
    const events = e.snapshot().events;
    expect(kinds(events).slice(0, 6)).toEqual([
      "propertyUpgraded",
      "treasureGained",
      "treasureSold",
      "treasureTraded",
      "turnEnded",
      "turnStarted",
    ]);
    expect(events[0]).toMatchObject({
      kind: "propertyUpgraded",
      propertyId: tile.propertyId,
      newLevel: 2,
    });
    expect(events[3]).toMatchObject({
      kind: "treasureTraded",
      buyerSeat: e.players.indexOf(visitor),
      sellerSeat: e.players.indexOf(owner),
      treasureId: "锦囊袋",
      price: guidePriceOf(1),
    });
  });
});

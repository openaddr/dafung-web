// 事件序列测试(#375,测试缝 2):对已知状态转移断言引擎产出的事件序列——
// 词汇表见 src/core/game-events.ts,快照经 `events` 字段透出当前批。批界 = 编排
// 入口开批(submitCommand/botAct/开局驱动);测试对白盒触达的转移用 beginGameEventBatch
// 显式开批(与编排入口同纪律),逐转移断言本批 kind 序列与关键字段。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { testEngine } from "@core/testing";
import { guidePriceOf } from "@core/treasures";
import { HEROES } from "@core/heroes";
import { jinnangCardOf } from "@core/jinnang";
import { beginGameEventBatch, type GameEvent } from "@core/game-events";
import type { TurnPhase } from "@core/authority";
import sanguoData from "../public/maps/sanguo.json";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[], encounter?: EngineConfig["encounter"]) {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    encounter,
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
  e.doDraftRoll();
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
  it("开局全史(逐批折叠):每位一条 capitalSelected,收尾 setupCompleted → gameStarted → turnStarted", () => {
    const e = makeEngine(7, [
      { name: "A", isBot: true, guohao: "魏" },
      { name: "B", isBot: true, guohao: "蜀" },
    ]);
    const events = finishSetup(e);
    expect(kinds(events)).toEqual([
      "capitalSelected",
      "capitalSelected",
      "setupCompleted",
      "gameStarted",
      "turnStarted",
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
    expect(kinds(e.snapshot().events)).toEqual([
      "capitalSelected",
      "setupCompleted",
      "gameStarted",
      "turnStarted",
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
    expect(kinds(first)).toEqual(["turnEnded", "turnStarted"]);
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
    expect(kinds(first)).toEqual(["turnEnded", "turnStarted"]);
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 新命令 = 新批,上一批弃(本座末位:连带轮次收尾)
    expect(kinds(e.snapshot().events)).toEqual([
      "turnEnded",
      "roundEnded",
      "roundStarted",
      "turnStarted",
    ]);
  });
});

describe("事件流(#375):掷骰行军与购地", () => {
  it("rollAndMove 产出 [diceRolled, marchArrived](落无主城进决策,回合未收尾)", () => {
    const e = makeEngine(11);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    // 预言骰面:同种子探针骰不消耗引擎 rng(mulberry32 状态续掷语义)
    const die = createDice(e.dice.getRngState()).roll().die;
    // 找一个摆位:掷 die 后落无主城、途中不驻跸、不落辅路入口
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
    expect(target).toBeDefined(); // sanguo 必有无主城可达(数据不变量)
    t.place(seat, target!.index);
    beginGameEventBatch(e);
    e.rollAndMove();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["diceRolled", "marchArrived"]);
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
      (x) =>
        x.type === "Property" &&
        x.propertyId != null &&
        e.findOwner(x.propertyId) == null &&
        !MAP.board.getBranchStart(x.index),
    )!;
    buyer.cash = e.catalog.get(tile.propertyId!)!.purchasePrice + 100; // 买得起且低于目标身价(不触发终局)
    t.landActiveAt(tile.index);
    expect(phaseOf(e)).toBe("AwaitingDecision");
    const propertyId = e.pendingLand!.propertyId;
    const price = e.catalog.get(propertyId)!.purchasePrice;
    beginGameEventBatch(e);
    e.buyProperty();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["propertyBought", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({
      kind: "propertyBought",
      seat: e.players.indexOf(buyer),
      propertyId,
      price,
    });
  });
});

describe("事件流(#375):金钱变更", () => {
  it("税关缴税产出 cashChanged(delta=-200,reason=tax),随后回合收尾", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const taxTile = MAP.board.tiles.find((tile) => tile.type === "Tax");
    expect(taxTile).toBeDefined(); // sanguo 设税关(数据不变量)
    t.placeActive(taxTile!.index);
    beginGameEventBatch(e);
    t.land();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["cashChanged", "turnEnded", "turnStarted"]);
    expect(events[0]).toMatchObject({ kind: "cashChanged", delta: -200, reason: "tax" });
  });

  it("落己都城补给产出 cashChanged(reason=supply),招贤相位挂起不收尾", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    t.placeActive(mover.capitalIndex);
    beginGameEventBatch(e);
    t.land();
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["cashChanged"]);
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
    e.turnPhase = "AwaitingJinnang"; // 军师幕摆位(#122/T2 白盒)
    beginGameEventBatch(e);
    e.resolveJinnang("求贤令");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["jinnangAnnounced", "heroRecruited"]);
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
    expect(kinds(events)).toEqual([
      "jinnangAnnounced",
      "reactionOpened",
      "reactionAnswered",
      "jinnangVoided",
    ]);
    expect(events[0]).toMatchObject({
      kind: "jinnangAnnounced",
      seat: userSeat,
      cardId: "横征暴敛",
    });
    expect(events[1]).toMatchObject({
      kind: "reactionOpened",
      windowKind: "jinnang",
      cardId: "横征暴敛",
      queriedSeats: [otherSeat],
    });
    expect(events[2]).toMatchObject({
      kind: "reactionAnswered",
      seat: otherSeat,
      use: true,
      cardId: "识破诡计",
    });
    expect(events[3]).toMatchObject({
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
    expect(kinds(e.snapshot().events)).toEqual(["turnEnded", "turnStarted"]);
  });

  it("轮末收尾产出 [turnEnded, roundEnded, roundStarted, turnStarted](回到锚点,轮 +1;经 submitCommand 验批界)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 首个座位收尾 → 轮到下家(入口自动开批)
    const first = e.snapshot().events;
    expect(kinds(first)).toEqual(["turnEnded", "turnStarted"]);
    const before = e.round;
    e.turnPhase = "AwaitingDecision";
    e.submitCommand({ type: "endDecision" }); // 末座收尾 → 回到轮次锚点(新命令弃上一批)
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["turnEnded", "roundEnded", "roundStarted", "turnStarted"]);
    expect(e.round).toBe(before + 1);
  });
});

describe("事件流(#375):机遇、破产、招贤、珍宝交割", () => {
  it("机遇触发产出 encounterTriggered(id/tier 随抽取,带档位)", () => {
    const e = makeEngine(9, undefined, {
      triggerRate: 100,
      baseRates: { good: 1, neutral: 98, bad: 1 },
    });
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    const tile = MAP.board.tiles.find((x) => x.type !== "Fate")!; // 天命格不参与机遇 roll,避开
    t.place(e.players.indexOf(mover), tile.index);
    beginGameEventBatch(e);
    t.maybeApplyEncounter(e.activePlayer, e.activePlayer.position); // 触发率 100,必抽中
    const events = e.snapshot().events;
    expect(events[0]?.kind).toBe("encounterTriggered");
    expect(events[0]).toMatchObject({
      seat: e.players.indexOf(e.activePlayer),
      tier: expect.stringMatching(/好运|中性|霉运/),
    });
  });

  it("无可变卖资产付不起 → playerBankrupt(善后完成点产出)", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const t = testEngine(e);
    const mover = e.activePlayer;
    mover.cash = 50;
    mover.properties = []; // 仅都城不可变卖 → 无可变卖资产
    beginGameEventBatch(e);
    const r = t.payOrLiquidate(mover, null, 200);
    expect(r).toBe("bankrupt");
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["playerBankrupt"]);
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
    const expectedHeroId = e.offeredHeroes[0].id;
    e.resolveHeroPick(0);
    const events = e.snapshot().events;
    expect(kinds(events)).toEqual(["heroRecruited", "turnEnded", "turnStarted"]);
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
      (x) =>
        x.type === "Property" &&
        x.propertyId != null &&
        x.index !== visitor.capitalIndex &&
        !MAP.board.getBranchStart(x.index),
    )!;
    owner.properties.push({
      propertyId: tile.propertyId!,
      group: "a",
      purchasePrice: 100,
      level: 0,
      maxLevel: 3,
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
    expect(kinds(events)).toEqual([
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
      newLevel: 1,
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

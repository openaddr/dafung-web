// 体力系统单测(#131):初值/夹紧 + 耗竭全自动结算(外敌乘虚:诸城各降 1 级、0 级封底、
// 都城同规不失去 / 休整两回合:skipTurns=2 + resting 标记 / 休整期满回满)。
// 落格与随机无关:耗竭入口 exhaustIfDepleted 直调,种子只影响无关路径。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import { createDice } from "@core/dice";
import { fullDefenseOf } from "@core/defense";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  });
}

/** 给 seat 一座指定等级的房产(非都城):从棋盘捡一座无主普通城的 catalog 信息。 */
function giveProperty(e: GameEngine, seat: number, level: number): string {
  const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const tile = MAP.board.tiles.find(
    (t) => t.event == null && t.propertyId && !taken.has(t.propertyId),
  )!;
  const def = MAP.catalog.get(tile.propertyId)!;
  e.players[seat].properties.push({
    propertyId: def.id,
    group: def.group,
    level,
    maxLevel: def.maxLevel,
    defense: fullDefenseOf(level),
  });
  return def.id;
}

/** 把 seat 的都城房产取出(测试都城规则用)。 */
function capitalHolding(e: GameEngine, seat: number) {
  const p = e.players[seat];
  const capitalPropId = MAP.board.tiles[p.capitalIndex].propertyId;
  return p.properties.find((h) => h.propertyId === capitalPropId)!;
}

describe("体力字段(#131)", () => {
  it("所有 Seat 初值 100", () => {
    const e = makeEngine();
    for (const p of e.players) expect(p.stamina).toBe(100);
  });

  it("addStamina 夹紧 [0,100]:回血溢出作废、扣减到负按 0", () => {
    const e = makeEngine();
    e.addStamina(0, 30); // 溢出作废
    expect(e.players[0].stamina).toBe(100);
    e.addStamina(0, -30);
    expect(e.players[0].stamina).toBe(70);
    e.addStamina(0, -200); // → 夹到 0
    expect(e.players[0].stamina).toBe(0);
  });
});

describe("耗竭全自动结算(#131):外敌乘虚+休整", () => {
  it("诸城各降 1 级(含都城):多座齐降、skipTurns=2、resting 立、体力保持 0、endTurn 收尾", () => {
    const e = makeEngine();
    finishSetupLite(e);
    const p1 = giveProperty(e, 0, 2);
    const p2 = giveProperty(e, 0, 1);
    const cap = capitalHolding(e, 0);
    cap.level = 3; // 都城同规:可降
    e.players[0].stamina = 0;
    const r = e.exhaustIfDepleted(0);
    expect(r).toBe("resolved"); // 全自动,无相位
    expect(e.turnPhase).toBe("Roll"); // endTurn 已收尾(空手牌 → 无出牌阶段)
    expect(e.players[0].properties.find((h) => h.propertyId === p1)!.level).toBe(1); // 2→1
    expect(e.players[0].properties.find((h) => h.propertyId === p2)!.level).toBe(0); // 1→0 封底
    expect(capitalHolding(e, 0).level).toBe(2); // 都城 3→2
    expect(e.players[0].skipTurns).toBe(2); // 休整两回合
    expect(e.players[0].resting).toBe(true);
    expect(e.players[0].stamina).toBe(0); // 归 0 当刻不回血,卧床状态可见
    // 事件面:降级清单=全部实降城(都城+两座陪衬城,遍历序随持有表),restTurns=2 显式走
    const ev = e.gameEvents.find((x) => x.kind === "exhaustionResolved");
    expect(ev).toBeTruthy();
    expect(
      ev && ev.kind === "exhaustionResolved" ? [...ev.downgradedPropertyIds].sort() : null,
    ).toEqual([p1, p2, cap.propertyId].sort());
    expect(ev && ev.kind === "exhaustionResolved" ? ev.restTurns : null).toBe(2);
  });

  it("0 级封底:全 0 级 → 纯休整,城池一件不失去、无降级记录", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 0);
    const cap = capitalHolding(e, 0);
    cap.level = 0;
    e.players[0].stamina = 0;
    expect(e.exhaustIfDepleted(0)).toBe("resolved");
    expect(e.players[0].properties.length).toBe(2); // 一件不失去
    expect(capitalHolding(e, 0).level).toBe(0);
    const ev = e.gameEvents.find((x) => x.kind === "exhaustionResolved");
    expect(ev && ev.kind === "exhaustionResolved" ? ev.downgradedPropertyIds : null).toEqual([]); // 清单空
    expect(e.players[0].skipTurns).toBe(2);
  });

  it("无房产 → 纯休整(不进相位)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    e.players[0].properties = []; // 清掉都城:纯"一无所有"场景
    e.players[0].stamina = 0;
    expect(e.exhaustIfDepleted(0)).toBe("resolved");
    expect(e.players[0].skipTurns).toBe(2);
    expect(e.players[0].resting).toBe(true);
    expect(e.players[0].stamina).toBe(0);
    expect(e.players[0].properties.length).toBe(0);
  });

  it("休整期满回满:跳回合消费完 → 体力 100、resting 清、staminaChanged(reason=rest)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 2);
    e.players[0].stamina = 0;
    e.exhaustIfDepleted(0); // 内含 endTurn:活跃已让位下家
    expect(e.players[0].skipTurns).toBe(2);
    e.endTurn(); // 下家回合毕 → 推进遇本人:跳 1(2→1)
    expect(e.players[0].skipTurns).toBe(1);
    expect(e.players[0].stamina).toBe(0); // 休整中不回血
    e.endTurn(); // 下家回合毕 → 再跳 1(1→0)= 休整期满
    expect(e.players[0].skipTurns).toBe(0);
    expect(e.players[0].resting).toBe(false);
    expect(e.players[0].stamina).toBe(100);
    const rest = e.gameEvents.find((x) => x.kind === "staminaChanged" && x.reason === "rest");
    expect(rest).toBeTruthy();
  });

  it("stamina>0 不触发:入口直调返回 none", () => {
    const e = makeEngine();
    finishSetupLite(e);
    e.players[0].stamina = 1;
    expect(e.exhaustIfDepleted(0)).toBe("none");
    expect(e.players[0].skipTurns).toBe(0);
    expect(e.players[0].resting).toBe(false);
  });
});

/** 轻量开局:只把相位推到 Playing(都城由 doDraftRoll 后的 aiSetup/手动定),不断言选都细节。 */
function finishSetupLite(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) e.aiSetupStep();
    else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 发牌时已入相位的话放行
}

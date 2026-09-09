// 体力系统单测(#131):初值/夹紧/耗竭三路径(多房产相位、全 0 级失去、无房产自动)/
// 惩罚结算(降级、失去变无主、skipTurns、重置 100)/都城规则(可降级、地板 0、不可失去)。
// 落格与随机无关:耗竭入口 exhaustIfDepleted 直调,种子只影响无关路径。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 7): GameEngine {
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
  });
}

/** 给 seat 一座指定等级的房产(非都城):从棋盘捡一座无主普通城的 catalog 信息。 */
function giveProperty(e: GameEngine, seat: number, level: number): string {
  const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  const tile = MAP.board.tiles.find(
    (t) => t.type === "Property" && t.propertyId && !taken.has(t.propertyId),
  )!;
  const def = MAP.catalog.get(tile.propertyId)!;
  e.players[seat].properties.push({
    propertyId: def.id,
    group: def.group,
    purchasePrice: def.buildCost,
    level,
    maxLevel: def.maxLevel,
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

describe("耗竭相位与惩罚(#131)", () => {
  it("多房产有等级 >0 → 进相位,选项=各房产降级", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 2);
    giveProperty(e, 0, 1);
    e.players[0].stamina = 0;
    const r = e.exhaustIfDepleted(0);
    expect(r).toBe("phase");
    expect(e.turnPhase).toBe("AwaitingExhaustion");
    const opts = e.choicesFor();
    expect(opts.length).toBe(2); // 两座非都城房产(都城 0 级不出现)
    expect(opts.every((o) => o.available)).toBe(true);
  });

  it("全部 0 级 → 失去选项,都城不可失去", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 0);
    giveProperty(e, 0, 0);
    e.players[0].stamina = 0;
    e.exhaustIfDepleted(0);
    expect(e.turnPhase).toBe("AwaitingExhaustion");
    const opts = e.choicesFor();
    expect(opts.length).toBe(2); // 两座非都城可失去,都城不在列
    // resolve:失去第一座 → 变无主
    const victimId = opts[0].holdingPropertyId!;
    e.resolveExhaustionChoice(0);
    expect(e.players[0].properties.some((h) => h.propertyId === victimId)).toBe(false);
    expect(e.findOwner(victimId)).toBeNull(); // 城回无主
  });

  it("惩罚结算:降 1 级 + skipTurns+1 + 体力重置 100", () => {
    const e = makeEngine();
    finishSetupLite(e);
    const propId = giveProperty(e, 0, 2);
    e.players[0].stamina = 0;
    e.exhaustIfDepleted(0);
    e.resolveExhaustionChoice(0); // 降第一座(唯一可用)
    const holding = e.players[0].properties.find((h) => h.propertyId === propId)!;
    expect(holding.level).toBe(1); // 2 → 1
    expect(e.players[0].skipTurns).toBe(1); // 跳过下一回合(复用现有机制)
    expect(e.players[0].stamina).toBe(100); // 重置
    expect(e.turnPhase).toBe("Roll"); // endTurn 收尾
  });

  it("单房产可用选项 ≤1 → 自动执行,不进相位", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 2); // 唯一房产 → 唯一选项
    e.players[0].stamina = 0;
    const r = e.exhaustIfDepleted(0);
    expect(r).toBe("auto");
    expect(e.turnPhase).not.toBe("AwaitingExhaustion");
    expect(e.players[0].skipTurns).toBe(1);
    expect(e.players[0].stamina).toBe(100);
  });

  it("无房产 → 惩罚降级为纯跳回合(不进相位)", () => {
    const e = makeEngine();
    finishSetupLite(e);
    e.players[0].properties = []; // 清掉都城:纯"一无所有"场景
    e.players[0].stamina = 0;
    const r = e.exhaustIfDepleted(0);
    expect(r).toBe("auto");
    expect(e.players[0].skipTurns).toBe(1);
    expect(e.players[0].stamina).toBe(100);
    expect(e.players[0].properties.length).toBe(0);
  });

  it("都城规则:可降级、地板 0 级、永不出现在失去选项", () => {
    const e = makeEngine();
    finishSetupLite(e);
    giveProperty(e, 0, 1); // 陪衬:保证可用选项 ≥2,不触发自动执行
    const cap = capitalHolding(e, 0);
    cap.level = 3; // 都城有等级 → 出现在降级选项
    e.players[0].stamina = 0;
    e.exhaustIfDepleted(0);
    const opts = e.choicesFor();
    expect(opts.length).toBe(2); // 都城(3 级)+ 陪衬(1 级)
    expect(opts.some((o) => o.holdingPropertyId === cap.propertyId)).toBe(true);
    expect(opts.every((o) => o.exhaustionKind !== "lose")).toBe(true); // 有可降级 → 无失去选项
    // resolve 都城降级:3 → 2(level>0 过滤天然保证地板 0)
    const capIdx = opts.findIndex((o) => o.holdingPropertyId === cap.propertyId);
    e.resolveExhaustionChoice(capIdx);
    expect(capitalHolding(e, 0).level).toBe(2);
    // 陪衬仍 >0 级:再次耗竭仍走降级选项(失去选项仅在全 0 级时出现)
    e.players[0].stamina = 0;
    expect(e.exhaustIfDepleted(0)).toBe("phase");
    expect(e.choicesFor().every((o) => o.exhaustionKind === "downgrade")).toBe(true);
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
  e.players.forEach((p) => { p.jinnangHand = []; p.jinnangHandCount = 0; }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 发牌时已入相位的话放行

}

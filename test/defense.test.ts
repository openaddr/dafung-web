// 防御值系统单测(#1387 T1 棒1):满值表与越界抛错 / 等级变动重置挂点(购入/扩军/公道
// 买卖成交/破产易主/火焰伤害降级)/ 火焰伤害结算单点(扣减→降级回满→失城、都城打空
// 即停+免疫、无主城抛错)/ 快照往返 / 种植件 setDefense / 外敌乘虚回归钉(不走防御值)。
// 只测外部行为(返回值+引擎状态),不镜像实现;布景一律走种植件(#1295)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { applyFireDamage, fullDefenseOf, resetToFull } from "@core/defense";
import { buy, upgrade, settleDebt } from "@core/economy";
import { createPlayer } from "@core/player";
import { serializeGame, restoreGameSnapshot } from "@core/snapshot";
import { applyPlant, grantProperty, setDefense, setStamina } from "@core/planter";
import { testEngine } from "@core/testing";
import { tileIndexOfProperty } from "@core/board";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 7, seats?: SeatConfig[]): GameEngine {
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

/** 驱动选都到入局(人类选三候选首项,bot 自动);放行开局发牌相位。 */
function finishSetup(e: GameEngine): void {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) e.aiSetupStep();
    else e.pickCapital(idx, e.offeredCapitals[0]!); // 候选外落子会被引擎拒绝
  }
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

/** seat 的都城 propertyId(入局后恒有)。 */
function capitalId(e: GameEngine, seat: number): string {
  return e.board.at(e.players[seat].capitalIndex).propertyId!;
}

/** 从棋盘捡一座无主普通城(非都城格)。 */
function freeCity(e: GameEngine, avoid: string[] = []): string {
  const taken = new Set(e.players.flatMap((p) => p.properties.map((h) => h.propertyId)));
  return MAP.board.tiles.find(
    (t) =>
      t.event == null && t.propertyId && !taken.has(t.propertyId) && !avoid.includes(t.propertyId),
  )!.propertyId!;
}

describe("满值表(0级5/1级4/2级3/3级2,按等级索引,#1386)", () => {
  it("fullDefenseOf 逐级 5/4/3/2;越界等级响亮抛错(零兜底)", () => {
    expect([0, 1, 2, 3].map(fullDefenseOf)).toEqual([5, 4, 3, 2]);
    expect(() => fullDefenseOf(4)).toThrow();
    expect(() => fullDefenseOf(-1)).toThrow();
  });

  it("resetToFull 对越界等级持有行响亮抛错(重置单口不回退)", () => {
    expect(() =>
      resetToFull({ propertyId: "x", group: "a", level: 4, maxLevel: 3, defense: 0 }),
    ).toThrow();
  });
});

describe("等级变动重置挂点(等级一变一律回满,升级回满=奖励)", () => {
  it("购入即满值;扩军升级回新等级满值(经济路径 buy/upgrade)", () => {
    const p = createPlayer({
      id: "p",
      name: "A",
      guohao: "魏",
      colorIndex: 0,
      isBot: false,
      startingCash: 100000,
    });
    const changan = MAP.catalog.get("prop-changan")!;
    buy(p, changan);
    expect(p.properties[0]!.defense).toBe(5); // 购入 Lv.0 → 满 5
    upgrade(p, changan);
    expect(p.properties[0]).toMatchObject({ level: 1, defense: 4 });
    upgrade(p, changan);
    upgrade(p, changan);
    expect(p.properties[0]).toMatchObject({ level: 3, defense: 2 });
  });

  it("建都即满值(入局后各都城防御 5)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    for (const p of e.players) {
      const h = p.properties.find((h) => h.propertyId === capitalId(e, e.players.indexOf(p)))!;
      expect(h.defense).toBe(5);
    }
  });

  it("grantProperty 拉级=等级变动,防御重置满值(种植件与生产同口径)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 2);
    expect(e.players[0].properties.find((h) => h.propertyId === pid)).toMatchObject({
      level: 2,
      defense: 3,
    });
    expect(() => grantProperty(e, 0, pid, 5)).toThrow(); // 越界等级在满值表处响亮抛错(种不出的状态不静默)
  });

  it("公道买卖成交升级回满(城主奖励挂点,treasure-flow 路径)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const mover = e.activePlayer;
    const ownerSeat = e.players.findIndex((p) => p !== mover);
    const owner = e.players[ownerSeat];
    const def = MAP.catalog.get("prop-luoyang")!;
    grantProperty(e, ownerSeat, "prop-luoyang", 0);
    owner.treasures.push({ id: "t0", name: "测试珍宝", level: 1, count: 1, desc: "" });
    e.treasureVisitor = { def, ownerIdx: ownerSeat };
    testEngine(e).forceTurnPhase("AwaitingTreasureOwner");
    e.resolveTreasureOwner({ type: "fair", treasureId: "t0" });
    expect(owner.properties.find((h) => h.propertyId === "prop-luoyang")).toMatchObject({
      level: 1,
      defense: 4, // 0→1 级回满
    });
  });

  it("破产转移=易主,防御重置新主名下满值(settleDebt 路径)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 2);
    setDefense(e, 0, pid, 1); // 受损态(否则重置不可观察)
    const debtor = e.players[0];
    const creditor = e.players[1];
    expect(settleDebt(debtor, creditor, debtor.cash + 1)).toBe(true);
    expect(creditor.properties.find((h) => h.propertyId === pid)).toMatchObject({
      level: 2,
      defense: 3, // 易主回满,跨主不带暗账
    });
  });
});

describe("火焰伤害结算单点 applyFireDamage(#1386 全局唯一)", () => {
  it("纯扣防:伤害被吸收返回 absorbed,防御逐点递减、未归零不降级", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 2); // Lv2 满防 3
    const r = applyFireDamage(e, e.players[0], pid, 1);
    expect(r).toEqual({
      kind: "absorbed",
      propertyId: pid,
      tileIndex: tileIndexOfProperty(MAP.board, pid),
    });
    expect(e.players[0].properties.find((h) => h.propertyId === pid)).toMatchObject({
      level: 2,
      defense: 2,
    });
  });

  it("归零降级回满、剩余点数继续扣新防(demolished);随后 0 级归零失城回无主(lost)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 1); // Lv1 满防 4
    const r = applyFireDamage(e, e.players[0], pid, 6);
    expect(r.kind).toBe("demolished");
    const held = e.players[0].properties.find((h) => h.propertyId === pid)!;
    expect(held).toMatchObject({ level: 0, defense: 3 }); // 4 点破防→降 0 级回满 5→余 2 点扣到 3
    const r2 = applyFireDamage(e, e.players[0], pid, 3);
    expect(r2.kind).toBe("lost");
    expect(e.findOwner(pid)).toBeNull(); // 失城回无主
    expect(e.players[0].properties.some((h) => h.propertyId === pid)).toBe(false);
    const trace = e.propertyChanges.at(-1)!;
    expect(trace).toMatchObject({
      tileIndex: tileIndexOfProperty(MAP.board, pid),
      level: 0,
      ownerColorIndex: null,
      levelChanged: false,
      ownerChanged: true,
    }); // 失城留痕(ADR-0015,写法对照 demolishOnVictim)
  });

  it("0 级都城打空即停:打空那发 absorbed,此后对一切火焰伤害免疫、持仓恒在", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = capitalId(e, 0);
    const p = e.players[0];
    expect(applyFireDamage(e, p, pid, 4)).toMatchObject({ kind: "absorbed" }); // 5→1
    expect(applyFireDamage(e, p, pid, 1)).toMatchObject({ kind: "absorbed" }); // 打空(打空不是降级也不是失城)
    expect(p.properties.find((h) => h.propertyId === pid)).toMatchObject({ level: 0, defense: 0 });
    expect(applyFireDamage(e, p, pid, 5)).toMatchObject({ kind: "absorbed" }); // 免疫:剩余点数作废
    expect(p.properties.find((h) => h.propertyId === pid)).toMatchObject({ level: 0, defense: 0 });
    expect(e.findOwner(pid)).toBe(p); // 都城不可失
  });

  it("无主城传入即响亮抛错(零兜底:调用侧必须先解析城主)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    expect(() => applyFireDamage(e, e.players[0], pid, 1)).toThrow();
  });
});

describe("外敌乘虚回归钉(直接降级,不走防御值,#1386 显式两分)", () => {
  it("耗竭降级后防御原样保留(不重置),0 级封底", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 1); // 满防 4
    setDefense(e, 0, pid, 2); // 受损态:若误接 resetToFull 此处必挂
    setStamina(e, 0, 0);
    expect(e.exhaustIfDepleted(0)).toBe("resolved");
    expect(e.players[0].properties.find((h) => h.propertyId === pid)).toMatchObject({
      level: 0, // 直接降级照旧
      defense: 2, // 防御值原样:外敌乘虚不 touch 防御
    });
    expect(e.players[0].properties.find((h) => h.propertyId === capitalId(e, 0))!.level).toBe(0); // 0 级封底
  });
});

describe("快照往返(联机/恢复一致)", () => {
  it("defense 入快照行,restore 原样回灌", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = freeCity(e);
    grantProperty(e, 0, pid, 1);
    setDefense(e, 0, pid, 2); // 非满值才证明往返的是字段本体而非派生
    const snap = serializeGame(e);
    const row = snap.players[0]!.properties.find((h) => h.propertyId === pid)!;
    expect(row.defense).toBe(2);
    const e2 = makeEngine(7);
    restoreGameSnapshot(e2, snap);
    expect(e2.players[0].properties.find((h) => h.propertyId === pid)).toMatchObject({
      level: 1,
      defense: 2,
    });
  });
});

describe("种植件 setDefense(布景防御值)", () => {
  it("applyPlant 分发:直写终态;未持有城当场炸(无主城无防御值)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const pid = capitalId(e, 0);
    applyPlant(e, { kind: "setDefense", seat: 0, propertyId: pid, defense: 1 });
    expect(e.players[0].properties.find((h) => h.propertyId === pid)!.defense).toBe(1);
    expect(() =>
      applyPlant(e, { kind: "setDefense", seat: 0, propertyId: freeCity(e), defense: 1 }),
    ).toThrow();
    expect(() => setDefense(e, 9, pid, 1)).toThrow();
  });
});

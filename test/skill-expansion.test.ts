// 技能扩展包现役名将技能池、效果注册与引擎结算。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type { EngineConfig, SeatConfig } from "@dafung/core/engine/authority";
import { createDice, type Dice } from "@dafung/core/engine/dice";
import { HEROES } from "@dafung/core/engine/heroes";
import { isTriggerSkill, skillById } from "@dafung/core/engine/skills";
import { EFFECTS } from "@dafung/core/engine/effects";
import { MOMENTS } from "@dafung/core/engine/timing";
import { armHero } from "@dafung/core/engine/testing";
import guanzhongData from "../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";

const MAP = loadMap(guanzhongData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
];
const SEATS3: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
  { name: "C", isBot: false, guohao: "吴" },
];

function makeEngine(seed = 42, seats: SeatConfig[] = SEATS2): GameEngine {
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 驱动选都到完成(人类选第一个空城)= finishSetup 真实路径;全员手牌清空(锦囊相位
 *  inert, reaction 窗不被暗牌误开)。 */
function finishSetup(e: GameEngine) {
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
  });
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
}

function prepared(seed?: number, seats?: SeatConfig[]) {
  const e = makeEngine(seed, seats);
  finishSetup(e);
  return e;
}

/** 扩展包现役技能。 */
const NEW_IDS = [
  "delongwangshu",
  "yusui",
  "shengougolei",
  "taoguangyanghui",
  "chubianbujing",
  "suifeng",
] as const;

/** 按名将 id 查定义(查无 = 数据 bug,炸出——测试布场不走兜底)。 */
function heroDef(id: string) {
  const hero = HEROES.find((h) => h.id === id);
  if (hero == null) throw new Error(`测试布场:名将 ${id} 不在 HEROES(数据 bug)`);
  return hero;
}

/** 给 seat 布一槽只授 skillId 一技的名将(实将入槽,防招贤池/骰流干扰)。 */
function arm(e: GameEngine, seat: number, heroId: string, skillId: string) {
  armHero(e, e.players[seat], heroDef(heroId), [skillId]);
}

// ── 行军走廊(关中环位,同 test/reaction-window.test.ts 口径)──
const AT = (pid: string) => MAP.board.tiles.find((t) => t.propertyId === pid)!.index;
const START = AT("prop-jieting"); // 街亭 P14:走廊起点
const LAND = AT("prop-liangzhou"); // 凉州 P16:骰 2 落点

/** 骰子替身(readonly 只挡编译,测试注入走断言,同 reaction-window scriptDice 口径)。 */
function scriptDice(e: GameEngine, die: number) {
  const dice: Dice = {
    roll: () => ({ die }),
    rollDie: () => die,
    nextFloat: () => 0.99,
    getRngState: () => 0,
    setRngState: () => {},
  };
  (e as unknown as { dice: Dice }).dice = dice;
}

/** 走廊布场:全员让出三格房产、双方都城挪出路径、mover 摆到街亭、置骰。 */
function marchCorridor(e: GameEngine, moverSeat: number, die: number) {
  const pathProps = ["prop-jieting", "prop-xianyang", "prop-liangzhou"];
  for (const p of e.players) {
    p.properties = p.properties.filter((h) => !pathProps.includes(h.propertyId));
  }
  e.players[moverSeat].capitalIndex = AT("prop-changan");
  for (let i = 0; i < e.players.length; i++) {
    if (i !== moverSeat) e.players[i].capitalIndex = AT("prop-liaodong");
  }
  e.players[moverSeat].position = START;
  e.turnPhase = "Roll";
  scriptDice(e, die);
}

/** 给 seat 一座非都城房产(城主布场;等级不参与本包任一判定)。 */
function grantCity(e: GameEngine, seat: number, propertyId: string) {
  e.players[seat].properties.push({
    burning: null,
    damageRanking: [],
    propertyId,
    group: "a",
    level: 3,
    maxLevel: 4,
    defense: 20,
  });
}

describe("技能扩展内容包:数据形制(#1145)", () => {
  it("全表逐字钉:内置将 5→9(四新将入表;含 #1142 卧龙,#1378 曹丕池换血,#1390 周瑜池换血)", () => {
    expect(HEROES.map((h) => [h.id, h.skillPool])).toEqual([
      ["zhouyu", ["yingzi", "huogong"]], // 周瑜{英姿,火攻}(#1390 池换血:疾行/擂鼓移出,技能本体保留)
      ["caopi", ["fangzhu", "xingshang"]], // 曹丕{放逐,行殇}(#1378 池换血)
      ["zhangxingcai", ["zhijin", "leigu", "jixing"]], // 张星彩{掷金,擂鼓,疾行}
      ["huatuo", ["qingnang", "zhenji"]], // 华佗{青囊,赈济}
      ["zhugeliang", ["huogong", "yuli"]], // 诸葛亮{火攻,渔利}(池 2 仿华佗非对称,#1142)
      ["simayi", ["taoguangyanghui", "suifeng"]],
      ["dengai", ["suifeng", "chubianbujing"]],
      ["caoren", ["shengougolei"]],
      ["mizhu", ["delongwangshu", "yusui"]],
    ]);
  });

  it("技属主集钉:共享两条(火攻/岁俸,#1390 后疾行/擂鼓改张星彩单属)+ 静态被动英姿/放逐/行殇单属主", () => {
    const owners = (id: string) =>
      HEROES.filter((h) => h.skillPool.includes(id))
        .map((h) => h.id)
        .sort();
    expect(owners("jixing")).toEqual(["zhangxingcai"]); // 疾行:张星彩单属(#1390 周瑜出池,本体保留)
    expect(owners("leigu")).toEqual(["zhangxingcai"]); // 擂鼓:张星彩单属(#1390 周瑜出池,本体保留)
    expect(owners("zhijin")).toEqual(["zhangxingcai"]); // 掷金:张星彩单属(#1378 曹丕出池)
    expect(owners("suifeng")).toEqual(["dengai", "simayi"]); // 岁俸:司马懿↔邓艾
    expect(owners("huogong")).toEqual(["zhouyu", "zhugeliang"]); // 火攻:周瑜↔诸葛亮(#1142)
    expect(owners("yuli")).toEqual(["zhugeliang"]); // 渔利:诸葛亮单属(#1378 曹丕出池)
    expect(owners("yingzi")).toEqual(["zhouyu"]); // 英姿:周瑜独占(#1390 周瑜重做)
    expect(owners("fangzhu")).toEqual(["caopi"]); // 放逐/行殇:曹丕独占(#1378 换血)
    expect(owners("xingshang")).toEqual(["caopi"]);
    for (const single of ["qingnang", "zhenji", ...NEW_IDS.filter((id) => id !== "suifeng")]) {
      expect(owners(single), `${single} 应单属主`).toHaveLength(1);
    }
  });

  it("现役技能形制(#1145 表逐行:id×时机×效果×初值×scope,终稿形制)", () => {
    const rows = NEW_IDS.map((id) => {
      const s = skillById(id);
      if (!isTriggerSkill(s)) throw new Error(`${id} 应为被动技(数据 bug)`);
      return [s.id, s.when, s.effect, s.params, s.scope ?? "self"];
    });
    expect(rows).toEqual([
      ["delongwangshu", "TreasureGained", "gainCash", { amount: 100 }, "self"],
      ["yusui", "TreasureLost", "gainCash", { amount: 80 }, "self"],
      ["shengougolei", "MarchPassedCity", "cashOnOwnCityPassed", { amount: 20 }, "any"],
      ["taoguangyanghui", "TurnSkipImposed", "gainCash", { amount: 100 }, "self"],
      ["chubianbujing", "JinnangAnnounced", "cashIfTargetedByJinnang", { amount: 10 }, "others"],
      ["suifeng", "TurnStart", "gainCash", { amount: 1 }, "any"],
    ]);
  });

  it("时机/效果对号:扩展技 when 皆在 MOMENTS 注册表、effect 皆在 EFFECTS 注册表(零新时机)", () => {
    for (const id of NEW_IDS) {
      const s = skillById(id);
      if (!isTriggerSkill(s)) throw new Error(`${id} 应为被动技(数据 bug)`);
      expect(MOMENTS).toContain(s.when);
      expect(typeof EFFECTS[s.effect]).toBe("function");
    }
  });

  it("两个扩展效果入注册表;得陇/玉碎/韬光/岁俸四技纯参数复用 gainCash 零新 fn", () => {
    for (const fn of ["cashOnOwnCityPassed", "cashIfTargetedByJinnang"]) {
      expect(typeof EFFECTS[fn]).toBe("function");
    }
    for (const id of ["delongwangshu", "yusui", "taoguangyanghui", "suifeng"]) {
      const s = skillById(id);
      if (!isTriggerSkill(s)) throw new Error(`${id} 应为被动技(数据 bug)`);
      expect(s.effect).toBe("gainCash");
    }
  });
});

describe("技能扩展内容包:引擎行为(命中/不命中/数值/受益人)", () => {
  it("得陇望蜀:得宝 +100 两;他人得宝不触发(scope self)", () => {
    const e = prepared();
    const meSeat = e.players.indexOf(e.activePlayer);
    arm(e, meSeat, "mizhu", "delongwangshu");
    const cash0 = e.players[meSeat].cash;
    e.dispatchMoment("TreasureGained", { subject: meSeat, treasureId: "t1" });
    expect(e.players[meSeat].cash).toBe(cash0 + 100);
    e.dispatchMoment("TreasureGained", {
      subject: (meSeat + 1) % e.players.length,
      treasureId: "t1",
    });
    expect(e.players[meSeat].cash).toBe(cash0 + 100);
  });

  it("玉碎:失宝 +80 两;他人失宝不触发(scope self)", () => {
    const e = prepared();
    const meSeat = e.players.indexOf(e.activePlayer);
    arm(e, meSeat, "mizhu", "yusui");
    const cash0 = e.players[meSeat].cash;
    e.dispatchMoment("TreasureLost", { subject: meSeat, treasureId: "t1" });
    expect(e.players[meSeat].cash).toBe(cash0 + 80);
    e.dispatchMoment("TreasureLost", {
      subject: (meSeat + 1) % e.players.length,
      treasureId: "t1",
    });
    expect(e.players[meSeat].cash).toBe(cash0 + 80);
  });

  it("深沟高垒:他人途经你城不停留 +20 两(受益人=城主);落点即你城不算;途经他人城不触发", () => {
    // 命中:骰 2 街亭 → 途经咸阳 → 落凉州(MarchPassedCity 真实派发点)
    const e = prepared();
    const moverSeat = e.players.indexOf(e.activePlayer);
    const holderSeat = (moverSeat + 1) % e.players.length;
    arm(e, holderSeat, "caoren", "shengougolei");
    marchCorridor(e, moverSeat, 2);
    grantCity(e, holderSeat, "prop-xianyang");
    const cash0 = e.players[holderSeat].cash;
    e.rollAndMove();
    expect(e.players[moverSeat].position).toBe(LAND); // 不停留
    expect(e.players[holderSeat].cash).toBe(cash0 + 20);
    // 不命中一:落点即城主城(骰 1)——落点格引擎不派 MarchPassedCity
    const e2 = prepared();
    const mover2 = e2.players.indexOf(e2.activePlayer);
    const holder2 = (mover2 + 1) % e2.players.length;
    arm(e2, holder2, "caoren", "shengougolei");
    marchCorridor(e2, mover2, 1);
    grantCity(e2, holder2, "prop-xianyang");
    const cash2 = e2.players[holder2].cash;
    e2.rollAndMove();
    expect(e2.players[holder2].cash).toBe(cash2);
    // 不命中二:途经的是第三方之城
    const e3 = prepared(42, SEATS3);
    const mover3 = e3.players.indexOf(e3.activePlayer);
    const holder3 = (mover3 + 1) % 3;
    const third3 = (mover3 + 2) % 3;
    arm(e3, holder3, "caoren", "shengougolei");
    marchCorridor(e3, mover3, 2);
    grantCity(e3, third3, "prop-xianyang");
    const cash3 = e3.players[holder3].cash;
    e3.rollAndMove();
    expect(e3.players[holder3].cash).toBe(cash3);
  });

  it("处变不惊+韬光养晦(缓兵之计真实链):被他人锦囊指向 +10、被强加跳回合 +100;指向他人则两技皆不触发", () => {
    // 命中:出牌者对持技者出缓兵之计——宣布(JinnangAnnounced)与执行(TurnSkipImposed)双派发点
    const e = prepared();
    const casterSeat = e.players.indexOf(e.activePlayer);
    const victimSeat = (casterSeat + 1) % e.players.length;
    arm(e, victimSeat, "dengai", "chubianbujing");
    arm(e, victimSeat, "simayi", "taoguangyanghui"); // 第二槽:两技同人
    const caster = e.players[casterSeat];
    caster.jinnangHand = ["缓兵之计"];
    caster.jinnangHandCount = 1;
    e.turnPhase = "AwaitingJinnang";
    const cash0 = e.players[victimSeat].cash;
    e.resolveJinnang("缓兵之计"); // 入目标段
    e.resolveJinnang("缓兵之计", [victimSeat]); // 宣布 + 结算
    expect(e.players[victimSeat].skipTurns).toBe(1);
    expect(e.players[victimSeat].cash).toBe(cash0 + 10 + 100);
    // 不命中:同计指向第三人(无人持技)
    const e3 = prepared(42, SEATS3);
    const caster3 = e3.players.indexOf(e3.activePlayer);
    const holder3 = (caster3 + 1) % 3;
    const third3 = (caster3 + 2) % 3;
    arm(e3, holder3, "dengai", "chubianbujing");
    arm(e3, holder3, "simayi", "taoguangyanghui");
    const casterP = e3.players[caster3];
    casterP.jinnangHand = ["缓兵之计"];
    casterP.jinnangHandCount = 1;
    e3.turnPhase = "AwaitingJinnang";
    const cash3 = e3.players[holder3].cash;
    e3.resolveJinnang("缓兵之计");
    e3.resolveJinnang("缓兵之计", [third3]);
    expect(e3.players[holder3].cash).toBe(cash3); // 未被指向(scope others+targetSeats 双条件)
  });

  it("岁俸:每个回合开始 +1 两(scope any,含他人回合);真实 endTurn 派发点逐回合逐两", () => {
    const e = prepared();
    const activeSeat = e.players.indexOf(e.activePlayer);
    const holderSeat = (activeSeat + 1) % e.players.length;
    arm(e, holderSeat, "mizhu", "suifeng");
    const cash0 = e.players[holderSeat].cash;
    e.endTurn(); // 活跃(他人)回合收尾 → 下一位 TurnStart
    expect(e.players[holderSeat].cash).toBe(cash0 + 1); // 他人回合开始也 +1
    const cash1 = e.players[holderSeat].cash;
    e.endTurn(); // 再收一回合(轮到持技者之后的 TurnStart,主体轮换)
    expect(e.players[holderSeat].cash).toBe(cash1 + 1);
  });
});

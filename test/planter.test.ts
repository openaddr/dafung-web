// 种植件行为面单测(#1298,#1295 Testing Decisions):数值种下后快照与派生量正确——
// 塞牌后手牌=指定牌集、jinnangHandCount 派生一致、目录外牌/坏座位/未知指令当场炸
// (零兜底)。判词单源 src/core/planter.ts 头注;桥/e2e 经同一实现分发(#1298 三层共用)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig } from "@core/authority";
import { createDice } from "@core/dice";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import {
  applyPlant,
  giveJinnang,
  giveTreasure,
  setCash,
  setReputation,
  setStamina,
  type PlantOp,
} from "@core/planter";

const MAP = loadMap(guanzhongData);

function makeEngine(seed = 1) {
  const cfg: EngineConfig = {
    seats: [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

describe("giveJinnang(塞指定锦囊,裸写形)", () => {
  it("手牌终态=指定牌集(多张与重复牌原样保留),jinnangHandCount 派生一致", () => {
    const e = makeEngine();
    giveJinnang(e, 0, ["火烧连营", "识破诡计", "识破诡计"]);
    expect(e.players[0].jinnangHand).toEqual(["火烧连营", "识破诡计", "识破诡计"]);
    expect(e.players[0].jinnangHandCount).toBe(3);
  });

  it("空牌集=清空手牌(peek 空手目标形)", () => {
    const e = makeEngine();
    giveJinnang(e, 1, ["求贤令"]);
    giveJinnang(e, 1, []);
    expect(e.players[1].jinnangHand).toEqual([]);
    expect(e.players[1].jinnangHandCount).toBe(0);
  });

  it("目录外牌与越界座位当场炸(零兜底:种错的场要响,不静默长出死牌)", () => {
    const e = makeEngine();
    expect(() => giveJinnang(e, 0, ["不是牌"])).toThrow();
    expect(() => giveJinnang(e, 9, ["求贤令"])).toThrow();
  });
});

describe("giveTreasure(塞指定珍宝,裸写形)", () => {
  it("终态替换=指定宝集(非追加):目录外虚构 id 原样入位(计数位被测面的合法素材,#521 画心回查炸点在被测渲染路径)", () => {
    const e = makeEngine();
    giveTreasure(e, 0, [{ id: "gem-1", name: "夜明珠", level: 5 }]); // 站点同款虚构珍宝
    expect(e.players[0].treasures).toEqual([{ id: "gem-1", name: "夜明珠", level: 5 }]);
    giveTreasure(e, 0, [
      { id: "seal", name: "传国玉玺", level: 3 },
      { id: "hat", name: "草帽", level: 1 },
    ]);
    expect(e.players[0].treasures).toEqual([
      { id: "seal", name: "传国玉玺", level: 3 },
      { id: "hat", name: "草帽", level: 1 },
    ]);
  });

  it("越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => giveTreasure(e, 9, [{ id: "seal", name: "传国玉玺", level: 3 }])).toThrow();
  });
});

describe("setCash(改现金,裸写形)", () => {
  it("现金终态=指定值(直写,零结算副作用;身价等派生量活算无存储字段,零重灌)", () => {
    const e = makeEngine();
    setCash(e, 0, 20000);
    expect(e.players[0].cash).toBe(20000);
    setCash(e, 1, 5000);
    expect(e.players[1].cash).toBe(5000);
  });

  it("越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => setCash(e, 9, 1)).toThrow();
  });
});

describe("setReputation/setStamina(声望/体力,薄包公共方法)", () => {
  it("对外绝对值语义=终态精确可达:内部 delta 换算走 addReputation/addStamina 唯一写口(声望无夹紧 #1090;体力夹紧 0~100 随公共口,超界种值落夹紧终态)", () => {
    const e = makeEngine();
    setReputation(e, 1, 210); // warlords 概率条极端形
    expect(e.players[1].reputation).toBe(210);
    setReputation(e, 0, 0); // 自机钉零(自机声望非零后归零同样精确)
    expect(e.players[0].reputation).toBe(0);
    setStamina(e, 0, 50); // self-target 半体力形(满 100 起)
    expect(e.players[0].stamina).toBe(50);
    setStamina(e, 0, 20); // 中途改钉(非零起点 delta 换算)
    expect(e.players[0].stamina).toBe(20);
    setStamina(e, 1, 150); // 夹紧上界
    expect(e.players[1].stamina).toBe(100);
    setStamina(e, 1, -5); // 夹紧下界
    expect(e.players[1].stamina).toBe(0);
  });

  it("越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => setReputation(e, 9, 1)).toThrow();
    expect(() => setStamina(e, 9, 1)).toThrow();
  });
});

describe("applyPlant(桥 plant(op) 分发单源)", () => {
  it("giveJinnang 指令与直呼同一实现(终态逐位一致)", () => {
    const a = makeEngine();
    const b = makeEngine();
    giveJinnang(a, 0, ["军情密探"]);
    const op: PlantOp = { kind: "giveJinnang", seat: 0, cards: ["军情密探"] };
    applyPlant(b, op);
    expect(b.players[0].jinnangHand).toEqual(a.players[0].jinnangHand);
    expect(b.players[0].jinnangHandCount).toBe(a.players[0].jinnangHandCount);
  });

  it("数值族指令(giveTreasure/setCash/setReputation/setStamina)与直呼同一实现", () => {
    const a = makeEngine();
    const b = makeEngine();
    giveTreasure(a, 1, [{ id: "gem-1", name: "夜明珠", level: 5 }]);
    setCash(a, 0, 20000);
    setReputation(a, 1, 210);
    setStamina(a, 0, 50);
    applyPlant(b, {
      kind: "giveTreasure",
      seat: 1,
      treasures: [{ id: "gem-1", name: "夜明珠", level: 5 }],
    });
    applyPlant(b, { kind: "setCash", seat: 0, cash: 20000 });
    applyPlant(b, { kind: "setReputation", seat: 1, reputation: 210 });
    applyPlant(b, { kind: "setStamina", seat: 0, stamina: 50 });
    expect(b.players[1].treasures).toEqual(a.players[1].treasures);
    expect(b.players[0].cash).toBe(a.players[0].cash);
    expect(b.players[1].reputation).toBe(a.players[1].reputation);
    expect(b.players[0].stamina).toBe(a.players[0].stamina);
  });

  it("未知 kind 当场炸(分发口不吞错)", () => {
    const e = makeEngine();
    expect(() => applyPlant(e, { kind: "noSuchFamily" } as never)).toThrow(/noSuchFamily/);
  });
});

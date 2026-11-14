// 种植件行为面单测(#1298/#1299/#1300,#1295 Testing Decisions):数值种下后快照与派生
// 量正确——塞牌后手牌=指定牌集、jinnangHandCount 派生一致、目录外牌/坏座位/未知指令
// 当场炸(零兜底)。判词单源 src/core/planter.ts 头注;桥/e2e 经同一实现分发(#1298
// 三层共用)。#1300 布景族四件(摆位/授房产/名将候选/牌堆源珍宝)同口径。
// #1302 确定性族两件同口径:钉骰后骰口按值序、耗尽自还原、种子 rng 不消耗、两注入口
// 不串队;合成行入日志与真行同 schema。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, EnginePhase, TurnPhase } from "@core/authority";
import { createDice } from "@core/dice";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";
import {
  applyPlant,
  armBankrupt,
  armDebt,
  armGameOver,
  armHero,
  armHeroOffer,
  armLanding,
  armPhase,
  armReaction,
  armVisitor,
  giveJinnang,
  giveTreasure,
  giveTreasureFromDeck,
  grantProperty,
  injectWarLog,
  pinDice,
  placePlayer,
  setBot,
  setCash,
  setJinnangUsedTags,
  setReputation,
  setStamina,
  type PlantOp,
} from "@core/planter";
import type { ReactionPayload, ReactionView } from "@core/reaction-window";
import { heroById } from "@core/heroes";
import { createTreasureDeck } from "@core/treasures";

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

describe("placePlayer(摆位布防,裸写形)", () => {
  it("终态摆位=position 绝对格位(拦检布防的「都城前一格」算式由测试侧读现值拼,种植件只收终态)", () => {
    const e = makeEngine();
    placePlayer(e, 1, 5);
    placePlayer(e, 0, e.board.count - 1); // 0 号格前一格=环序末格
    expect(e.players[1].position).toBe(5);
    expect(e.players[0].position).toBe(e.board.count - 1);
  });

  it("出盘面格位与越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => placePlayer(e, 0, e.board.count)).toThrow();
    expect(() => placePlayer(e, 0, -1)).toThrow();
    expect(() => placePlayer(e, 9, 0)).toThrow();
  });
});

describe("grantProperty(授房产/等级,裸写形)", () => {
  it("未持有=入册持有行(group/maxLevel 自城目录派生,行形状单源 PropertyHolding);已持有=改等级(upsert 同一终态语义两面)", () => {
    const e = makeEngine();
    const pid = e.board.at(3).propertyId!;
    grantProperty(e, 0, pid, 1);
    const def = e.catalog.get(pid)!;
    expect(e.players[0].properties).toEqual([
      { propertyId: pid, group: def.group, level: 1, maxLevel: def.maxLevel, defense: 4 },
    ]);
    grantProperty(e, 0, pid, 3); // 已持有=改等级(bot 城拉级/满级金框形态)
    expect(e.players[0].properties).toHaveLength(1);
    expect(e.players[0].properties[0]!.level).toBe(3);
  });

  it("目录外地块与越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => grantProperty(e, 0, "no-such-city", 1)).toThrow();
    expect(() => grantProperty(e, 9, e.board.at(3).propertyId!, 1)).toThrow();
  });
});

describe("armHero/armHeroOffer(名将/候选,裸写形;判词共一处)", () => {
  it("armHero=槽位行追加(skillIds 缺省=整池原序,显式=实授子集);armHeroOffer=候选终态整体替换(行=def+全池,行序=陈列序)", () => {
    const e = makeEngine();
    armHero(e, 0, "zhouyu"); // 缺省=整池原序(testing.ts armHero 同款签名)
    expect(e.players[0].heroes).toEqual([
      {
        heroId: "zhouyu",
        skillIds: [...heroById("zhouyu").skillPool],
        lastFired: {},
        marks: {}, // 技能标记容器(#1377):标记感知构造
      },
    ]);
    armHero(e, 1, "huatuo", ["qingnang"]); // 显式子集(实授只给主动技形,jinnang-use 站点)
    expect(e.players[1].heroes).toEqual([
      { heroId: "huatuo", skillIds: ["qingnang"], lastFired: {}, marks: {} },
    ]);
    armHeroOffer(e, ["zhouyu", "huatuo", "zhangxingcai"]);
    expect(e.offeredHeroes).toEqual(
      ["zhouyu", "huatuo", "zhangxingcai"].map((id) => ({
        def: heroById(id),
        skillIds: [...heroById(id).skillPool],
      })),
    );
  });

  it("目录外将与越界座位当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => armHero(e, 0, "no-such-hero")).toThrow();
    expect(() => armHero(e, 9, "zhouyu")).toThrow();
    expect(() => armHeroOffer(e, ["zhouyu", "no-such-hero"])).toThrow();
  });
});

describe("giveTreasureFromDeck(牌堆源珍宝,裸写形)", () => {
  it("终态=牌堆前 N 件真实例(def 字段全真实,按 def 现算的渲染面不画错);牌堆只读不收缩", () => {
    const e = makeEngine();
    e.treasureDeck = createTreasureDeck();
    const deckDepth = e.treasureDeck.length;
    giveTreasureFromDeck(e, 0, 3);
    expect(e.players[0].treasures).toEqual(e.treasureDeck.slice(0, 3));
    expect(e.treasureDeck).toHaveLength(deckDepth); // slice 非 splice:不扰对局抽珍宝面
    giveTreasureFromDeck(e, 0, 0); // 0 件=清空终态(与 giveTreasure 空集同款)
    expect(e.players[0].treasures).toEqual([]);
  });

  it("count 超牌堆深度与越界座位当场炸(零兜底:静默短发是掩盖)", () => {
    const e = makeEngine();
    e.treasureDeck = createTreasureDeck();
    expect(() => giveTreasureFromDeck(e, 0, e.treasureDeck.length + 1)).toThrow();
    expect(() => giveTreasureFromDeck(e, 9, 1)).toThrow();
  });
});

describe("armPhase(改相位/活跃方,裸写形)", () => {
  it("三字段按需选填直写:turnPhase+activeIndex 钉位(停车坪形)、单 activeIndex 亦达(钉 bot 行动方形)、未选填字段零触碰", () => {
    const e = makeEngine();
    expect(e.turnPhase).toBe("Roll"); // 出厂态:断言「钉了才变」
    armPhase(e, { turnPhase: "AwaitingDecision", activeIndex: 0 });
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.activeIndex).toBe(0);
    armPhase(e, { activeIndex: 1 }); // 单字段补丁(他人回合沿驱动形)
    expect(e.activeIndex).toBe(1);
    expect(e.turnPhase).toBe("AwaitingDecision");
    armPhase(e, { phase: "Playing" });
    expect(e.phase).toBe("Playing");
  });

  it("未知相位/越界座位/空补丁当场炸(零兜底:op 过桥是无类型 JSON,种错的场要响)", () => {
    const e = makeEngine();
    expect(() => armPhase(e, { turnPhase: "AwaitingDecsion" as TurnPhase })).toThrow();
    expect(() => armPhase(e, { phase: "Plyaing" as EnginePhase })).toThrow();
    expect(() => armPhase(e, { activeIndex: 9 })).toThrow();
    expect(() => armPhase(e, {})).toThrow(); // 空补丁=种了个寂寞
  });
});

describe("armBankrupt/armDebt/armGameOver(破产终局族,裸写形;判词共一处)", () => {
  it("破产印=isBankrupt 置位;挂债窗=pendingDebt+AwaitingBankruptcySettle 一体(creditor 座位解析成 Player 引用);终局=isOver+winner+GameOver 一体", () => {
    const e = makeEngine();
    armBankrupt(e, 1);
    expect(e.players[1].isBankrupt).toBe(true);
    armDebt(e, 99999, null);
    expect(e.pendingDebt).toEqual({ amount: 99999, creditor: null });
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    armDebt(e, 1500, 1);
    expect(e.pendingDebt).toEqual({ amount: 1500, creditor: e.players[1] });
    armGameOver(e, 0);
    expect(e.isOver).toBe(true);
    expect(e.winner).toBe(e.players[0]);
    expect(e.phase).toBe("GameOver");
  });

  it("越界座位(破产印/creditor/终局胜者)当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    expect(() => armBankrupt(e, 9)).toThrow();
    expect(() => armDebt(e, 100, 9)).toThrow();
    expect(() => armGameOver(e, 9)).toThrow();
  });
});

describe("armReaction(挂反应载荷,裸写形)", () => {
  it("pendingReaction 与 openReactionWindow 产物同构:seq=jinnangSeq 自增取号、answers 恒空、turnPhase=AwaitingReaction 同拍;二窗单调再取号", () => {
    const e = makeEngine();
    const view: ReactionView = {
      kind: "jinnang",
      cardId: "火烧连营",
      userSeat: 1,
      targetSeats: [0],
      queriedBySeat: [0],
      windowMs: 30000,
    };
    const payload: ReactionPayload = {
      kind: "jinnang",
      userSeat: 1,
      cardId: "火烧连营",
      targets: [0],
    };
    armReaction(e, view, payload);
    expect(e.jinnangSeq).toBe(1);
    expect(e.pendingReaction).toEqual({ seq: 1, view, answers: [], payload });
    expect(e.turnPhase).toBe("AwaitingReaction");
    armReaction(e, view, payload);
    expect(e.pendingReaction!.seq).toBe(2);
  });

  it("view 公开面越界当场炸(使用者座位/城指向域城份格/被询问座位;#1389 城指向域 targetSeats 走棋盘界)", () => {
    const e = makeEngine();
    const badUser: ReactionView = {
      kind: "jinnang",
      cardId: "火烧连营",
      userSeat: 9,
      targetSeats: [0],
      queriedBySeat: [0],
      windowMs: 1000,
    };
    expect(() =>
      armReaction(e, badUser, {
        kind: "jinnang",
        userSeat: 1,
        cardId: "火烧连营",
        targets: [0],
      }),
    ).toThrow();
    const badTarget: ReactionView = {
      kind: "jinnang",
      cardId: "火烧连营",
      userSeat: 1,
      targetSeats: [28], // 城指向域(#1389):关中图 28 格,[28]=城份格越界,响亮炸
      queriedBySeat: [0],
      windowMs: 1000,
    };
    expect(() =>
      armReaction(e, badTarget, {
        kind: "jinnang",
        userSeat: 1,
        cardId: "火烧连营",
        targets: [0],
      }),
    ).toThrow();
  });
});

describe("armLanding/armVisitor(落格投影+交涉挂起载荷,裸写形;#1303)", () => {
  it("PropertyAvailable=两字段一体置值(def 目录现查、无主前提);清形=双字段一体置 null(停车坪空闲态)", () => {
    const e = makeEngine();
    const pid = e.board.tiles.find(
      (t) => t.propertyId && e.findOwner(t.propertyId) == null,
    )!.propertyId!;
    armLanding(e, { kind: "PropertyAvailable", propertyId: pid });
    expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: pid });
    expect(e.lastLandOutcome).toEqual({
      kind: "PropertyAvailable",
      property: e.catalog.get(pid)!,
    });
    armLanding(e, null); // 清投影(决策卷轴不遮顶栏的空闲态,八站多数派)
    expect(e.pendingLand).toBeNull();
    expect(e.lastLandOutcome).toBeNull();
  });

  it("OwnProperty=owner 按持有关系解析(与生产 settleMarchLanding 同源),两字段同拍配套", () => {
    const e = makeEngine();
    const pid = e.board.tiles.find(
      (t) => t.propertyId && e.findOwner(t.propertyId) == null,
    )!.propertyId!;
    grantProperty(e, 0, pid, 1);
    armLanding(e, { kind: "OwnProperty", propertyId: pid });
    expect(e.pendingLand).toEqual({ kind: "OwnProperty", propertyId: pid });
    expect(e.lastLandOutcome).toEqual({
      kind: "OwnProperty",
      property: e.catalog.get(pid)!,
      owner: e.players[0],
    });
  });

  it("形制与归属矛盾/目录外地块当场炸(零兜底:种错的场要响)", () => {
    const e = makeEngine();
    const pid = e.board.tiles.find(
      (t) => t.propertyId && e.findOwner(t.propertyId) == null,
    )!.propertyId!;
    expect(() => armLanding(e, { kind: "OwnProperty", propertyId: pid })).toThrow(); // 无主却种己城形
    grantProperty(e, 0, pid, 0);
    expect(() => armLanding(e, { kind: "PropertyAvailable", propertyId: pid })).toThrow(); // 有主却种可购形
    expect(() =>
      armLanding(e, { kind: "PropertyAvailable", propertyId: "no-such-city" }),
    ).toThrow();
  });

  it("armVisitor=treasureVisitor 与引擎挂点产物同构(def 目录现查+ownerIdx 座位号);目录外与越界座位当场炸", () => {
    const e = makeEngine();
    const pid = e.board.at(3).propertyId!;
    armVisitor(e, pid, 0);
    expect(e.treasureVisitor).toEqual({ def: e.catalog.get(pid)!, ownerIdx: 0 });
    expect(() => armVisitor(e, "no-such-city", 0)).toThrow();
    expect(() => armVisitor(e, pid, 9)).toThrow();
  });
});

describe("pinDice(钉骰子,测试替身)", () => {
  it("行程口:行军按值序(rollAndMove 首骰=钉值)", () => {
    const e = makeEngine(7);
    armPhase(e, { phase: "Playing", turnPhase: "Roll", activeIndex: 0 });
    pinDice(e, "march", [3]);
    e.rollAndMove(); // 行程骰吃 march 口钉值 3(无拦检/驻跸:出生位起步直落)
    expect(e.players[0].position).toBe(3);
  });

  it("值序+耗尽自还原+种子 rng 不消耗:还原后首骰=同种子未钉对照引擎的自然首骰", () => {
    const firstNatural = makeEngine(7).dice.roll().die; // 独立对照引擎(同种子)
    const e = makeEngine(7);
    pinDice(e, "march", [3, 5]);
    expect(e.dice.roll().die).toBe(3); // 按值序
    expect(e.dice.roll().die).toBe(5);
    expect(e.dice.roll().die).toBe(firstNatural); // 已自还原;替身未消耗种子 rng
  });

  it("拼点口与行程口分属两个注入口互不串队;拼点口耗尽自还原同理", () => {
    const firstNaturalDie = makeEngine(9).dice.rollDie();
    const e = makeEngine(9);
    pinDice(e, "march", [2]);
    pinDice(e, "duel", [6, 1]);
    expect(e.dice.roll().die).toBe(2); // 行程口只吃行程队列
    expect(e.dice.rollDie()).toBe(6); // 拼点口只吃拼点队列
    expect(e.dice.rollDie()).toBe(1);
    expect(e.dice.rollDie()).toBe(firstNaturalDie); // 拼点口还原后续走自然骰
  });

  it("空值队列与非 1..6 整数当场炸(骰面契约,零兜底)", () => {
    const e = makeEngine();
    expect(() => pinDice(e, "march", [])).toThrow();
    expect(() => pinDice(e, "duel", [0])).toThrow();
    expect(() => pinDice(e, "march", [7])).toThrow();
    expect(() => pinDice(e, "duel", [2.5])).toThrow();
  });
});

describe("injectWarLog(战报注入,合成行直种)", () => {
  it("追加合成行:与真行同 schema,ts/round/turn 派生戳随引擎唯一写口保真", () => {
    const e = makeEngine();
    const before = e.log.length;
    injectWarLog(e, {
      category: "roll",
      player: "魏",
      brief: "合成战报测试事件",
      detail: "act=synth i=1",
    });
    expect(e.log.length).toBe(before + 1); // 只增不改(日志是产物流)
    const line = e.log[e.log.length - 1]!;
    expect(line.category).toBe("roll");
    expect(line.player).toBe("魏");
    expect(line.brief).toBe("合成战报测试事件");
    expect(line.detail).toBe("act=synth i=1");
    expect(line.ts).toBeGreaterThan(0);
    expect(line.round).toBe(e.round);
    expect(line.turn).toBe(e.turnNumber);
  });

  it("amount 可选携带(现金收付类合成行)", () => {
    const e = makeEngine();
    injectWarLog(e, {
      category: "trade",
      player: "蜀",
      brief: "合成交易",
      detail: "act=synth trade",
      amount: -300,
    });
    expect(e.log[e.log.length - 1]!.amount).toBe(-300);
  });

  it("未知 category 当场炸(渲染端按类白名单消费,种错类即假场景)", () => {
    const e = makeEngine();
    expect(() =>
      injectWarLog(e, {
        category: "noSuchCategory" as never,
        player: null,
        brief: "x",
        detail: "y",
      }),
    ).toThrow(/noSuchCategory/);
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

  it("布景族指令(placePlayer/grantProperty/armHero/armHeroOffer/giveTreasureFromDeck)与直呼同一实现", () => {
    const a = makeEngine();
    const b = makeEngine();
    a.treasureDeck = createTreasureDeck();
    b.treasureDeck = createTreasureDeck();
    const pid = a.board.at(3).propertyId!;
    placePlayer(a, 1, 5);
    grantProperty(a, 0, pid, 2);
    armHero(a, 1, "zhouyu");
    armHeroOffer(a, ["zhouyu", "huatuo"]);
    giveTreasureFromDeck(a, 0, 2);
    applyPlant(b, { kind: "placePlayer", seat: 1, position: 5 });
    applyPlant(b, {
      kind: "grantProperty",
      seat: 0,
      propertyId: pid,
      level: 2,
    });
    applyPlant(b, { kind: "armHero", seat: 1, heroId: "zhouyu" });
    applyPlant(b, { kind: "armHeroOffer", heroIds: ["zhouyu", "huatuo"] });
    applyPlant(b, { kind: "giveTreasureFromDeck", seat: 0, count: 2 });
    expect(b.players[1].position).toBe(a.players[1].position);
    expect(b.players[0].properties).toEqual(a.players[0].properties);
    expect(b.players[1].heroes).toEqual(a.players[1].heroes);
    expect(b.offeredHeroes).toEqual(a.offeredHeroes);
    expect(b.players[0].treasures).toEqual(a.players[0].treasures);
  });

  it("执行态族指令(armPhase/armBankrupt/armDebt/armGameOver/armReaction)与直呼同一实现", () => {
    const a = makeEngine();
    const b = makeEngine();
    const view: ReactionView = {
      kind: "jinnang",
      cardId: "火烧连营",
      userSeat: 1,
      targetSeats: [0],
      queriedBySeat: [0],
      windowMs: 30000,
    };
    const payload: ReactionPayload = {
      kind: "jinnang",
      userSeat: 1,
      cardId: "火烧连营",
      targets: [0],
    };
    armPhase(a, { turnPhase: "AwaitingDecision", activeIndex: 0 });
    armBankrupt(a, 1);
    armDebt(a, 99999, null);
    armGameOver(a, 0);
    armReaction(a, view, payload);
    applyPlant(b, {
      kind: "armPhase",
      turnPhase: "AwaitingDecision",
      activeIndex: 0,
    });
    applyPlant(b, { kind: "armBankrupt", seat: 1 });
    applyPlant(b, { kind: "armDebt", amount: 99999, creditor: null });
    applyPlant(b, { kind: "armGameOver", winnerSeat: 0 });
    applyPlant(b, { kind: "armReaction", view, payload });
    expect(b.turnPhase).toBe(a.turnPhase);
    expect(b.activeIndex).toBe(a.activeIndex);
    expect(b.players[1].isBankrupt).toBe(a.players[1].isBankrupt);
    expect(b.pendingDebt).toEqual(a.pendingDebt);
    expect(b.turnPhase).toBe(a.turnPhase);
    expect(b.isOver).toBe(a.isOver);
    expect(a.winner).toBe(a.players[0]); // winner=本引擎座位引用(跨引擎实例不可比)
    expect(b.winner).toBe(b.players[0]);
    expect(b.phase).toBe(a.phase);
    expect(b.pendingReaction).toEqual(a.pendingReaction);
  });

  it("确定性族指令(pinDice/injectWarLog)与直呼同一实现", () => {
    const a = makeEngine(11);
    const b = makeEngine(11);
    pinDice(a, "march", [4]);
    applyPlant(b, { kind: "pinDice", channel: "march", values: [4] });
    expect(a.dice.roll().die).toBe(4);
    expect(b.dice.roll().die).toBe(4);
    injectWarLog(a, { category: "system", player: null, brief: "合成A", detail: "act=x" });
    applyPlant(b, {
      kind: "injectWarLog",
      category: "system",
      player: null,
      brief: "合成A",
      detail: "act=x",
    });
    const la = a.log[a.log.length - 1]!;
    const lb = b.log[b.log.length - 1]!;
    expect(lb.category).toBe(la.category);
    expect(lb.player).toBe(la.player);
    expect(lb.brief).toBe(la.brief);
    expect(lb.detail).toBe(la.detail);
    expect(lb.round).toBe(la.round);
  });

  it("残块收编族指令(armLanding/armVisitor/setBot/setJinnangUsedTags)与直呼同一实现(#1303)", () => {
    const a = makeEngine();
    const b = makeEngine();
    const pid = a.board.tiles.find(
      (t) => t.propertyId && a.findOwner(t.propertyId) == null,
    )!.propertyId!;
    grantProperty(a, 0, pid, 1);
    grantProperty(b, 0, pid, 1);
    armLanding(a, { kind: "OwnProperty", propertyId: pid });
    armVisitor(a, a.board.at(3).propertyId!, 0);
    setBot(a, 1, true);
    setJinnangUsedTags(a, ["谋", "攻"]);
    applyPlant(b, { kind: "armLanding", landing: { kind: "OwnProperty", propertyId: pid } });
    applyPlant(b, { kind: "armVisitor", propertyId: b.board.at(3).propertyId!, ownerSeat: 0 });
    applyPlant(b, { kind: "setBot", seat: 1, bot: true });
    applyPlant(b, { kind: "setJinnangUsedTags", tags: ["谋", "攻"] });
    expect(b.pendingLand).toEqual(a.pendingLand);
    expect(b.lastLandOutcome).toEqual(a.lastLandOutcome);
    expect(b.treasureVisitor).toEqual(a.treasureVisitor);
    expect(b.players[1].isBot).toBe(true);
    expect(b.jinnangUsedTags).toEqual(a.jinnangUsedTags);
  });

  it("未知 kind 当场炸(分发口不吞错)", () => {
    const e = makeEngine();
    expect(() => applyPlant(e, { kind: "noSuchFamily" } as never)).toThrow(/noSuchFamily/);
  });
});

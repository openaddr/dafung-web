// 锦囊系统单测(#122/T1):目录数据校验 + 引擎缝(发牌/无上限抽干/抽空/快照往返/日志不泄牌)。
// 缝约定:只测引擎公共面(构造/公共方法/snapshot/log),不碰私有中间态。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@dafung/core/engine/authority";
import type { EngineConfig, SeatConfig } from "@dafung/core/engine/authority";
import { createDice, type Dice } from "@dafung/core/engine/dice";
import { beginGameEventBatch, type GameEvent } from "@dafung/core/engine/game-events";
import guanzhongData from "../packages/core/maps/guanzhong.json";
import { loadMap } from "@dafung/core/engine/board-loader";
import {
  JINNANG_CARDS,
  JINNANG_DECK_LIST,
  TARGET_DOMAIN_STAGES,
  buildJinnangDeck,
  jinnangCardOf,
} from "@dafung/core/engine/jinnang";

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

/** 驱动选都到完成(人类选第一个空城,bot 自动)= finishSetup 真实路径。 */
function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
    } else {
      const capIdx = e.firstAvailableCapitalIndex();
      if (capIdx < 0) break;
      e.pickCapital(idx, capIdx);
    }
  }
}

describe("锦囊目录(数据校验)", () => {
  it("锦囊 id 唯一且文案非空", () => {
    expect(new Set(JINNANG_CARDS.map((c) => c.id)).size).toBe(JINNANG_CARDS.length);
    for (const c of JINNANG_CARDS) {
      expect(c.text.length).toBeGreaterThan(6);
      expect(c.tags.length).toBeGreaterThanOrEqual(1);
      expect(c.tags.length).toBeLessThanOrEqual(2);
    }
  });

  it("标签只用 谋/攻/守/援/即时;目标域六域之一(#281:即时=反应锦囊,reaction=纯反应牌;#1389:one-city=城指向)", () => {
    const tags = new Set(["谋", "攻", "守", "援", "即时"]);
    const domains = new Set(["self", "one", "two-others", "all-others", "one-city", "reaction"]);
    for (const c of JINNANG_CARDS) {
      for (const t of c.tags) expect(tags.has(t)).toBe(true);
      expect(domains.has(c.targetDomain)).toBe(true);
    }
  });

  it("缓兵之计是唯一双标签牌(谋+攻);即时牌恰两张(识破诡计/半路杀出)且守类零张", () => {
    const multi = JINNANG_CARDS.filter((c) => c.tags.length === 2);
    expect(multi.map((c) => c.id)).toEqual(["缓兵之计"]);
    expect(multi[0].tags).toEqual(["谋", "攻"]);
    const instant = JINNANG_CARDS.filter((c) => c.tags.includes("即时"));
    expect(instant.map((c) => c.id).sort()).toEqual(["半路杀出", "识破诡计"]);
    for (const c of instant) {
      expect(c.targetDomain).toBe("reaction"); // 纯反应牌:只在反应窗打出
    }
    expect(JINNANG_CARDS.some((c) => c.tags.includes("守"))).toBe(false); // 守类清零,枚举保留
  });

  it("牌库构成 20 张，按目录 copies 展平", () => {
    expect(JINNANG_DECK_LIST.length).toBe(20);
    const counts = new Map(JINNANG_CARDS.map((c) => [c.id, 0]));
    for (const id of JINNANG_DECK_LIST) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const c of JINNANG_CARDS) {
      expect(counts.get(c.id)).toBe(c.copies);
    }
    expect(JINNANG_CARDS.find((c) => c.id === "缓兵之计")?.copies).toBe(1);
    expect(JINNANG_CARDS.find((c) => c.id === "半路杀出")?.copies).toBe(3);
    expect(JINNANG_CARDS.find((c) => c.id === "袭扰")?.copies).toBe(2);
  });

  it("buildJinnangDeck 同 seed 同牌序，配置的牌无遗漏", () => {
    const a = buildJinnangDeck(createDice(7));
    const b = buildJinnangDeck(createDice(7));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...JINNANG_DECK_LIST].sort());
  });

  it("未知 id 查牌面直接抛错", () => {
    expect(() => jinnangCardOf("无中生有")).toThrow();
  });
});

describe("锦囊发牌(引擎缝)", () => {
  it("每人发 1 张起手锦囊，首个回合在出牌前再摸 1 张", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true },
      { name: "C", isBot: true },
    ]);
    finishSetup(e);
    expect(e.phase).toBe("Playing");
    expect(e.activePlayer.jinnangHandCount).toBe(2);
    expect(e.players.filter((p) => p !== e.activePlayer).map((p) => p.jinnangHandCount)).toEqual([
      1, 1,
    ]);
    expect(e.jinnangDeckCount).toBe(JINNANG_DECK_LIST.length - 4);
    expect(e.gameEvents.filter((event) => event.kind === "jinnangDrawn")).toEqual([
      expect.objectContaining({ seat: e.activeIndex, turn: 1, count: 1, reason: "turnStart" }),
    ]);
  });

  it("同 seed 同发牌(牌序确定性贯穿到手上)", () => {
    const seats = [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true },
    ];
    const e1 = makeEngine(9, seats);
    const e2 = makeEngine(9, seats);
    finishSetup(e1);
    finishSetup(e2);
    expect(e1.players.map((p) => p.jinnangHand)).toEqual(e2.players.map((p) => p.jinnangHand));
    expect(e1.jinnangDeck).toEqual(e2.jinnangDeck);
  });

  it("手牌无上限(#250)，单人可持整副牌", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const p = e.players[0];
    // 把对手起手牌收回牌库，供同一人抽完整副。
    const other = e.players[1];
    e.jinnangDeck.unshift(...other.jinnangHand.splice(0));
    other.jinnangHandCount = 0;
    e.jinnangDeckCount = e.jinnangDeck.length;
    e.drawJinnang(0, 99); // 超发远超牌库:抽到空即止,张张入手
    expect(p.jinnangHand.length).toBe(JINNANG_DECK_LIST.length);
    expect(p.jinnangHandCount).toBe(JINNANG_DECK_LIST.length);
    expect(e.jinnangDeck).toEqual([]);
    expect(e.jinnangDeckCount).toBe(0);
    expect(e.jinnangDiscard).toEqual([]); // 无作废:满手作废已废除
    // 落空宣告走事件面(#588):一次调用至多一条(既有「至多提示一次」语义不变)
    expect(e.snapshot().events.filter((x) => x.kind === "jinnangExhausted").length).toBe(1);
  });

  it("牌库抽空(弃堆亦空):落空宣告 jinnangExhausted 零转移,浮字「锦囊已空」由 fx 面派生", () => {
    const e = makeEngine(3);
    finishSetup(e);
    e.jinnangDeck = [];
    const handBefore = e.players[0].jinnangHand.length;
    e.drawJinnang(0, 2);
    expect(e.players[0].jinnangHand.length).toBe(handBefore);
    expect(e.jinnangDiscard.length).toBe(0);
    const ev = e.snapshot().events.find((x) => x.kind === "jinnangExhausted");
    expect(ev).toMatchObject({ kind: "jinnangExhausted", seat: 0 });
  });

  it("公开计数(引擎态)随抽牌维护:手牌数/牌库余数与内容一致,随快照往返", () => {
    const e = makeEngine(17);
    finishSetup(e);
    const d0 = e.jinnangDeckCount;
    e.drawJinnang(0, 2);
    expect(e.players[0].jinnangHandCount).toBe(e.players[0].jinnangHand.length);
    expect(e.jinnangDeckCount).toBe(d0 - 2);
    const snap = e.snapshot();
    const e2 = makeEngine(1);
    e2.restoreFromSnapshot(snap);
    expect(e2.players[0].jinnangHandCount).toBe(e.players[0].jinnangHandCount);
    expect(e2.jinnangDeckCount).toBe(e.jinnangDeckCount);
  });

  it("对局日志不落手牌内容(ADR-0016):抽牌行只有「抽了一张锦囊」", () => {
    const e = makeEngine(11);
    finishSetup(e);
    e.drawJinnang(0, 2);
    const logStr = JSON.stringify(e.log);
    for (const card of JINNANG_CARDS) {
      expect(logStr.includes(card.id)).toBe(false);
    }
    expect(JSON.stringify(e.log).includes("抽了一张锦囊")).toBe(true);
  });
});

// ──────────────────────────── 弃牌堆洗回(牌库耗尽机制)────────────────────────────
describe("弃牌堆洗回(牌库耗尽)", () => {
  /** 循环读数(牌只在三处,#198 守恒同口径):牌库+弃堆+在世者手牌。 */
  function circulation(e: GameEngine): number {
    return (
      e.jinnangDeck.length +
      e.jinnangDiscard.length +
      e.players.filter((x) => !x.isBankrupt).reduce((s, x) => s + x.jinnangHand.length, 0)
    );
  }

  it("洗回前后牌库、各座位手牌及弃堆的总数守恒", () => {
    const e = makeEngine(7);
    finishSetup(e);
    expect(circulation(e)).toBe(JINNANG_DECK_LIST.length);
    e.jinnangDiscard.push(...e.jinnangDeck.splice(0)); // 牌库耗尽的真实面貌:全数经手牌/弃堆流转
    e.jinnangDeckCount = 0;
    expect(circulation(e)).toBe(JINNANG_DECK_LIST.length);
    e.drawJinnang(0, 2);
    expect(circulation(e)).toBe(JINNANG_DECK_LIST.length);
  });

  it("触发:牌库空+弃牌非空 → 洗回并入手;战报/事件宣告(浮字归 fx 面),计数同步", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.jinnangDeck = [];
    e.jinnangDeckCount = 0;
    e.jinnangDiscard = ["横征暴敛", "军情密探", "识破诡计"];
    const handBefore = e.players[0].jinnangHand.length;
    expect(e.drawJinnang(0, 2)).toBe(2);
    expect(e.jinnangDiscard).toEqual([]); // 洗回即清空
    expect(e.jinnangDeck.length).toBe(1); // 3 洗回 − 抽 2
    expect(e.jinnangDeckCount).toBe(1);
    expect(e.players[0].jinnangHand.length).toBe(handBefore + 2);
    // 事件只带张数不带牌 id(洗后牌序是暗信息,ADR-0016)
    const ev = e.snapshot().events.find((x) => x.kind === "jinnangReshuffled");
    expect(ev).toMatchObject({ kind: "jinnangReshuffled", seat: 0, count: 3 });
    expect(Object.keys(ev!).sort()).toEqual(["count", "kind", "round", "seat", "turn"]);
    // 战报:机读前缀归 jinnang 类,同不落牌名
    const reshuffleLog = e.log.find((l) => l.detail.includes("jinnangReshuffle"));
    expect(reshuffleLog?.detail).toContain("count=3");
  });

  it("双空:牌库与弃堆皆空 → 落空零转移,不产洗回事件", () => {
    const e = makeEngine(7);
    finishSetup(e);
    e.jinnangDeck = [];
    e.jinnangDeckCount = 0;
    e.jinnangDiscard = [];
    const before = circulation(e);
    expect(e.drawJinnang(0, 3)).toBe(0);
    expect(circulation(e)).toBe(before);
    expect(e.snapshot().events.some((x) => x.kind === "jinnangReshuffled")).toBe(false);
    expect(e.snapshot().events.some((x) => x.kind === "jinnangExhausted")).toBe(true); // 落空宣告(#588,浮字归 fx 面)
  });

  it("确定性:同 seed+同指令序列,两局洗回后牌库牌序一致", () => {
    const seats = [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true },
    ];
    const e1 = makeEngine(13, seats);
    const e2 = makeEngine(13, seats);
    finishSetup(e1);
    finishSetup(e2);
    for (const e of [e1, e2]) {
      e.jinnangDeck = [];
      e.jinnangDeckCount = 0;
      e.jinnangDiscard = ["横征暴敛", "军情密探", "识破诡计", "连环计"];
    }
    e1.drawJinnang(0, 2);
    e2.drawJinnang(0, 2);
    expect(e1.jinnangDeck).toEqual(e2.jinnangDeck); // 同骰序洗回:牌序逐张一致
    expect(e1.players.map((p) => p.jinnangHand)).toEqual(e2.players.map((p) => p.jinnangHand));
  });
});

describe("锦囊快照往返(恢复/联机一致性)", () => {
  it("snapshot → restore:手牌/牌库/弃牌堆逐项一致", () => {
    const e = makeEngine(21);
    finishSetup(e);
    e.drawJinnang(0, 2);
    e.drawJinnang(1, 1);
    const snap = e.snapshot();
    const e2 = makeEngine(999); // 不同 seed 的空引擎,纯靠快照恢复
    e2.restoreFromSnapshot(snap);
    expect(e2.players.map((p) => p.jinnangHand)).toEqual(e.players.map((p) => p.jinnangHand));
    expect(e2.jinnangDeck).toEqual(e.jinnangDeck);
    expect(e2.jinnangDiscard).toEqual(e.jinnangDiscard);
  });
});

// ──────────────────────────── 使用回路(T2)────────────────────────────
import { botAct } from "@dafung/core/engine/bot";
import { JINNANG_LIVE_EFFECTS, hasUsableJinnang } from "@dafung/core/engine/choices";

/** 把引擎摆到「当前玩家持 cards、停在锦囊相位」的测试态(相位为公开字段,直设同
 *  testEngine 落格后门口径)。同时清走他座的反应牌(#281)——常规锦囊回路不掺杂反应窗,
 *  反应窗全回路在 reaction-window.test 专项布置。 */
function armJinnang(e: GameEngine, cards: string[]) {
  const p = e.activePlayer;
  p.jinnangHand = [...cards];
  p.jinnangHandCount = cards.length;
  e.turnPhase = "AwaitingJinnang";
  for (const other of e.players) {
    if (other === p) continue;
    other.jinnangHand = other.jinnangHand.filter((id) => id !== "识破诡计" && id !== "半路杀出");
    other.jinnangHandCount = other.jinnangHand.length;
  }
  return p;
}

describe("锦囊使用回路(T2)", () => {
  it("回合开始有可用牌 → 相位入 AwaitingJinnang;今不用 → Roll", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["横征暴敛"]);
    expect(e.turnPhase).toBe("AwaitingJinnang");
    e.resolveJinnang(null);
    expect(e.turnPhase).toBe("Roll");
  });

  it("目录效果全部已接入结算(目录 ⊆ LIVE,穷尽守卫的运行时镜像)", () => {
    // 未来新增 effect.kind 而未接结算案时:灰置路径仍在(此计暂未启用),本守卫先红
    const kinds = JINNANG_CARDS.map((c) => c.effect.kind);
    for (const k of kinds) expect(JINNANG_LIVE_EFFECTS.has(k)).toBe(true);
  });

  it("唯反应牌不进「出牌阶段」(#281):灰置「唯反应」、hasUsableJinnang 不计、用牌命令被拒", () => {
    const e = makeEngine(42);
    finishSetup(e);
    const p = armJinnang(e, ["识破诡计"]);
    const opt = e.choicesFor().find((o) => o.id === "识破诡计");
    expect(opt?.available).toBe(false);
    expect(opt?.reason).toBe("唯反应(反应窗打出)");
    e.resolveJinnang("识破诡计"); // 硬闯:引擎按选项集拒绝(牌未消耗)
    expect(p.jinnangHand).toEqual(["识破诡计"]);
    expect(p.jinnangHandCount).toBe(1);
    expect(e.jinnangDiscard).not.toContain("识破诡计");
    expect(e.turnPhase).toBe("AwaitingJinnang"); // 未收卷:今不用才收
    e.resolveJinnang(null);
    expect(e.turnPhase).toBe("Roll");
  });

  it("持唯反应牌不触发「出牌阶段」(hasUsableJinnang 不计纯反应牌,#281)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null); // 清开局卷轴
    armJinnang(e, ["识破诡计"]);
    e.turnPhase = "Roll";
    expect(hasUsableJinnang(e)).toBe(false); // 纯反应手牌=无可用药:掷骰前不弹卷轴
  });

  it("用求贤令:名将入帐(未满编时);名将已尽折现", () => {
    const e = makeEngine(42);
    finishSetup(e);
    const p = armJinnang(e, ["求贤令"]);
    const cashBefore = p.cash;
    e.resolveJinnang("求贤令");
    const gotHero = p.heroes.length === 1;
    if (gotHero) {
      expect(p.cash).toBe(cashBefore);
      expect(e.recruitedHeroIds.size).toBe(1);
    } else {
      expect(p.cash).toBe(cashBefore + 300);
    }
    expect(["Roll", "AwaitingJinnang"]).toContain(e.turnPhase);
  });

  it("同一出牌阶段可以连续打出同标签锦囊，直至无牌可出", () => {
    const e = makeEngine(42);
    finishSetup(e);
    const user = armJinnang(e, ["军情密探", "军情密探"]);
    const target = e.players.indexOf(user) === 0 ? 1 : 0;
    giveJinnang(e, target, []);
    e.submitCommand({ type: "useJinnang", cardId: "军情密探" });
    e.submitCommand({ type: "useJinnang", cardId: "军情密探", targets: [target] });
    expect(e.turnPhase).toBe("AwaitingJinnang");
    expect(e.choicesFor().find((option) => option.id === "军情密探")).toMatchObject({
      available: true,
      cardTags: ["谋"],
    });
    e.submitCommand({ type: "useJinnang", cardId: "军情密探" });
    e.submitCommand({ type: "useJinnang", cardId: "军情密探", targets: [target] });
    expect(user.jinnangHand).toEqual([]);
    expect(e.jinnangDiscard).toEqual(["军情密探", "军情密探"]);
    expect(e.turnPhase).toBe("Roll");
  });

  it("异类标签同回合可用:用攻(横征)后援(求贤)仍可再出", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["横征暴敛", "求贤令"]);
    e.resolveJinnang("横征暴敛");
    expect(e.turnPhase).toBe("AwaitingJinnang");
    expect(e.choicesFor().find((o) => o.id === "求贤令")?.available).toBe(true);
    e.resolveJinnang("求贤令");
    // #188 档 3:新招名将的主动技即就绪 → 出牌阶段重算后停留(合并窗语义);今不用收卷
    expect(["Roll", "AwaitingJinnang"]).toContain(e.turnPhase);
    if (e.turnPhase === "AwaitingJinnang") {
      expect(e.choicesFor().some((o) => o.available && o.skillId != null)).toBe(true);
      e.resolveJinnang(null);
    }
    expect(e.turnPhase).toBe("Roll");
    expect(e.jinnangDiscard).toEqual(["横征暴敛", "求贤令"]);
  });

  it("bot 在锦囊相位对策略不济的牌恒今不用(不掷骰,手牌原样)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    const hand = ["军情密探"]; // 策略:手牌 ≥2 才用 → 今不用
    armJinnang(e, hand);
    const deckBefore = e.jinnangDeckCount;
    botAct(e);
    expect(e.turnPhase).toBe("Roll");
    expect(e.activePlayer.jinnangHand).toEqual(hand); // 牌仍在手(bot 没花)
    expect(e.jinnangDeckCount).toBe(deckBefore);
  });

  it("submitCommand 走 useJinnang 等价直调;非相位用牌被拒", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.submitCommand({ type: "useJinnang", cardId: null });
    expect(e.turnPhase).toBe("Roll");
    // 非相位用牌:静默拒绝(命令流已记 cmd 行)
    const handBefore = e.players[1].jinnangHand.length;
    e.submitCommand({ type: "useJinnang", cardId: "求贤令" });
    expect(e.players[1].jinnangHand.length).toBe(handBefore); // 未消耗
  });
});

import { giveJinnang, grantProperty, setDefense } from "@dafung/core/engine/planter";

// ──────────────────────────── 目标段与指向他人(T3)────────────────────────────
describe("锦囊目标段(T3)", () => {
  it("单段可声明数量区间，重复或不可用目标拒绝整批，有效目标全部随用牌公告", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    e.resolveJinnang(null);
    const plan = TARGET_DOMAIN_STAGES.one;
    TARGET_DOMAIN_STAGES.one = {
      stages: 1,
      excludeFirstFromSecond: false,
      selection: { domain: "seat", min: 1, max: 2 },
    };
    try {
      armJinnang(e, ["缓兵之计"]);
      e.resolveJinnang("缓兵之计");
      const [first, second] = e.players
        .map((_, seat) => seat)
        .filter((seat) => seat !== e.activeIndex);
      for (const invalid of [[], [first, first], [first, e.activeIndex], [first, second, first]]) {
        e.resolveJinnang("缓兵之计", invalid);
        expect(e.pendingJinnang?.cardId).toBe("缓兵之计");
        expect(e.activePlayer.jinnangHand).toEqual(["缓兵之计"]);
      }
      e.resolveJinnang("缓兵之计", [first, second]);
      expect(e.pendingJinnang).toBeNull();
      expect(e.gameEvents).toContainEqual(
        expect.objectContaining({ kind: "jinnangAnnounced", targetSeats: [first, second] }),
      );
    } finally {
      TARGET_DOMAIN_STAGES.one = plan;
    }
  });

  it("缓兵之计入目标段:候选含国号+作罢;选定后 skipTurns+1", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null); // 清开局相位
    armJinnang(e, ["缓兵之计"]);
    e.resolveJinnang("缓兵之计"); // 选牌 → 入目标段
    expect(e.turnPhase).toBe("AwaitingJinnang");
    expect(e.pendingJinnang).toMatchObject({ cardId: "缓兵之计", stage: "one" });
    const targets = e.choicesFor().filter((o) => o.targetSeat != null);
    expect(targets.length).toBe(2); // 2 人局:另一个 + 自己(自己灰置)
    expect(targets.find((o) => o.targetSeat === 0)?.available).toBe(false);
    expect(targets.find((o) => o.targetSeat === 0)?.reason).toBe("不能指定自己");
    expect(targets.find((o) => o.targetSeat === 1)?.available).toBe(true);
    // 作罢:牌保留,回卡牌段(牌仍可用 → 停留相位)
    e.resolveJinnang("缓兵之计", undefined, true);
    expect(e.pendingJinnang).toBeNull();
    expect(e.activePlayer.jinnangHand).toContain("缓兵之计");
    expect(e.turnPhase).toBe("AwaitingJinnang");
    // 再选牌进目标段并选定:skipTurns+1
    e.resolveJinnang("缓兵之计");
    e.resolveJinnang("缓兵之计", [1]);
    expect(e.players[1].skipTurns).toBe(1);
    expect(e.turnPhase).toBe("Roll");
    expect(e.activePlayer.jinnangHand).toEqual([]);
  });

  it("窃玉偷香:无珍宝灰置;有珍宝 → 随机夺一张(骰驱)", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    e.resolveJinnang(null);
    const userSeat = e.players.indexOf(e.activePlayer);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const thirdSeat = [0, 1, 2].find((i) => i !== userSeat && i !== victimSeat)!;
    const victim = e.players[victimSeat];
    // 卡级预检(#477):需一名有珍宝对手,牌才可用——第三席挂一件保牌可用,目标段灰置才可达
    e.players[thirdSeat].treasures.push({ id: "t0", name: "夜明珠", level: 1 });
    armJinnang(e, ["窃玉偷香"]);
    e.resolveJinnang("窃玉偷香");
    expect(e.choicesFor().find((o) => o.targetSeat === victimSeat)?.available).toBe(false);
    expect(e.choicesFor().find((o) => o.targetSeat === victimSeat)?.reason).toBe("无珍宝");
    expect(e.choicesFor().find((o) => o.targetSeat === thirdSeat)?.available).toBe(true);
    victim.treasures.push(
      { id: "t1", name: "和氏璧", level: 3 },
      { id: "t2", name: "随侯珠", level: 2 },
    );
    expect(e.choicesFor().find((o) => o.targetSeat === victimSeat)?.available).toBe(true);
    e.resolveJinnang("窃玉偷香", [victimSeat]);
    expect(e.activePlayer.treasures.length).toBe(1);
    expect(victim.treasures.length).toBe(1);
  });

  it("火烧连营目标段(#1389 城指向):候选=全图任意城(含无主城标注「作火源自身免伤」/含己城),出牌窗恒可达", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["火烧连营"]);
    expect(e.choicesFor().find((o) => o.id === "火烧连营")?.available).toBe(true); // 目标段无候选=牌不可出;全城池制恒有候选
    e.resolveJinnang("火烧连营"); // 入目标段
    expect(e.pendingJinnang).toMatchObject({ cardId: "火烧连营", stage: "one" });
    const opts = e.choicesFor().filter((o) => o.targetTileIndex != null);
    expect(opts.length).toBe(e.board.count); // 全城池制(#826):每格都是城,无距离限制
    expect(opts.every((o) => o.available)).toBe(true);
    // 无主城候选带「作火源自身免伤」语义标注;有主城(含己城)照城名
    const unowned = opts.find(
      (o) => o.targetPropertyId != null && e.findOwner(o.targetPropertyId) == null,
    );
    expect(unowned?.label).toContain("(无主,作火源自身免伤)");
    const owned = opts.find(
      (o) => o.targetPropertyId != null && e.findOwner(o.targetPropertyId) != null,
    );
    expect(owned?.label).not.toContain("无主");
    // 作罢:牌保留回卡牌段(既有目标段口径不因域而变)
    e.resolveJinnang("火烧连营", undefined, true);
    expect(e.pendingJinnang).toBeNull();
    expect(e.activePlayer.jinnangHand).toContain("火烧连营");
  });

  it("溅射矩阵(#1389):中心+前方 1、2 格有主城各挨 8 点火焰伤害;中心无主=免伤锚(不调单点)而邻居受击;战报逐城一行", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const victimSeat = e.players.indexOf(e.activePlayer) === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    const centerTile = e.board.tiles.find(
      (t) => t.propertyId && e.findOwner(t.propertyId) == null,
    )!;
    const at = (off: number) => e.board.at((centerTile.index + off) % e.board.count);
    // 前方 1、2 格清走既有持仓(选都落点不确定),种 victim 的 3 级城（满防 20）
    for (const off of [1, 2]) {
      const pid = at(off).propertyId!;
      for (const p of e.players) p.properties = p.properties.filter((h) => h.propertyId !== pid);
      grantProperty(e, victimSeat, pid, 3);
    }
    const n1 = victim.properties.find((h) => h.propertyId === at(1).propertyId)!;
    const n2 = victim.properties.find((h) => h.propertyId === at(2).propertyId)!;
    armJinnang(e, ["火烧连营"]);
    beginGameEventBatch(e);
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [centerTile.index]); // 城指向:提交目标城 tileIndex
    // 中心无主:免伤(无持有产生),前两格各挨 8 点:防御 20→12
    expect(e.findOwner(centerTile.propertyId!)).toBeNull();
    expect(n1.defense).toBe(12);
    expect(n2.defense).toBe(12);
    // 战报逐城一行(来源段「使用锦囊【火烧连营】」):无主中心免于火焰行 + 两行受击果
    const fireLines = e.log.filter((l) => l.detail.includes("jinnangFireWall"));
    expect(fireLines.length).toBe(3);
    expect(e.log.some((l) => l.brief.includes(`「${centerTile.name}」无主,免于火焰`))).toBe(true);
    expect(e.log.filter((l) => l.brief.includes(`「${at(1).name}」防御值降至 12`)).length).toBe(1);
    expect(e.log.filter((l) => l.brief.includes(`「${at(2).name}」防御值降至 12`)).length).toBe(1);
  });

  it("火烧连营攻陷 1 级非都城，原城主仍持有防御打空的都城", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const victimSeat = e.players.indexOf(e.activePlayer) === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    const capId = e.board.at(victim.capitalIndex).propertyId!;
    // 火源=受害者都城(打空前最后一点:防御 1);前方 1 格=1 级非都城(防御 1,烧毁失城);
    // 前方 2 格清成无主(免于火焰,不扰时机断言)
    setDefense(e, victimSeat, capId, 1);
    const at = (off: number) => e.board.at((victim.capitalIndex + off) % e.board.count);
    const loseTile = at(1);
    for (const p of e.players)
      p.properties = p.properties.filter(
        (h) => h.propertyId !== loseTile.propertyId && h.propertyId !== at(2).propertyId,
      );
    grantProperty(e, victimSeat, loseTile.propertyId!, 1); // 1 级满防 40
    setDefense(e, victimSeat, loseTile.propertyId!, 1);
    armJinnang(e, ["火烧连营"]);
    const entries: { moment: string; ctx: unknown }[] = [];
    const orig = e.dispatchMoment.bind(e);
    (e as { dispatchMoment: (m: string, ctx: unknown) => void }).dispatchMoment = (
      m: string,
      ctx: unknown,
    ) => {
      entries.push({ moment: m, ctx });
      return orig(m as never, ctx as never);
    };
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [victim.capitalIndex]);
    const attacker = e.activePlayer;
    expect(e.findOwner(loseTile.propertyId!)).toBe(attacker);
    expect(attacker.properties.find((h) => h.propertyId === loseTile.propertyId)).toMatchObject({
      level: 1,
      defense: 40,
      damageRanking: [],
    });
    expect(victim.properties.some((h) => h.propertyId === loseTile.propertyId)).toBe(false);
    const trace = e.propertyChanges[e.propertyChanges.length - 1];
    expect(trace).toEqual({
      tileIndex: loseTile.index,
      level: 1,
      ownerColorIndex: attacker.colorIndex,
      levelChanged: false,
      ownerChanged: true,
    });
    // 都城打空即停(absorbed):持仓恒在、防御 0
    expect(e.findOwner(capId)).toBe(victim);
    expect(victim.properties.find((h) => h.propertyId === capId)).toMatchObject({
      level: 1,
      defense: 0,
    });
    // 时机按果择一逐城派:恰一条 PropertyLost(1 级非都城),无 PropertyDemolished(absorbed 不派)
    expect(entries.filter((x) => x.moment === "PropertyLost").map((x) => x.ctx)).toEqual([
      { subject: victimSeat, propertyId: loseTile.propertyId, tileIndex: loseTile.index },
    ]);
    expect(entries.some((x) => x.moment === "PropertyDemolished")).toBe(false);
    expect(
      e.log.some((l) => l.brief.includes(`失「${loseTile.name}」,城归${attacker.guohao}`)),
    ).toBe(true);
    expect(e.log.some((l) => l.brief.includes("城防打空,火焰伤害被吸收"))).toBe(true);
  });

  it("溅射果分(#1389):都城可降(demolished,PropertyDemolished 派,降级回满新等级);己城照烧", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const victimSeat = userSeat === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    const capId = e.board.at(victim.capitalIndex).propertyId!;
    grantProperty(e, victimSeat, capId, 3); // 都城 3 级（满防 20）——都城可降不可失(#226)
    setDefense(e, victimSeat, capId, 1); // 再挨 1 点即归零降级
    // 己城照烧:火源旁种使用者一座 2 级城(前方 1 格),同样挨烧
    const ownTile = e.board.at((victim.capitalIndex + 1) % e.board.count);
    for (const p of e.players)
      p.properties = p.properties.filter((h) => h.propertyId !== ownTile.propertyId);
    grantProperty(e, userSeat, ownTile.propertyId!, 2); // 满防 30
    const entries: { moment: string; ctx: unknown }[] = [];
    const orig = e.dispatchMoment.bind(e);
    (e as { dispatchMoment: (m: string, ctx: unknown) => void }).dispatchMoment = (
      m: string,
      ctx: unknown,
    ) => {
      entries.push({ moment: m, ctx });
      return orig(m as never, ctx as never);
    };
    armJinnang(e, ["火烧连营"]);
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [victim.capitalIndex]);
    // 都城降至 2 级，回满 30 点防御
    expect(victim.properties.find((h) => h.propertyId === capId)).toMatchObject({
      level: 2,
      defense: 30,
    });
    // 己城照烧，防御 30→22（等级不动）
    expect(user.properties.find((h) => h.propertyId === ownTile.propertyId)).toMatchObject({
      level: 2,
      defense: 22,
    });
    // 恰一条 PropertyDemolished(都城);己城纯扣防 absorbed 不派
    expect(entries.filter((x) => x.moment === "PropertyDemolished").map((x) => x.ctx)).toEqual([
      { subject: victimSeat, propertyId: capId, tileIndex: victim.capitalIndex },
    ]);
    expect(
      e.log.some((l) =>
        l.brief.includes(`「${e.board.at(victim.capitalIndex).name}」城防降为 2 级`),
      ),
    ).toBe(true);
    expect(e.log.some((l) => l.brief.includes(`「${ownTile.name}」防御值降至 22`))).toBe(true);
  });

  it("横征暴敛:全体域无目标段直接执行;上限=现金", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["横征暴敛"]);
    const user = e.activePlayer;
    const userSeat = e.players.indexOf(user);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    const payer = e.players[others[0]];
    payer.cash = 80; // 不足 200 → 倾囊 80
    // 其余他座:手牌清空(无人持识破不开反应窗,识破免征见 reaction-window.test)、
    // 现金清零(缴 0,钉「上限=现金」口径)
    for (const seat of others.slice(1)) {
      e.players[seat].jinnangHand = [];
      e.players[seat].jinnangHandCount = 0;
      e.players[seat].cash = 0;
    }
    const before = user.cash;
    e.resolveJinnang("横征暴敛"); // 无目标段:一次提交即执行
    expect(e.pendingJinnang).toBeNull();
    expect(payer.cash).toBe(0);
    expect(user.cash).toBe(before + 80);
  });

  it("目标段载荷随快照往返(two-a 场景在 T4 连环计覆盖)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["缓兵之计"]);
    e.resolveJinnang("缓兵之计");
    const e2 = makeEngine(1);
    e2.restoreFromSnapshot(e.snapshot());
    expect(e2.pendingJinnang).toEqual(e.pendingJinnang);
  });
});

// ──────────────────────────── 连环计与窥探(T4)────────────────────────────
describe("连环计·二虎竞食(T4)", () => {
  it("两步选人:two-a 定首挑 → two-b 排除首挑 → 执行;骰点与银两走规则", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    e.resolveJinnang(null);
    const userSeat = e.players.indexOf(e.activePlayer);
    const others = [0, 1, 2].filter((i) => i !== userSeat);
    armJinnang(e, ["连环计"]);
    e.resolveJinnang("连环计");
    expect(e.pendingJinnang).toMatchObject({ cardId: "连环计", stage: "two-a" });
    e.resolveJinnang("连环计", [others[0]]);
    expect(e.pendingJinnang).toMatchObject({ stage: "two-b", picked: [others[0]] });
    // 第二段排除首挑
    const second = e
      .choicesFor()
      .filter((o) => o.targetSeat != null && o.available)
      .map((o) => o.targetSeat);
    expect(second).not.toContain(others[0]);
    e.resolveJinnang("连环计", [second[0]!]);
    expect(e.pendingJinnang).toBeNull();
    expect(e.activePlayer.jinnangHand).toEqual([]); // 已消耗
    // 结算:读战报的骰点,断言三态之一的钱流不变量
    const duel = e.log.filter((l) => l.detail.includes("jinnangDuel"));
    expect(duel.length).toBeGreaterThanOrEqual(1); // 结果行(胜负两条或平局一条)
    const winnerLine = duel.find((l) => l.detail.includes("winner="));
    const loserLine = duel.find((l) => l.detail.includes("loser="));
    if (winnerLine && loserLine) {
      const gain = Number(/gain=(\d+)/.exec(winnerLine.detail)?.[1]);
      const pay = Number(/pay=(\d+)/.exec(loserLine.detail)?.[1]);
      expect(gain).toBe(300);
      expect(pay).toBeLessThanOrEqual(400);
    } else {
      expect(duel.some((l) => l.detail.includes("tie"))).toBe(true); // 平局作废
    }
  });

  it("两人局连环计灰置「对手不足」(可用目标 <2)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["连环计"]);
    const opt = e.choicesFor().find((o) => o.id === "连环计");
    expect(opt?.available).toBe(false);
  });

  it("两人局火烧连营目标段候选恒在(城指向域,#1389:全图任意城为火源,无席位域「无可毁之城」门)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["火烧连营"]);
    const opt = e.choicesFor().find((o) => o.id === "火烧连营");
    expect(opt?.available).toBe(true);
    expect(opt?.reason).toBeUndefined();
  });

  it("两人局窃玉偷香灰置「无珍宝」(对手无珍宝,#477)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["窃玉偷香"]);
    const opt = e.choicesFor().find((o) => o.id === "窃玉偷香");
    expect(opt?.available).toBe(false);
    expect(opt?.reason).toBe("无珍宝");
  });
});

// ── 连环计拼点入事件流(#636,ADR-0030):resolveDuel 单点 emit 的连环计侧三支 ──
describe("连环计 duelResolved(#636,ADR-0030)", () => {
  /** 骰子替身(同 test/reaction-window.test.ts scriptDice 口径):rollDie 按脚本出点。 */
  function scriptDice(e: GameEngine, rollDies: number[]) {
    let di = 0;
    const dice: Dice = {
      roll: () => ({ die: 1 }),
      rollDie: () => rollDies[di++] ?? 1,
      nextFloat: () => 0.99,
      getRngState: () => 0,
      setRngState: () => {},
    };
    (e as unknown as { dice: Dice }).dice = dice;
  }

  /** 连环计拼点驱动:two-a 首挑=a(即 aSeat),批界始于最终执行的 two-b,拼点事件批内可查。 */
  function duelDriven(rolls: [number, number]) {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    e.resolveJinnang(null);
    const others = [0, 1, 2].filter((i) => i !== e.players.indexOf(e.activePlayer));
    const [a, b] = others;
    armJinnang(e, ["连环计"]);
    e.resolveJinnang("连环计");
    e.resolveJinnang("连环计", [a!]);
    scriptDice(e, [...rolls]);
    beginGameEventBatch(e);
    e.resolveJinnang("连环计", [b!]); // two-b 落定即执行拼点
    const duel = e
      .snapshot()
      .events.filter(
        (ev): ev is Extract<GameEvent, { kind: "duelResolved" }> => ev.kind === "duelResolved",
      );
    return { duel, a: a!, b: b! };
  }

  it("a 方胜:恰一条,座位/点数/胜者字段正确", () => {
    const { duel, a, b } = duelDriven([6, 2]);
    expect(duel.length).toBe(1);
    expect(duel[0]).toMatchObject({
      seat: a, // emit seat=a 方(resolveDuel 首参)
      sides: [
        { seat: a, roll: 6 },
        { seat: b, roll: 2 },
      ],
      winnerSeat: a,
    });
  });

  it("b 方胜:aRoll<bRoll,胜者=bSeat", () => {
    const { duel, a, b } = duelDriven([2, 6]);
    expect(duel.length).toBe(1);
    expect(duel[0]).toMatchObject({
      sides: [
        { seat: a, roll: 2 },
        { seat: b, roll: 6 },
      ],
      winnerSeat: b,
    });
  });

  it("平局:winnerSeat=null(此计作废,双方无事)", () => {
    const { duel, a, b } = duelDriven([3, 3]);
    expect(duel.length).toBe(1);
    expect(duel[0]).toMatchObject({
      sides: [
        { seat: a, roll: 3 },
        { seat: b, roll: 3 },
      ],
      winnerSeat: null,
    });
  });
});

describe("军情密探·窥探(#575 即时一次性)", () => {
  it("生效产出 peekApplied(窥方/被窥者+手牌内容随事件走);无任何持续窗口", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["军情密探"]);
    const targetHand = [...e.players[1].jinnangHand];
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    // 事件=窥探的唯一载体(viewer 凭事件得一次阅览权):真生效才产出,手牌快照随行;
    // cardId=所因锦囊(#1067:UI 题名按目录回查,载荷带牌 id)
    const ev = e.gameEvents.find((x) => x.kind === "peekApplied");
    expect(ev).toMatchObject({
      kind: "peekApplied",
      seat: 0,
      viewerSeat: 0,
      targetSeat: 1,
      cardId: "军情密探",
      hand: targetHand,
    });
    // 即时一次性:窥探无任何客户端/快照状态(引擎账本已删,快照零字段)
    expect(Object.hasOwn(e.snapshot(), "jinnangPeeks")).toBe(false);
  });

  it("PeekApplied 时机同址派发(subject=使用者,targetSeat=被窥者);战报公开不泄牌名", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["军情密探"]);
    const entries: { moment: string; ctx: unknown }[] = [];
    const orig = e.dispatchMoment.bind(e);
    (e as { dispatchMoment: (m: string, ctx: unknown) => void }).dispatchMoment = (
      m: string,
      ctx: unknown,
    ) => {
      entries.push({ moment: m, ctx });
      return orig(m as never, ctx as never);
    };
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    expect(entries.filter((x) => x.moment === "PeekApplied").map((x) => x.ctx)).toEqual([
      { subject: 0, targetSeat: 1 },
    ]);
    expect(e.log.some((l) => l.brief.includes("窥探 蜀 的锦囊"))).toBe(true);
    expect(e.log.some((l) => l.brief.includes("至下回合"))).toBe(false); // 时窗口径随 #575 删除
  });

  it("被识破不产出 peekApplied(识破只护份,窥探从未发生)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["军情密探"]);
    e.players[1].jinnangHand = ["识破诡计"]; // armJinnang 清过反应牌,此处重植
    e.players[1].jinnangHandCount = 1;
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    expect(e.turnPhase).toBe("AwaitingReaction"); // 宣布 → 识破窗挂起
    e.respondReaction(1, true, "识破诡计", 1); // 自保识破
    expect(e.pendingReaction).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // 计被拆,照常收卷
    expect(e.gameEvents.some((x) => x.kind === "peekApplied")).toBe(false);
    expect(e.jinnangDiscard).toContain("识破诡计"); // 识破牌已耗,军情密探也无处可窥
  });
});

// ─────────────────────────── 破产清手(#198)───────────────────────────
describe("破产清手(#198):手牌入弃牌堆,15 张守恒", () => {
  it("破产 → 手牌清入弃牌堆;牌库+弃牌+在世者手牌守恒", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0; // 无现金、无珍宝/名将/非都城城 → 无可变卖资产,欠款后等待确认破产
    // 从牌库顶挪一张进他手牌(守恒口径:牌只在这三处)
    const card = e.jinnangDeck.pop()!;
    e.jinnangDeckCount = e.jinnangDeck.length;
    p.jinnangHand.push(card);
    p.jinnangHandCount = 1;
    const total = () => ({
      deck: e.jinnangDeck.length,
      discard: e.jinnangDiscard.length,
      hands: e.players.filter((x) => !x.isBankrupt).reduce((s, x) => s + x.jinnangHand.length, 0),
    });
    const before = total();
    e.payOrLiquidate(p, null, 200); // 欠 200,现金 0 → 清算挂债
    e.declareBankruptcy();
    expect(p.isBankrupt).toBe(true);
    expect(p.jinnangHand).toEqual([]);
    expect(p.jinnangHandCount).toBe(0);
    expect(e.jinnangDiscard).toContain(card);
    const after = total();
    expect(after.deck + after.discard + after.hands).toBe(
      before.deck + before.discard + before.hands,
    );
  });
});

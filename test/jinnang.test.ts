// 锦囊系统单测(#122/T1):目录数据校验 + 引擎缝(发牌/无上限抽干/抽空/快照往返/日志不泄牌)。
// 缝约定:只测引擎公共面(构造/公共方法/snapshot/log),不碰私有中间态。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice } from "@core/dice";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import {
  JINNANG_CARDS,
  JINNANG_DECK_LIST,
  JINNANG_STARTING_HAND,
  buildJinnangDeck,
  jinnangCardOf,
} from "@core/jinnang";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]) {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
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
  it("9 种牌,id 唯一且中文自带因果(文案非空)", () => {
    expect(JINNANG_CARDS.length).toBe(9);
    expect(new Set(JINNANG_CARDS.map((c) => c.id)).size).toBe(9);
    for (const c of JINNANG_CARDS) {
      expect(c.text.length).toBeGreaterThan(6);
      expect(c.tags.length).toBeGreaterThanOrEqual(1);
      expect(c.tags.length).toBeLessThanOrEqual(2);
    }
  });

  it("标签只用 谋/攻/守/援/即时;目标域五域之一(#281:即时=反应锦囊,reaction=纯反应牌)", () => {
    const tags = new Set(["谋", "攻", "守", "援", "即时"]);
    const domains = new Set(["self", "one", "two-others", "all-others", "reaction"]);
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

  it("牌库构成 18 张:按目录 copies 展平(缓兵之计 1、半路杀出 3,其余 2)", () => {
    expect(JINNANG_DECK_LIST.length).toBe(18);
    const counts = new Map(JINNANG_CARDS.map((c) => [c.id, 0]));
    for (const id of JINNANG_DECK_LIST) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const c of JINNANG_CARDS) {
      expect(counts.get(c.id)).toBe(c.copies);
    }
    expect(JINNANG_CARDS.find((c) => c.id === "缓兵之计")?.copies).toBe(1);
    expect(JINNANG_CARDS.find((c) => c.id === "半路杀出")?.copies).toBe(3);
  });

  it("buildJinnangDeck 同 seed 同牌序;是 18 张的同一多重集", () => {
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
  it("选都完成进 Playing:每人起手 1 张(座位序),牌库相应减少", () => {
    const e = makeEngine(42, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: true },
      { name: "C", isBot: true },
    ]);
    finishSetup(e);
    expect(e.phase).toBe("Playing");
    const total = e.players.reduce((n, p) => n + p.jinnangHand.length, 0);
    expect(total).toBe(3 * JINNANG_STARTING_HAND);
    expect(e.jinnangDeck.length).toBe(18 - 3);
    for (const p of e.players) {
      expect(p.jinnangHand.length).toBe(1);
      expect(() => jinnangCardOf(p.jinnangHand[0])).not.toThrow();
    }
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

  it("手牌无上限(#250):循环抽到牌库空,单人可持整副 18 张,不作废不报错", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const p = e.players[0];
    // 守恒口径(牌只在这三处):把对手起手那张收回牌库,凑回整副 18 张
    const other = e.players[1];
    e.jinnangDeck.unshift(...other.jinnangHand.splice(0));
    other.jinnangHandCount = 0;
    e.jinnangDeckCount = e.jinnangDeck.length;
    expect(e.jinnangDeck.length).toBe(17); // 整副 18 张:p 手上 1 张 + 牌库 17 张
    e.drawJinnang(0, 99); // 超发远超牌库:抽到空即止,张张入手
    expect(p.jinnangHand.length).toBe(18); // 理论上限=整副牌库
    expect(p.jinnangHandCount).toBe(18);
    expect(e.jinnangDeck).toEqual([]);
    expect(e.jinnangDeckCount).toBe(0);
    expect(e.jinnangDiscard).toEqual([]); // 无作废:满手作废已废除
    const msgs = e.presentation
      .drainFloaters()
      .filter((f) => f.kind === "msg")
      .map((f) => (f as { text: string }).text);
    expect(msgs.some((t) => t.includes("锦囊已空"))).toBe(true); // 抽空后落空提示(既有语义不变)
  });

  it("牌库抽空:落空浮字「锦囊已空」,不报错不回流", () => {
    const e = makeEngine(3);
    finishSetup(e);
    e.jinnangDeck = [];
    const handBefore = e.players[0].jinnangHand.length;
    e.drawJinnang(0, 2);
    expect(e.players[0].jinnangHand.length).toBe(handBefore);
    expect(e.jinnangDiscard.length).toBe(0);
    const msgs = e.presentation
      .drainFloaters()
      .filter((f) => f.kind === "msg")
      .map((f) => (f as { text: string }).text);
    expect(msgs.some((t) => t.includes("锦囊已空"))).toBe(true);
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
import { botAct } from "@core/bot";
import { JINNANG_LIVE_EFFECTS, hasUsableJinnang } from "@core/choices";

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
    other.jinnangHand = other.jinnangHand.filter(
      (id) => id !== "识破诡计" && id !== "半路杀出",
    );
    other.jinnangHandCount = other.jinnangHand.length;
  }
  return p;
}

describe("锦囊使用回路(T2)", () => {
  it("回合开始有可用牌 → 相位入 AwaitingJinnang;今不用 → Roll", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["横征暴敛"]); // 已启用种类:摆位进卷轴(自然入相路径由 enterJinnangPhase 走)
    expect(e.turnPhase).toBe("AwaitingJinnang");
    e.resolveJinnang(null);
    expect(e.turnPhase).toBe("Roll");
  });

  it("目录效果全部已接入结算(目录 ⊆ LIVE,穷尽守卫的运行时镜像)", () => {
    // 未来新增 effect.kind 而未接结算案时:灰置路径仍在(此计暂未启用),本守卫先红
    const kinds = JINNANG_CARDS.map((c) => c.effect.kind);
    for (const k of kinds) expect(JINNANG_LIVE_EFFECTS.has(k)).toBe(true);
  });

  it("唯反应牌不进军师幕(#281):灰置「唯反应」、hasUsableJinnang 不计、用牌命令被拒", () => {
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

  it("持唯反应牌不触发军师幕(hasUsableJinnang 不计纯反应牌,#281)", () => {
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

  it("每回合每类标签一张:同回合用谋后再持谋牌则灰置,重算收卷", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["军情密探", "军情密探"]);
    e.resolveJinnang("军情密探"); // 第一张谋(入目标段选人)
    e.resolveJinnang("军情密探", [1]);
    expect(e.turnPhase).toBe("Roll"); // 第二张同标签 → 灰置 → 重算无可用 → 收卷
    // 硬闯第二张:相位已走,引擎相位守卫拒绝
    const discardBefore = e.jinnangDiscard.length;
    e.resolveJinnang("军情密探");
    expect(e.jinnangDiscard.length).toBe(discardBefore); // 未消耗
  });

  it("异类标签同回合可用:用攻(横征)后援(求贤)仍可再出", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["横征暴敛", "求贤令"]);
    e.resolveJinnang("横征暴敛");
    expect(e.turnPhase).toBe("AwaitingJinnang"); // 求贤(援)名额未占 → 停留卷轴
    expect(e.choicesFor().find((o) => o.id === "求贤令")?.available).toBe(true);
    e.resolveJinnang("求贤令");
    // #188 档 3:新招名将的主动技即就绪 → 军师幕重算后停留(合并窗语义);今不用收卷
    expect(["Roll", "AwaitingJinnang"]).toContain(e.turnPhase);
    if (e.turnPhase === "AwaitingJinnang") {
      expect(e.choicesFor().some((o) => o.available && o.skillId != null)).toBe(true);
      e.resolveJinnang(null);
    }
    expect(e.turnPhase).toBe("Roll");
    expect(e.jinnangUsedTags.sort()).toEqual(["攻", "援"].sort());
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

  it("快照往返:usedTags 保真", () => {
    const e = makeEngine(42);
    finishSetup(e);
    armJinnang(e, ["横征暴敛"]);
    e.resolveJinnang("横征暴敛");
    const e2 = makeEngine(1);
    e2.restoreFromSnapshot(e.snapshot());
    expect(e2.jinnangUsedTags).toEqual(e.jinnangUsedTags);
    expect(e2.jinnangUsedTags).toEqual(["攻"]);
  });
});

// ──────────────────────────── 渠道(T5)────────────────────────────
import { testEngine } from "@core/testing";
import { ENCOUNTERS } from "@core/encounters";
import { CHANCE_EVENTS } from "@core/events";

describe("锦囊渠道(T5)", () => {
  it("落锦囊格必抽一张(index 22 与 31 两格)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    const handBefore = e.players[0].jinnangHand.length;
    testEngine(e).landActiveAt(22); // 子午谷改建的锦囊格
    expect(e.players[0].jinnangHand.length).toBe(handBefore + 1);
    expect(e.log.some((l) => l.detail.includes("jinnangTile"))).toBe(true);
  });

  it("声望献计:+30/+60/+90 各首次向上穿越献一封,回落再升不重复", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.players.forEach((p) => {
      p.jinnangHand = [];
      p.jinnangHandCount = 0;
    });
    const handOf = () => e.players[0].jinnangHand.length;
    const h0 = handOf();
    e.addReputation(0, 30);
    expect(handOf()).toBe(h0 + 1);
    e.addReputation(0, 29); // 59 未过 60
    expect(handOf()).toBe(h0 + 1);
    e.addReputation(0, 1); // 60
    expect(handOf()).toBe(h0 + 2);
    e.addReputation(0, 30); // 90
    expect(handOf()).toBe(h0 + 3);
    e.addReputation(0, -90); // 归 0
    e.addReputation(0, 30); // 再过 30:已领 → 不重发
    expect(handOf()).toBe(h0 + 3);
    expect(e.players[0].repMilestones.sort()).toEqual([30, 60, 90]);
  });

  it("机遇目录:圯上授书(好运/grantCard/锦囊标签)存在且权重合法", () => {
    const entry = ENCOUNTERS.find((c) => c.id === "圯上授书");
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe("好运");
    expect(entry!.tags).toContain("锦囊");
    expect(entry!.effect?.kind).toBe("grantCard");
    expect(entry!.weight).toBeGreaterThan(0);
  });

  it("辅路事件池:军师来投带 jinnangDraw 标记且零现金", () => {
    const ev = CHANCE_EVENTS.find((e) => e.id === "strategist");
    expect(ev).toBeDefined();
    expect(ev!.jinnangDraw).toBe(true);
    expect(ev!.cashDelta).toBe(0);
  });
});

// ──────────────────────────── 目标段与指向他人(T3)────────────────────────────
describe("锦囊目标段(T3)", () => {
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
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const victim = e.players[1];
    armJinnang(e, ["窃玉偷香"]);
    e.resolveJinnang("窃玉偷香");
    expect(e.choicesFor().find((o) => o.targetSeat === 1)?.available).toBe(false);
    expect(e.choicesFor().find((o) => o.targetSeat === 1)?.reason).toBe("无珍宝");
    victim.treasures.push(
      { id: "t1", name: "和氏璧", level: 3 },
      { id: "t2", name: "随侯珠", level: 2 },
    );
    expect(e.choicesFor().find((o) => o.targetSeat === 1)?.available).toBe(true);
    e.resolveJinnang("窃玉偷香", [1]);
    expect(e.activePlayer.treasures.length).toBe(1);
    expect(victim.treasures.length).toBe(1);
  });

  it("火烧连营:有可升级城 → 降 1 级;全 0 级 → 失一座(回无主)", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const victim = e.players[1];
    const cap = victim.properties[0];
    cap.level = 2;
    victim.properties.forEach((h) => {
      if (h !== cap) h.level = 2;
    });
    armJinnang(e, ["火烧连营"]);
    e.resolveJinnang("火烧连营");
    expect(e.choicesFor().find((o) => o.targetSeat === 1)?.available).toBe(true);
    e.resolveJinnang("火烧连营", [1]);
    expect(victim.properties.length).toBe(1);
    expect(victim.properties[0].level).toBe(1); // 2→1 降级(单城可升级)
    // 全 0 级:再烧 → 失城(清攻名额:跨回合才可再出同标签,此处单测直接开账重置)。
    // 失城池排除都城(#226「都城可降不可失」):给目标添一座 0 级非都城,烧失的必须是非都城。
    victim.properties[0].level = 0;
    const freeId = e.board.tiles.find(
      (t) => t.type === "Property" && t.propertyId && e.findOwner(t.propertyId) == null,
    )!.propertyId!;
    victim.properties.push({
      propertyId: freeId,
      group: "a",
      purchasePrice: 1000,
      level: 0,
      maxLevel: 3,
    });
    e.jinnangUsedTags = [];
    armJinnang(e, ["火烧连营"]);
    e.resolveJinnang("火烧连营");
    e.resolveJinnang("火烧连营", [1]);
    expect(victim.properties).toHaveLength(1); // 都城持仓恒在
    expect(victim.properties[0].propertyId).toBe(cap.propertyId);
    expect(e.findOwner(freeId)).toBeNull(); // 非都城失城,回无主
    expect(e.findOwner(cap.propertyId)).toBe(victim); // 都城不可失
  });

  it("火烧连营不可毁都城(#226):目标仅剩 0 级都城 → 门槛拦截,钱已扣、都城持仓恒在", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    const user = e.activePlayer; // seed 42 定序首动者
    const victimSeat = e.players.indexOf(user) === 0 ? 1 : 0;
    const victim = e.players[victimSeat];
    const capPropId = e.board.at(victim.capitalIndex).propertyId!;
    const capTile = victim.capitalIndex;
    // 开局面貌(#226 e2e 布场时序):目标仅有都城一座,且 Lv.0
    expect(victim.properties).toHaveLength(1);
    expect(victim.properties[0].propertyId).toBe(capPropId);
    expect(victim.properties[0].level).toBe(0);
    armJinnang(e, ["火烧连营"]);
    e.resolveJinnang("火烧连营");
    // 目标门槛(选项集单口,ADR-0013):都城可降不可失——仅剩 0 级都城 = 无可毁之城
    const opt = e.choicesFor().find((o) => o.targetSeat === victimSeat);
    expect(opt?.available).toBe(false);
    expect(opt?.reason).toBe("无可毁之城");
    // 引擎硬拒不可用目标 → 都城持仓原样(建城费已扣、持仓在,capitalIndex ↔ properties 一致)
    e.resolveJinnang("火烧连营", [victimSeat]);
    expect(victim.properties).toHaveLength(1);
    expect(victim.properties[0].propertyId).toBe(capPropId);
    expect(victim.properties[0].level).toBe(0);
    expect(e.findOwner(capPropId)).toBe(victim);
    expect(victim.capitalIndex).toBe(capTile); // 指向不变
    // 牌未消耗:目标段被拒,牌留手(作罢才退回卡牌段)
    expect(user.jinnangHand).toContain("火烧连营");
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
});

describe("军情密探·窥探(T4)", () => {
  it("窥探入账;viewer 下回合开始到期清零", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["军情密探"]);
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    expect(e.jinnangPeeks).toEqual([{ viewer: 0, target: 1 }]);
    const p = e.activePlayer;
    e.rollAndMove();
    let seenOther = false;
    let guard = 0;
    while (!e.isOver && guard++ < 50) {
      if (e.activePlayer !== p) seenOther = true;
      else if (seenOther) break;
      if (e.turnPhase === "Roll") e.rollAndMove();
      else if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
      else botAct(e);
    }
    expect(seenOther).toBe(true);
    expect(e.jinnangPeeks).toEqual([]); // 轮回 viewer:到期
  });

  it("快照往返:peeks 保真", () => {
    const e = makeEngine(42);
    finishSetup(e);
    e.resolveJinnang(null);
    armJinnang(e, ["军情密探"]);
    e.resolveJinnang("军情密探");
    e.resolveJinnang("军情密探", [1]);
    const e2 = makeEngine(1);
    e2.restoreFromSnapshot(e.snapshot());
    expect(e2.jinnangPeeks).toEqual([{ viewer: 0, target: 1 }]);
  });
});

// ─────────────────────────── 破产清手(#198)───────────────────────────
describe("破产清手(#198):手牌入弃牌堆,15 张守恒", () => {
  it("破产 → 手牌清入弃牌堆;牌库+弃牌+在世者手牌守恒", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0; // 无现金、无珍宝/名将/非都城城 → 无可变卖资产,欠款即直接破产
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
    testEngine(e).payOrLiquidate(p, null, 200); // 欠 200,现金 0 → 直接破产
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

// 锦囊系统单测(#122/T1):目录数据校验 + 引擎缝(发牌/上限/抽空/快照往返/日志不泄牌)。
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
  JINNANG_HAND_LIMIT,
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
  it("8 种牌,id 唯一且中文自带因果(文案非空)", () => {
    expect(JINNANG_CARDS.length).toBe(8);
    expect(new Set(JINNANG_CARDS.map((c) => c.id)).size).toBe(8);
    for (const c of JINNANG_CARDS) {
      expect(c.text.length).toBeGreaterThan(6);
      expect(c.tags.length).toBeGreaterThanOrEqual(1);
      expect(c.tags.length).toBeLessThanOrEqual(2);
    }
  });

  it("标签只用 谋/攻/守/援;目标域四域之一", () => {
    const tags = new Set(["谋", "攻", "守", "援"]);
    const domains = new Set(["self", "one", "two-others", "all-others"]);
    for (const c of JINNANG_CARDS) {
      for (const t of c.tags) expect(tags.has(t)).toBe(true);
      expect(domains.has(c.targetDomain)).toBe(true);
    }
  });

  it("缓兵之计是唯一双标签牌(谋+攻)", () => {
    const multi = JINNANG_CARDS.filter((c) => c.tags.length === 2);
    expect(multi.map((c) => c.id)).toEqual(["缓兵之计"]);
    expect(multi[0].tags).toEqual(["谋", "攻"]);
  });

  it("牌库构成 15 张:按目录 copies 展平(缓兵之计 1,其余 2)", () => {
    expect(JINNANG_DECK_LIST.length).toBe(15);
    const counts = new Map(JINNANG_CARDS.map((c) => [c.id, 0]));
    for (const id of JINNANG_DECK_LIST) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const c of JINNANG_CARDS) {
      expect(counts.get(c.id)).toBe(c.copies);
    }
    expect(JINNANG_CARDS.find((c) => c.id === "缓兵之计")?.copies).toBe(1);
  });

  it("buildJinnangDeck 同 seed 同牌序;是 15 张的同一多重集", () => {
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
    expect(e.jinnangDeck.length).toBe(15 - 3);
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

  it("手牌上限 3:满手抽牌作废入弃牌堆(浮字+日志),手中牌不变", () => {
    const e = makeEngine(5);
    finishSetup(e);
    const p = e.players[0];
    e.drawJinnang(0, JINNANG_HAND_LIMIT); // 1 → 3(满)
    expect(p.jinnangHand.length).toBe(JINNANG_HAND_LIMIT);
    const discardBefore = e.jinnangDiscard.length;
    e.drawJinnang(0, 1); // 满手 → 作废
    expect(p.jinnangHand.length).toBe(JINNANG_HAND_LIMIT);
    expect(e.jinnangDiscard.length).toBe(discardBefore + 1);
    const msgs = e.presentation
      .drainFloaters()
      .filter((f) => f.kind === "msg")
      .map((f) => (f as { text: string }).text);
    expect(msgs.some((t) => t.includes("锦囊已满"))).toBe(true);
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

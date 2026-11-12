// 技能书全链(#1146,spec #1144 拆票 B/五)引擎单测:
//  ① 位满改发书:四渠道(招贤城/义士来投/以宝换贤/求贤令)位满不再得将,该次预掷授技
//     各印一册技能书按普通珍宝入位(零折现、不占招贤池);池空(名将已尽)折现不变。
//  ② 用书学技:出牌阶段命令,三态校验(0 名拒绝/1 名直学/多名按槽位序)、池序入槽、
//     lastFired 照新授技同款(不落键)、用后书消耗、skillLearned 事件。
//  ③ 同构:学技后的技能与招贤所得技同槽同账,时机派发/冷却零第二套。
//  ④ 快照:书实例(kind/skillId)随快照往返保真(新增字段允许,存量字段零删改)。
//  ⑤ bot 贪心:出牌阶段扫描珍宝位,可用书即用,多名同池按槽位序取首,零新随机。
// 骰流敏感点(位满分叉的掷将 1 掷 + 授技 1 掷)以同 seed 双引擎对跑断言可复现。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig, TurnPhase } from "@core/authority";
import type { EncounterDef } from "@core/encounters";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { HEROES } from "@core/heroes";
import { HERO_CAPACITY } from "@core/constants";
import {
  isSkillBook,
  makeSkillBook,
  SKILL_BOOK_LEVEL,
  SKILL_BOOK_ID_PREFIX,
} from "@core/treasures";
import type { TreasureDef } from "@core/treasures";
import { armHero, sweepTestHeroes, testEngine } from "@core/testing";
import { botAct } from "@core/bot";

// ── fixture 图:20 城全城池(招贤城 + 填充城;同 city-event.test 制式)──
function cityTile(i: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `tile-${i}`,
    name,
    pos: [i * 200, 0],
    group: "a",
    tier: "县",
    price: 1200,
    buildCost: 600,
    valueByLevel: [720, 1080, 1440, 1800],
    tradeAdd: [100, 200, 300, 600],
    tradeMult: [2, 3, 4, 5],
    ...extra,
  };
}

const FULL_TILES = [
  cityTile(0, "陈留"),
  cityTile(1, "招贤城", { event: "hero" }),
  ...Array.from({ length: 18 }, (_, i) => cityTile(2 + i, `填城${i + 1}`)),
];

function fixtureData(tiles: object[]) {
  return {
    version: 1,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
    maxLevel: 3,
    resupply: 1000,
    tiles: tiles.map((t) => ({ ...t })),
  };
}

const MAP = loadMap(fixtureData(FULL_TILES));

const SEATS: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
];

function makeEngine(seed = 7, encounter?: { enabled?: boolean }): GameEngine {
  const cfg: EngineConfig = {
    seats: SEATS,
    targetNetWorth: 30000,
    startingCash: 10000,
    startingTreasures: 0,
    ...(encounter ? { encounter: { enabled: true } } : {}),
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

function finishSetup(e: GameEngine) {
  e.doDraftRoll();
  let guard = 0;
  while (e.phase === "Setup" && guard++ < 50) {
    const idx = e.currentSetupPlayerIndex;
    if (idx < 0) break;
    if (e.players[idx].isBot) {
      e.aiSetupStep();
      continue;
    }
    e.pickCapital(idx, e.offeredCapitals[0]!);
  }
}

/** 麾下摆满(真将占位,占招贤池;skillIds 显式给定保确定性)。 */
function fillRoster(e: GameEngine, seat: number): void {
  const p = e.players[seat]!;
  for (let i = 0; i < HERO_CAPACITY; i++) {
    armHero(e, p, HEROES[i]!, [HEROES[i]!.skillPool[0]!]);
  }
}

/** 把一本书放进玩家珍宝位(布场直写;形状=makeSkillBook 单源产出)。 */
function armBook(e: GameEngine, seat: number, skillId: string): void {
  e.players[seat]!.treasures.push(makeSkillBook(skillId));
}

afterEach(() => sweepTestHeroes());

// ────────────────────────── 位满改发书:四渠道 ──────────────────────────
describe("位满改发书(#1146 四渠道统一)", () => {
  it("招贤城:位满不设候选(事件沉默契约不变),预掷授技印书入珍宝位、不占招贤池", () => {
    const e = makeEngine(23);
    finishSetup(e);
    const mover = e.activePlayer;
    fillRoster(e, 0);
    const cash0 = mover.cash;
    const heroes0 = [...e.recruitedHeroIds];
    testEngine(e).placeActive(1);
    testEngine(e).land(); // 招贤城落格
    expect(e.turnPhase).not.toBe("AwaitingHeroPick"); // 不设候选:位满不再走三选一
    expect(testEngine(e).logText()).not.toMatch(/招贤纳士/); // 事件沉默契约(收尾照旧)
    expect(mover.heroes.length).toBe(HERO_CAPACITY); // 不再得将
    expect(mover.cash).toBe(cash0); // 位满印书零折现
    expect([...e.recruitedHeroIds]).toEqual(heroes0); // 不占招贤池(将未入麾下)
    const books = mover.treasures.filter(isSkillBook);
    expect(books.length).toBeGreaterThanOrEqual(1); // 该次预掷授技各印一册
    for (const b of books) {
      expect(b.level).toBe(SKILL_BOOK_LEVEL);
      expect(b.id.startsWith(SKILL_BOOK_ID_PREFIX)).toBe(true);
      expect(b.name.startsWith("技能书·")).toBe(true);
    }
    // TreasureGained 时机照走珍宝通路(每册一条 treasureGained 事件)
    const gained = e.snapshot().events.filter((ev) => ev.kind === "treasureGained");
    expect(gained.length).toBe(books.length);
  });

  it("招贤城位满印书:骰流契约同 seed 复现(选将 1 掷 + 授技 1 掷,零新随机)", () => {
    const run = (seed: number) => {
      const e = makeEngine(seed);
      finishSetup(e);
      fillRoster(e, 0);
      testEngine(e).placeActive(1);
      testEngine(e).land();
      return e.activePlayer.treasures.filter(isSkillBook).map((b) => b.skillId);
    };
    expect(run(23)).toEqual(run(23)); // 同 seed 同书序(可复现)
  });

  it("机遇义士来投:位满改印书(零折现);池空名将已尽折现不变", () => {
    const e = makeEngine(7, { enabled: true });
    finishSetup(e);
    const mover = e.activePlayer;
    fillRoster(e, 0);
    const cash0 = mover.cash;
    const def: EncounterDef = {
      id: "义士来投",
      tier: "好运",
      tags: ["名将"],
      weight: 1,
      text: "义士来投",
      effect: { kind: "grantHero", fallbackCash: 200 },
    };
    testEngine(e).applyEncounter(mover, def);
    expect(mover.heroes.length).toBe(HERO_CAPACITY); // 不再得将
    expect(mover.cash).toBe(cash0); // 零折现
    expect(mover.treasures.filter(isSkillBook).length).toBeGreaterThanOrEqual(1);

    // 池空(名将已尽):折现不变(兜底语义与位满分叉互斥)
    const e2 = makeEngine(7, { enabled: true });
    finishSetup(e2);
    const mover2 = e2.activePlayer;
    for (const h of HEROES) e2.recruitedHeroIds.add(h.id);
    const cash02 = mover2.cash;
    testEngine(e2).applyEncounter(mover2, def);
    expect(mover2.treasures.filter(isSkillBook).length).toBe(0);
    expect(mover2.cash).toBe(cash02 + 200);
  });

  it("锦囊求贤令:位满改印书(零折现);骰流=选将 1 掷 + 授技 1 掷", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const user = e.activePlayer;
    fillRoster(e, 0);
    const cash0 = user.cash;
    user.jinnangHand.push("求贤令");
    user.jinnangHandCount = user.jinnangHand.length;
    e.turnPhase = "AwaitingJinnang";
    e.resolveJinnang("求贤令");
    expect(user.heroes.length).toBe(HERO_CAPACITY);
    expect(user.cash).toBe(cash0); // 零折现(fallbackCash=300 不发)
    expect(user.treasures.filter(isSkillBook).length).toBeGreaterThanOrEqual(1);
  });

  it("四渠道单喉:三种调用路径(招贤城/机遇/锦囊)印出的书形状同一(makeSkillBook 单源)", () => {
    const e = makeEngine(23);
    finishSetup(e);
    fillRoster(e, 0);
    testEngine(e).placeActive(1);
    testEngine(e).land();
    const book: TreasureDef = e.activePlayer.treasures.find(isSkillBook)!;
    expect(book).toEqual(makeSkillBook(book.skillId!)); // 形状=印书单源逐字段一致
  });
});

// ────────────────────────── 用书学技:命令与校验 ──────────────────────────
describe("用书学技(#1146 命令面)", () => {
  it("1 名可学:直接习得——池序入槽、lastFired 不落键(照新授技同款)、书消耗、skillLearned 事件", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, [HEROES[0]!.skillPool[0]!]); // 周瑜:槽内已有 疾行
    e.recruitedHeroIds.add(HEROES[0]!.id);
    const slot = me.heroes[0]!;
    armBook(e, 0, "leigu"); // 擂鼓书:周瑜池含 leigu 且未习得(池序 疾行→火攻→擂鼓,插末)
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "leigu", slot.heroId);
    expect(slot.skillIds).toEqual(
      HEROES[0]!.skillPool.filter((id) => id === "leigu" || slot.skillIds.includes(id)),
    );
    expect(slot.skillIds).toContain("leigu");
    expect(slot.lastFired["leigu"]).toBeUndefined(); // 无冷却负债(照新授技同款)
    expect(me.treasures.some((t) => t.id === SKILL_BOOK_ID_PREFIX + "leigu")).toBe(false); // 用后书消耗
    const ev = e.snapshot().events.find((x) => x.kind === "skillLearned");
    expect(ev).toMatchObject({
      kind: "skillLearned",
      seat: 0,
      heroId: slot.heroId,
      skillId: "leigu",
      treasureId: SKILL_BOOK_ID_PREFIX + "leigu",
    });
    expect(testEngine(e).logText()).toMatch(/习得/); // 战报 category:"skill"
  });

  it("池序插入:习得技按名将池声明序落位,不追加尾部", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    // 周瑜池 [疾行,火攻,擂鼓]:已有 火攻,习得 疾行 → 槽序 [疾行,火攻]
    armHero(e, me, HEROES[0]!, ["huogong"]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    const slot = me.heroes[0]!;
    armBook(e, 0, "jixing");
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "jixing", slot.heroId);
    expect(slot.skillIds).toEqual(["jixing", "huogong"]);
  });

  it("0 名可学(全池已习得):引擎拒绝、书保留=纯交易物", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, [...HEROES[0]!.skillPool]); // 整池已授
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armBook(e, 0, HEROES[0]!.skillPool[0]!);
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + HEROES[0]!.skillPool[0]!, me.heroes[0]!.heroId);
    expect(me.treasures.some(isSkillBook)).toBe(true); // 书保留(纯交易物)
    expect(e.snapshot().events.some((x) => x.kind === "skillLearned")).toBe(false);
  });

  it("0 名可学(麾下无将/无匹配将):引擎拒绝、书保留", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armBook(e, 0, "jixing");
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "jixing", "zhouyu"); // 无将:拒绝
    expect(me.treasures.some(isSkillBook)).toBe(true);
    // 有将但池不含此技:同样拒绝
    armHero(e, me, HEROES[1]!, [HEROES[1]!.skillPool[0]!]); // 曹丕(池无 jixing)
    e.recruitedHeroIds.add(HEROES[1]!.id);
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "jixing", me.heroes[0]!.heroId);
    expect(me.treasures.some(isSkillBook)).toBe(true);
    expect(me.heroes[0]!.skillIds).not.toContain("jixing");
  });

  it("非出牌阶段:引擎拒绝(assertPhase);目标段子状态内:跨子状态误用拒绝", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, [HEROES[0]!.skillPool[0]!]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armBook(e, 0, "leigu");
    e.turnPhase = "Roll"; // finishSetup 首手即出牌窗(开局发牌可出),显式摆 Roll 验相位闸
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "leigu", me.heroes[0]!.heroId);
    expect(me.treasures.some(isSkillBook)).toBe(true); // 未消耗
    e.turnPhase = "AwaitingJinnang";
    e.pendingJinnang = { cardId: "求贤令", stage: "one", picked: [] }; // 锦囊目标段挂起
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "leigu", me.heroes[0]!.heroId);
    expect(me.treasures.some(isSkillBook)).toBe(true); // 跨子状态误用拒绝
  });

  it("同构:学得的技与招贤所得技同槽同账——时机派发照常击发、冷却记本槽", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["huogong"]); // 周瑜:只授火攻
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armBook(e, 0, "jixing");
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "jixing", me.heroes[0]!.heroId);
    expect(me.heroes[0]!.skillIds).toContain("jixing");
    // 时机派发:BeforeMarch 击发学得的疾行(moveBonus +1),冷却账记本槽
    e.dispatchMoment("BeforeMarch", { subject: 0 });
    const ev = e.snapshot().events.find((x) => x.kind === "skillFired");
    expect(ev).toMatchObject({
      kind: "skillFired",
      heroId: me.heroes[0]!.heroId,
      skillId: "jixing",
    });
    expect(me.heroes[0]!.lastFired["jixing"]).toBeDefined();
  });

  it("出牌阶段可用:用书后窗口收口走 settleJinnangExit——学得的主动技即战力,窗不误收", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, [HEROES[0]!.skillPool[0]!]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armBook(e, 0, "leigu");
    armBook(e, 0, "huogong");
    me.jinnangHand = []; // 清开局手牌:书=可用项唯一来源(判据纯净)
    me.jinnangHandCount = 0;
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "leigu", me.heroes[0]!.heroId);
    expect(e.turnPhase).toBe("AwaitingJinnang"); // 尚有火攻书可用,窗口停留
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "huogong", me.heroes[0]!.heroId);
    // 书尽但学得的擂鼓/火攻都是主动技,照新授技同款即刻就绪——窗口停留是同构的正确结果
    expect(e.turnPhase).toBe("AwaitingJinnang");
    e.resolveJinnang(null); // 今不用 → 收卷
    expect<TurnPhase>(e.turnPhase).toBe("Roll");
  });

  it("出牌阶段可用:书尽且无其他可用项(纯被动书)→ 收卷进 Roll", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[1]!, ["fangzhu"]); // 曹丕:池全被动(放逐/行殇,#1378 池换血)
    e.recruitedHeroIds.add(HEROES[1]!.id);
    armBook(e, 0, "fangzhu");
    armBook(e, 0, "xingshang");
    me.jinnangHand = [];
    me.jinnangHandCount = 0;
    e.turnPhase = "AwaitingJinnang";
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "fangzhu", me.heroes[0]!.heroId);
    expect(e.turnPhase).toBe("AwaitingJinnang"); // 尚有行殇书
    e.resolveBookSkill(SKILL_BOOK_ID_PREFIX + "xingshang", me.heroes[0]!.heroId);
    expect<TurnPhase>(e.turnPhase).toBe("Roll"); // 书尽且被动技不入窗 → 收卷
  });
});

// ────────────────────────── 快照保真 ──────────────────────────
describe("技能书快照(#1146 新增字段零删改)", () => {
  it("书实例 kind/skillId 随快照往返保真;普通珍宝与存量形状零变", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armBook(e, 0, "jixing");
    me.treasures.push({ ...e.treasureDeck[0]! }); // 普通珍宝对照
    const mirror = makeEngine(7);
    mirror.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    const [book, plain] = mirror.activePlayer.treasures;
    expect(isSkillBook(book!)).toBe(true);
    expect(book!.skillId).toBe("jixing");
    expect(book!.name).toBe("技能书·疾行");
    expect(plain!.kind).toBeUndefined(); // 普通珍宝无 kind(存量形状零变)
    expect(plain!.skillId).toBeUndefined();
  });
});

// ────────────────────────── bot 贪心 ──────────────────────────
describe("bot 用书(#1146 可用即用、槽位序取首)", () => {
  it("出牌阶段扫描珍宝位:可用书即用,多名同池按槽位序取首,零新随机", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    // 两名池含 jixing 的将(张星彩/周瑜),槽位序 0=周瑜先入麾下
    armHero(e, me, HEROES[0]!, ["huogong"]);
    armHero(e, me, HEROES[2]!, ["leigu"]);
    for (const h of [HEROES[0]!, HEROES[2]!]) e.recruitedHeroIds.add(h.id);
    armBook(e, 0, "jixing");
    e.turnPhase = "AwaitingJinnang";
    botAct(e);
    expect(me.heroes[0]!.skillIds).toContain("jixing"); // 槽位序 0(周瑜)习得
    expect(me.heroes[1]!.skillIds).not.toContain("jixing");
    expect(me.treasures.some(isSkillBook)).toBe(false); // 书已消耗
  });

  it("无可学书时 bot 照常收卷(不卖书权衡:破产变卖路零特判)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armBook(e, 0, "jixing"); // 无将:书不可用
    me.jinnangHand = []; // 清开局手牌:免开局牌路(如求贤令送将)反转「无可学」前提
    me.jinnangHandCount = 0;
    e.turnPhase = "AwaitingJinnang";
    botAct(e);
    expect<TurnPhase>(e.turnPhase).toBe("Roll"); // 收卷,书保留
    expect(e.activePlayer.treasures.some(isSkillBook)).toBe(true);
  });
});

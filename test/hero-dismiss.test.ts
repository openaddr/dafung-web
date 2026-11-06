// 遣散全链(#1147,spec #1144 拆票 C/五)引擎单测:
//  ① 主链:名册遣散命令(dismissHero)——槽移除(冷却随槽消失)+回池划名(破产释放
//     同口径)+已学技逐册折书(makeSkillBook 单源、TreasureGained 时机零特判)+
//     heroDismissed 事件随批。
//  ② 回池再招:遣散后该将重进招贤候选,再招 = 全新实例(授技重新预掷、lastFired 空账)。
//  ③ 校验:目标不在麾下(含空册)拒绝;非己回合(Setup 期/他座决策窗)拒绝。
//  ④ 零特判实证:TreasureGained 监听技(得陇望蜀)随折书逐册击发——折书走珍宝现通路。
//  ⑤ 快照契约:遣散后状态随快照往返保真(零 schema 变更,纯命令+事件流转)。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { HEROES } from "@core/heroes";
import { makeSkillBook, SKILL_BOOK_ID_PREFIX } from "@core/treasures";
import { armHero, sweepTestHeroes, testEngine } from "@core/testing";
import { dismissHero } from "@core/hero-dismiss";

// ── fixture 图:20 城全城池(同 skill-book.test 制式)──
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

function makeEngine(seed = 7): GameEngine {
  const cfg: EngineConfig = {
    seats: SEATS,
    targetNetWorth: 30000,
    startingCash: 10000,
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

afterEach(() => sweepTestHeroes());

// ────────────────────────── 主链:遣散 = 槽移除 + 回池 + 折书 ──────────────────────────
describe("遣散主链(#1147)", () => {
  it("遣散:槽移除(冷却随槽消失)+回池划名+已学技逐册折书+heroDismissed 事件", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["jixing", "huogong"]); // 周瑜:已学 疾行+火攻
    e.recruitedHeroIds.add(HEROES[0]!.id);
    me.heroes[0]!.lastFired["jixing"] = 5; // 冷却账随槽(布场直写)
    const cash0 = me.cash;
    const treasures0 = me.treasures.length;

    dismissHero(e, "zhouyu");

    expect(me.heroes.length).toBe(0); // 槽移除(冷却账随槽俱弃,无孤儿键)
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false); // 回池划名(破产释放同口径)
    expect(me.cash).toBe(cash0); // 免费(无声望/银两代价;与破产变卖 200 两分流)
    // 已学技逐册折书:两技两册,id=skillbook-<skillId>(同 id 复用,无流水号)
    const books = me.treasures.slice(treasures0);
    expect(books.map((b) => b.id)).toEqual([
      SKILL_BOOK_ID_PREFIX + "jixing",
      SKILL_BOOK_ID_PREFIX + "huogong",
    ]);
    for (const b of books) expect(b).toEqual(makeSkillBook(b.skillId!)); // 形状=印书单源
    // heroDismissed 事件随批(skillIds=折书明细随事件走)
    const ev = e.snapshot().events.find((x) => x.kind === "heroDismissed");
    expect(ev).toMatchObject({ kind: "heroDismissed", seat: 0, heroId: "zhouyu" });
    expect([...(ev as { skillIds: string[] }).skillIds].sort()).toEqual(["huogong", "jixing"]);
    // TreasureGained 时机零特判:每册一条 treasureGained 事件(珍宝现通路)
    const gained = e.snapshot().events.filter((x) => x.kind === "treasureGained");
    expect(gained.map((x) => (x as { treasureId: string }).treasureId)).toEqual([
      SKILL_BOOK_ID_PREFIX + "jixing",
      SKILL_BOOK_ID_PREFIX + "huogong",
    ]);
    // 战报:主行 + 逐册行
    const text = testEngine(e).logText();
    expect(text).toMatch(/遣散「周瑜」/);
    expect(text).toMatch(/技能书·疾行/);
    expect(text).toMatch(/技能书·火攻/);
  });

  it("独门技折书=纯交易物:零特判实证——TreasureGained 监听技(得陇望蜀)逐册击发", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["jixing", "huogong", "leigu"]); // 周瑜三技(独门技也在内)
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armHero(e, me, HEROES[7]!, ["delongwangshu"]); // 糜竺:得陇望蜀(TreasureGained self +100)
    e.recruitedHeroIds.add(HEROES[7]!.id);
    const cash0 = me.cash;

    dismissHero(e, "zhouyu");

    // 三册折书 → 得陇望蜀击发三次(+100/册):折书走珍宝入位派发,监听技白得零特判
    expect(me.cash).toBe(cash0 + 300);
    const fired = e
      .snapshot()
      .events.filter(
        (x) => x.kind === "skillFired" && (x as { skillId: string }).skillId === "delongwangshu",
      );
    expect(fired.length).toBe(3);
    // 三技三册同 id 命名空间:书 id 逐技唯一(同技多册同 id 由同构测试覆盖,此处三技各异)
    expect(me.treasures.filter((t) => t.kind === "book").length).toBe(3);
  });

  it("同技多册=同 id 多册:两将共享技各遣散一次,书同 id 并存", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["jixing"]); // 周瑜:疾行
    e.recruitedHeroIds.add(HEROES[0]!.id);
    armHero(e, me, HEROES[2]!, ["jixing"]); // 张星彩:疾行(共享技)
    e.recruitedHeroIds.add(HEROES[2]!.id);

    dismissHero(e, "zhouyu");
    dismissHero(e, "zhangxingcai");

    const books = me.treasures.filter((t) => t.id === SKILL_BOOK_ID_PREFIX + "jixing");
    expect(books.length).toBe(2); // 同技两册,同 id 多手共存(锦囊手牌同款)
    expect(me.heroes.length).toBe(0);
  });
});

// ────────────────────────── 回池再招:全新实例 ──────────────────────────
describe("遣散回池再招(#1147)", () => {
  it("回池后重进招贤候选;再招=全新实例:预掷重新、lastFired 空账(冷却不遗留)", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["huogong"]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    me.heroes[0]!.lastFired["huogong"] = 3;
    // 其余七将全部占池:遣散周瑜后候选池恰剩周瑜一名(断言确定性)
    for (const h of HEROES) {
      if (h.id !== "zhouyu") e.recruitedHeroIds.add(h.id);
    }
    me.treasures.length = 0; // 清折书:判据纯净(折书主链已有专测)

    dismissHero(e, "zhouyu");
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false);

    // 招贤:候选恰含周瑜(回池划名生效),预掷=rollGrantedSkills 现掷
    const r = e.tryRecruitHero(me);
    expect(r).toBe("offered");
    expect(e.offeredHeroes.map((o) => o.def.id)).toEqual(["zhouyu"]);
    e.resolveHeroPick(0);
    const slot = me.heroes.find((s) => s.heroId === "zhouyu");
    expect(slot).toBeDefined();
    expect(Object.keys(slot!.lastFired)).toEqual([]); // 全新实例:冷却账不遗留
    expect(slot!.skillIds.length).toBeGreaterThanOrEqual(1); // 授技重新预掷(至少一技)
    for (const id of slot!.skillIds) expect(HEROES[0]!.skillPool).toContain(id); // 池绑定
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(true); // 再占池
  });
});

// ────────────────────────── 校验:目标与回合 ──────────────────────────
describe("遣散校验(#1147)", () => {
  it("目标不在麾下(含空册):拒绝,零状态变更", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    dismissHero(e, "zhouyu"); // 空册
    expect(me.heroes.length).toBe(0);
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false);
    armHero(e, me, HEROES[1]!, ["yuli"]); // 有将但遣散别人
    e.recruitedHeroIds.add(HEROES[1]!.id);
    dismissHero(e, "zhouyu");
    expect(me.heroes.length).toBe(1); // 目标不在麾下:麾下不动
    expect(me.treasures.length).toBe(0); // 零折书
    expect(e.snapshot().events.some((x) => x.kind === "heroDismissed")).toBe(false);
  });

  it("非己回合:Setup 期拒绝;他座决策窗(珍宝交涉城主视角)拒绝", () => {
    const e2 = makeEngine(7); // Setup 期(未 finishSetup)
    const p2 = e2.players[0]!;
    armHero(e2, p2, HEROES[0]!, ["jixing"]);
    e2.recruitedHeroIds.add(HEROES[0]!.id);
    dismissHero(e2, "zhouyu");
    expect(p2.heroes.length).toBe(1); // Setup 期不可遣散

    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["jixing"]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    // 他人回合的珍宝交涉决策窗:decisionOwner=城主(座 1)≠ 行动者(座 0)——遣散拒绝
    e.turnPhase = "AwaitingTreasureOwner";
    e.treasureVisitor = { def: e.catalog.get("tile-2")!, ownerIdx: 1 };
    const heroes0 = me.heroes.length;
    dismissHero(e, "zhouyu");
    expect(me.heroes.length).toBe(heroes0); // 麾下不动
    expect(me.treasures.length).toBe(0);
  });
});

// ────────────────────────── 快照契约(#1147 零 schema 变更)──────────────────────────
describe("遣散快照(#1147)", () => {
  it("遣散后状态随快照往返保真:槽已删/折书在位(含 kind/skillId)/回池划名", () => {
    const e = makeEngine(7);
    finishSetup(e);
    const me = e.activePlayer;
    armHero(e, me, HEROES[0]!, ["jixing"]);
    e.recruitedHeroIds.add(HEROES[0]!.id);
    dismissHero(e, "zhouyu");
    const mirror = makeEngine(7);
    mirror.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    const mp = mirror.players[0]!;
    expect(mp.heroes.length).toBe(0);
    expect(mirror.recruitedHeroIds.has("zhouyu")).toBe(false);
    const book = mp.treasures.find((t) => t.kind === "book");
    expect(book).toBeDefined();
    expect(book!.skillId).toBe("jixing");
    expect(book!.name).toBe("技能书·疾行");
  });
});

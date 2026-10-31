// 特殊城池事件字段与落格链序(#823/#824/#826,ADR-0037):引擎缝单测。
// fixture 图定种子自证整条落格链:事件城免掷随机机遇、固定事件先于交易链、
// 访客/城主触发语义、池空/满员沉默(#826 起功能格退役,盘面只剩城池)。
// 测试只走外部行为(装载器产出 / 引擎相位·日志·公共状态),不碰内部实现。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { loadMap } from "@core/board-loader";
import { HEROES } from "@core/heroes";
import { HERO_CAPACITY } from "@core/constants";
import { armHero, sweepTestHeroes, testEngine } from "@core/testing";

// ── fixture 图:20 城全城池(普通×1 + 事件城×5 + 填充城×14,#826 起无第三种格子)──
function cityTile(i: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `tile-${i}`,
    name,
    pos: [i * 200, 0],
    group: "a",
    price: 1200,
    buildCost: 600,
    valueByLevel: [720, 1080, 1440, 1800],
    tradeAdd: [100, 200, 300, 600],
    tradeMult: [2, 3, 4, 5],
    ...extra,
  };
}

// 格位:0 普通 / 1 招贤 / 2 锦囊 / 3 天命 / 4 商市 / 5 宝藏(event:treasure);
// 6–19 填充城(都城席位与掷骰路径由此远离落格目标,任何 die 1–6 × 目标 0–5 组合
// 都不撞都城通路)。
const FULL_TILES = [
  cityTile(0, "陈留"),
  cityTile(1, "招贤城", { event: "hero" }),
  cityTile(2, "锦囊城", { event: "jinnang" }),
  cityTile(3, "天命城", { event: "fate" }),
  cityTile(4, "商市城", { event: "market" }),
  cityTile(5, "宝藏城", { event: "treasure" }),
  ...Array.from({ length: 14 }, (_, i) => cityTile(6 + i, `填城${i + 1}`)),
];

function fixtureData(tiles: object[]) {
  return {
    version: 1,
    targetNetWorth: 30000,
    startingCash: 10000,
    maxLevel: 3,
    resupply: 1000,
    tiles: tiles.map((t) => ({ ...t })), // 逐格浅拷贝:非法值用例的直写改动不泄给共享 FULL_TILES
  };
}

const MAP = loadMap(fixtureData(FULL_TILES));

const SEATS: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
];

function makeEngine(
  seed = 7,
  encounter?: { good?: number; neutral?: number; bad?: number },
): GameEngine {
  const cfg: EngineConfig = {
    seats: SEATS,
    targetNetWorth: 30000,
    ...(encounter
      ? {
          encounter: {
            enabled: true,
            baseRates: {
              good: encounter.good ?? 34,
              neutral: encounter.neutral ?? 33,
              bad: encounter.bad ?? 33,
            },
          },
        }
      : {}),
  };
  return new GameEngine(MAP.board, MAP.catalog, createDice(seed), cfg);
}

/** 定 seat 都城重置(测试布场):退选都草都、换驻固定城(持有/迁城/建都即持语义同
 *  pickCapital,不掷骰)——都城落位与落格目标解耦,通路碰撞归零。 */
function reseatCapital(e: GameEngine, seat: number, tileIndex: number): void {
  const p = e.players[seat];
  const oldId = e.board.at(p.capitalIndex).propertyId!;
  p.properties = p.properties.filter((h) => h.propertyId !== oldId);
  const def = e.catalog.get(e.board.at(tileIndex).propertyId!)!;
  p.properties.push({ propertyId: def.id, group: def.group, level: 0, maxLevel: def.maxLevel });
  p.capitalIndex = tileIndex;
  p.position = tileIndex;
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
    e.pickCapital(idx, e.offeredCapitals[0]!); // 三选一首项(候选外落子会被引擎拒绝)
  }
  reseatCapital(e, 0, 12); // 都城钉在填充城:落格目标 0–9 的任何掷骰路径都不途经都城
  reseatCapital(e, 1, 13);
}

function passJinnang(e: GameEngine): GameEngine {
  while (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

function peekDie(e: GameEngine): number {
  const probe = createDice(0);
  probe.setRngState(e.dice.getRngState());
  return probe.roll().die;
}

/** 挪位后掷骰,恰好落在 targetTile(真掷骰路径:过 settleMarchLanding 机遇挂点)。
 *  落点/途经不得是自己都城——都城通路(补给+招贤/驻跸)是另一条分流,不属本票落格链。 */
function landActiveOn(e: GameEngine, targetTile: number): void {
  const p = e.activePlayer;
  if (targetTile === p.capitalIndex) throw new Error(`场景无效:落点是自己都城`);
  const die = peekDie(e);
  const n = e.board.count;
  const from = (((targetTile - die) % n) + n) % n;
  const passesCapital = Array.from({ length: die }, (_, i) => (from + 1 + i) % n).some(
    (t) => t === p.capitalIndex && t !== targetTile,
  );
  if (passesCapital) throw new Error(`场景无效:途经都城`);
  testEngine(e).placeActive(from);
  passJinnang(e).rollAndMove();
}

// ────────────────────────── 装载缝(#824 AC1)──────────────────────────
describe("装载器 event 字段(#824)", () => {
  it("五类合法 event 全接受并落到 TileDef;普通城无 event 合法", () => {
    const m = loadMap(fixtureData(FULL_TILES));
    expect(m.tiles[1].event).toBe("hero");
    expect(m.tiles[2].event).toBe("jinnang");
    expect(m.tiles[3].event).toBe("fate");
    expect(m.tiles[4].event).toBe("market");
    expect(m.tiles[5].event).toBe("treasure");
    expect(m.tiles[0].event).toBeUndefined(); // 可选字段的语义:这块地有没有固定事件
    expect(m.properties.length).toBe(20); // 全城池制(#826):每格都是城池、同权入册
    for (const t of m.tiles) expect(t.propertyId).toBe(`tile-${t.index}`); // propertyId = tile id(全城池制恒在)
  });

  it("非法 event 值响亮报错", () => {
    const d = fixtureData(FULL_TILES);
    (d.tiles[0] as Record<string, unknown>).event = "blessing";
    expect(() => loadMap(d)).toThrow(/event/);
  });

  it("格型白名单外(type 非 Property)响亮报错:#826 五型+珍宝城格型全量退役", () => {
    const d = fixtureData(FULL_TILES);
    (d.tiles[0] as Record<string, unknown>).type = "Nonexistent";
    expect(() => loadMap(d)).toThrow(/type/);
  });
});

// ──────────────── 落格链缝:机遇门 + 触发语义(#824 AC2/AC3)────────────────
describe("事件城落格链(#824)", () => {
  it("机遇总开关开:普通城掷出机遇,事件城不掷(固定事件照常触发)", () => {
    const rates = { good: 34, neutral: 33, bad: 33 };
    const a = makeEngine(11, rates);
    finishSetup(a);
    landActiveOn(a, 0); // 普通城:机遇必出照旧
    expect(testEngine(a).logText()).toMatch(/机遇/);

    const b = makeEngine(11, rates);
    finishSetup(b);
    landActiveOn(b, 1); // 招贤城:免掷随机机遇,固定事件接管
    expect(testEngine(b).logText()).not.toMatch(/机遇/);
    expect(b.turnPhase).toBe("AwaitingHeroPick");
  });

  it("固定事件先于交易链:招贤解完才进可购决策", () => {
    const e = makeEngine(13);
    finishSetup(e);
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingHeroPick");
    const t = testEngine(e);
    const offerIdx = t.logText().indexOf("招贤纳士");
    e.resolveHeroPick(0);
    const text = t.logText();
    const buyIdx = text.indexOf("可购");
    expect(offerIdx).toBeGreaterThanOrEqual(0);
    expect(buyIdx).toBeGreaterThan(offerIdx); // 事件先于交易链
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "tile-1" });
  });

  it("访客落城主事件城:事件照出、珍宝交涉照常(付费通路仅访客)", () => {
    const e = makeEngine(17);
    finishSetup(e);
    const mover = e.activePlayer;
    const owner = e.players[e.players.findIndex((p) => p !== mover)]; // 城主=非活跃座位
    owner.properties.push({ propertyId: "tile-1", group: "a", level: 0, maxLevel: 3 });
    owner.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" });
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingHeroPick"); // 固定事件对一切落地者无差别
    e.resolveHeroPick(0);
    expect(e.turnPhase).toBe("AwaitingTreasureOwner"); // 交易链照常:访客交涉通路
    expect(e.activePlayer).toBe(mover);
  });

  it("城主落己事件城:有事件、无租(扩军决策,零付款)", () => {
    const e = makeEngine(19);
    finishSetup(e);
    const p = e.activePlayer;
    p.properties.push({ propertyId: "tile-1", group: "a", level: 0, maxLevel: 3 });
    const cash0 = p.cash;
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingHeroPick"); // 城主落地有事件
    e.resolveHeroPick(0);
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(e.pendingLand).toEqual({ kind: "OwnProperty", propertyId: "tile-1" });
    expect(p.cash).toBe(cash0); // 无租:除事件效果外零现金变动
  });

  it("招贤池空:事件沉默、交易链照常", () => {
    const e = makeEngine(41);
    finishSetup(e);
    for (const h of HEROES) e.recruitedHeroIds.add(h.id);
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingDecision"); // 直入交易链
    expect(testEngine(e).logText()).not.toMatch(/招贤纳士/); // 事件沉默
  });

  it("麾下满员:事件沉默、交易链照常", () => {
    const e = makeEngine(43);
    finishSetup(e);
    const p = e.activePlayer;
    for (let i = 0; i < HERO_CAPACITY; i++) armHero(e, p, HEROES[i]!);
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingDecision");
    expect(testEngine(e).logText()).not.toMatch(/招贤纳士/);
  });

  it("event:'treasure' 珍宝城(#825 接线):免掷机遇、探宝先行、续进交易链", () => {
    const e = makeEngine(47, { good: 34, neutral: 33, bad: 33 });
    finishSetup(e);
    const mover = e.activePlayer;
    e.treasureDeck = [{ id: "probe-t", name: "拼点必得宝", level: 1, count: 1, desc: "" }];
    landActiveOn(e, 5);
    expect(testEngine(e).logText()).not.toMatch(/机遇/); // 事件城免掷(分流按 event 字段)
    expect(mover.treasures.map((t) => t.id)).toEqual(["probe-t"]); // 探宝已在落格先行(#825)
    expect(e.turnPhase).toBe("AwaitingDecision"); // 探宝毕续进交易链(tile-5 无主 → 可购决策)
  });

  it("招贤城固定事件待续跑标记随快照走(恢复后解招贤续交易链)", () => {
    const e = makeEngine(53);
    finishSetup(e);
    landActiveOn(e, 1);
    expect(e.turnPhase).toBe("AwaitingHeroPick");
    const mirror = makeEngine(53);
    mirror.restoreFromSnapshot(JSON.parse(JSON.stringify(e.snapshot())));
    expect(mirror.turnPhase).toBe("AwaitingHeroPick");
    mirror.resolveHeroPick(0);
    expect(mirror.turnPhase).toBe("AwaitingDecision"); // 续跑交易链,不丢
    expect(mirror.pendingLand).toEqual({ kind: "PropertyAvailable", propertyId: "tile-1" });
  });
});

// ──────────── 四类固定事件各自结算(#824 AC4;#826 起事件城是唯一承载)────────────
describe("四类固定事件各自结算(#826)", () => {
  afterEach(() => sweepTestHeroes());

  it("招贤城:三选一明牌流(候选生成定种子可复现)", () => {
    const h1 = makeEngine(23);
    finishSetup(h1);
    landActiveOn(h1, 1);
    expect(h1.turnPhase).toBe("AwaitingHeroPick");
    expect(h1.offeredHeroes).toHaveLength(3); // 明牌三选一
    expect(new Set(h1.offeredHeroes.map((o) => o.def.id)).size).toBe(3);
    const h2 = makeEngine(23);
    finishSetup(h2);
    landActiveOn(h2, 1);
    expect(h2.offeredHeroes.map((o) => o.def.id)).toEqual(h1.offeredHeroes.map((o) => o.def.id));
    expect(h2.offeredHeroes.map((o) => o.skillIds)).toEqual(
      h1.offeredHeroes.map((o) => o.skillIds),
    );
  });

  it("锦囊城:落格必抽 1 张(牌序同种子可复现),续进交易链", () => {
    const j = makeEngine(29);
    finishSetup(j);
    const jMover = j.activePlayer;
    const jhand0 = jMover.jinnangHand.length;
    landActiveOn(j, 2); // 锦囊城
    expect(jMover.jinnangHand.length).toBe(jhand0 + 1); // 落格必抽 1
    const j2 = makeEngine(29);
    finishSetup(j2);
    landActiveOn(j2, 2);
    expect(j2.jinnangDeck).toEqual(j.jinnangDeck); // 同种子同牌序消耗
    expect(j.turnPhase).toBe("AwaitingDecision"); // 抽完续交易链
    expect(testEngine(j).logText()).toMatch(/抽一张锦囊/);
  });

  it("天命城:+20 声望,±100 夹紧沿用", () => {
    const f2 = makeEngine(31);
    finishSetup(f2);
    const m2 = f2.activePlayer;
    landActiveOn(f2, 3); // 天命城
    expect(m2.reputation).toBe(20);
    const f3 = makeEngine(31);
    finishSetup(f3);
    const m3 = f3.activePlayer;
    m3.reputation = 95;
    landActiveOn(f3, 3);
    expect(m3.reputation).toBe(100); // 夹紧 +100
  });

  it("商市城:随机行情 ±100–200,行情落账后续进交易链", () => {
    const m = makeEngine(37);
    finishSetup(m);
    const mMover = m.activePlayer;
    const m0 = mMover.cash;
    landActiveOn(m, 4); // 商市城
    const swing = mMover.cash - m0;
    expect(Math.abs(swing)).toBeGreaterThanOrEqual(100);
    expect(Math.abs(swing)).toBeLessThanOrEqual(200);
    expect(m.turnPhase).toBe("AwaitingDecision"); // 行情落账后续交易链
  });
});

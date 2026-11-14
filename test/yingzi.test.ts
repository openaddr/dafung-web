// 英姿七面骰(#1390,spec #1386 周瑜重做):静态被动技首例——掷骰面数数据化。
// 判层自查(ADR-0062):守的是引擎规则面(面数推导/三路掷骰/钉骰契约),全走层①②
// 无头单测——签面字表「七」= 数据表(constants.SIGN_FACES)逐字钉在本件,不轻上 e2e
// (呈现面 DiceOverlay/DuelSignsOverlay/HandZone 全部直读 SIGN_FACES 单源,字表对
// 呈现是结构性保证,无第二处字面可漂)。
// 缝约定同 test/skill-expansion.test.ts(makeEngine/finishSetup/走廊布场模式复制,
// 不 import 测试文件;只测引擎公共面);行军走廊同口径(街亭 P14 起步,骰 7 落赤壁)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice, DEFAULT_DIE_FACES, type Dice } from "@core/dice";
import { SIGN_FACES } from "@core/constants";
import { HEROES } from "@core/heroes";
import {
  YINGZI_SKILL_ID,
  heroDieFaces,
  isActiveSkill,
  isStaticSkill,
  isTriggerSkill,
  skillById,
} from "@core/skills";
import { resolveDuel } from "@core/reaction-window";
import { beginGameEventBatch } from "@core/game-events";
import type { GameEvent } from "@core/game-events";
import { armHero } from "@core/testing";
import { pinDice } from "@core/planter";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
];
const SEATS4: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: false, guohao: "蜀" },
  { name: "C", isBot: false, guohao: "吴" },
  { name: "D", isBot: false, guohao: "群" },
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

/** 驱动选都到完成(人类选第一个空城);全员手牌清空(锦囊相位 inert)。 */
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

/** 给 seat 布一槽只授 skillIds 的名将(实将入槽,防招贤池/骰流干扰)。 */
function arm(e: GameEngine, seat: number, heroId: string, skillIds: string[]) {
  const hero = HEROES.find((h) => h.id === heroId);
  if (hero == null) throw new Error(`测试布场:名将 ${heroId} 不在 HEROES(数据 bug)`);
  armHero(e, e.players[seat], hero, skillIds);
}

// ── 行军走廊(关中环位,同 test/skill-expansion.test.ts 口径):街亭 P14 起步,骰 7 落赤壁 ──
const AT = (pid: string) => MAP.board.tiles.find((t) => t.propertyId === pid)!.index;
const START = AT("prop-jieting"); // 街亭 P14
const LAND7 = AT("prop-chibi"); // 赤壁 P21:骰 7 落点(环位 14+7)
const PATH_IDX = [AT("prop-xianyang"), AT("prop-liangzhou"), AT("prop-hangu"), LAND7];

/** 走廊布场:全员让出走廊房产、双方都城挪出路径(长安 P0/辽东 P3)、mover 摆到街亭、
 *  置 Roll 相位。骰值由调用方 pinDice 钉(契约通道本身即被测面)。 */
function marchCorridor(e: GameEngine, moverSeat: number) {
  for (const p of e.players) {
    p.properties = p.properties.filter(
      (h) =>
        !PATH_IDX.includes(MAP.board.tiles.findIndex((t) => t.propertyId === h.propertyId)) &&
        h.propertyId !== "prop-jieting",
    );
  }
  e.players[moverSeat].capitalIndex = AT("prop-changan");
  for (let i = 0; i < e.players.length; i++) {
    if (i !== moverSeat) e.players[i].capitalIndex = AT("prop-liaodong");
  }
  e.players[moverSeat].position = START;
  e.turnPhase = "Roll";
}

/** 拼点结算事件速读(同 test/reaction-window.test.ts 口径)。 */
const duelEventsOf = (e: GameEngine) =>
  e
    .snapshot()
    .events.filter(
      (ev): ev is Extract<GameEvent, { kind: "duelResolved" }> => ev.kind === "duelResolved",
    );

const logText = (e: GameEngine) => e.log.map((l) => `${l.brief} ${l.detail}`).join("\n");

describe("英姿:数据形制与面数查询口(#1390)", () => {
  it("技表钉:英姿=静态被动三形(id/名/desc 逐字=规格 #1386 定稿原文),非时机技非主动技", () => {
    const s = skillById(YINGZI_SKILL_ID);
    expect(isStaticSkill(s)).toBe(true);
    expect(isTriggerSkill(s)).toBe(false);
    expect(isActiveSkill(s)).toBe(false);
    expect([s.id, s.name, s.desc]).toEqual([
      YINGZI_SKILL_ID,
      "英姿",
      "你的骰子增加1面，此面值递增1。",
    ]);
  });

  it("签面字表钉(呈现面单源):「一」~「七」七面,#1390 扩七", () => {
    expect(SIGN_FACES).toEqual(["一", "二", "三", "四", "五", "六", "七"]);
    expect(SIGN_FACES).toHaveLength(DEFAULT_DIE_FACES + 1);
  });

  it("heroDieFaces 单源:无英姿六面;持英姿(麾下已授技推导)七面;他人持技不串账", () => {
    const e = prepared();
    expect(heroDieFaces(e, 0)).toBe(6); // 麾下空
    arm(e, 0, "zhouyu", ["huogong"]); // 持周瑜但未授英姿
    expect(heroDieFaces(e, 0)).toBe(6);
    arm(e, 0, "zhouyu", [YINGZI_SKILL_ID]); // 第二槽授英姿
    expect(heroDieFaces(e, 0)).toBe(7);
    expect(heroDieFaces(e, 1)).toBe(6); // 他人不串账
    expect(() => heroDieFaces(e, 9)).toThrow(); // 越界座位响亮炸
  });
});

describe("英姿:掷骰三路七面(可达且按 7 结算)", () => {
  it("行军:持英姿掷出 7 可达——按 7 步落格、签面「七」、无加成括注", () => {
    const e = prepared();
    const moverSeat = e.players.indexOf(e.activePlayer);
    arm(e, moverSeat, "zhouyu", [YINGZI_SKILL_ID]);
    marchCorridor(e, moverSeat);
    pinDice(e, "march", [7]); // 契约合法面:持英姿钉 7
    e.rollAndMove();
    expect(e.players[moverSeat].position).toBe(LAND7);
    const roll = e.log.filter((l) => l.category === "roll").pop()!;
    expect(roll.brief).toContain("七"); // 签面字表随域(SIGN_FACES 单源)
    expect(roll.detail).toContain("die=7");
    expect(roll.detail).toContain("bonus=0"); // 面数非步数加成:零加成(七面 ≠ +N 步)
  });

  it("行军对照:无英姿者仍六面——钉 7 在消费点响亮炸(点名场景),掷 6 照常", () => {
    const e = prepared();
    const moverSeat = e.players.indexOf(e.activePlayer);
    marchCorridor(e, moverSeat);
    pinDice(e, "march", [7]); // 种植点放行 1..7;无英姿消费时炸
    expect(() => e.rollAndMove()).toThrow(/钉值 7 超本次掷骰面数 6/);
    // 同一场换钉 6:六面世界行军照常(替身消费炸前已耗尽自还原,可重钉)
    pinDice(e, "march", [6]);
    e.rollAndMove();
    expect(e.players[moverSeat].position).toBe(START + 6);
  });

  it("拼点:持英姿方掷出 7 可达且按 7 结算(胜过 5);无英姿方消费 7 炸", () => {
    const e = prepared();
    const moverSeat = e.players.indexOf(e.activePlayer);
    const ownerSeat = moverSeat === 0 ? 1 : 0;
    arm(e, moverSeat, "zhouyu", [YINGZI_SKILL_ID]);
    pinDice(e, "duel", [5, 7]); // a=城主(无英姿)5;b=行人(持英姿)7
    beginGameEventBatch(e);
    const duel = resolveDuel(e, ownerSeat, moverSeat);
    expect(duel).toEqual({ aRoll: 5, bRoll: 7, winnerSeat: moverSeat });
    expect(duelEventsOf(e)[0]).toMatchObject({ aRoll: 5, bRoll: 7, winnerSeat: moverSeat });
    // 无英姿拼点方消费 7:消费点响亮炸(a 方面数 6)
    const e2 = prepared();
    pinDice(e2, "duel", [7, 1]);
    expect(() => resolveDuel(e2, 0, 1)).toThrow(/钉值 7 超本次掷骰面数 6/);
  });

  it("探宝拼点:持英姿双骰各 7 面(7+7=14 得宝);无英姿对照 6+6=12", () => {
    const e = prepared();
    const mover = e.activePlayer;
    arm(e, e.players.indexOf(mover), "zhouyu", [YINGZI_SKILL_ID]);
    const real = e.dice;
    (e as unknown as { dice: Dice }).dice = {
      roll: (faces?: number) => real.roll(faces),
      rollDie: (faces?: number) => real.rollDie(faces),
      nextFloat: () => 0.99, // 探宝抽签与双骰同流:1+floor(0.99*faces)=7
      getRngState: () => 0,
      setRngState: () => {},
    };
    e.drawTreasureAt(mover, "探宝测试城");
    expect(logText(e)).toContain("拼点 7+7=14"); // 第七面可达且按 7 结算
    expect(mover.treasures).toHaveLength(1);
    // 无英姿对照:双骰各 6 面(6+6=12)——同流同源,差面数一处
    const e2 = prepared();
    const mover2 = e2.activePlayer;
    const real2 = e2.dice;
    (e2 as unknown as { dice: Dice }).dice = {
      roll: (faces?: number) => real2.roll(faces),
      rollDie: (faces?: number) => real2.rollDie(faces),
      nextFloat: () => 0.99,
      getRngState: () => 0,
      setRngState: () => {},
    };
    e2.drawTreasureAt(mover2, "探宝测试城");
    expect(logText(e2)).toContain("拼点 6+6=12");
  });
});

describe("英姿:不波及面(定序/掷金涟漪)", () => {
  it("开局定序掷骰仍六面:招募前发生,麾下有英姿亦不接面数查询口(缺省语义)", () => {
    const e = makeEngine(42, SEATS4);
    arm(e, 0, "zhouyu", [YINGZI_SKILL_ID]); // 招募前预布英姿(极限布景)
    const calls: (number | undefined)[] = [];
    const real = e.dice;
    (e as unknown as { dice: Dice }).dice = {
      roll: (faces?: number) => real.roll(faces),
      rollDie: (faces?: number) => {
        calls.push(faces);
        return real.rollDie(faces);
      },
      nextFloat: () => real.nextFloat(),
      getRngState: () => real.getRngState(),
      setRngState: (a: number) => real.setRngState(a),
    };
    e.doDraftRoll();
    expect(e.draftRolls).toHaveLength(4);
    for (const r of e.draftRolls) expect(r).toBeLessThanOrEqual(6); // 六面:无 7
    for (const c of calls) expect(c).toBeUndefined(); // 定序掷骰不传面数(缺省语义,不接查询口)
    expect(e.draftOrder).toHaveLength(4);
  });

  it("掷金横涟漪(知情断言):周瑜掷 7 不触发「掷出 6」;对照掷 6 照常 +20", () => {
    const holderSetup = (seed: number) => {
      const eng = prepared(seed);
      const moverSeat = eng.players.indexOf(eng.activePlayer);
      const holderSeat = (moverSeat + 1) % eng.players.length;
      arm(eng, moverSeat, "zhouyu", [YINGZI_SKILL_ID]);
      arm(eng, holderSeat, "zhangxingcai", ["zhijin"]); // 掷金:任意人掷 6 +20
      marchCorridor(eng, moverSeat);
      return { eng, holderSeat };
    };
    // 掷 7(英姿第七面):掷金条件 face=6 不满足,+0
    const a = holderSetup(42);
    const cash0 = a.eng.players[a.holderSeat].cash;
    pinDice(a.eng, "march", [7]);
    a.eng.rollAndMove();
    expect(a.eng.players[a.holderSeat].cash).toBe(cash0);
    // 对照掷 6:掷金 +20(布场自证)
    const b = holderSetup(42);
    const cashB = b.eng.players[b.holderSeat].cash;
    pinDice(b.eng, "march", [6]);
    b.eng.rollAndMove();
    expect(b.eng.players[b.holderSeat].cash).toBe(cashB + 20);
  });
});

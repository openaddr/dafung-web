// 锦囊 bot 策略单测(#148/T6):策略表逐牌「用/不用 + 目标选择」、Simple 掺骰弃权、
// conservative 看门狗口径、策略决策不掷骰。缝约定同 test/jinnang.test.ts
// (makeEngine/finishSetup/armJinnang 模式复制,不 import 测试文件;只测引擎公共面
// + bot 纯决策出口 jinnangIntent——连环计/军情密探结算未接入,端到端到不了)。
import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/game";
import type { EngineConfig, SeatConfig } from "@core/game";
import { createDice, type Dice } from "@core/dice";
import type { Player } from "@core/types";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";
import { botAct, jinnangIntent, medianCash } from "@core/bot";

const MAP = loadMap(sanguoData);

const SEATS2: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
];
const SEATS3: SeatConfig[] = [
  { name: "A", isBot: false, guohao: "魏" },
  { name: "B", isBot: true },
  { name: "C", isBot: true },
];

function makeEngine(seed = 42, seats: SeatConfig[] = SEATS2, difficulty?: "Simple" | "Normal") {
  const cfg: EngineConfig = {
    seats,
    targetNetWorth: 30000,
    ...(difficulty ? { difficulty } : {}),
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

/** 开好局并清掉开局锦囊卷轴(seed 42 开局必弹),当前玩家处可测态。 */
function prepared(seed?: number, seats?: SeatConfig[], difficulty?: "Simple" | "Normal") {
  const e = makeEngine(seed, seats, difficulty);
  finishSetup(e);
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null);
  return e;
}

/** 把引擎摆到「当前玩家持 cards、停在锦囊相位」的测试态(同 test/jinnang.test.ts 口径)。 */
function armJinnang(e: GameEngine, cards: string[]) {
  const p = e.activePlayer;
  p.jinnangHand = [...cards];
  p.jinnangHandCount = cards.length;
  e.turnPhase = "AwaitingJinnang";
  return p;
}

/** 骰子替身:nextFloat 恒返回 float 并计数(dice 字段 readonly 只挡编译,测试注入走断言)。 */
function stubDice(e: GameEngine, float = 0.99) {
  let calls = 0;
  const dice: Dice = {
    roll: () => {
      throw new Error("测试路径不应 roll");
    },
    rollDie: () => {
      throw new Error("测试路径不应 rollDie");
    },
    nextFloat: () => {
      calls++;
      return float;
    },
    getRngState: () => 0,
    setRngState: () => {},
  };
  (e as unknown as { dice: Dice }).dice = dice;
  return { calls: () => calls };
}

const cashPlayers = (xs: number[]) => xs.map((cash) => ({ cash })) as unknown as Player[];

describe("锦囊 bot 策略(#148)", () => {
  it("横征暴敛:可用即用,无目标段直接执行,收卷进 Roll", () => {
    const e = prepared();
    const user = armJinnang(e, ["横征暴敛"]);
    e.players[1].cash = 550;
    const before = user.cash;
    const deckBefore = e.jinnangDeckCount;
    botAct(e);
    expect(e.players[1].cash).toBe(350); // 各缴 200
    expect(user.cash).toBe(before + 200);
    expect(user.jinnangHand).toEqual([]);
    expect(e.jinnangUsedTags).toEqual(["攻"]);
    expect(e.turnPhase).toBe("Roll");
    expect(e.jinnangDeckCount).toBe(deckBefore); // 用牌不抽牌
  });

  it("求贤令:可用即用(得将或折现)", () => {
    const e = prepared();
    const user = armJinnang(e, ["求贤令"]);
    const cashBefore = user.cash;
    botAct(e);
    if (user.heroes.length === 1) {
      expect(user.cash).toBe(cashBefore);
    } else {
      expect(user.cash).toBe(cashBefore + 300); // 满编/名将已尽折现
    }
    expect(user.jinnangHand).toEqual([]);
    expect(e.turnPhase).toBe("Roll");
  });

  it("异类标签连用:一次 botAct 把求贤令+横征暴敛连用完再收卷", () => {
    const e = prepared();
    const user = armJinnang(e, ["求贤令", "横征暴敛"]);
    e.players[1].cash = 300;
    botAct(e);
    expect(user.jinnangHand).toEqual([]);
    expect(e.jinnangUsedTags.slice().sort()).toEqual(["攻", "援"].sort());
    expect(e.players[1].cash).toBe(100);
    expect(e.turnPhase).toBe("Roll");
  });

  it("免战金牌:现金低于全体中位数才用(偶数家=两中值均值)", () => {
    // 偶数家中位数 (100+500)/2=300
    const e = prepared();
    e.players[0].cash = 100;
    e.players[1].cash = 500;
    const user = armJinnang(e, ["免战金牌"]);
    botAct(e);
    expect(user.jinnangShield).toBe(true); // 100 < 300 → 用
    expect(user.jinnangHand).toEqual([]);
    expect(e.turnPhase).toBe("Roll");

    const e2 = prepared();
    e2.players[0].cash = 500;
    e2.players[1].cash = 100;
    const user2 = armJinnang(e2, ["免战金牌"]);
    botAct(e2);
    expect(user2.jinnangShield).toBe(false); // 500 ≥ 300 → 今不用
    expect(user2.jinnangHand).toEqual(["免战金牌"]);
    expect(e2.turnPhase).toBe("Roll");
  });

  it("免战金牌:奇数家取中位;medianCash 两分支直测", () => {
    const e = prepared(42, SEATS3);
    e.players[0].cash = 100;
    e.players[1].cash = 500;
    e.players[2].cash = 600;
    const user = armJinnang(e, ["免战金牌"]);
    botAct(e);
    expect(user.jinnangShield).toBe(true); // 中位 500,100 < 500

    expect(medianCash(cashPlayers([1, 2, 3]))).toBe(2);
    expect(medianCash(cashPlayers([1, 2, 3, 4]))).toBe(2.5);
  });

  it("缓兵之计:仅对当前身价领先者;自己是领先者则今不用", () => {
    // 对手领先(netWorth=现金)→ 用在其身
    const e = prepared();
    e.players[1].cash = e.players[0].cash + 500;
    const user = armJinnang(e, ["缓兵之计"]);
    botAct(e);
    expect(e.players[1].skipTurns).toBe(1);
    expect(user.jinnangHand).toEqual([]);
    expect(e.turnPhase).toBe("Roll");

    // 自己领先 → 无的放矢,今不用
    const e2 = prepared();
    e2.players[0].cash = e2.players[1].cash + 500;
    const user2 = armJinnang(e2, ["缓兵之计"]);
    botAct(e2);
    expect(e2.players[1].skipTurns).toBe(0);
    expect(user2.jinnangHand).toEqual(["缓兵之计"]);
    expect(e2.turnPhase).toBe("Roll");
  });

  it("缓兵之计:领先者被免战庇护 → 目标段作罢,牌退回手,今不用收卷", () => {
    const e = prepared();
    e.players[1].cash = e.players[0].cash + 500;
    e.players[1].jinnangShield = true;
    const user = armJinnang(e, ["缓兵之计"]);
    botAct(e);
    expect(e.players[1].skipTurns).toBe(0);
    expect(user.jinnangHand).toEqual(["缓兵之计"]); // 作罢不消耗
    expect(e.turnPhase).toBe("Roll");
  });

  it("窃玉偷香:目标=珍宝最多者(并列取座位序小);执行夺一张", () => {
    const e = prepared(42, SEATS3);
    const user = e.players[0];
    e.players[1].treasures.push({ id: "t1", name: "和氏璧", level: 3 });
    e.players[2].treasures.push({ id: "t2", name: "随侯珠", level: 2 }, { id: "t3", name: "良玉", level: 1 });
    expect(jinnangIntent(e, "窃玉偷香").targets).toEqual([2, 1]); // 2 件 > 1 件
    e.players[1].treasures.push({ id: "t4", name: "夜光璧", level: 2 }); // 2=2 并列 → 座位序小在前
    expect(jinnangIntent(e, "窃玉偷香").targets).toEqual([1, 2]);
    armJinnang(e, ["窃玉偷香"]);
    botAct(e);
    expect(user.treasures.length).toBe(1); // 夺得一张
    expect(e.players[1].treasures.length).toBe(1); // 目标 2→1
    expect(e.players[2].treasures.length).toBe(2); // 非目标原样
    expect(e.turnPhase).toBe("Roll");
  });

  it("火烧连营:目标=城数最多者;唯一可升级城被降 1 级", () => {
    const e = prepared(42, SEATS3);
    const user = e.players[0];
    const free = e.board.tiles.find((t) => t.propertyId != null && e.findOwner(t.propertyId) == null)!.propertyId!;
    const cap2 = e.players[2].properties[0];
    e.players[2].properties.push({ ...cap2, propertyId: free, level: 1 }); // 2 座城 > 他人 1 座
    expect(jinnangIntent(e, "火烧连营").targets).toEqual([2, 1]);
    armJinnang(e, ["火烧连营"]);
    botAct(e);
    expect(e.players[2].properties.find((h) => h.propertyId === free)!.level).toBe(0); // 唯一 Lv>0 → 降级
    expect(e.players[1].properties[0].level).toBe(0); // 非目标原样(开局都城 Lv.0)
    expect(user.jinnangHand).toEqual([]);
    expect(e.turnPhase).toBe("Roll");
  });

  it("连环计:次富者现金 <400 或可用目标 <2 → 不用;达标则两挑现金最高两人", () => {
    const e = prepared(42, SEATS3);
    e.players[0].cash = 1000;
    e.players[1].cash = 900;
    e.players[2].cash = 350;
    expect(jinnangIntent(e, "连环计")).toEqual({ use: false, targets: [1, 2] }); // 次富 350 < 400
    e.players[2].cash = 450;
    expect(jinnangIntent(e, "连环计")).toEqual({ use: true, targets: [1, 2] }); // 现金最高两人相咬
    e.players[1].jinnangShield = true; // 庇护 → 可用目标 <2
    expect(jinnangIntent(e, "连环计").use).toBe(false);
    expect(jinnangIntent(e, "连环计").targets).toEqual([2]);
  });

  it("军情密探:自己手牌 ≥2 才用(bot 拿信息无用)", () => {
    const e = prepared(42, SEATS3);
    armJinnang(e, ["军情密探"]);
    expect(jinnangIntent(e, "军情密探").use).toBe(false); // 手牌 1
    e.activePlayer.jinnangHand = ["军情密探", "求贤令"];
    e.activePlayer.jinnangHandCount = 2;
    expect(jinnangIntent(e, "军情密探").use).toBe(true); // 手牌 2
    expect(jinnangIntent(e, "军情密探").targets![0]).toBe(1); // 目标取现金最高者(并列座位序小)
  });

  it("连环计/军情密探已 live(T4):策略面达标端到端会用出(牌入弃堆)", () => {
    const e = prepared(42, SEATS3);
    e.players[0].cash = 1000;
    e.players[1].cash = 900;
    e.players[2].cash = 900; // 连环计策略面达标、密探手牌 2
    const user = armJinnang(e, ["连环计", "军情密探"]);
    botAct(e);
    // 谋名额一张/回合:先出的那张消耗,另一张留手;两者都符合各自策略面
    const used = ["连环计", "军情密探"].filter((c) => !user.jinnangHand.includes(c));
    expect(used.length).toBe(1);
    expect(e.jinnangDiscard).toContain(used[0]);
    expect(e.jinnangPeeks.length + (e.log.some((l) => l.detail.includes("duel")) ? 1 : 0)).toBeGreaterThanOrEqual(1);
    expect(["Roll", "AwaitingJinnang"]).toContain(e.turnPhase);
  });

  it("Simple 难度:50% 弃权掺骰(<0.5 弃权,≥0.5 照用);同 seed 复现", () => {
    const e = prepared(42, SEATS2, "Simple");
    e.players[1].cash = 300;
    armJinnang(e, ["横征暴敛"]); // 策略=必用,弃权与否全看那一掷
    const d1 = stubDice(e, 0.1);
    botAct(e);
    expect(d1.calls()).toBe(1); // 恰好一掷
    expect(e.activePlayer.jinnangHand).toEqual(["横征暴敛"]);
    expect(e.turnPhase).toBe("Roll");

    armJinnang(e, ["横征暴敛"]);
    const d2 = stubDice(e, 0.9);
    botAct(e);
    expect(d2.calls()).toBe(1);
    expect(e.activePlayer.jinnangHand).toEqual([]);
    expect(e.players[1].cash).toBe(100);
    expect(e.turnPhase).toBe("Roll");

    // 同 seed 两次全真跑(真骰)结果一致:掺骰保确定性
    const run = (seed: number) => {
      const x = prepared(seed, SEATS2, "Simple");
      x.players[1].cash = 300;
      armJinnang(x, ["横征暴敛"]);
      botAct(x);
      return { hand: [...x.activePlayer.jinnangHand], phase: x.turnPhase, cash: x.players[1].cash };
    };
    expect(run(7)).toEqual(run(7));
  });

  it("conservative=true(看门狗):恒今不用、不掷骰、牌库不动;目标段中途也作罢收卷", () => {
    const e = prepared();
    e.players[1].cash = 300; // 策略面(横征/求贤=可用即用)必用,conservative 也不得用
    const user = armJinnang(e, ["横征暴敛", "求贤令"]);
    const deckBefore = e.jinnangDeckCount;
    const d = stubDice(e, 0.99);
    botAct(e, { conservative: true });
    expect(d.calls()).toBe(0); // 不掷骰
    expect(user.jinnangHand).toEqual(["横征暴敛", "求贤令"]);
    expect(e.jinnangUsedTags).toEqual([]);
    expect(e.players[1].cash).toBe(300);
    expect(e.jinnangDeckCount).toBe(deckBefore);
    expect(e.turnPhase).toBe("Roll");

    // 目标段中途接管:先作罢(牌退回)再今不用,同样不掷骰
    const e2 = prepared();
    e2.players[1].cash = e2.players[0].cash + 500;
    const user2 = armJinnang(e2, ["缓兵之计"]);
    e2.resolveJinnang("缓兵之计"); // 人类残局:已入目标段
    expect(e2.pendingJinnang).not.toBeNull();
    const d2 = stubDice(e2, 0.99);
    botAct(e2, { conservative: true });
    expect(d2.calls()).toBe(0);
    expect(user2.jinnangHand).toEqual(["缓兵之计"]);
    expect(e2.players[1].skipTurns).toBe(0);
    expect(e2.turnPhase).toBe("Roll");
  });

  it("策略决策不掷骰:Normal 各场景 nextFloat 零调用、牌库计数不变", () => {
    const scenario = (arm: (e: GameEngine) => void, tweak?: (e: GameEngine) => void) => {
      const x = prepared();
      tweak?.(x);
      arm(x);
      const deckBefore = x.jinnangDeckCount;
      const d = stubDice(x, 0.99);
      botAct(x);
      return { calls: d.calls(), deckDelta: x.jinnangDeckCount - deckBefore, phase: x.turnPhase };
    };
    // 横征暴敛(可用即用,执行无骰)
    expect(scenario((x) => armJinnang(x, ["横征暴敛"]), (x) => { x.players[1].cash = 300; }))
      .toEqual({ calls: 0, deckDelta: 0, phase: "Roll" });
    // 免战金牌(低于中位数)
    expect(scenario((x) => armJinnang(x, ["免战金牌"]), (x) => { x.players[0].cash = 100; x.players[1].cash = 500; }))
      .toEqual({ calls: 0, deckDelta: 0, phase: "Roll" });
    // 缓兵之计(对手领先,目标段两步推进)
    expect(scenario((x) => armJinnang(x, ["缓兵之计"]), (x) => { x.players[1].cash += 500; }))
      .toEqual({ calls: 0, deckDelta: 0, phase: "Roll" });
    // 灰置牌(连环计)今不用
    expect(scenario((x) => armJinnang(x, ["连环计"])))
      .toEqual({ calls: 0, deckDelta: 0, phase: "Roll" });
  });
});

// 机遇逐实体结算 sweep(2026-11-10 grill 拍板 Q1-Q7;判层①,快池)。守卫对象=「接线契约」:
// 60 机遇逐条(抉择型逐选项)经生产结算通路真实结算,断言引擎状态差 == 目录声明(期望从表推算)。
// 判词:期望读的是「声明」、断言打的是「引擎真状态」——验的是引擎是否照数据生效,不是拿同一行
// 数据验同一行数据(镜像测试,验证纪律三条款③禁)。本 sweep 补「逐实体正算例」统一层,不替代
// 存量深度例(封顶/耗竭/灰显/保底放行/章闸语义各归专例,#grill Q7)。现状背景(grill 清点):
// 60 条中 33 条在 test/ 零结算出现、22 条散落行为例、5 条仅结构引用。
// 到站缝:抽取(档位/加权/池过滤)已有独立单测,本 sweep 经 testEngine.applyEncounter/enterEncounter
// 指定条目绕抽取(#123/#124 缝,签名人工对齐 authority 私有);闸门选项一律种到可用(章/珍宝/现金
// 代价,将池/无主城用全新局自带),不许静默跳过(零兜底)。
// 布场配方照抄 test/encounters.test.ts(makeEngine/finishSetup,how-to 场景配方跨文件照抄惯例)。
import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { sweepTestHeroes, testEngine } from "@core/testing";
import { resolveEncounterChoice } from "@core/encounter-flow";
import {
  ENCOUNTERS,
  assertChoicesNotFlagLocked,
  grantEncounterFlags,
  type EncounterChoiceOption,
  type EncounterDef,
  type EncounterEffect,
} from "@core/encounters";
import { giveTreasureFromDeck, grantProperty, placePlayer, setStamina } from "@core/planter";
import type { Player } from "@core/model";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

// 合成名将登记清退同款纪律(#785):本文件不造合成将,保留钩子与文件族一致
afterEach(() => sweepTestHeroes());

function makeEngine(seed = 7): GameEngine {
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

/** 结算前后状态快照(期望差的「前」侧;对手现金按序快照供 siphon/levy/trade 合计断言)。 */
function snap(e: GameEngine, mover: Player) {
  return {
    cash: mover.cash,
    stamina: mover.stamina,
    reputation: mover.reputation,
    treasures: mover.treasures.length,
    heroes: mover.heroes.length,
    hand: mover.jinnangHand.length,
    properties: mover.properties.length,
    flags: [...mover.encounterFlags],
    othersCash: e.players.filter((p) => p !== mover).map((p) => p.cash),
  };
}

/** 表推期望(读「声明」算差值;闸门全开的新局下封顶/fallback 均不触发——
 *  现金 10000 远超任何 |delta|/代价,对手现金同,将池/无主城全新局俱在)。 */
function expectation(option?: EncounterChoiceOption, effect?: EncounterEffect) {
  const exp = {
    cash: -(option?.cashCost ?? 0),
    stamina: (option?.staminaDelta ?? 0) + (effect?.staminaDelta ?? 0),
    reputation: (option?.repDelta ?? 0) + (effect?.repDelta ?? 0),
    treasures: -(option?.treasureCost ?? 0),
    heroes: 0,
    hand: 0,
    properties: 0,
    /** 对手侧现金合计(siphon/levy/trade 专属;null=本条不动对手钱包) */
    othersCash: null as number | null,
    heroId: effect?.kind === "grantHero" ? effect.heroId : undefined,
  };
  switch (effect?.kind) {
    case "cash":
      exp.cash += effect.delta;
      break;
    case "grantTreasure":
      exp.treasures += 1;
      break;
    case "grantHero":
      exp.heroes += 1;
      break;
    case "grantCard":
      exp.hand += 1;
      break;
    case "grantCity":
      exp.properties += 1;
      break;
    case "siphon":
      exp.cash += effect.amount;
      exp.othersCash = -effect.amount;
      break;
    case "levy":
      exp.cash -= effect.amount;
      exp.othersCash = effect.amount;
      break;
    case "trade":
      exp.cash += effect.amount;
      exp.othersCash = effect.amount;
      break;
    case undefined:
      break;
  }
  return exp;
}

// ──────────────────────────── 逐实体正算例 ────────────────────────────
interface SweepRow {
  label: string;
  def: EncounterDef;
  option?: EncounterChoiceOption;
  optionIndex?: number;
}
const rows: SweepRow[] = [];
for (const def of ENCOUNTERS) {
  if (def.choices) {
    def.choices.forEach((option, optionIndex) =>
      rows.push({
        label: `${def.id}·选项${optionIndex}「${option.text}」`,
        def,
        option,
        optionIndex,
      }),
    );
  } else if (def.effect) {
    rows.push({ label: def.id, def });
  } else {
    throw new Error(`机遇「${def.id}」既无 effect 也无 choices(目录 bug,应被结构 sweep 先拦)`);
  }
}

describe(`机遇逐实体结算 sweep(${rows.length} 行=31 即时+29 抉择×选项)`, () => {
  for (const row of rows) {
    it(`${row.label}:结算后状态按声明生效`, () => {
      const e = makeEngine();
      finishSetup(e);
      const mover = e.activePlayer;
      const seat = e.players.indexOf(mover);
      // 挪出都城:抉择路结算会续跑「落格结算」(城池结算,首跑 57 挂的根因——站在都城上
      // =补给+1000+招贤相位窜进断言面)。关中图无空地(4×7 全城格),种到「无主非都城」
      // 城格:落格结算=开购地决策相挂起等输入,零状态变更,断言面干净
      const capIdxs = new Set(e.players.map((p) => p.position));
      const tile = e.board.tiles.find(
        (t) => t.propertyId != null && !capIdxs.has(t.index) && e.findOwner(t.propertyId) == null,
      );
      if (!tile) throw new Error("地图无无主非都城城格(地图 bug)");
      placePlayer(e, seat, tile.index);
      // 闸门种到可用:章(章闸选项)/珍宝(换贤代价)/现金与将池/无主城用全新局自带
      if (row.option?.requiresFlags) grantEncounterFlags(mover, row.option.requiresFlags);
      if (row.option?.treasureCost) giveTreasureFromDeck(e, seat, row.option.treasureCost);
      // 体力钉 50:正负 delta 都落在 (0,100) 开区间内,耗竭路径与 MAX 夹紧都不触发(各归专例)
      setStamina(e, seat, 50);
      const before = snap(e, mover);

      if (row.option) {
        testEngine(e).enterEncounter(row.def);
        if (e.turnPhase === "AwaitingEncounter") resolveEncounterChoice(e, row.optionIndex!);
      } else {
        testEngine(e).applyEncounter(mover, row.def);
      }
      // 结算收口:不该停在等选项(≤1 可用的自动执行与 resolve 两路都已续跑)
      expect(e.turnPhase).not.toBe("AwaitingEncounter");

      const after = snap(e, mover);
      const exp = expectation(row.option, row.option?.effect ?? row.def.effect);
      expect(after.cash).toBe(before.cash + exp.cash);
      expect(after.reputation).toBe(before.reputation + exp.reputation);
      expect(after.stamina).toBe(before.stamina + exp.stamina);
      expect(after.treasures).toBe(before.treasures + exp.treasures);
      expect(after.heroes).toBe(before.heroes + exp.heroes);
      expect(after.hand).toBe(before.hand + exp.hand);
      expect(after.properties).toBe(before.properties + exp.properties);
      // 章落册:setsFlags(条目级+选项级)去重后必在册(已持章场景由中断路专例守)
      expect(after.flags).toEqual(
        expect.arrayContaining([
          ...before.flags,
          ...(row.option?.setsFlags ?? []),
          ...(row.def.setsFlags ?? []),
        ]),
      );
      // 指定招揽:点名将入麾下(三顾茅庐→诸葛亮族)
      if (exp.heroId) {
        expect(mover.heroes.some((h) => h.heroId === exp.heroId)).toBe(true);
      }
      // 对手侧合计(随机对手由种子骰定人,断言合计+单人金额;封顶场景归专例)
      if (exp.othersCash !== null) {
        const deltas = after.othersCash.map((c, i) => c - before.othersCash[i]!);
        expect(deltas.reduce((a, b) => a + b, 0)).toBe(exp.othersCash);
        expect(Math.max(...deltas.map(Math.abs))).toBe(Math.abs(exp.othersCash));
      }
    });
  }

  // ──────────────────────────── 目录不变量 + 唯一零驱动分支 ────────────────────────────
  it("目录不变量:每机遇 ≥1 无门槛选项(章闸不锁死选项集)", () => {
    assertChoicesNotFlagLocked(ENCOUNTERS);
  });

  it("grantCity fallback:无可授城(全城有主)→ 折现 fallbackCash 而非赐城(#grill Q6,唯一零驱动分支)", () => {
    const e = makeEngine();
    finishSetup(e);
    const mover = e.activePlayer;
    const seat = e.players.indexOf(mover);
    // 全城有主:棋盘上每块带 propertyId 的地都授给另一家(已持的 grantProperty 走升级分支不重复;
    // fallback 判据=逐 tile findOwner==null,授满即全无主城清零,判据单源 encounter-flow:577)
    for (const t of e.board.tiles) {
      if (t.propertyId != null) grantProperty(e, 1 - seat, t.propertyId, 1);
    }
    const def = ENCOUNTERS.find((c) => c.effect?.kind === "grantCity");
    if (!def) throw new Error("目录无 grantCity 条目(目录 bug)");
    const eff = def.effect as Extract<EncounterEffect, { kind: "grantCity" }>;
    setStamina(e, seat, 50);
    const before = snap(e, mover);
    testEngine(e).applyEncounter(mover, def);
    const after = snap(e, mover);
    expect(after.properties).toBe(before.properties); // 不赐城
    expect(after.cash).toBe(before.cash + eff.fallbackCash); // 折现
  });
});

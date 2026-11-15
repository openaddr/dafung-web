import { describe, it, expect, afterEach } from "bun:test";
import { GameEngine } from "@core/authority";
import type { BankruptcyAsset } from "@core/bankruptcy";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import { botAct } from "@core/bot";
import type { Player } from "@core/model";
import { sellValueOf } from "@core/economy";
import { HEROES } from "@core/heroes";
import type { EncounterDef } from "@core/encounters";
import type { GameMoment, MomentCtx } from "@core/timing";
import { armHero, sweepTestHeroes } from "@core/testing";
import {
  armHero as plantHero,
  armPhase,
  giveTreasure,
  grantProperty,
  setCash,
} from "@core/planter";
import guanzhongData from "../public/maps/guanzhong.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(guanzhongData);

// 合成名将(zhugeliang 等)经 armHero 登记进名将表,afterEach 精确清退防泄漏(#785)
afterEach(() => sweepTestHeroes());

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
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
    const capIdx = e.firstAvailableCapitalIndex();
    if (capIdx < 0) break;
    e.pickCapital(idx, capIdx);
  }
  e.players.forEach((p) => {
    p.jinnangHand = [];
    p.jinnangHandCount = 0;
  }); // 锦囊相位 inert(#122)
  if (e.turnPhase === "AwaitingJinnang") e.resolveJinnang(null); // 发牌时已入相位的话放行
}

function hero(id: string, name: string) {
  // 清算保留名将布场:本组不测试技能,空池隔离其余时机。
  return {
    id,
    name,
    title: "",
    skillPool: [] as string[],
    image: "/assets/heroes/hero-zhouyu-sgs.png",
  };
}

/** 给玩家塞一座非都城的可变卖城(catalog 里 valueByLevel 齐全的普通城),返回其 Lv.0 变卖价。 */
function giveSellableCity(e: GameEngine, p: Player): { propId: string; lv0Value: number } {
  const tile = e.board.tiles.find((t) => t.propertyId && e.findOwner(t.propertyId) === null)!;
  const def = e.catalog.get(tile.propertyId!)!;
  grantProperty(e, e.players.indexOf(p), def.id, 0);
  return { propId: def.id, lv0Value: def.valueByLevel[0] };
}

describe("破产清算", () => {
  it("批量清偿消费同标识技能书的真实数量,末件超额保留现金且重复提交不再成交", () => {
    const e = makeEngine();
    finishSetup(e);
    const seat = e.activeIndex;
    const p = e.activePlayer;
    setCash(e, seat, 20);
    giveTreasure(e, seat, [
      { id: "skill-book-jixing", name: "急行", level: 1 },
      { id: "skill-book-jixing", name: "急行", level: 1 },
      { id: "kept", name: "留存", level: 2 },
    ]);
    e.payOrLiquidate(p, null, 200);

    const command = {
      type: "confirmBankruptcySettle" as const,
      assets: [
        { kind: "treasure" as const, id: "skill-book-jixing" },
        { kind: "treasure" as const, id: "skill-book-jixing" },
      ],
    };
    e.submitCommand(command);

    expect(p.cash).toBe(20);
    expect(p.treasures.map((t) => t.id)).toEqual(["kept"]);
    expect(e.pendingDebt).toBeNull();
    expect(e.snapshot().events.filter((event) => event.kind === "assetLiquidated")).toHaveLength(2);
    e.submitCommand(command);
    expect(p.cash).toBe(20);
    expect(p.treasures.map((t) => t.id)).toEqual(["kept"]);
  });

  for (const scenario of [
    { name: "无可卖资产", level: null, bankrupt: true, cash: 0 },
    { name: "资产不足", level: 1, bankrupt: true, cash: 0 },
    { name: "珍宝足以自救", level: 5, bankrupt: false, cash: 400 },
  ]) {
    it(`bot ${scenario.name}:只卖合法资产并完成清偿或认破产,名将不换银`, () => {
      const e = makeEngine(1);
      finishSetup(e);
      const p = e.activePlayer;
      plantHero(e, e.activeIndex, "zhouyu", ["jixing"]);
      setCash(e, e.activeIndex, 0);
      giveTreasure(
        e,
        e.activeIndex,
        scenario.level === null ? [] : [{ id: "funds", name: "筹款宝", level: scenario.level }],
      );
      e.payOrLiquidate(p, null, 200);

      botAct(e);

      expect(p.isBankrupt).toBe(scenario.bankrupt);
      expect(p.cash).toBe(scenario.cash);
      expect(p.heroes.map((slot) => slot.heroId)).toEqual(scenario.bankrupt ? [] : ["zhouyu"]);
      expect(e.pendingDebt).toBeNull();
      expect(e.turnPhase).not.toBe("AwaitingBankruptcySettle");
      if (scenario.bankrupt) {
        expect(e.snapshot().events.some((event) => event.kind === "assetLiquidated")).toBe(false);
      }
    });
  }

  it("现金不足但有珍宝 → 进入清算;卖珍宝凑够 → 免破产继续", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600(经济 v2)
    const r = e.payOrLiquidate(p, null, 200); // 欠 200,cash 100,有珍宝 → 清算
    expect(r).toBe("liquidating");
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(e.pendingDebt?.amount).toBe(200);
    e.confirmBankruptcySettle([{ kind: "treasure", id: "t1" }]); // +600 后清偿 200
    expect(p.cash).toBe(500);
    expect(p.isBankrupt).toBe(false);
  });

  it("无资产可清(仅都城)仍先进入清算,不会自动出局", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    setCash(e, e.activeIndex, 50);
    // 选都后只有都城(不可卖)+ 无珍宝/名将
    const r = e.payOrLiquidate(p, null, 200);
    expect(r).toBe("liquidating");
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(e.pendingDebt?.amount).toBe(200);
    expect(p.isBankrupt).toBe(false);
  });

  it("清偿不足时拒绝结算,明确认破产后才出局", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 指导价 100
    e.payOrLiquidate(p, null, 500); // 欠 500,宝仅 100
    e.confirmBankruptcySettle([{ kind: "treasure", id: "t1" }]);
    expect(p.cash).toBe(0);
    expect(p.treasures.map((t) => t.id)).toEqual(["t1"]);
    expect(p.isBankrupt).toBe(false);
    expect(e.pendingDebt?.amount).toBe(500);
    e.submitCommand({ type: "declareBankruptcy" });
    expect(p.isBankrupt).toBe(true);
  });

  it("可卖资产足额仍可明确认破产,剩余资产清算且名将回池,不换银或折书", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const seat = e.activeIndex;
    e.tryRecruitHero(p);
    e.resolveHeroPick(0);
    const heroId = p.heroes[0].heroId;
    expect(e.recruitedHeroIds.has(heroId)).toBe(true);
    armPhase(e, { activeIndex: seat, turnPhase: "Roll" });
    setCash(e, seat, 0);
    giveTreasure(e, seat, [
      { id: "funds", name: "自救宝", level: 5 },
      { id: "kept", name: "余宝", level: 2 },
    ]);
    e.payOrLiquidate(p, null, 150);
    expect(p.heroes.map((slot) => slot.heroId)).toEqual([heroId]);

    e.submitCommand({ type: "declareBankruptcy" });

    expect(p.isBankrupt).toBe(true);
    expect(p.cash).toBe(0);
    expect(p.treasures).toEqual([]);
    expect(p.properties).toEqual([]);
    expect(p.heroes).toEqual([]);
    expect(e.recruitedHeroIds.has(heroId)).toBe(false);
    expect(e.pendingDebt).toBeNull();
  });

  it("批量清偿禁止变卖都城", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const capProp = e.board.at(p.capitalIndex)?.propertyId!;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 有珍宝才能进清算
    e.payOrLiquidate(p, null, 99999);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.confirmBankruptcySettle([{ kind: "property", id: capProp }]);
    expect(p.properties.some((h) => h.propertyId === capProp)).toBe(true); // 都城仍在
    expect(p.cash).toBe(0); // 没卖成都城
  });

  it("混合批次先完整校验:数量不足、非法资产、欠额和足额后多选均无部分成交", () => {
    const e = makeEngine();
    finishSetup(e);
    const p = e.activePlayer;
    const seat = e.activeIndex;
    setCash(e, seat, 20);
    giveTreasure(e, seat, [
      { id: "book", name: "技能书", level: 1 },
      { id: "book", name: "技能书", level: 1 },
      { id: "kept", name: "余宝", level: 2 },
    ]);
    const city = giveSellableCity(e, p);
    const capital = e.board.at(p.capitalIndex).propertyId!;
    const foreign = e.board.at(e.players.find((q) => q !== p)!.capitalIndex).propertyId!;
    const book = { kind: "treasure" as const, id: "book" };
    const property = { kind: "property" as const, id: city.propId };
    const debt = 20 + 200 + city.lv0Value;
    e.payOrLiquidate(p, null, debt);
    const holdings = structuredClone(p.properties);
    for (const assets of [
      [book],
      [book, book, book, property],
      [book, { kind: "property" as const, id: capital }],
      [book, { kind: "property" as const, id: foreign }],
      [book, property, property],
      [book, book, { kind: "hero", id: city.propId } as unknown as BankruptcyAsset],
      [book, book, property, { kind: "treasure" as const, id: "kept" }],
    ]) {
      e.submitCommand({ type: "confirmBankruptcySettle", assets });
      expect(p.cash).toBe(20);
      expect(p.treasures.map((t) => t.id)).toEqual(["book", "book", "kept"]);
      expect(p.properties).toEqual(holdings);
      expect(e.pendingDebt!.amount).toBe(debt);
      expect(e.snapshot().events.some((event) => event.kind === "assetLiquidated")).toBe(false);
    }
    e.submitCommand({ type: "confirmBankruptcySettle", assets: [book, book, property] });
    expect(p.cash).toBe(0);
    expect(p.treasures.map((t) => t.id)).toEqual(["kept"]);
    expect(p.properties.some((h) => h.propertyId === city.propId)).toBe(false);
    expect(e.pendingDebt).toBeNull();
  });

  it("恰好差 1 分时卖最便宜的仍允许(单笔可超额凑足),凑足后立刻封死", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 499;
    p.treasures.push(
      { id: "cheap", name: "草帽", level: 1, count: 1, desc: "" }, // 指导价 100(最便宜)
      { id: "pricey", name: "玉玺", level: 10, count: 1, desc: "" }, // 指导价 3000
    );
    e.payOrLiquidate(p, null, 500); // 欠 500,cash 499,差 1 分
    e.confirmBankruptcySettle([{ kind: "treasure", id: "cheap" }]);
    expect(p.treasures.map((t) => t.id)).toEqual(["pricey"]);
    expect(p.cash).toBe(99); // 599 − 500
    expect(p.isBankrupt).toBe(false);
  });

  it("清算自救走完后状态干净(pendingDebt/托管/访客态复位,回到 Roll)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" });
    e.payOrLiquidate(p, null, 200);
    e.confirmBankruptcySettle([{ kind: "treasure", id: "t1" }]);
    expect(e.pendingDebt).toBeNull();
    expect(e.escrowTreasure).toBeNull();
    expect(e.treasureVisitor).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // endTurn 后轮到下一玩家
    expect(p.isBankrupt).toBe(false);
    expect(p.treasures.length).toBe(0); // 卖掉的珍宝不在手中
  });

  it("破产出局走完后状态干净(pendingDebt 清空、名将回招贤池)", () => {
    const e = makeEngine(1, [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
      { name: "C", isBot: false, guohao: "吴" },
    ]);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    armHero(e, p, hero("zhouyu", "周瑜"));
    e.payOrLiquidate(p, null, 500); // 仅有名将,无可卖资产仍进入清算
    e.declareBankruptcy();
    expect(p.isBankrupt).toBe(true);
    expect(e.pendingDebt).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // 3 人在局,游戏未结束
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false); // 名将释放回招贤池
  });
});

describe("变卖金额口径(#60:展示价 === 实际入账)", () => {
  it("卖一座城恰好清债:按展示价(Lv.0 变卖价)入账后尚欠归零,免破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const city = giveSellableCity(e, p);
    const price = sellValueOf(e.catalog.get(city.propId)!, 0); // 与卷轴展示同一函数
    p.cash = 0; // 现金归零:欠恰一座 Lv.0 城的变卖价(仅城可卖 → 仍进清算)
    e.payOrLiquidate(p, null, price);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    // 尚欠(卷轴口径)= max(0, debt − cash)
    expect(Math.max(0, e.pendingDebt!.amount - p.cash)).toBe(price);
    e.confirmBankruptcySettle([{ kind: "property", id: city.propId }]);
    expect(p.cash).toBe(0); // 恰好清偿,无隐藏扣减
    expect(p.isBankrupt).toBe(false);
    expect(e.pendingDebt).toBeNull();
  });
});

describe("清算路径 CashLost 口径(#452):非自愿现金支出按实付现金派发,实付 0 不派发", () => {
  const CAOPI = HEROES.find((h) => h.id === "caopi")!;

  it("清算自救后清偿:实付现金派 CashLost,渔利恰得 50", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const caopi = e.players.find((q) => q !== p)!;
    // 池收窄到受试技(#1378 曹丕池换血={放逐,行殇}后整池直授不再含渔利;渔利现役
    // 单属诸葛亮,受试布场经 armHero 指定技直授,收窄先例同下例 hero-skill armSkill)
    armHero(e, caopi, CAOPI, ["yuli"]);
    const caopiCash0 = caopi.cash;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    const r = e.payOrLiquidate(p, null, 200);
    expect(r).toBe("liquidating");
    e.confirmBankruptcySettle([{ kind: "treasure", id: "t1" }]); // 实付 200 清偿
    expect(p.cash).toBe(500);
    expect(p.isBankrupt).toBe(false);
    expect(caopi.cash).toBe(caopiCash0 + 50); // 与现金直付同口径:渔利恰一次
  });

  it("征粮归一:直付派发(渔利 +50);封顶实付以现有银两为限,不送清算(#1153)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const caopi = e.players.find((q) => q !== p)!;
    // 池收窄到受试技(#1378 曹丕池换血={放逐,行殇}:整池直授会连带挂可选技待决、
    // 损失过阈再入待决队列,干扰渔利精确断言;收窄布场同 test/hero-skill.test.ts
    // armSkill 先例)
    armHero(e, caopi, CAOPI, ["yuli"]);
    const caopiCash0 = caopi.cash;
    const levy: EncounterDef = {
      id: "假道征粮",
      tier: "霉运",
      tags: ["银两", "玩家"],
      weight: 1,
      text: "t",
      effect: { kind: "levy", amount: 150 },
    };
    // 直付腿:现金充足 → 实付 150 派发;对手收 150 转移 + 曹丕(持牌者=对手)渔利 50
    e.settleEncounter(p, levy);
    const afterDirect = caopi.cash;
    expect(afterDirect).toBe(caopiCash0 + 150 + 50);
    // 封顶腿(#1153 红线「机遇不送清算」):现金不足 → 实付以其现有银两为限,派发实付额
    p.cash = 10;
    const r = e.settleEncounter(p, levy);
    expect(r).toBe("settled");
    expect(p.cash).toBe(0);
    expect(p.isBankrupt).toBe(false);
    expect(caopi.cash).toBe(afterDirect + 10 + 50); // 实付 10 照派转移 + 渔利 50
  });
});

// ──────────────────── 收款派发下沉(#455 A3+A5):玩家间每次收款恰一派 ────────────────────
describe("收款派发下沉(#455 A3+A5):直付/清偿收款点派 CashGained(收款方视角),恰一派", () => {
  /** 包一层 dispatchMoment,记录派发的时机 + 完整 ctx(同 timing.test 口径)。 */
  function recordCashMoments(e: GameEngine): { moment: GameMoment; ctx: MomentCtx }[] {
    const entries: { moment: GameMoment; ctx: MomentCtx }[] = [];
    const orig = e.dispatchMoment.bind(e);
    (e as unknown as { dispatchMoment: (m: GameMoment, ctx: MomentCtx) => void }).dispatchMoment = (
      m,
      ctx,
    ) => {
      entries.push({ moment: m, ctx: { ...ctx } });
      return orig(m, ctx);
    };
    return entries;
  }

  it("直付路:payOrLiquidate ok 派 CashGained(subject=收款债主,amount=实收);creditor=null(归银行)不派", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const payer = e.activePlayer;
    const creditor = e.players.find((q) => q !== payer)!;
    const payerCash0 = payer.cash;
    const creditorCash0 = creditor.cash;
    const entries = recordCashMoments(e);
    const r = e.payOrLiquidate(payer, creditor, 150);
    expect(r).toBe("ok");
    expect(payer.cash).toBe(payerCash0 - 150); // 付款方实付
    expect(creditor.cash).toBe(creditorCash0 + 150); // 收款方实收
    expect(entries.filter((x) => x.moment === "CashGained").map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(creditor), amount: 150 }, // 恰一派
    ]);
    expect(entries.filter((x) => x.moment === "CashLost")).toHaveLength(0); // 本窄面只测收款半边(付款侧 CashLost 由调用域派发)

    // creditor=null(税/行情等归银行):无玩家收款,不派发
    const entries2 = recordCashMoments(e);
    expect(e.payOrLiquidate(payer, null, 100)).toBe("ok");
    expect(entries2.filter((x) => x.moment === "CashGained")).toHaveLength(0);
  });

  it("清偿路:confirm 清偿成功收款点派 CashGained(subject=债主),与付款方 CashLost(#452)成对且各恰一次", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const creditor = e.players.find((q) => q !== p)!;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    const creditorCash0 = creditor.cash;
    const entries = recordCashMoments(e);
    expect(e.payOrLiquidate(p, creditor, 200)).toBe("liquidating");
    e.confirmBankruptcySettle([{ kind: "treasure", id: "t1" }]); // 实付 200 清偿 → 债主收款
    expect(p.cash).toBe(500);
    expect(creditor.cash).toBe(creditorCash0 + 200); // 收款方恰一派(清算路不再经 deliverEscrow 补派)
    expect(entries.filter((x) => x.moment === "CashGained").map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(creditor), amount: 200 },
    ]);
    expect(entries.filter((x) => x.moment === "CashLost").map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(p), amount: 200 }, // 付款半边(#452 口径)成对在列
    ]);
  });
});

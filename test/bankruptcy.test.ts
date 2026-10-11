import { describe, it, expect } from "bun:test";
import { GameEngine } from "@core/authority";
import type { EngineConfig, SeatConfig } from "@core/authority";
import { createDice } from "@core/dice";
import type { Player } from "@core/model";
import { sellValueOf } from "@core/economy";
import { guidePriceOf } from "@core/treasures";
import { HEROES } from "@core/heroes";
import type { EncounterDef } from "@core/encounters";
import type { GameMoment, MomentCtx } from "@core/timing";
import { testEngine } from "@core/testing";
import sanguoData from "../public/maps/sanguo.json";
import { loadMap } from "@core/board-loader";

const MAP = loadMap(sanguoData);

function makeEngine(seed = 1, seats?: SeatConfig[]): GameEngine {
  const cfg: EngineConfig = {
    seats: seats ?? [
      { name: "A", isBot: false, guohao: "魏" },
      { name: "B", isBot: false, guohao: "蜀" },
    ],
    targetNetWorth: 30000,
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
  return {
    id,
    name,
    title: "",
    desc: "",
    skills: [
      {
        id: `${id}-move+1`,
        name: "测试技",
        when: "BeforeMarch" as const,
        effect: "moveBonus",
        params: { steps: 1 },
        scope: "self" as const,
      },
    ],
    image: "/assets/heroes/hero-zhouyu-sgs.png",
  };
}

/** 给玩家塞一座非都城的可变卖城(catalog 里 valueByLevel 齐全的普通城),返回其 Lv.0 变卖价。 */
function giveSellableCity(e: GameEngine, p: Player): { propId: string; lv0Value: number } {
  const capProp = e.board.at(p.capitalIndex)?.propertyId!;
  const tile = e.board.tiles.find(
    (t) => !!t.propertyId && t.propertyId !== capProp && e.catalog.get(t.propertyId) != null,
  )!;
  const def = e.catalog.get(tile.propertyId!)!;
  p.properties.push({
    propertyId: def.id,
    group: def.group,
    purchasePrice: def.purchasePrice,
    level: 0,
    maxLevel: def.maxLevel,
  });
  return { propId: def.id, lv0Value: def.valueByLevel[0] };
}

describe("破产清算", () => {
  it("现金不足但有珍宝 → 进入清算;卖珍宝凑够 → 免破产继续", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600(经济 v2)
    const r = testEngine(e).payOrLiquidate(p, null, 200); // 欠 200,cash 100,有珍宝 → 清算
    expect(r).toBe("liquidating");
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    expect(e.pendingDebt?.amount).toBe(200);
    e.sellTreasureBankruptcy("t1"); // 卖宝 +600 → cash 700
    expect(p.cash).toBe(700);
    e.confirmBankruptcySettle(); // 凑够 → 扣 200
    expect(p.cash).toBe(500);
    expect(p.isBankrupt).toBe(false);
  });

  it("无资产可清(仅都城)→ 直接破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 50;
    // 选都后只有都城(不可卖)+ 无珍宝/名将
    const r = testEngine(e).payOrLiquidate(p, null, 200);
    expect(r).toBe("bankrupt");
    expect(p.isBankrupt).toBe(true);
  });

  it("清算卖光仍不足 → 破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 指导价 100
    testEngine(e).payOrLiquidate(p, null, 500); // 欠 500,宝仅 100
    e.sellTreasureBankruptcy("t1"); // +100 → cash 100
    e.confirmBankruptcySettle(); // 仍不足 → 破产
    expect(p.isBankrupt).toBe(true);
  });

  it("名将换银 200 + 释放回招贤池", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.heroes.push(hero("zhouyu", "周瑜"));
    testEngine(e).payOrLiquidate(p, null, 150); // 欠 150,有名将 → 清算
    e.cashHeroBankruptcy("zhouyu"); // +200,释放
    expect(p.cash).toBe(200);
    expect(p.heroes.length).toBe(0);
    e.confirmBankruptcySettle(); // 凑够 → 扣 150
    expect(p.cash).toBe(50);
    expect(p.isBankrupt).toBe(false);
  });

  it("都城不可变卖(清算时 sellPropertyBankruptcy 拒绝)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const capProp = e.board.at(p.capitalIndex)?.propertyId!;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 1, count: 1, desc: "" }); // 有珍宝才能进清算
    testEngine(e).payOrLiquidate(p, null, 99999);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.sellPropertyBankruptcy(capProp); // 都城 → 拒绝(warn,不变)
    expect(p.properties.some((h) => h.propertyId === capProp)).toBe(true); // 都城仍在
    expect(p.cash).toBe(0); // 没卖成都城
  });

  it("凑足即止:自救达标(现金≥债务)后,三类变卖命令一律被引擎硬拒绝", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    p.heroes.push(hero("zhouyu", "周瑜"), hero("zhugeliang", "诸葛亮"));
    const city = giveSellableCity(e, p);
    testEngine(e).payOrLiquidate(p, null, 150); // 欠 150
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    e.cashHeroBankruptcy("zhouyu"); // +200 → cash 200 ≥ 150,自救达标
    expect(p.cash).toBe(200);
    // 达标后珍宝/城/名将三类守卫一致:一律拒绝,资产原封不动
    e.sellTreasureBankruptcy("t1");
    e.sellPropertyBankruptcy(city.propId);
    e.cashHeroBankruptcy("zhugeliang");
    expect(p.cash).toBe(200);
    expect(p.treasures.map((t) => t.id)).toEqual(["t1"]);
    expect(p.properties.some((h) => h.propertyId === city.propId)).toBe(true);
    expect(p.heroes.map((h) => h.id)).toEqual(["zhugeliang"]);
    expect(e.log.some((l) => l.brief.includes("已凑足债务,不可再卖"))).toBe(true); // 明确 reason 进日志
    e.confirmBankruptcySettle(); // 确认结算语义不变:照常清偿 150
    expect(p.cash).toBe(50);
    expect(p.isBankrupt).toBe(false);
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
    testEngine(e).payOrLiquidate(p, null, 500); // 欠 500,cash 499,差 1 分
    e.sellTreasureBankruptcy("cheap"); // 仍欠 1 分 → 卖最便宜的允许(卖出即凑足)
    expect(p.cash).toBe(599);
    e.sellTreasureBankruptcy("pricey"); // 已达标 → 拒绝
    expect(p.cash).toBe(599);
    expect(p.treasures.map((t) => t.id)).toEqual(["pricey"]);
    e.confirmBankruptcySettle();
    expect(p.cash).toBe(99); // 599 − 500
    expect(p.isBankrupt).toBe(false);
  });

  it("清算自救走完后状态干净(pendingDebt/托管/访客态复位,回到 Roll)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" });
    testEngine(e).payOrLiquidate(p, null, 200);
    e.sellTreasureBankruptcy("t1"); // +600 → 700
    e.confirmBankruptcySettle();
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
    p.heroes.push(hero("zhouyu", "周瑜"));
    testEngine(e).payOrLiquidate(p, null, 500); // 欠 500,仅有名将(+200)可卖
    e.cashHeroBankruptcy("zhouyu"); // +200,仍差 300
    e.confirmBankruptcySettle(); // 凑不够 → 破产出局
    expect(p.isBankrupt).toBe(true);
    expect(e.pendingDebt).toBeNull();
    expect(e.turnPhase).toBe("Roll"); // 3 人在局,游戏未结束
    expect(e.recruitedHeroIds.has("zhouyu")).toBe(false); // 名将释放回招贤池
  });
});

describe("变卖金额口径(#60:展示价 === 实际入账)", () => {
  /** 卷轴展示价的 UI 口径(DecisionScrollLayer/BankruptcyScroll 与引擎共用的纯函数):
   *  珍宝 = guidePriceOf(level),城 = sellValueOf(def, level),名将 = 200。
   *  本组断言:引擎三变卖命令的实际入账 === 同一批纯函数的输出(展示 ≠ 入账即红)。 */
  it("三类变卖入账 = UI 展示价(同一纯函数),城按 valueByLevel 而非购入价", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 7, count: 1, desc: "" }); // 指导价 = guidePriceOf(7)
    const city = giveSellableCity(e, p);
    const def = e.catalog.get(city.propId)!;
    p.heroes.push(hero("zhouyu", "周瑜"));
    testEngine(e).payOrLiquidate(p, null, 999999); // 巨债:确保三笔变卖都还被允许

    // 珍宝:入账 === 展示(guidePriceOf(level))
    e.sellTreasureBankruptcy("t1");
    expect(p.cash).toBe(guidePriceOf(7));

    // 城:入账 === 展示(sellValueOf(def, level) = valueByLevel[level]);Lv.0 是折价 ≠ 购入价
    e.sellPropertyBankruptcy(city.propId);
    expect(p.cash).toBe(guidePriceOf(7) + sellValueOf(def, 0));
    expect(sellValueOf(def, 0)).toBe(def.valueByLevel[0]);
    expect(sellValueOf(def, 0)).not.toBe(def.purchasePrice); // Lv.0 变卖折价(经济 v2:40%),展示不再标购入价

    // 名将:入账 === 展示(200)
    e.cashHeroBankruptcy("zhouyu");
    expect(p.cash).toBe(guidePriceOf(7) + sellValueOf(def, 0) + 200);
  });

  it("卖一座城恰好清债:按展示价(Lv.0 变卖价)入账后尚欠归零,免破产", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const city = giveSellableCity(e, p);
    const price = sellValueOf(e.catalog.get(city.propId)!, 0); // 与卷轴展示同一函数
    p.cash = 0; // 现金归零:欠恰一座 Lv.0 城的变卖价(仅城可卖 → 仍进清算)
    testEngine(e).payOrLiquidate(p, null, price);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");
    // 尚欠(卷轴口径)= max(0, debt − cash)
    expect(Math.max(0, e.pendingDebt!.amount - p.cash)).toBe(price);
    e.sellPropertyBankruptcy(city.propId); // +price(恰为展示价)→ cash === debt
    expect(p.cash).toBe(price);
    expect(Math.max(0, e.pendingDebt!.amount - p.cash)).toBe(0); // 尚欠刷新为 0
    e.confirmBankruptcySettle();
    expect(p.cash).toBe(0); // 恰好清偿,无隐藏扣减
    expect(p.isBankrupt).toBe(false);
    expect(e.pendingDebt).toBeNull();
  });

  it("尚欠随每笔变卖实时刷新(快照口径:owe = max(0, pendingDebt.amount − 快照 cash)),debt 本身不变", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    p.cash = 0;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    const city = giveSellableCity(e, p);
    const cityPrice = sellValueOf(e.catalog.get(city.propId)!, 0);
    const debt = guidePriceOf(5) + cityPrice;
    testEngine(e).payOrLiquidate(p, null, debt);
    expect(e.turnPhase).toBe("AwaitingBankruptcySettle");

    const oweOf = () => {
      const s = e.snapshot();
      const me = s.players[s.activeIndex];
      expect(s.pendingDebt?.amount).toBe(debt); // 债务额清算期固定,不随变卖缩水
      return Math.max(0, s.pendingDebt!.amount - me.cash);
    };
    expect(oweOf()).toBe(debt); // 未卖:欠全额
    e.sellTreasureBankruptcy("t1"); // +600
    expect(oweOf()).toBe(cityPrice); // 尚欠实时缩水
    e.sellPropertyBankruptcy(city.propId); // +cityPrice
    expect(oweOf()).toBe(0); // 凑足即 0(封顶,不为负)
    e.confirmBankruptcySettle();
    expect(p.cash).toBe(0); // 全额清偿,无其他扣减
    expect(p.isBankrupt).toBe(false);
  });
});

describe("清算路径 CashLost 口径(#452):非自愿现金支出按实付现金派发,实付 0 不派发", () => {
  const CAOPI = HEROES.find((h) => h.id === "caopi")!;

  it("清算自救后清偿:实付现金派 CashLost,曹丕渔利恰得 50", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const caopi = e.players.find((q) => q !== p)!;
    caopi.heroes.push(CAOPI);
    const caopiCash0 = caopi.cash;
    p.cash = 100;
    p.treasures.push({ id: "t1", name: "宝", level: 5, count: 1, desc: "" }); // 指导价 600
    const r = testEngine(e).payOrLiquidate(p, null, 200);
    expect(r).toBe("liquidating");
    e.sellTreasureBankruptcy("t1"); // +600 → cash 700
    e.confirmBankruptcySettle(); // 实付 200 清偿
    expect(p.cash).toBe(500);
    expect(p.isBankrupt).toBe(false);
    expect(caopi.cash).toBe(caopiCash0 + 50); // 与现金直付同口径:渔利恰一次
  });

  it("征粮归一:直付派发(渔利 +50);致破实付 0 不派发(曹丕分文不得)", () => {
    const e = makeEngine(1);
    finishSetup(e);
    const p = e.activePlayer;
    const caopi = e.players.find((q) => q !== p)!;
    caopi.heroes.push(CAOPI);
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
    testEngine(e).applyEncounter(p, p.position, levy);
    const afterDirect = caopi.cash;
    expect(afterDirect).toBe(caopiCash0 + 150 + 50);
    // 致破腿:现金不足且无产可清算 → paid=0 → 不派发,曹丕分文不得
    p.cash = 10;
    p.properties = [];
    const r = testEngine(e).applyEncounter(p, p.position, levy);
    expect(r).toBe("bankrupt");
    expect(p.isBankrupt).toBe(true);
    expect(caopi.cash).toBe(afterDirect); // 0 额不派发:渔利不再白得 50
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
    const r = testEngine(e).payOrLiquidate(payer, creditor, 150);
    expect(r).toBe("ok");
    expect(payer.cash).toBe(payerCash0 - 150); // 付款方实付
    expect(creditor.cash).toBe(creditorCash0 + 150); // 收款方实收
    expect(entries.filter((x) => x.moment === "CashGained").map((x) => x.ctx)).toEqual([
      { subject: e.players.indexOf(creditor), amount: 150 }, // 恰一派
    ]);
    expect(entries.filter((x) => x.moment === "CashLost")).toHaveLength(0); // 本窄面只测收款半边(付款侧 CashLost 由调用域派发)

    // creditor=null(税/行情等归银行):无玩家收款,不派发
    const entries2 = recordCashMoments(e);
    expect(testEngine(e).payOrLiquidate(payer, null, 100)).toBe("ok");
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
    expect(testEngine(e).payOrLiquidate(p, creditor, 200)).toBe("liquidating");
    e.sellTreasureBankruptcy("t1"); // +600 → 凑足
    e.confirmBankruptcySettle(); // 实付 200 清偿 → 债主收款
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

// 经济数值一致性守卫(ADR-0034 四档城制;ADR-0042 决策 3 档位显式化重钉):城池档位
// 已是地图 JSON 逐城必配的 tier 字段(loadMap 白名单校验、注入 PropertyDef),本守卫改
// 「tier 声明 ↔ 该档标准曲线」对账:任何一座城 tier 声明与数值形状不符 = 红——
// 回改地图,不改本表(标准值表留守卫内);各图各档数量盘子一并锁定,防数值漂移/悄悄改盘子。
// 都城补给 = 地图顶层 resupply 固定值,珍宝指导价表一并锁定。
//
// 四档设计口径(ADR-0034):加法城两档(县城/郡城,倍率恒 1,加值随级翻倍节奏)、
// 纯乘城一档(奇城,加值恒 0,满级倍率 7 高于名城的 5——高等级配高价值珍宝翻盘)、
// 乘加城一档(名城,两者皆有、购价明显高,低中高价值珍宝通吃)。
//
// 两图共用同一张标准表(ADR-0041):#827 曾给环游图单独 ×1.5(百两速记 27/45/72)
// 回补 36 格圈水槽;实测跑了一阵后玩家侧判定数字膨胀 + 前期现金过阔,ADR-0041 回调——
// ①价格回 ÷1.5(百两速记 18/30/48),两图统一单表(曲线本就同值,双表并存只剩维护成本);
// ②起手现金 10,000→5,000(两图同改),引擎 DEFAULT_TARGET/DEFAULT_CASH 缺省删除,
//   targetNetWorth/startingCash 改地图必配(loadMap 校验);
// ③奇城 Lv2 倍率 5→4 驯化保留(#827 独立实测修复:大单 78% 出在奇城)并推广到中原图
//   (虎牢关/宛城同为双奇城);满级 ×7、青囊书 600 分水岭(奇/名满级同售 4200)与
//   斩杀线 21000 不变。
// 局长随之回短:模拟对账留档于 ADR-0041,玩家拍板「短了就短了」认账。
//
// ④变卖系数削弱(#1077,2026-11-05):[60,90,120,150]% → [50,70,90,110]%——破产自救
//   回收变紧;满级 110% 仍高于购价,「可增值」语义保留但变薄。
import { describe, it, expect } from "bun:test";
import { loadMap } from "@core/board-loader";
import type { CityTier } from "@core/economy";
import { TREASURE_PRICE } from "@core/treasures";
import zhongyuanData from "../public/maps/zhongyuan.json";
import guanzhongData from "../public/maps/guanzhong.json";

/** 两图共用标准表(ADR-0041 两图统一;关中图侧 make-guanzhong-map.ts TIERS 同源同值),
 *  键 = 城池档位单字口径(economy.CityTier,逐城 tier 字段)。购价百两速记:
 *  县 18 档/郡·奇 30 档/名 48 档;变卖价 = 购价 × [50%, 70%, 90%, 110%](#1077);建城费 = 购价 50%。 */
const STANDARD: Record<
  CityTier,
  {
    price: number;
    buildCost: number;
    tradeMult: number[];
    tradeAdd: number[];
    valueByLevel: number[];
  }
> = {
  县: {
    price: 1800,
    buildCost: 900,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [100, 200, 400, 800],
    valueByLevel: [900, 1260, 1620, 1980],
  },
  郡: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [200, 400, 800, 1600],
    valueByLevel: [1500, 2100, 2700, 3300],
  },
  奇: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [2, 3, 4, 7],
    tradeAdd: [0, 0, 0, 0],
    valueByLevel: [1500, 2100, 2700, 3300],
  },
  名: {
    price: 4800,
    buildCost: 2400,
    tradeMult: [2, 3, 4, 5],
    tradeAdd: [200, 400, 600, 1200],
    valueByLevel: [2400, 3360, 4320, 5280],
  },
};

/** 各图各档数量盘子(ADR-0034 拍板的分配盘子,防逐城微调悄悄改盘子;
 *  关中图 28 城(#938):环游图盘子按 7/9 等比缩,县城同样含 5 座(#960 专名改定
 *  [襄平/泸水/卧龙岗/南徐/受禅台])。 */
const GUANZHONG_COUNTS: Record<CityTier, number> = { 县: 12, 郡: 9, 奇: 4, 名: 3 };
const ZY_COUNTS: Record<CityTier, number> = { 县: 3, 郡: 2, 奇: 2, 名: 1 };

function checkMap(name: string, data: unknown, counts: Record<CityTier, number>) {
  const m = loadMap(data);
  it(`${name}:全局数值(目标 30000 / 起手 5000 / 补给 1000)`, () => {
    expect(m.targetNetWorth).toBe(30000);
    expect(m.startingCash).toBe(5000);
    for (const p of m.properties) expect(p.resupply, `${p.id} resupply`).toBe(1000);
  });
  it(`${name}:逐城 tier 声明与该档标准曲线对账`, () => {
    expect(m.properties.length).toBe(Object.values(counts).reduce((a, b) => a + b, 0)); // 无城遗漏/多城
    const seen: Record<CityTier, number> = { 县: 0, 郡: 0, 奇: 0, 名: 0 };
    for (const p of m.properties) {
      const std = STANDARD[p.tier];
      expect(p.purchasePrice, `${p.id} price(tier=${p.tier})`).toBe(std.price);
      expect(p.buildCost, `${p.id} buildCost(tier=${p.tier})`).toBe(std.buildCost);
      expect(p.tradeAdd, `${p.id} tradeAdd(tier=${p.tier})`).toEqual(std.tradeAdd);
      expect(p.tradeMult, `${p.id} tradeMult(tier=${p.tier})`).toEqual(std.tradeMult);
      expect(p.valueByLevel, `${p.id} valueByLevel(tier=${p.tier})`).toEqual(std.valueByLevel);
      seen[p.tier] += 1;
    }
    expect(seen, `${name} 各档数量盘子`).toEqual(counts);
  });
}

describe("经济数值守卫(四档城制,ADR-0034;两图同表,ADR-0041;tier 显式对账,ADR-0042)", () => {
  checkMap("guanzhong", guanzhongData, GUANZHONG_COUNTS);
  checkMap("zhongyuan", zhongyuanData, ZY_COUNTS);

  it("珍宝指导价表(v2 沿用):Lv1-10 = 1/2/3/4/6/8/12/16/22/30 两", () => {
    expect(TREASURE_PRICE).toEqual({
      1: 100,
      2: 200,
      3: 300,
      4: 400,
      5: 600,
      6: 800,
      7: 1200,
      8: 1600,
      9: 2200,
      10: 3000,
    });
  });
});

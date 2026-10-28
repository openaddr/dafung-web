// 经济数值 v3 一致性守卫(ADR-0034 四档城制):两张内置地图每座城的 price/tradeAdd/
// tradeMult/valueByLevel/buildCost 必须严格落在其城档(县城/郡城/奇城/名城)的标准值上,
// 都城补给 = 地图顶层 resupply 固定值,珍宝指导价表一并锁定——防手改地图数值漂移。
//
// 四档设计口径(ADR-0034):加法城两档(县城/郡城,倍率恒 1,加值随级翻倍节奏)、
// 纯乘城一档(奇城,加值恒 0,倍率 [2,3,5,7] 高于名城的 5——高等级配高价值珍宝翻盘)、
// 乘加城一档(名城,两者皆有、购价明显高,低中高价值珍宝通吃)。
import { describe, it, expect } from "bun:test";
import { loadMap } from "@core/board-loader";
import { TREASURE_PRICE } from "@core/treasures";
import zhongyuanData from "../public/maps/zhongyuan.json";
import huanyouData from "../public/maps/huanyou.json";

/** 四档标准表(购价百两速记:县城 18 档/郡城·奇城 30 档/名城 48 档)。
 *  变卖价 = 购价 × [60%, 90%, 120%, 150%];建城费 = 购价 50%。 */
const TIERS = {
  县城: {
    price: 1800,
    buildCost: 900,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [100, 200, 400, 800],
    valueByLevel: [1080, 1620, 2160, 2700],
  },
  郡城: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [200, 400, 800, 1600],
    valueByLevel: [1800, 2700, 3600, 4500],
  },
  奇城: {
    price: 3000,
    buildCost: 1500,
    tradeMult: [2, 3, 5, 7],
    tradeAdd: [0, 0, 0, 0],
    valueByLevel: [1800, 2700, 3600, 4500],
  },
  名城: {
    price: 4800,
    buildCost: 2400,
    tradeMult: [2, 3, 4, 5],
    tradeAdd: [200, 400, 600, 1200],
    valueByLevel: [2880, 4320, 5760, 7200],
  },
};

/** 环游图逐城城档(38 城:名城4/奇城5/郡城12/县城17);zhongyuan 各自映射。 */
const HUANYOU_TIER: Record<string, keyof typeof TIERS> = {
  // 名城(魏蜀吴都城 + 汉室西京)
  "prop-changan": "名城",
  "prop-luoyang": "名城",
  "prop-chengdu": "名城",
  "prop-jianye": "名城",
  // 奇城(有故事的知名城池:马谡/魏延/关羽/张辽/赤壁)
  "prop-jieting": "奇城",
  "prop-ziwu": "奇城",
  "prop-huarong": "奇城",
  "prop-hefei": "奇城",
  "prop-chibi": "奇城",
  // 郡城
  "prop-wujun": "郡城",
  "prop-hulao": "郡城",
  "prop-xianyang": "郡城",
  "prop-xiangyang": "郡城",
  "prop-xuchang": "郡城",
  "prop-kuiji": "郡城",
  "prop-ye": "郡城",
  "prop-xuzhou": "郡城",
  "prop-hanzhong": "郡城",
  "prop-jiangling": "郡城",
  "prop-xiapi": "郡城",
  "prop-hongnong": "郡城",
  // 县城
  "prop-jiange": "县城",
  "prop-jinyang": "县城",
  "prop-wuchang": "县城",
  "prop-linzi": "县城",
  "prop-shouchun": "县城",
  "prop-wan": "县城",
  "prop-jiangzhou": "县城",
  "prop-shangyong": "县城",
  "prop-jiangxia": "县城",
  "prop-youzhou": "县城",
  "prop-changsha": "县城",
  "prop-hangu": "县城",
  "prop-yongzhou": "县城",
  "prop-liaodong": "县城",
  "prop-lingling": "县城",
  "prop-jiaozhou": "县城",
  "prop-liangzhou": "县城",
};
const ZY_TIER: Record<string, keyof typeof TIERS> = {
  "prop-luoyang": "名城",
  "prop-hulaoguan": "奇城",
  "prop-wancheng": "奇城",
  "prop-kaifeng": "郡城",
  "prop-mengjin": "郡城",
  "prop-xuchang2": "县城",
  "prop-xinye": "县城",
  "prop-henei": "县城",
};

/** 各图各档数量分布(ADR-0034 拍板的分配盘子,防逐城微调悄悄改盘子)。 */
const HUANYOU_COUNTS: Record<keyof typeof TIERS, number> = { 名城: 4, 奇城: 5, 郡城: 12, 县城: 17 };
const ZY_COUNTS: Record<keyof typeof TIERS, number> = { 名城: 1, 奇城: 2, 郡城: 2, 县城: 3 };

function checkMap(
  name: string,
  data: unknown,
  tierOf: Record<string, keyof typeof TIERS>,
  counts: Record<keyof typeof TIERS, number>,
) {
  const m = loadMap(data);
  it(`${name}:全局数值(目标 30000 / 起手 10000 / 补给 1000)`, () => {
    expect(m.targetNetWorth).toBe(30000);
    expect(m.startingCash).toBe(10000);
    for (const p of m.properties) expect(p.resupply, `${p.id} resupply`).toBe(1000);
  });
  it(`${name}:逐城数值必须落在城档标准值上`, () => {
    expect(m.properties.length).toBe(Object.keys(tierOf).length); // 无城遗漏/多城
    const seen: Record<string, number> = {};
    for (const p of m.properties) {
      const tier = tierOf[p.id];
      expect(tier, `${p.id} 缺城档分配`).toBeDefined();
      const standard = TIERS[tier];
      expect(p.purchasePrice, `${p.id} price`).toBe(standard.price);
      expect(p.buildCost, `${p.id} buildCost`).toBe(standard.buildCost);
      expect(p.tradeAdd, `${p.id} tradeAdd`).toEqual(standard.tradeAdd);
      expect(p.tradeMult, `${p.id} tradeMult`).toEqual(standard.tradeMult);
      expect(p.valueByLevel, `${p.id} valueByLevel`).toEqual(standard.valueByLevel);
      seen[tier] = (seen[tier] ?? 0) + 1;
    }
    expect(seen, `${name} 各档数量盘子`).toEqual(counts);
  });
}

describe("经济数值 v3 守卫(四档城制,ADR-0034)", () => {
  checkMap("huanyou", huanyouData, HUANYOU_TIER, HUANYOU_COUNTS);
  checkMap("zhongyuan", zhongyuanData, ZY_TIER, ZY_COUNTS);

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

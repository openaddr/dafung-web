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

/** 中原图标准表(ADR-0034 v3 原表,未动;购价百两速记:县城 18 档/郡城·奇城 30 档/名城 48 档)。
 *  变卖价 = 购价 × [60%, 90%, 120%, 150%];建城费 = 购价 50%。 */
const ZY_STANDARD = {
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

/** 环游图标准表(#827 第二棒再平衡,生成器 make-huanyou-map.ts TIERS 同源同值)。
 *  圈长 45→36 实锤补给吞吐 +25%、局长 −39%/−31%(超 ADR-0034 ±20% 判据),故:
 *  ①价格 ×1.5(圈长比 1.25 × 冻结节拍残差 1.2)回补每圈水槽——城池购置是系统唯一
 *  真水槽(租值是玩家间转移,模拟实测调加值/倍率局长零响应);变卖系数 60/90/120/150%
 *  与建城费 50% 口径保持(购价百两速记:县城 27 档/郡城·奇城 45 档/名城 72 档)。
 *  ②奇城 Lv2 倍率 5→4:移交清单「双奇城租值」实锤大单 78% 出在奇城,驯化后局均大单
 *  −27%;满级 ×7、青囊书 600 分水岭(奇/名满级同售 4200)与斩杀线 21000 全保。
 *  targetNetWorth 30000 / startingCash 10000 / resupply 1000 / maxLevel 3 冻结不动。 */
const HUANYOU_STANDARD = {
  县城: {
    price: 2700,
    buildCost: 1350,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [100, 200, 400, 800],
    valueByLevel: [1620, 2430, 3240, 4050],
  },
  郡城: {
    price: 4500,
    buildCost: 2250,
    tradeMult: [1, 1, 1, 1],
    tradeAdd: [200, 400, 800, 1600],
    valueByLevel: [2700, 4050, 5400, 6750],
  },
  奇城: {
    price: 4500,
    buildCost: 2250,
    tradeMult: [2, 3, 4, 7],
    tradeAdd: [0, 0, 0, 0],
    valueByLevel: [2700, 4050, 5400, 6750],
  },
  名城: {
    price: 7200,
    buildCost: 3600,
    tradeMult: [2, 3, 4, 5],
    tradeAdd: [200, 400, 600, 1200],
    valueByLevel: [4320, 6480, 8640, 10800],
  },
};
type TierKey = keyof typeof ZY_STANDARD;

/** 环游图逐城城档(36 城,#827 重排:名城4/奇城5/郡城11/县城16——县城含 5 座
 *  #827 派生名城[商市城/锦囊城×2/卧龙城/天命城],与旧功能格转城同款县城档);
 *  zhongyuan 各自映射。 */
const HUANYOU_TIER: Record<string, TierKey> = {
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
  // 郡城(旧 12 城去虎牢关/江陵/弘农,升凉州[州治]/江州[巴郡治])
  "prop-wujun": "郡城",
  "prop-xianyang": "郡城",
  "prop-xiangyang": "郡城",
  "prop-xuchang": "郡城",
  "prop-kuiji": "郡城",
  "prop-ye": "郡城",
  "prop-xuzhou": "郡城",
  "prop-hanzhong": "郡城",
  "prop-xiapi": "郡城",
  "prop-liangzhou": "郡城",
  "prop-jiangzhou": "郡城",
  // 县城
  "prop-jiange": "县城",
  "prop-jinyang": "县城",
  "prop-wuchang": "县城",
  "prop-linzi": "县城",
  "prop-jiangxia": "县城",
  "prop-youzhou": "县城",
  "prop-changsha": "县城",
  "prop-hangu": "县城",
  "prop-liaodong": "县城",
  "prop-lingling": "县城",
  "prop-jiaozhou": "县城",
  // #827 派生名城(商市城/锦囊城×2/卧龙城/天命城,统一按县城档入表)
  "prop-shangshi": "县城",
  "prop-jinnang-1": "县城",
  "prop-jinnang-2": "县城",
  "prop-wolong": "县城",
  "prop-tianming": "县城",
};
const ZY_TIER: Record<string, TierKey> = {
  "prop-luoyang": "名城",
  "prop-hulaoguan": "奇城",
  "prop-wancheng": "奇城",
  "prop-kaifeng": "郡城",
  "prop-mengjin": "郡城",
  "prop-xuchang2": "县城",
  "prop-xinye": "县城",
  "prop-henei": "县城",
};

/** 各图各档数量分布(ADR-0034 拍板的分配盘子,#827 重排 36 城盘子,防逐城微调悄悄改盘子)。 */
const HUANYOU_COUNTS: Record<TierKey, number> = { 名城: 4, 奇城: 5, 郡城: 11, 县城: 16 };
const ZY_COUNTS: Record<TierKey, number> = { 名城: 1, 奇城: 2, 郡城: 2, 县城: 3 };

function checkMap(
  name: string,
  data: unknown,
  tierOf: Record<string, TierKey>,
  counts: Record<TierKey, number>,
  standard: typeof ZY_STANDARD,
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
      const std = standard[tier];
      expect(p.purchasePrice, `${p.id} price`).toBe(std.price);
      expect(p.buildCost, `${p.id} buildCost`).toBe(std.buildCost);
      expect(p.tradeAdd, `${p.id} tradeAdd`).toEqual(std.tradeAdd);
      expect(p.tradeMult, `${p.id} tradeMult`).toEqual(std.tradeMult);
      expect(p.valueByLevel, `${p.id} valueByLevel`).toEqual(std.valueByLevel);
      seen[tier] = (seen[tier] ?? 0) + 1;
    }
    expect(seen, `${name} 各档数量盘子`).toEqual(counts);
  });
}

describe("经济数值 v3 守卫(四档城制,ADR-0034)", () => {
  checkMap("huanyou", huanyouData, HUANYOU_TIER, HUANYOU_COUNTS, HUANYOU_STANDARD);
  checkMap("zhongyuan", zhongyuanData, ZY_TIER, ZY_COUNTS, ZY_STANDARD);

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

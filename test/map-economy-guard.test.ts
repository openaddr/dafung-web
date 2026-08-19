// 经济数值 v2 一致性守卫:三张内置地图每座城的 price/tradeAdd/tradeMult/valueByLevel/
// buildCost/resupplyPerLevel 必须严格落在其价位档的标准值上(乘法城另表),
// 珍宝指导价表/等级倍率/引擎默认值一并锁定——防手改地图数值漂移。
import { describe, it, expect } from "bun:test";
import { loadMap } from "@core/board-loader";
import { TREASURE_PRICE, CITY_LEVEL_MULTIPLIER } from "@core/treasures";
import sanguoData from "../public/maps/sanguo.json";
import zhongyuanData from "../public/maps/zhongyuan.json";
import chessboardData from "../public/maps/chessboard.json";

/** 价位档标准表(单位分;乘法城 30 两档单列)。与 .scratch/rescale-maps.cjs 同源,手改任一侧都应在此炸出。 */
const y2f = (liang: number) => liang * 100;
const ADD: Record<number, number[]> = {
  18: [1, 5, 13, 30], 22: [2, 7, 16, 37], 24: [2, 7, 18, 40], 27: [2, 8, 20, 45],
  34: [3, 10, 25, 55], 38: [3, 11, 28, 65], 40: [3, 12, 30, 70],
};
const TIER_OF = (liang: number) => ({
  price: y2f(liang),
  buildCost: y2f(Math.round(liang * 0.5)),
  tradeAdd: ADD[liang].map(y2f),
  tradeMult: [2, 4, 6, 10],
  valueByLevel: [0.4, 0.6, 0.85, 1.2].map((k) => y2f(Math.round(liang * k))),
});
const TIERS = new Map<number, ReturnType<typeof TIER_OF>>();
for (const liang of [18, 22, 24, 27, 34, 38, 40]) TIERS.set(liang, TIER_OF(liang));
// 乘法城(30 两):tradeAdd 全 0,tradeMult [2,3,4,5]
TIERS.set(30, {
  price: y2f(30), buildCost: y2f(15),
  tradeAdd: [0, 0, 0, 0], tradeMult: [2, 3, 4, 5],
  valueByLevel: [12, 18, 26, 36].map(y2f),
});

/** sanguo 逐城价位(两);zhongyuan/chessboard 各自映射到同一张表。 */
const SANGUO_TIER: Record<string, number> = {
  "prop-changan": 40, "prop-luoyang": 40, "prop-jianye": 40,
  "prop-xuchang": 34, "prop-wujun": 38, "prop-kuiji": 34,
  "prop-chengdu": 30, "prop-ye": 30, "prop-jiange": 30,
  "prop-jieting": 30, "prop-huarong": 30, "prop-hefei": 30,
  "prop-xiangyang": 34, "prop-jiangling": 27, "prop-wuchang": 27, "prop-jiangxia": 24, "prop-chibi": 24,
  "prop-hanzhong": 27, "prop-jiangzhou": 24, "prop-ziwu": 24,
  "prop-linzi": 27, "prop-xuzhou": 27, "prop-shouchun": 27,
  "prop-jinyang": 27,
  "prop-changsha": 22, "prop-lingling": 18, "prop-jiaozhou": 18,
  "prop-yongzhou": 22, "prop-liangzhou": 18,
  "prop-youzhou": 22, "prop-liaodong": 18,
};
const ZY_TIER: Record<string, number> = {
  "prop-luoyang": 40, "prop-mengjin": 38, "prop-hulaoguan": 34, "prop-kaifeng": 38,
  "prop-xuchang2": 34, "prop-wancheng": 34, "prop-xinye": 34, "prop-henei": 34,
};
const MULT_CITY = new Set(["prop-chengdu", "prop-ye", "prop-jiange", "prop-jieting", "prop-huarong", "prop-hefei"]);
const FERTILE = ["中原", "江东"];
const MEDIUM = ["荆楚", "巴蜀", "青徐", "淮南", "并州"];

function checkMap(name: string, data: unknown, tierOf: Record<string, number>) {
  const m = loadMap(data);
  it(`${name}:全局数值(目标 30000 / 起手 10000)`, () => {
    expect(m.targetNetWorth).toBe(30000);
    expect(m.startingCash).toBe(10000);
  });
  it(`${name}:逐城数值必须落在价位档标准值上`, () => {
    expect(m.properties.length).toBe(Object.keys(tierOf).length); // 无城遗漏/多城
    for (const p of m.properties) {
      const liang = tierOf[p.id];
      expect(liang, `${p.id} 缺价位分配`).toBeDefined();
      const tier = TIERS.get(liang)!;
      expect(p.purchasePrice, `${p.id} price`).toBe(tier.price);
      expect(p.buildCost, `${p.id} buildCost`).toBe(tier.buildCost);
      expect(p.tradeAdd, `${p.id} tradeAdd`).toEqual(tier.tradeAdd);
      expect(p.tradeMult, `${p.id} tradeMult`).toEqual(tier.tradeMult);
      expect(p.valueByLevel, `${p.id} valueByLevel`).toEqual(tier.valueByLevel);
    }
  });
}

function checkResupply(name: string, data: any) {
  it(`${name}:都城补给按区域档(边陲200/中庸300/沃野400/乘法城300)`, () => {
    for (const t of data.tiles as any[]) {
      if ((t.type ?? "Property") !== "Property") continue;
      const expected = MULT_CITY.has(t.id) ? 300
        : FERTILE.includes(t.region) ? 400
        : MEDIUM.includes(t.region) ? 300
        : 200;
      expect(t.resupplyPerLevel, `${t.id}(${t.name}/${t.region}) resupply`).toBe(expected);
    }
  });
}

describe("经济数值 v2 守卫", () => {
  checkMap("sanguo", sanguoData, SANGUO_TIER);
  checkMap("chessboard", chessboardData, SANGUO_TIER); // 从 sanguo 派生,同表
  checkMap("zhongyuan", zhongyuanData, ZY_TIER);
  checkResupply("sanguo", sanguoData);
  checkResupply("chessboard", chessboardData);
  checkResupply("zhongyuan", zhongyuanData);

  it("珍宝指导价表(v2):Lv1-10 = 1/2/3/4/6/8/12/16/22/30 两", () => {
    expect(TREASURE_PRICE).toEqual({
      1: 100, 2: 200, 3: 300, 4: 400, 5: 600,
      6: 800, 7: 1200, 8: 1600, 9: 2200, 10: 3000,
    });
  });
  it("城池等级倍率(v2):L0 起步 ×1.5", () => {
    expect(CITY_LEVEL_MULTIPLIER).toEqual([2, 3, 4, 5]);
  });
});

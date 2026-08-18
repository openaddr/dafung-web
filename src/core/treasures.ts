// 珍宝系统:数据驱动的珍宝定义 + 牌堆管理。
// 新增珍宝 = 往 TREASURES 加一条 TreasureDef。牌堆自动初始化。
import type { TreasureDef, TradeFormula } from "./types";

export const TREASURES: TreasureDef[] = [
  { id: "edict", name: "带血的诏书", level: 9, count: 1, desc: "衣带诏,董承受命" },
  { id: "seal", name: "传国玉玺", level: 10, count: 1, desc: "受命于天,既寿永昌" },
  { id: "lychee", name: "新鲜的荔枝", level: 9, count: 3, desc: "一骑红尘妃子笑" },
  { id: "hu", name: "小斛", level: 3, count: 3, desc: "曹操小斛杀粮官" },
  { id: "hat", name: "草帽", level: 1, count: 1, desc: "编草为生,布衣起家" },
  { id: "qingnang", name: "青囊书残卷", level: 5, count: 5, desc: "华佗遗书,残缺不全" },
];

/** 等级 → 指导价(分):Lv1-4 线性,Lv5+ 加速增长(1/2/3/4/6/8/12/16/22/30 两)。 */
export const TREASURE_PRICE: Record<number, number> = {
  1: 100, 2: 200, 3: 300, 4: 400, 5: 600,
  6: 800, 7: 1200, 8: 1600, 9: 2200, 10: 3000,
};

/** 珍宝指导价(分):查表;缺等级 = 数据 bug,直接抛错(零兜底)。集中一处,供引擎/UI 复用。 */
export function guidePriceOf(level: number): number {
  const price = TREASURE_PRICE[level];
  if (price == null) throw new Error(`珍宝等级 ${level} 无指导价(TREASURE_PRICE 缺项,数据 bug)`);
  return price;
}

/** 贸易售价(旧公式,向后兼容):markup=加价(指导价+param×等级倍率)、multiply=翻倍(指导价×param×等级倍率)、默认×1.5 保底高于指导价。集中公式防漂移。 */
export function tradePriceOf(guidePrice: number, trade: TradeFormula | undefined, levelMult: number): number {
  if (trade?.type === "markup") return guidePrice + trade.param * levelMult;
  if (trade?.type === "multiply") return guidePrice * trade.param * levelMult;
  return guidePrice * 1.5 * levelMult;
}

/** 城池等级 → 坐地起价倍率(旧 trade 公式回退用;下标 = 等级,Lv0..3)。
 *  新字段 tradeAdd/tradeMult 由地图 json 直接配置(同样下标 = 等级)。 */
export const CITY_LEVEL_MULTIPLIER = [1.5, 2, 3, 5]; // L0=×1.5, L1=×2, L2=×3, L3=×5

/** 坐地起价售价(新公式,per-level 加值/乘数优先;无则回退旧 trade 公式)。
 *  公式:指导价 × tradeMult[cityLevel] + tradeAdd[cityLevel](先乘再加;cityLevel 0..3)。 */
export function premiumPriceOf(
  guidePrice: number,
  def: { tradeAdd?: number[]; tradeMult?: number[]; trade?: TradeFormula },
  cityLevel: number,
): number {
  const add = def.tradeAdd?.[cityLevel];
  const mult = def.tradeMult?.[cityLevel];
  if (add != null || mult != null) {
    return Math.round(guidePrice * (mult ?? 1) + (add ?? 0)); // 先乘再加
  }
  // 回退:旧 trade 公式 + CITY_LEVEL_MULTIPLIER
  return tradePriceOf(guidePrice, def.trade, CITY_LEVEL_MULTIPLIER[cityLevel] ?? 1);
}

/** 初始化牌堆:展开所有珍宝为单独实例(如 荔枝 ×3 → 3 张)。 */
export function createTreasureDeck(): TreasureDef[] {
  const deck: TreasureDef[] = [];
  let serial = 0;
  for (const def of TREASURES) {
    for (let i = 0; i < (def.count ?? 1); i++) {
      deck.push({ ...def, id: `${def.id}-${serial++}` });
    }
  }
  return deck;
}

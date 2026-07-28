// 珍宝系统:数据驱动的珍宝定义 + 牌堆管理。
// 新增珍宝 = 往 TREASURES 加一条 TreasureDef。牌堆自动初始化。
import type { TreasureDef } from "./types";

export const TREASURES: TreasureDef[] = [
  { id: "edict", name: "带血的诏书", level: 9, count: 1, desc: "衣带诏,董承受命" },
  { id: "seal", name: "传国玉玺", level: 10, count: 1, desc: "受命于天,既寿永昌" },
  { id: "lychee", name: "新鲜的荔枝", level: 9, count: 3, desc: "一骑红尘妃子笑" },
  { id: "hu", name: "小斛", level: 3, count: 3, desc: "曹操小斛杀粮官" },
  { id: "hat", name: "草帽", level: 1, count: 1, desc: "编草为生,布衣起家" },
  { id: "qingnang", name: "青囊书残卷", level: 5, count: 5, desc: "华佗遗书,残缺不全" },
];

/** 等级 → 指导价(分)。Lv1-5 线性,Lv6+ 加速增长。 */
export const TREASURE_PRICE: Record<number, number> = {
  1: 100, 2: 200, 3: 300, 4: 400, 5: 500,
  6: 700, 7: 900, 8: 1200, 9: 1500, 10: 2000,
};

/** 珍宝指导价(分):查表兜底 等级×100。集中一处,供引擎/UI 复用。 */
export function guidePriceOf(level: number): number {
  return TREASURE_PRICE[level] ?? level * 100;
}

/** 城池等级 → 贸易/赠宝倍率。 */
export const CITY_LEVEL_MULTIPLIER = [1, 2, 3, 5]; // L0=×1, L1=×2, L2=×3, L3=×5

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

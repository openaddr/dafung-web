// 珍宝系统:数据驱动的珍宝定义 + 牌堆管理。
// 新增珍宝 = 往 TREASURES 加一条 TreasureDef。牌堆自动初始化。
// 珍宝类型随域走(#326 types.ts 解散,ADR-0019):珍宝定义由本文件拥有。
import type { PropertyDef } from "./economy";

/** 珍宝定义(牌堆实例与玩家持有共用)。 */
export interface TreasureDef {
  id: string; // 唯一(牌堆展开后含序号)
  name: string;
  level: number; // 1-10
  count?: number; // 牌堆中数量(仅 TREASURES 表用)
  desc?: string; // 风味描述
  image?: string; // 装裱卡画心(public 下,如 /assets/treasures/treasure-seal.webp;#521 画心批,同华佗 image 先例:纯数据字段,机制零消费;缺省=装裱卡回退远山肌理)
}

export const TREASURES: TreasureDef[] = [
  {
    id: "edict",
    name: "带血的诏书",
    level: 9,
    count: 1,
    desc: "衣带诏,董承受命",
    image: "/assets/treasures/treasure-edict.webp",
  },
  {
    id: "seal",
    name: "传国玉玺",
    level: 10,
    count: 1,
    desc: "受命于天,既寿永昌",
    image: "/assets/treasures/treasure-seal.webp",
  },
  {
    id: "lychee",
    name: "新鲜的荔枝",
    level: 9,
    count: 3,
    desc: "一骑红尘妃子笑",
    image: "/assets/treasures/treasure-lychee.webp",
  },
  {
    id: "hu",
    name: "小斛",
    level: 3,
    count: 3,
    desc: "曹操小斛杀粮官",
    image: "/assets/treasures/treasure-hu.webp",
  },
  {
    id: "hat",
    name: "草帽",
    level: 1,
    count: 1,
    desc: "编草为生,布衣起家",
    image: "/assets/treasures/treasure-hat.webp",
  },
  {
    id: "qingnang",
    name: "青囊书残卷",
    level: 5,
    count: 5,
    desc: "华佗遗书,残缺不全",
    image: "/assets/treasures/treasure-qingnang.webp",
  },
];

/** 等级 → 指导价(两):Lv1-4 线性,Lv5+ 加速增长(100/200/300/400/600/800/1200/1600/2200/3000 两)。 */
export const TREASURE_PRICE: Record<number, number> = {
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
};

/** 珍宝指导价(两):查表;缺等级 = 数据 bug,直接抛错(零兜底)。集中一处,供引擎/UI 复用。 */
export function guidePriceOf(level: number): number {
  const price = TREASURE_PRICE[level];
  if (price == null) throw new Error(`珍宝等级 ${level} 无指导价(TREASURE_PRICE 缺项,数据 bug)`);
  return price;
}

/** 坐地起价售价:指导价 × tradeMult[cityLevel] + tradeAdd[cityLevel](先乘再加、四舍五入)。
 *  tradeMult/tradeAdd 逐城必配(地图 schema 必填,loadMap 校验长度 = maxLevel+1),
 *  cityLevel 0..maxLevel 与两表同域(等级由引擎封闭变更),不在此设防。集中公式防漂移,供引擎/UI 复用。 */
export function premiumPriceOf(
  guidePrice: number,
  def: Pick<PropertyDef, "tradeAdd" | "tradeMult">,
  cityLevel: number,
): number {
  return Math.round(guidePrice * def.tradeMult[cityLevel] + def.tradeAdd[cityLevel]);
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

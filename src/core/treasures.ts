// 珍宝系统:数据驱动的珍宝定义 + 牌堆管理。
// 新增珍宝 = 往 TREASURES 加一条 TreasureDef。牌堆自动初始化。
// 珍宝类型随域走(#326 types.ts 解散,ADR-0019):珍宝定义由本文件拥有。
import type { PropertyDef } from "./economy";
import { skillById } from "./skills";

/** 珍宝定义(牌堆实例与玩家持有共用)。 */
export interface TreasureDef {
  id: string; // 唯一(牌堆展开后含序号;技能书=skillbook-<skillId>,见 makeSkillBook)
  name: string;
  level: number; // 1-10
  count?: number; // 牌堆中数量(仅 TREASURES 表用)
  desc?: string; // 风味描述
  image?: string; // 装裱卡画心(public 下,如 /assets/treasures/treasure-seal.webp;#521 画心批,同华佗 image 先例:纯数据字段,机制零消费;缺省=装裱卡回退远山肌理)
  /** 种别(#1146):缺省 "normal"=纯价值物;"book"=技能书——麾下习得器的可交易载体
   *  (白得零特判:交易/变卖/来访求购/窃玉全套珍宝现通路)。判别严格走本字段
   *  (isSkillBook 守卫),不靠 skillId 有无;存量珍宝零改。 */
  kind?: "normal" | "book";
  /** 技能书专属(#1146):书承载的技 id。技能二元有无(书=「此技习得器」,无等级语义,
   *  level 只承载珍宝位价值);普通珍宝不带。 */
  skillId?: string;
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
  // ── 起手珍宝目录扩容(#1100):1 级八品种各 2 件 + 断弦琴/粮册,1 级池合计 17 件
  // (8 人局开局发放 16 件后余 1)。本批不含画心(image 缺省 = 装裱卡回退远山肌理合法空态)。
  {
    id: "zhuojiu",
    name: "浊酒",
    level: 1,
    count: 2,
    desc: "一壶浊酒,笑谈古今",
    image: "/assets/treasures/treasure-zhuojiu.webp",
  },
  {
    id: "hubing",
    name: "胡饼",
    level: 1,
    count: 2,
    desc: "灵帝所好、京师争炊的胡饼",
    image: "/assets/treasures/treasure-hubing.webp",
  },
  {
    id: "suanchou",
    name: "算筹",
    level: 1,
    count: 2,
    desc: "账房先生握了一辈子的竹签",
  },
  {
    id: "pushan",
    name: "蒲扇",
    level: 1,
    count: 2,
    desc: "夏夜摇来凉风的老蒲扇",
    image: "/assets/treasures/treasure-pushan.webp",
  },
  {
    id: "suoyi",
    name: "蓑衣",
    level: 1,
    count: 2,
    desc: "一蓑烟雨的老蓑衣",
    image: "/assets/treasures/treasure-suoyi.webp",
  },
  {
    id: "qingmei",
    name: "青梅",
    level: 1,
    count: 2,
    desc: "煮酒论英雄的同款青梅",
  },
  {
    id: "shimo",
    name: "石磨",
    level: 1,
    count: 2,
    desc: "张飞悬肉压井的石磨",
    image: "/assets/treasures/treasure-shimo.webp",
  },
  {
    id: "doudai",
    name: "豆袋",
    level: 1,
    count: 2,
    desc: "云长落难时贩豆的袋子",
    image: "/assets/treasures/treasure-doudai.webp",
  },
  {
    id: "duanxian",
    name: "断弦琴",
    level: 8,
    count: 1,
    desc: "空城城头武侯抚琴的那张琴",
    image: "/assets/treasures/treasure-duanxian.webp",
  },
  {
    id: "liangce",
    name: "粮册",
    level: 4,
    count: 1,
    desc: "管粮官王垕的账册,小斛亏空笔笔在案",
    image: "/assets/treasures/treasure-liangce.webp",
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

// ──────────────────────────── 技能书(#1146)────────────────────────────
/** 技能书珍宝位档(#1146):低档位走珍宝价表(变卖/交涉价随 guidePriceOf);
 *  初值 Lv.2(指导价 200 两)——归 D 票校准。 */
export const SKILL_BOOK_LEVEL = 2;

/** 技能书实例 id 前缀(#1146):`skillbook-<skillId>`。同技多册同 id(锦囊手牌同款:
 *  同名张多手共存,实例定位恒在持有者列表内,无独立流水号)——快照/折叠按本前缀
 *  回溯印书单源(makeSkillBook),零静态造表。 */
export const SKILL_BOOK_ID_PREFIX = "skillbook-";

/** 印一册技能书(#1146,印书单源):name 由技表组合生成(「技能书·技名」,禁逐技
 *  静态造表);书=「此技习得器」,技能二元有无、无等级语义——level 只承载珍宝位价值。
 *  机制流程(位满印书入位/用书学技)归 recruitment.ts/roster.ts 域,本文件只管形状。 */
export function makeSkillBook(skillId: string): TreasureDef {
  const skill = skillById(skillId); // 查无=数据 bug,炸出(零兜底,同 skillById 口径)
  return {
    id: `${SKILL_BOOK_ID_PREFIX}${skillId}`,
    name: `技能书·${skill.name}`,
    level: SKILL_BOOK_LEVEL,
    desc: `研读可令麾下习得【${skill.name}】`,
    kind: "book",
    skillId,
  };
}

/** 技能书判别(#1146,类型守卫):严格判 kind 字段,skillId 有无不作凭据(存量珍宝
 *  恒 undefined 不误伤)。收窄后 skillId 非空,消费方免断言。 */
export function isSkillBook(t: TreasureDef): t is TreasureDef & { kind: "book"; skillId: string } {
  return t.kind === "book";
}

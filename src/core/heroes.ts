// 名将(英雄)池:技与将解耦(ADR-0036)。名将只声明技能池(skillPool,按池声明序引用技 id),
// 技能定义单源 src/core/skills.ts(被动+主动同表;一条技可入多个名将的池,重叠是特性)。
// 招募授技掷子集(rollGrantedSkills 单源 roster.ts,#787);新增名将 = 往这里加一条 HeroDef;
// 新增技改 skills.ts——两表都永远只是纯数据 + 读口(时机框架扩展指南见
// docs/explanation/时机框架.md;名将/技能定义随域走,#326 types.ts 解散,ADR-0019)。

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  title: string; // 雅量高致(称号,风味)
  /** 技能池(ADR-0036):允许拥有的技 id,按池声明序(派发序/卡面序/浮字拼接序同源);
   *  主动技每池至多一条、技 id 须在技能表可解析(数据守卫见 test/hero-skill 四钉)。 */
  skillPool: string[];
  image: string; // 画像路径(public 下,如 /assets/heroes/hero-zhouyu-sgs.png;3:4 竖版)
}

/** 按将 id 查名将(#785 麾下槽位化后的回查口:槽位只存 heroId,派发战报/遣散文案/快照
 *  展示字段按 id 现查);查无=数据 bug,炸出(零兜底)。 */
export function heroById(id: string): HeroDef {
  const hero = HEROES.find((h) => h.id === id);
  if (hero == null) throw new Error(`名将目录外 id:${id}(core/heroes.ts HEROES 无此 id)`);
  return hero;
}

// 首批共享表(ADR-0036 拍板,零新增数值):疾行=周瑜↔张星彩、擂鼓=张星彩↔周瑜、
// 掷金=张星彩↔曹丕,余五条单属主;池大小 = 强度旋钮(三将池 3、华佗池 2,不对称有意)。
export const HEROES: HeroDef[] = [
  {
    id: "zhouyu",
    image: "/assets/heroes/hero-zhouyu-sgs.png",
    name: "周瑜",
    title: "雅量高致",
    skillPool: ["jixing", "huogong", "leigu"], // {疾行,火攻,擂鼓}
  },
  {
    id: "caopi",
    image: "/assets/heroes/hero-caopi-sgs.png",
    name: "曹丕",
    title: "承继大统",
    skillPool: ["yuli", "zhengpi", "zhijin"], // {渔利,征辟,掷金}
  },
  {
    id: "zhangxingcai",
    image: "/assets/heroes/hero-zhangxingcai-sgs.png",
    name: "张星彩",
    title: "银翎飞骑",
    skillPool: ["zhijin", "leigu", "jixing"], // {掷金,擂鼓,疾行}
  },
  {
    id: "huatuo",
    // sgs 经典形象(#751 画像统一收官,curid=7870;noname 版已退役留档)
    image: "/assets/heroes/hero-huatuo-sgs.png",
    name: "华佗",
    title: "神医",
    skillPool: ["qingnang", "zhenji"], // {青囊,赈济}
  },
];

// 名将(英雄)池:技与将解耦(ADR-0036)。名将只声明技能池(skillPool,按池声明序引用技 id),
// 技能定义单源 src/core/skills.ts(被动+主动同表;一条技可入多池,重叠是特性)。
// 招贤授全池(授技掷子集为后续票,ADR-0036 路线图)。新增名将 = 往这里加一条 HeroDef;
// 新增技改 skills.ts——两表都永远只是纯数据 + 读口(时机框架扩展指南见
// docs/explanation/时机框架.md;名将/技能定义随域走,#326 types.ts 解散,ADR-0019)。
import { poolTriggerSkills } from "./skills";

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  title: string; // 雅量高致(称号,风味)
  /** 技能池(ADR-0036):允许拥有的技 id,按池声明序(派发序/卡面序/浮字拼接序同源);
   *  主动技每池至多一条、技 id 须在技能表可解析(数据守卫见 test/hero-skill 四钉)。 */
  skillPool: string[];
  image: string; // 画像路径(public 下,如 /assets/heroes/hero-zhouyu-sgs.png;3:4 竖版)
}

/** 池序被动技 desc 拼接(#604 单源读口,语义保持):招贤/机遇/送将浮字与
 *  卡面 title 浮签共用;多被动将逐技拼接。 */
export function passiveDescLineOf(hero: HeroDef): string {
  return poolTriggerSkills(hero.skillPool)
    .map((s) => s.desc)
    .join(";");
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

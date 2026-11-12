// 名将(英雄)池:技与将解耦(ADR-0036)。名将只声明技能池(skillPool,按池声明序引用技 id),
// 技能定义单源 src/core/skills.ts(被动+主动同表;一条技可入多个名将的池,重叠是特性)。
// 招募授技掷子集(rollGrantedSkills 单源 roster.ts,#787);新增名将 = 往这里加一条 HeroDef;
// 新增技改 skills.ts——两表都永远只是纯数据 + 读口(时机框架扩展指南见
// docs/explanation/时机框架.md;名将/技能定义随域走,#326 types.ts 解散,ADR-0019)。

export interface HeroDef {
  id: string;
  name: string; // 周瑜
  /** 技能池(ADR-0036):允许拥有的技 id,按池声明序(派发序/卡面序/浮字拼接序同源);
   *  池内技 id 唯一、须在技能表可解析;池可含多条主动技(逐字拍板表周瑜池即火攻+擂鼓
   *  双主动),逐技独立冷却(数据守卫见 test/hero-skill 四钉 + extension-registry 装载点)。 */
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

// 首批共享表(ADR-0036 拍板,零新增数值):疾行=周瑜↔张星彩、擂鼓=张星彩↔周瑜;
// #1142 卧龙入表,火攻=周瑜↔诸葛亮、渔利再入共享;#1378 曹丕池换血后共享仅四条
// (疾行/擂鼓/火攻/岁俸),渔利=诸葛亮单属、掷金=张星彩单属;
// 余单属主(青囊/赈济/放逐/行殇);池大小 = 强度旋钮(周瑜/张星彩/司马懿/邓艾/曹仁/
// 糜竺池 3、曹丕/华佗/诸葛亮池 2,不对称有意)。
export const HEROES: HeroDef[] = [
  {
    id: "zhouyu",
    image: "/assets/heroes/hero-zhouyu-sgs.png",
    name: "周瑜",
    skillPool: ["jixing", "huogong", "leigu"], // {疾行,火攻,擂鼓}
  },
  {
    id: "caopi",
    image: "/assets/heroes/hero-caopi-sgs.png",
    name: "曹丕",
    skillPool: ["fangzhu", "xingshang"], // {放逐,行殇}(#1378 池换血:挨打攒怒罚人,三国杀契合)
  },
  {
    id: "zhangxingcai",
    image: "/assets/heroes/hero-zhangxingcai-sgs.png",
    name: "张星彩",
    skillPool: ["zhijin", "leigu", "jixing"], // {掷金,擂鼓,疾行}
  },
  {
    id: "huatuo",
    // sgs 经典形象(#751 画像统一收官,curid=7870;noname 版已退役留档)
    image: "/assets/heroes/hero-huatuo-sgs.png",
    name: "华佗",
    skillPool: ["qingnang", "zhenji"], // {青囊,赈济}
  },
  {
    id: "zhugeliang",
    // 极简水墨立绘(#1142:图搜无可用水墨素材,走退路自绘——龚贤远山肌理
    // texture-gongxian-shanshui + 马善政「卧龙」竖题 + 孔明朱印;规格对齐 574×761)
    image: "/assets/heroes/hero-zhugeliang.png",
    name: "诸葛亮",
    skillPool: ["huogong", "yuli"], // {火攻,渔利} 池 2 仿华佗非对称(技重叠是特性)
  },
  // ── 技能扩展内容包(#1145,spec #1144 拆票 A/五):四新将,内置将 5→9(含 #1142 诸葛亮);
  // 岁俸双池共享(司马懿↔邓艾)=共享池新先例。──
  {
    id: "simayi",
    image: "/assets/heroes/hero-simayi-sgs.png",
    name: "司马懿",
    skillPool: ["taoguangyanghui", "saiwengshima", "suifeng"], // {韬光养晦,塞翁失马,岁俸}
  },
  {
    id: "dengai",
    image: "/assets/heroes/hero-dengai-sgs.png",
    name: "邓艾",
    skillPool: ["tuntian", "suifeng", "chubianbujing"], // {屯田,岁俸,处变不惊}
  },
  {
    id: "caoren",
    image: "/assets/heroes/hero-caoren-sgs.png",
    name: "曹仁",
    skillPool: ["wengzhongzhuobie", "shengougolei", "shengshi"], // {瓮中捉鳖,深沟高垒,声势}
  },
  {
    id: "mizhu",
    image: "/assets/heroes/hero-mizhu-sgs.png",
    name: "糜竺",
    skillPool: ["hushi", "delongwangshu", "yusui"], // {互市,得陇望蜀,玉碎}
  },
];

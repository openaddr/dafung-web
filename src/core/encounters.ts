// 机遇系统(#123):落格触发的事件目录与档位抽取。
// 本模块纯数据 + 纯函数:声望 softmax 调制(#1090)/加权抽取全部可独立单测;引擎消费时
// 一切随机经 this.dice(种子化,保命令流重放,ADR-0014)。id 用中文且必须自带因果
// (名字与效果互证)。

export type EncounterTier = "好运" | "中性" | "霉运";
export type EncounterTag = "银两" | "名将" | "珍宝" | "城池" | "声望" | "玩家" | "体力" | "锦囊";

/** P2 跨事件标记(#1153,即「机遇章」):机遇结算写进玩家章册的封闭枚举——链式典故的
 *  前编凭证(首两枚「元直荐书」「怀玺」,后编条目以 requiresFlags 认章,#1110 奇遇制)。
 *  封闭枚举拒自由键值:新章只能在此登记;条目以 setsFlags(写点)/requiresFlags(闸门)
 *  声明,章册按人记账(Player.encounterFlags,#1126 拍板① per-player、⑥ 破产不清章)。 */
export const ENCOUNTER_FLAGS = ["元直荐书", "怀玺"] as const;
export type EncounterFlagId = (typeof ENCOUNTER_FLAGS)[number];

/** 即时效果。cash 负值与 levy 输币同款封顶以其现有银两为限(#1153 新红线「机遇不送
 *  清算」:实际损失 = min(|delta|, 现有现金),不送支付/清算——机遇不把人逼进变卖
 *  卖城;levy 实付额照付对手,资敌语义不变)。siphon/levy 是玩家间银两转移:上限=
 *  付款方现有现金,不触发任何人清算。
 *  staminaDelta(#132):效果附带的体力增减——正值回血/负值耗体力,0/缺省=不变;
 *  经引擎 addStamina 落账,归 0 触发耗竭(#130)。
 *  repDelta(#1153):效果附带的声望增减(即时条目落声望的通道;抉择选项声望仍走选项级
 *  repDelta)——经 addReputation 唯一写口落账并 emit reputationChanged(先例=选项级
 *  repDelta 的 before/after 差值模式)。 */
export type EncounterEffect =
  | { kind: "cash"; delta: number; staminaDelta?: number; repDelta?: number }
  | { kind: "grantTreasure"; staminaDelta?: number; repDelta?: number }
  | {
      kind: "grantHero";
      fallbackCash: number;
      /** 指定招揽(#1153):点名某将来投(如三顾茅庐→诸葛亮);指定将已被招揽/
       *  麾下满/名将尽 → fallbackCash 折现(闸门见 choices.ts encounterOptionGate)。 */
      heroId?: string;
      staminaDelta?: number;
      repDelta?: number;
    }
  | { kind: "grantCard"; staminaDelta?: number; repDelta?: number } // #147:获得一张锦囊(圯上授书)
  | { kind: "grantCity"; fallbackCash: number; staminaDelta?: number; repDelta?: number }
  | { kind: "siphon"; amount: number; staminaDelta?: number; repDelta?: number }
  | { kind: "levy"; amount: number; staminaDelta?: number; repDelta?: number }
  | { kind: "trade"; amount: number; staminaDelta?: number; repDelta?: number }; // 你与随机对手各 +amount(国库出,正和)

/** 抉择选项(#124):repDelta 结算后立即落账(直接累加,#1090 去夹紧);effect 缺省=无事发生。
 *  staminaDelta(#132):选项级体力增减,在 effect/repDelta 落账后结算——正值回血/
 *  负值耗体力,0/缺省=不变;归 0 触发耗竭(#130)。
 *  treasureCost(#1067):grantHero 型选项的换贤代价(先扣 N 件珍宝再得将)——代价随
 *  条目声明,不再有全局常数;模块初始化守卫 assertGrantHeroCostDeclared 保证 grantHero
 *  选项必声明,消费点(门槛/结算)直读不兜底。 */
export interface EncounterChoiceOption {
  text: string;
  repDelta: number;
  effect?: EncounterEffect;
  staminaDelta?: number;
  treasureCost?: number;
  /** 选项闸(#1153 P2):要求持有的机遇章——未持满则选项灰显(reason 写持章要求);
   *  模块初始化守卫保证带章闸条目仍保有一个无章闸选项,选项集永不被章锁死。 */
  requiresFlags?: EncounterFlagId[];
  /** 抉择路章写点(#1153):本选项结算时写进抉择者章册(去重落章,grantEncounterFlags 单源);
   *  联机消费端按 encounterId+choiceIndex 回查目录派生,事件本体零改动(#1126 拍板②)。 */
  setsFlags?: EncounterFlagId[];
}

export interface EncounterDef {
  id: string;
  tier: EncounterTier;
  tags: EncounterTag[];
  weight: number;
  text: string;
  effect?: EncounterEffect;
  choices?: EncounterChoiceOption[];
  /** 即时路触发闸(#1153 P2):要求持有机遇章——仅持章者可抽中本条(抽取池过滤的消费面,
   *  字段先于条目数据落位,条目归 T2)。 */
  requiresFlags?: EncounterFlagId[];
  /** 即时路章写点(#1153):本条即时结算时写进行动者章册(去重落章,grantEncounterFlags 单源)。 */
  setsFlags?: EncounterFlagId[];
}

/** 目录 v3(#188 档 2 决策化扩容):30 条,好运 11/中性 8/霉运 11;玩家侧 7 条。
 *  抉择 15 条占一半(好运 1/中性 8/霉运 6,#124/#132/#188),即时 15 条带 effect。
 *  扩容主力在霉运:即时条附体力损耗;抉择条一律「两害相权」——每个选项都有实质代价
 *  (银两 vs 体力 / 声望 vs 银两 / 对己 vs 对他),红线:不需要决策的事件不配当抉择机遇。 */
export const ENCOUNTERS: EncounterDef[] = [
  // ── 好运 ──
  {
    id: "屯粮居奇",
    tier: "好运",
    tags: ["银两"],
    weight: 1,
    text: "荒年粮价飞涨,囤粮转卖大赚一笔",
    effect: { kind: "cash", delta: 250 },
  },
  {
    id: "草船借箭",
    tier: "好运",
    tags: ["银两"],
    weight: 1,
    text: "借得箭矢十万,转售诸侯",
    effect: { kind: "cash", delta: 200 },
  },
  {
    id: "风调雨顺",
    tier: "好运",
    tags: ["银两"],
    weight: 1,
    text: "五谷丰登,市税多入",
    effect: { kind: "cash", delta: 100 },
  },
  {
    id: "神医行诊",
    tier: "好运",
    tags: ["体力"],
    weight: 0.8,
    text: "神医路过举家调理",
    effect: { kind: "cash", delta: 0, staminaDelta: 25 },
  },
  {
    id: "义士来投",
    tier: "好运",
    tags: ["名将"],
    weight: 0.8,
    text: "名将慕名来投",
    effect: { kind: "grantHero", fallbackCash: 200 },
  },
  {
    id: "圯上授书",
    tier: "好运",
    tags: ["锦囊"],
    weight: 0.8,
    text: "圯上老人授你锦囊妙计一封",
    effect: { kind: "grantCard" },
  }, // #147:机遇→锦囊流通
  {
    id: "窖藏现世",
    tier: "好运",
    tags: ["珍宝"],
    weight: 0.8,
    text: "掘地三尺,挖出前朝窖藏",
    effect: { kind: "grantTreasure" },
  },
  {
    id: "传檄而定",
    tier: "好运",
    tags: ["城池"],
    weight: 0.2,
    text: "檄文所至,一座无主城望风归降",
    effect: { kind: "grantCity", fallbackCash: 300 },
  },
  {
    id: "敌营哗变",
    tier: "好运",
    tags: ["银两", "玩家"],
    weight: 0.8,
    text: "敌营哗变,士卒携粮来投",
    effect: { kind: "siphon", amount: 150 },
  },
  {
    id: "纳款输诚",
    tier: "好运",
    tags: ["银两", "玩家"],
    weight: 0.6,
    text: "邻镇诸侯为避战端,向你输银",
    effect: { kind: "siphon", amount: 200 },
  },
  {
    // 好运抉择(#188 档 2):得利附声望代价——岁赐落袋 vs 僭越之名(声望调档的长线成本)。
    id: "奉迎天子",
    tier: "好运",
    tags: ["银两", "声望"],
    weight: 0.8,
    text: "汉室车驾东归,恰过你的地界。奉迎天子,可领内库岁赐三百两、坐收号令之便;然僭越之讥随之,士林侧目。",
    choices: [
      {
        text: "奉迎天子(得岁赐 300 两,声望 −10)",
        repDelta: -10,
        effect: { kind: "cash", delta: 300 },
      },
      { text: "礼送出境(无事发生)", repDelta: 0 },
    ],
  },
  // ── 中性(抉择)──
  {
    id: "携民渡江",
    tier: "中性",
    tags: ["银两", "声望"],
    weight: 1,
    text: "流民数百拦江哭告,愿随你渡江避祸。安置他们需费银 150 两,但民心所向,声望大增;亦可径自过江,不相闻问。",
    choices: [
      {
        text: "携民渡江(费银 150 两,声望 +10)",
        repDelta: 10,
        effect: { kind: "cash", delta: -150 },
      },
      { text: "径自过江(无事发生)", repDelta: 0 },
    ],
  },
  {
    id: "散财消灾",
    tier: "中性",
    tags: ["银两", "声望"],
    weight: 1,
    text: "境内灾荒,饿殍遍野。开仓赈济需 200 两,可换百姓交口称颂;若充耳不闻,亦无人怪罪。",
    choices: [
      { text: "开仓赈济(费银 200 两,声望 +8)", repDelta: 8, effect: { kind: "cash", delta: -200 } },
      { text: "充耳不闻(无事发生)", repDelta: 0 },
    ],
  },
  {
    id: "以宝换贤",
    tier: "中性",
    tags: ["珍宝", "名将"],
    weight: 0.8,
    text: "名将遣使密告:愿以两件随身珍宝相赠,只求帐下效力。收下珍宝,名将即刻来投。",
    choices: [
      {
        text: "以两件珍宝换 1 名将",
        repDelta: 0,
        effect: { kind: "grantHero", fallbackCash: 0 },
        treasureCost: 2,
      },
      { text: "婉言相拒(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 单选项抉择(#124):选项集 ≤1 引擎自动执行(ADR-0013),正合「使团代应、自动发生」的设计。
    id: "结盟互市",
    tier: "中性",
    tags: ["银两", "玩家"],
    weight: 0.8,
    text: "邻镇诸侯遣使叩门:愿共设集市、通商互市。你与随机对手各得 100 两,银子皆由国库出——使团已替你在盟书上落了印。",
    choices: [
      {
        text: "结盟互市(你与随机对手各 +100 两,国库出)",
        repDelta: 0,
        effect: { kind: "trade", amount: 100 },
      },
    ],
  },
  {
    // 体力抉择(#132):入浴回血(选项级 staminaDelta +30)/ 不去无事。
    id: "温泉疗养",
    tier: "中性",
    tags: ["银两", "体力"],
    weight: 0.8,
    text: "行军途中遇温泉,水汽氤氲。付 150 两全军入浴休整,人困马乏尽去(体力 +30);亦可赶路要紧,不入。",
    choices: [
      {
        text: "付 150 两入浴(+30 体力)",
        repDelta: 0,
        effect: { kind: "cash", delta: -150 },
        staminaDelta: 30,
      },
      { text: "不去(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 体力抉择(#132;#789 重钉):连夜赶路得银耗体力(选项级 staminaDelta −20)/ 安营无事。
    // 卖体力价 90/20=4.5 两/点 ≤ 折银锚 5(constants.ts STAMINA_CASH_RATE)——旧值 150(7.5)
    // 高于温泉买价,机遇必出制下被无限套购(局均 210 次耗竭的元凶)。
    id: "夜行军",
    tier: "中性",
    tags: ["银两", "体力"],
    weight: 0.8,
    text: "斥候探得邻镇粮价飞涨。连夜赶路可抢先售粮(+90 两),将士疲于奔命(体力 −20);或安营扎寨,从长计议。",
    choices: [
      {
        text: "连夜赶路(+90 两,体力 −20)",
        repDelta: 0,
        effect: { kind: "cash", delta: 90 },
        staminaDelta: -20,
      },
      { text: "安营扎寨(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 声望/体力抉择(#188 档 2):胆气换名 vs 劳神伤体。
    id: "单刀赴会",
    tier: "中性",
    tags: ["声望", "体力"],
    weight: 0.8,
    text: "邻镇守将遣使下书,邀你单刀赴会、饮酒论英雄。只身赴会,胆气冠绝全军,威名远播;然席间暗流汹涌,惊险周旋颇耗心神。",
    choices: [
      { text: "单刀赴会(声望 +12,体力 −15)", repDelta: 12, staminaDelta: -15 },
      { text: "称病不往(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 对他抉择(#188 档 2):仁名 vs 赎银——bot 按声望系数在此分道(120 vs ±8×系数)。
    id: "义释俘虏",
    tier: "中性",
    tags: ["玩家", "声望"],
    weight: 0.8,
    text: "前哨擒得邻镇丁壮数十,囚于辕门。放其归乡,仁名远播;押为质、勒令赎金,白银入库,人心却散了。",
    choices: [
      { text: "义释归乡(声望 +8)", repDelta: 8 },
      {
        text: "押质勒赎(得赎银 120 两,声望 −8)",
        repDelta: -8,
        effect: { kind: "siphon", amount: 120 },
      },
    ],
  },
  // ── 霉运(抉择 = 两害相权:每个选项都有实质代价,#188 档 2)──
  {
    id: "粮道被劫",
    tier: "霉运",
    tags: ["银两", "体力"],
    weight: 1,
    text: "粮道遭山贼劫掠,损失折银 250 两",
    effect: { kind: "cash", delta: -250, staminaDelta: -10 }, // #789:体力税 ×0.45(−25→−10,验带迭代终值)
  },
  {
    id: "漕船倾覆",
    tier: "霉运",
    tags: ["银两", "体力"],
    weight: 1,
    text: "漕船江心倾覆,白银落水",
    effect: { kind: "cash", delta: -100, staminaDelta: -8 }, // #789:−20→−8
  },
  {
    id: "假道征粮",
    tier: "霉运",
    tags: ["银两", "玩家", "体力"],
    weight: 0.8,
    text: "邻镇诸侯假道征粮,你被迫输银 50 两",
    effect: { kind: "levy", amount: 50, staminaDelta: -7 }, // #789:−15→−7
  },
  {
    // 银两 vs 体力(#188 档 2;#789 重钉):花钱消灾 vs 全军疲敝。
    // 延医 120/免 25 点体力 = 隐含卖价 4.8 两/点 ≤ 折银锚 5(旧值 200=8,套利 outlier)。
    id: "疫病入营",
    tier: "霉运",
    tags: ["银两", "体力"],
    weight: 0.8,
    text: "军中疫气蔓延,病倒者日增。延医购药需费 120 两,疫可立止;若硬撑操练,疫情蚀体,全军疲敝。",
    choices: [
      { text: "延医购药(费银 120 两)", repDelta: 0, effect: { kind: "cash", delta: -120 } },
      { text: "硬撑操练(全军体力 −25)", repDelta: 0, staminaDelta: -25 },
    ],
  },
  {
    // 短期得利 vs 声望/银两(#188 档 2):扰民恶名换现粮,或按市价破财。
    id: "强征军粮",
    tier: "霉运",
    tags: ["银两", "声望"],
    weight: 0.8,
    text: "秋粮歉收,军仓告急。向四乡强征,即刻得粮折银 150 两,却落扰民恶名;按市价购粮,则需费银 200 两。",
    choices: [
      { text: "强征民粮(得 150 两,声望 −18)", repDelta: -18, effect: { kind: "cash", delta: 150 } },
      { text: "市价购粮(费银 200 两)", repDelta: 0, effect: { kind: "cash", delta: -200 } },
    ],
  },
  {
    // 对己 vs 对他(#188 档 2):自己拼体力拒贼,或嫁祸邻镇收贼资、担纵贼之名。
    id: "祸水东引",
    tier: "霉运",
    tags: ["玩家", "声望", "体力"],
    weight: 0.6,
    text: "马贼游骑直扑你的边境。出兵拒之,一场厮杀在所难免;若遣细作诱其转掠邻镇,贼获尽入你手,纵贼之名却也传开。",
    choices: [
      { text: "出兵拒之(体力 −20)", repDelta: 0, staminaDelta: -20 },
      {
        text: "祸水东引(得贼资 150 两,声望 −12)",
        repDelta: -12,
        effect: { kind: "siphon", amount: 150 },
      },
    ],
  },
  {
    // 声望 vs 银两(#188 档 2):清野困敌失民心,或任劫折粮。
    id: "坚壁清野",
    tier: "霉运",
    tags: ["声望", "银两"],
    weight: 0.8,
    text: "敌军大举压境,四乡禾稼尽在敌锋之下。焚田清野,敌无所获,乡里怨声载道;任其劫掠,粮储折银 200 两。",
    choices: [
      { text: "焚田清野(声望 −15)", repDelta: -15 },
      { text: "任其劫掠(损失折银 200 两)", repDelta: 0, effect: { kind: "cash", delta: -200 } },
    ],
  },
  {
    // 银两 vs 银两+体力(#188 档 2):抢险多花银,或堤溃后蚀粮又耗人夫。
    id: "河堤告急",
    tier: "霉运",
    tags: ["银两", "体力"],
    weight: 0.6,
    text: "秋汛暴涨,河堤渗漏如筛。征夫连夜抢修需费 120 两;若听天由命,堤溃淹田,抢收粮食又耗人夫体力。",
    choices: [
      { text: "征夫抢修(费银 120 两)", repDelta: 0, effect: { kind: "cash", delta: -120 } },
      {
        text: "听天由命(失 80 两,体力 −15)",
        repDelta: 0,
        effect: { kind: "cash", delta: -80 },
        staminaDelta: -15,
      },
    ],
  },
  {
    // 银两 vs 声望(#188 档 2):输币资敌保全盟约,或背盟恶名传遍诸侯。
    id: "盟镇勒币",
    tier: "霉运",
    tags: ["银两", "玩家", "声望"],
    weight: 0.6,
    text: "结义的盟镇忽然翻脸,遣使坐索岁币 120 两,言辞倨傲。破财免灾,盟约犹存;撕破脸皮,背盟之名传遍诸侯。",
    choices: [
      { text: "隐忍输币(输银 120 两)", repDelta: 0, effect: { kind: "levy", amount: 120 } },
      { text: "撕毁盟约(声望 −12)", repDelta: -12 },
    ],
  },
  {
    id: "驿马倒毙",
    tier: "霉运",
    tags: ["体力"],
    weight: 0.8,
    text: "千里转进,驿马接连倒毙,全军徒步拖行,人困马乏",
    effect: { kind: "cash", delta: 0, staminaDelta: -8 }, // #789:−20→−8
  },
  {
    id: "火烛惊营",
    tier: "霉运",
    tags: ["银两", "体力"],
    weight: 0.8,
    text: "夜半营中走水,火借风势,粮草帐幕焚毁过半",
    effect: { kind: "cash", delta: -150, staminaDelta: -7 }, // #789:−15→−7
  },
];

/** 换贤代价声明守卫(#1067):grantHero 型抉择选项必须显式声明 treasureCost——代价是
 *  条目数据,不再有全局常数兜底;未声明 = 目录数据 bug,模块加载时当场抛错定位。
 *  导出供单测复验(生产侧由下方模块初始化调用,同一函数单源)。 */
export function assertGrantHeroCostDeclared(defs: readonly EncounterDef[]): void {
  for (const def of defs) {
    for (const c of def.choices ?? []) {
      if (c.effect?.kind === "grantHero" && c.treasureCost == null)
        throw new Error(`机遇「${def.id}」grantHero 选项未声明 treasureCost:${c.text}(数据 bug)`);
    }
  }
}
assertGrantHeroCostDeclared(ENCOUNTERS); // 模块初始化即验:坏数据活不到任何消费点

/** 章闸不死锁守卫(#1153):凡 choices 非空且带 requiresFlags(def 级或任一 option 级)的
 *  条目,必须保有一个无 requiresFlags 的选项——「整条选项集被 flag 锁死」的条目会让
 *  AwaitingEncounter 零可用(enterEncounterPhase 的零兜底 throw 会从测试炸到生产)。
 *  导出供单测复验(生产侧由下方模块初始化调用,同一函数单源,仿 assertGrantHeroCostDeclared)。 */
export function assertChoicesNotFlagLocked(defs: readonly EncounterDef[]): void {
  for (const def of defs) {
    const choices = def.choices ?? [];
    if (choices.length === 0) continue;
    const gated = def.requiresFlags != null || choices.some((c) => c.requiresFlags != null);
    if (gated && !choices.some((c) => c.requiresFlags == null))
      throw new Error(
        `机遇「${def.id}」选项集被章闸锁死:须保有一个无 requiresFlags 的选项(数据 bug)`,
      );
  }
}
assertChoicesNotFlagLocked(ENCOUNTERS); // 模块初始化即验:坏数据活不到任何消费点

/** 章闸抽取过滤(#1153 P2 触发闸):带 def 级 requiresFlags 的条目只在持章者的抽取池里
 *  ——链式典故后编高权重(weight 2.5)只对持章者生效的设计前提(#1133:非持章者抽取时
 *  被过滤)。纯函数单源:抽取路(maybeApplyEncounter)与抽取池守卫共用本口。 */
export function drawableEncounters(
  defs: readonly EncounterDef[],
  flags: readonly EncounterFlagId[],
): readonly EncounterDef[] {
  return defs.filter(
    (d) => d.requiresFlags == null || d.requiresFlags.every((f) => flags.includes(f)),
  );
}

/** 章闸抽取池守卫(#1153):每档在「无章玩家」(空章册)视角必须仍有序可抽——档内若被
 *  def 级章闸全占,无章者抽中该档即空池(pickWeighted 当场炸)。坏数据在模块初始化炸出,
 *  不活到任何抽取点(与上方选项守卫成对:选项面/抽取面各封一路死锁)。 */
export function assertFlagGatePoolsDrawable(defs: readonly EncounterDef[]): void {
  for (const tier of ["好运", "中性", "霉运"] as const) {
    if (
      drawableEncounters(
        defs.filter((d) => d.tier === tier),
        [],
      ).length === 0
    )
      throw new Error(`机遇档「${tier}」被章闸全占:无章玩家空池(数据 bug)`);
  }
}
assertFlagGatePoolsDrawable(ENCOUNTERS); // 模块初始化即验:坏数据活不到任何消费点

/** 机遇章写点单源(#1153):把结算写点声明的 flags 落进玩家章册——章是经历记录,
 *  重复结算/事件重放不重章(按章去重);flags 缺省=该写点无章声明,零操作。
 *  引擎两写点(encounter-flow 抉择路 option.setsFlags/即时路 def.setsFlags)与联机
 *  折叠两路(event-fold encounterChoice/encounterTriggered)共用本口。 */
export function grantEncounterFlags(
  p: { encounterFlags: EncounterFlagId[] },
  flags: readonly EncounterFlagId[] | undefined,
): void {
  if (flags == null) return;
  for (const f of flags) if (!p.encounterFlags.includes(f)) p.encounterFlags.push(f);
}

/** 机遇开关(#123;ADR-0035 机遇必出:出不出不再掷概率,false=不出机遇)。
 *  引擎缺省 false=测试隔离开关;产品默认 true 来自 jiyu.json/设置屏。
 *  #1090 起配置面只剩这一个开关:三档概率=声望 softmax 三元拉锯(见 tierShares)。 */
export interface EncounterSwitch {
  enabled: boolean;
}

/** 产品默认开关(#135):与 public/config/jiyu.json 同值(机遇必出=开)。配置文件缺失/
 *  损坏时,服务器(#135 联机接线)与单机设置屏(encounterConfig.BUILTIN_ENCOUNTER_DEFAULTS)
 *  共用此回退(单源 import,app 侧零值拷贝,#1067)。 */
export const ENCOUNTER_PRODUCT_DEFAULTS: EncounterSwitch = { enabled: true };

/** jiyu.json → EncounterSwitch(#135;#1090 三档基准退役):enabled 布尔才接受,
 *  否则 null(调用方回退 ENCOUNTER_PRODUCT_DEFAULTS)。 */
export function parseEncounterFile(data: unknown): EncounterSwitch | null {
  if (typeof data !== "object" || data === null) return null;
  const enabled = (data as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? { enabled } : null;
}

/** 三档概率(好运/中性/霉运,百分比;三元 softmax 归一,和恒=100)。 */
export interface TierShares {
  good: number;
  neutral: number;
  bad: number;
}

/** softmax 唯一旋钮(#1090):声望 s 折算为权重 2^(s/K),K=100。代码常量,不进配置。 */
export const TIER_SOFTMAX_K = 100;

/** 声望调制(#1090 softmax 三元拉锯):三档权重 2^(s/K) : 1 : 2^(−s/K),归一为百分比。
 *  声望无界(可负,开局 0):好运随 s 单调不减、霉运单调不增;负向完美镜像
 *  (tierShares(−s) 与 tierShares(s) 好运霉运互换);两端极限 100/0/0 与 0/100/0,
 *  数学上渐近不可达,浮点下溢后精确等于极限值(见实现注)。
 *  实现走 softmax 最大值平移:三支指数同减 |s|/K,概率逐点不变——裸 2^(s/K) 在
 *  |s|≳102400 溢出 Infinity 得 NaN 静默判霉运(#1090 双轴评审必修),平移后任意
 *  有限声望无溢出。 */
export function tierShares(reputation: number): TierShares {
  const u = reputation / TIER_SOFTMAX_K;
  const m = Math.abs(u); // 平移量:三支指数同减 m,归一后概率不变
  const g = 2 ** (u - m); // 好运支(s≥0 恒 1;s<0 随深度下溢趋 0)
  const n = 2 ** -m; // 中性支
  const b = 2 ** (-u - m); // 霉运支(好运的镜像)
  const total = g + n + b;
  return { good: (g / total) * 100, neutral: (n / total) * 100, bad: (b / total) * 100 };
}

/** 按调制后占比抽档(f ∈ [0,1))。 */
export function pickTier(f: number, shares: TierShares): EncounterTier {
  const p = f * 100;
  if (p < shares.good) return "好运";
  if (p < shares.good + shares.neutral) return "中性";
  return "霉运";
}

/** 同档内按 weight 加权抽取(f ∈ [0,1))。 */
export function pickWeighted<T extends { weight: number }>(list: readonly T[], f: number): T {
  const total = list.reduce((acc, x) => acc + x.weight, 0);
  let r = f * total;
  for (const x of list) {
    r -= x.weight;
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

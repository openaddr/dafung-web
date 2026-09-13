// 机遇系统(#123):落格触发的事件目录与档位抽取。
// 本模块纯数据 + 纯函数:归一/声望调制/加权抽取全部可独立单测;引擎消费时一切随机经
// this.dice(种子化,保命令流重放,ADR-0014)。id 用中文且必须自带因果(名字与效果互证)。

export type EncounterTier = "好运" | "中性" | "霉运";
export type EncounterTag = "银两" | "武将" | "珍宝" | "城池" | "声望" | "玩家" | "体力" | "锦囊";

/** 即时效果。银两负值走引擎支付/清算(破产与购地同规则);
 *  siphon/levy 是玩家间银两转移:上限=付款方现有现金,不触发对方清算。
 *  staminaDelta(#132):效果附带的体力增减——正值回血/负值耗体力,0/缺省=不变;
 *  经引擎 addStamina 落账,归 0 触发耗竭(#130)。 */
export type EncounterEffect =
  | { kind: "cash"; delta: number; staminaDelta?: number }
  | { kind: "grantTreasure"; staminaDelta?: number }
  | { kind: "grantHero"; fallbackCash: number; staminaDelta?: number }
  | { kind: "grantCard"; staminaDelta?: number } // #147:获得一张锦囊(圯上授书)
  | { kind: "grantCity"; fallbackCash: number; staminaDelta?: number }
  | { kind: "siphon"; amount: number; staminaDelta?: number }
  | { kind: "levy"; amount: number; staminaDelta?: number }
  | { kind: "trade"; amount: number; staminaDelta?: number }; // 你与随机对手各 +amount(国库出,正和)

/** 抉择选项(#124):repDelta 结算后立即落账并夹紧;effect 缺省=无事发生。
 *  staminaDelta(#132):选项级体力增减,在 effect/repDelta 落账后结算——正值回血/
 *  负值耗体力,0/缺省=不变;归 0 触发耗竭(#130)。 */
export interface EncounterChoiceOption {
  text: string;
  repDelta: number;
  effect?: EncounterEffect;
  staminaDelta?: number;
}

export interface EncounterDef {
  id: string;
  tier: EncounterTier;
  tags: EncounterTag[];
  weight: number;
  text: string;
  effect?: EncounterEffect;
  choices?: EncounterChoiceOption[];
}

/** 目录 v3(#188 档 2 决策化扩容):30 条,好运 11/中性 8/霉运 11;玩家侧 7 条。
 *  抉择 15 条占一半(好运 1/中性 8/霉运 6,#124/#132/#188),即时 15 条带 effect。
 *  扩容主力在霉运:即时条附体力损耗;抉择条一律「两害相权」——每个选项都有实质代价
 *  (银两 vs 体力 / 声望 vs 银两 / 对己 vs 对他),红线:不需要决策的事件不配当抉择机遇。 */
export const ENCOUNTERS: EncounterDef[] = [
  // ── 好运 ──
  { id: "屯粮居奇", tier: "好运", tags: ["银两"], weight: 1, text: "荒年粮价飞涨,囤粮转卖大赚一笔", effect: { kind: "cash", delta: 250 } },
  { id: "草船借箭", tier: "好运", tags: ["银两"], weight: 1, text: "借得箭矢十万,转售诸侯", effect: { kind: "cash", delta: 200 } },
  { id: "风调雨顺", tier: "好运", tags: ["银两"], weight: 1, text: "五谷丰登,市税多入", effect: { kind: "cash", delta: 100 } },
  { id: "神医行诊", tier: "好运", tags: ["体力"], weight: 0.8, text: "神医路过举家调理", effect: { kind: "cash", delta: 0, staminaDelta: 25 } },
  { id: "义士来投", tier: "好运", tags: ["武将"], weight: 0.8, text: "贤士慕名来投", effect: { kind: "grantHero", fallbackCash: 200 } },
  { id: "圯上授书", tier: "好运", tags: ["锦囊"], weight: 0.8, text: "圯上老人授你锦囊妙计一封", effect: { kind: "grantCard" } }, // #147:机遇→锦囊流通
  { id: "窖藏现世", tier: "好运", tags: ["珍宝"], weight: 0.8, text: "掘地三尺,挖出前朝窖藏", effect: { kind: "grantTreasure" } },
  { id: "传檄而定", tier: "好运", tags: ["城池"], weight: 0.2, text: "檄文所至,一座无主城望风归降", effect: { kind: "grantCity", fallbackCash: 300 } },
  { id: "敌营哗变", tier: "好运", tags: ["银两", "玩家"], weight: 0.8, text: "敌营哗变,士卒携粮来投", effect: { kind: "siphon", amount: 150 } },
  { id: "纳款输诚", tier: "好运", tags: ["银两", "玩家"], weight: 0.6, text: "邻镇诸侯为避战端,向你输银", effect: { kind: "siphon", amount: 200 } },
  {
    // 好运抉择(#188 档 2):得利附声望代价——岁赐落袋 vs 僭越之名(声望调档/献计里程碑的长线成本)。
    id: "奉迎天子", tier: "好运", tags: ["银两", "声望"], weight: 0.8,
    text: "汉室车驾东归,恰过你的地界。奉迎天子,可领内库岁赐三百两、坐收号令之便;然僭越之讥随之,士林侧目。",
    choices: [
      { text: "奉迎天子(得岁赐 300 两,声望 −10)", repDelta: -10, effect: { kind: "cash", delta: 300 } },
      { text: "礼送出境(无事发生)", repDelta: 0 },
    ],
  },
  // ── 中性(抉择)──
  {
    id: "携民渡江", tier: "中性", tags: ["银两", "声望"], weight: 1,
    text: "流民数百拦江哭告,愿随你渡江避祸。安置他们需费银 150 两,但民心所向,声望大增;亦可径自过江,不相闻问。",
    choices: [
      { text: "携民渡江(费银 150 两,声望 +10)", repDelta: 10, effect: { kind: "cash", delta: -150 } },
      { text: "径自过江(无事发生)", repDelta: 0 },
    ],
  },
  {
    id: "散财消灾", tier: "中性", tags: ["银两", "声望"], weight: 1,
    text: "境内灾荒,饿殍遍野。开仓赈济需 200 两,可换百姓交口称颂;若充耳不闻,亦无人怪罪。",
    choices: [
      { text: "开仓赈济(费银 200 两,声望 +8)", repDelta: 8, effect: { kind: "cash", delta: -200 } },
      { text: "充耳不闻(无事发生)", repDelta: 0 },
    ],
  },
  {
    id: "以宝换贤", tier: "中性", tags: ["珍宝", "武将"], weight: 0.8,
    text: "贤士遣使密告:愿以两件随身珍宝相赠,只求帐下效力。收下珍宝,贤士即刻来投。",
    choices: [
      { text: "以两件珍宝换 1 名士", repDelta: 0, effect: { kind: "grantHero", fallbackCash: 0 } },
      { text: "婉言相拒(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 单选项抉择(#124):选项集 ≤1 引擎自动执行(ADR-0013),正合「使团代应、自动发生」的设计。
    id: "结盟互市", tier: "中性", tags: ["银两", "玩家"], weight: 0.8,
    text: "邻镇诸侯遣使叩门:愿共设集市、通商互市。你与随机对手各得 100 两,银子皆由国库出——使团已替你在盟书上落了印。",
    choices: [
      { text: "结盟互市(你与随机对手各 +100 两,国库出)", repDelta: 0, effect: { kind: "trade", amount: 100 } },
    ],
  },
  {
    // 体力抉择(#132):入浴回血(选项级 staminaDelta +30)/ 不去无事。
    id: "温泉疗养", tier: "中性", tags: ["银两", "体力"], weight: 0.8,
    text: "行军途中遇温泉,水汽氤氲。付 150 两全军入浴休整,人困马乏尽去(体力 +30);亦可赶路要紧,不入。",
    choices: [
      { text: "付 150 两入浴(+30 体力)", repDelta: 0, effect: { kind: "cash", delta: -150 }, staminaDelta: 30 },
      { text: "不去(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 体力抉择(#132):连夜赶路得银耗体力(选项级 staminaDelta −20)/ 安营无事。
    id: "夜行军", tier: "中性", tags: ["银两", "体力"], weight: 0.8,
    text: "斥候探得邻镇粮价飞涨。连夜赶路可抢先售粮(+150 两),将士疲于奔命(体力 −20);或安营扎寨,从长计议。",
    choices: [
      { text: "连夜赶路(+150 两,体力 −20)", repDelta: 0, effect: { kind: "cash", delta: 150 }, staminaDelta: -20 },
      { text: "安营扎寨(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 声望/体力抉择(#188 档 2):胆气换名 vs 劳神伤体。
    id: "单刀赴会", tier: "中性", tags: ["声望", "体力"], weight: 0.8,
    text: "邻镇守将遣使下书,邀你单刀赴会、饮酒论英雄。只身赴会,胆气冠绝全军,威名远播;然席间暗流汹涌,惊险周旋颇耗心神。",
    choices: [
      { text: "单刀赴会(声望 +12,体力 −15)", repDelta: 12, staminaDelta: -15 },
      { text: "称病不往(无事发生)", repDelta: 0 },
    ],
  },
  {
    // 对他抉择(#188 档 2):仁名 vs 赎银——bot 按声望系数在此分道(120 vs ±8×系数)。
    id: "义释俘虏", tier: "中性", tags: ["玩家", "声望"], weight: 0.8,
    text: "前哨擒得邻镇丁壮数十,囚于辕门。放其归乡,仁名远播;押为质、勒令赎金,白银入库,人心却散了。",
    choices: [
      { text: "义释归乡(声望 +8)", repDelta: 8 },
      { text: "押质勒赎(得赎银 120 两,声望 −8)", repDelta: -8, effect: { kind: "siphon", amount: 120 } },
    ],
  },
  // ── 霉运(抉择 = 两害相权:每个选项都有实质代价,#188 档 2)──
  { id: "粮道被劫", tier: "霉运", tags: ["银两", "体力"], weight: 1, text: "粮道遭山贼劫掠,损失折银 250 两", effect: { kind: "cash", delta: -250, staminaDelta: -25 } },
  { id: "漕船倾覆", tier: "霉运", tags: ["银两", "体力"], weight: 1, text: "漕船江心倾覆,白银落水", effect: { kind: "cash", delta: -100, staminaDelta: -20 } },
  { id: "假道征粮", tier: "霉运", tags: ["银两", "玩家", "体力"], weight: 0.8, text: "邻镇诸侯假道征粮,你被迫输银 50 两", effect: { kind: "levy", amount: 50, staminaDelta: -15 } },
  {
    // 银两 vs 体力(#188 档 2):花钱消灾 vs 全军疲敝。
    id: "疫病入营", tier: "霉运", tags: ["银两", "体力"], weight: 0.8,
    text: "军中疫气蔓延,病倒者日增。延医购药需费 200 两,疫可立止;若硬撑操练,疫情蚀体,全军疲敝。",
    choices: [
      { text: "重金延医(费银 200 两)", repDelta: 0, effect: { kind: "cash", delta: -200 } },
      { text: "硬撑操练(全军体力 −25)", repDelta: 0, staminaDelta: -25 },
    ],
  },
  {
    // 短期得利 vs 声望/银两(#188 档 2):扰民恶名换现粮,或按市价破财。
    id: "强征军粮", tier: "霉运", tags: ["银两", "声望"], weight: 0.8,
    text: "秋粮歉收,军仓告急。向四乡强征,即刻得粮折银 150 两,却落扰民恶名;按市价购粮,则需费银 200 两。",
    choices: [
      { text: "强征民粮(得 150 两,声望 −18)", repDelta: -18, effect: { kind: "cash", delta: 150 } },
      { text: "市价购粮(费银 200 两)", repDelta: 0, effect: { kind: "cash", delta: -200 } },
    ],
  },
  {
    // 对己 vs 对他(#188 档 2):自己拼体力拒贼,或嫁祸邻镇收贼资、担纵贼之名。
    id: "祸水东引", tier: "霉运", tags: ["玩家", "声望", "体力"], weight: 0.6,
    text: "马贼游骑直扑你的边境。出兵拒之,一场厮杀在所难免;若遣细作诱其转掠邻镇,贼获尽入你手,纵贼之名却也传开。",
    choices: [
      { text: "出兵拒之(体力 −20)", repDelta: 0, staminaDelta: -20 },
      { text: "祸水东引(得贼资 150 两,声望 −12)", repDelta: -12, effect: { kind: "siphon", amount: 150 } },
    ],
  },
  {
    // 声望 vs 银两(#188 档 2):清野困敌失民心,或任劫折粮。
    id: "坚壁清野", tier: "霉运", tags: ["声望", "银两"], weight: 0.8,
    text: "敌军大举压境,四乡禾稼尽在敌锋之下。焚田清野,敌无所获,乡里怨声载道;任其劫掠,粮储折银 200 两。",
    choices: [
      { text: "焚田清野(声望 −15)", repDelta: -15 },
      { text: "任其劫掠(损失折银 200 两)", repDelta: 0, effect: { kind: "cash", delta: -200 } },
    ],
  },
  {
    // 银两 vs 银两+体力(#188 档 2):抢险多花银,或堤溃后蚀粮又耗人夫。
    id: "河堤告急", tier: "霉运", tags: ["银两", "体力"], weight: 0.6,
    text: "秋汛暴涨,河堤渗漏如筛。征夫连夜抢修需费 120 两;若听天由命,堤溃淹田,抢收粮食又耗人夫体力。",
    choices: [
      { text: "征夫抢修(费银 120 两)", repDelta: 0, effect: { kind: "cash", delta: -120 } },
      { text: "听天由命(失 80 两,体力 −15)", repDelta: 0, effect: { kind: "cash", delta: -80 }, staminaDelta: -15 },
    ],
  },
  {
    // 银两 vs 声望(#188 档 2):输币资敌保全盟约,或背盟恶名传遍诸侯。
    id: "盟镇勒币", tier: "霉运", tags: ["银两", "玩家", "声望"], weight: 0.6,
    text: "结义的盟镇忽然翻脸,遣使坐索岁币 120 两,言辞倨傲。破财免灾,盟约犹存;撕破脸皮,背盟之名传遍诸侯。",
    choices: [
      { text: "隐忍输币(输银 120 两)", repDelta: 0, effect: { kind: "levy", amount: 120 } },
      { text: "撕毁盟约(声望 −12)", repDelta: -12 },
    ],
  },
  { id: "驿马倒毙", tier: "霉运", tags: ["体力"], weight: 0.8, text: "千里转进,驿马接连倒毙,全军徒步拖行,人困马乏", effect: { kind: "cash", delta: 0, staminaDelta: -20 } },
  { id: "火烛惊营", tier: "霉运", tags: ["银两", "体力"], weight: 0.8, text: "夜半营中走水,火借风势,粮草帐幕焚毁过半", effect: { kind: "cash", delta: -150, staminaDelta: -15 } },
];

export interface EncounterBaseRates {
  good: number;
  neutral: number;
  bad: number;
}

export interface EncounterConfig {
  /** 落格触发概率 0~100(引擎缺省 0=纯开关;产品默认 40 在配置文件/设置屏)。 */
  triggerRate?: number;
  /** 三档基准值,按占比归一(和不必为 100);缺省 30/45/25。 */
  baseRates?: EncounterBaseRates;
}

export interface EncounterRuntimeConfig {
  triggerRate: number;
  shares: EncounterBaseRates; // 已归一为百分比(和=100)
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 三档归一(#120 口径):配置值和不必为 100,按占比得百分比。 */
export function normalizeEncounterBaseRates(base: EncounterBaseRates): EncounterBaseRates {
  const total = base.good + base.neutral + base.bad;
  return {
    good: (base.good / total) * 100,
    neutral: (base.neutral / total) * 100,
    bad: (base.bad / total) * 100,
  };
}

/** 产品默认档(#135):与 public/config/jiyu.json 同值。配置文件缺失/损坏时,
 *  服务器(#135 联机接线)与单机设置屏(encounterConfig.BUILTIN_ENCOUNTER_DEFAULTS)
 *  共用此回退,三处(文件/两端代码)任一调整须同步。 */
export const ENCOUNTER_PRODUCT_DEFAULTS: EncounterConfig = {
  triggerRate: 40,
  baseRates: { good: 30, neutral: 45, bad: 25 },
};

/** jiyu.json → EncounterConfig(#135):triggerRate 与三档基准齐全且均为有限数才接受,
 *  否则 null(调用方回退 ENCOUNTER_PRODUCT_DEFAULTS)。数值边界(0~100/≥0)不在此夹紧
 *  ——resolveEncounterConfig 已有同语义回退,此处只做结构门槛。 */
export function parseEncounterFile(data: unknown): EncounterConfig | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  const b =
    typeof o.baseRates === "object" && o.baseRates !== null
      ? (o.baseRates as Record<string, unknown>)
      : null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const triggerRate = num(o.triggerRate);
  const good = b ? num(b.good) : null;
  const neutral = b ? num(b.neutral) : null;
  const bad = b ? num(b.bad) : null;
  if (triggerRate === null || good === null || neutral === null || bad === null) return null;
  return { triggerRate, baseRates: { good, neutral, bad } };
}

/** 配置解析:非法值回退默认;三档按占比归一为百分比。 */
export function resolveEncounterConfig(cfg?: EncounterConfig): EncounterRuntimeConfig {
  const raw = Number(cfg?.triggerRate ?? 0);
  const triggerRate = Number.isFinite(raw) ? clamp(raw, 0, 100) : 0;
  const b = cfg?.baseRates;
  // 0 是合法档位(如"中性 100%"=好运 0);仅在负数/非有限/总和为 0 时回退默认
  const base =
    b &&
    [b.good, b.neutral, b.bad].every((v) => Number.isFinite(v) && v >= 0) &&
    b.good + b.neutral + b.bad > 0
      ? b
      : { good: 30, neutral: 45, bad: 25 };
  return { triggerRate, shares: normalizeEncounterBaseRates(base) };
}

/** 声望调制(s 已夹紧 ±100):好运 +0.25s、霉运 −0.20s 百分点,各夹紧 [5,95],中性吃剩余。 */
export function tierShares(reputation: number, base: EncounterBaseRates): EncounterBaseRates {
  const s = clamp(reputation, -100, 100);
  const good = clamp(base.good + 0.25 * s, 5, 95);
  const bad = clamp(base.bad - 0.2 * s, 5, 95);
  const neutral = Math.max(0, 100 - good - bad);
  return { good, neutral, bad };
}

/** 按调制后占比抽档(f ∈ [0,1))。 */
export function pickTier(f: number, shares: EncounterBaseRates): EncounterTier {
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

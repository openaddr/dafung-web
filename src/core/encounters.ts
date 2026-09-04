// 机遇系统(#123):落格触发的事件目录与档位抽取。
// 本模块纯数据 + 纯函数:归一/声望调制/加权抽取全部可独立单测;引擎消费时一切随机经
// this.dice(种子化,保命令流重放,ADR-0014)。id 用中文且必须自带因果(名字与效果互证)。

export type EncounterTier = "好运" | "中性" | "霉运";
export type EncounterTag = "银两" | "武将" | "珍宝" | "城池" | "声望" | "玩家";

/** 即时效果。银两负值走引擎支付/清算(破产与购地同规则);
 *  siphon/levy 是玩家间银两转移:上限=付款方现有现金,不触发对方清算。 */
export type EncounterEffect =
  | { kind: "cash"; delta: number }
  | { kind: "grantTreasure" }
  | { kind: "grantHero"; fallbackCash: number }
  | { kind: "grantCity"; fallbackCash: number }
  | { kind: "siphon"; amount: number }
  | { kind: "levy"; amount: number }
  | { kind: "trade"; amount: number }; // 你与随机对手各 +amount(国库出,正和)

/** 抉择选项(#124):repDelta 结算后立即落账并夹紧;effect 缺省=无事发生。 */
export interface EncounterChoiceOption {
  text: string;
  repDelta: number;
  effect?: EncounterEffect;
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

/** 目录 v1(15 条):好运 8/中性 4/霉运 3,玩家侧 4 条≈27%(七三开)。
 *  抉择 4 条(#124)带 choices;即时 11 条带 effect。 */
export const ENCOUNTERS: EncounterDef[] = [
  // ── 好运 ──
  { id: "屯粮居奇", tier: "好运", tags: ["银两"], weight: 1, text: "荒年粮价飞涨,囤粮转卖大赚一笔", effect: { kind: "cash", delta: 250 } },
  { id: "草船借箭", tier: "好运", tags: ["银两"], weight: 1, text: "借得箭矢十万,转售诸侯", effect: { kind: "cash", delta: 200 } },
  { id: "风调雨顺", tier: "好运", tags: ["银两"], weight: 1, text: "五谷丰登,市税多入", effect: { kind: "cash", delta: 100 } },
  { id: "义士来投", tier: "好运", tags: ["武将"], weight: 0.8, text: "贤士慕名来投", effect: { kind: "grantHero", fallbackCash: 200 } },
  { id: "窖藏现世", tier: "好运", tags: ["珍宝"], weight: 0.8, text: "掘地三尺,挖出前朝窖藏", effect: { kind: "grantTreasure" } },
  { id: "传檄而定", tier: "好运", tags: ["城池"], weight: 0.2, text: "檄文所至,一座无主城望风归降", effect: { kind: "grantCity", fallbackCash: 300 } },
  { id: "敌营哗变", tier: "好运", tags: ["银两", "玩家"], weight: 0.8, text: "敌营哗变,士卒携粮来投", effect: { kind: "siphon", amount: 150 } },
  { id: "纳款输诚", tier: "好运", tags: ["银两", "玩家"], weight: 0.6, text: "邻镇诸侯为避战端,向你输银", effect: { kind: "siphon", amount: 200 } },
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
    text: "名士遣使密告:愿以两件随身珍宝相赠,只求帐下效力。收下珍宝,贤士即刻来投。",
    choices: [
      { text: "以两件珍宝换 1 武将", repDelta: 0, effect: { kind: "grantHero", fallbackCash: 0 } },
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
  // ── 霉运 ──
  { id: "粮道被劫", tier: "霉运", tags: ["银两"], weight: 1, text: "粮道遭山贼劫掠,损失折银 250 两", effect: { kind: "cash", delta: -250 } },
  { id: "漕船倾覆", tier: "霉运", tags: ["银两"], weight: 1, text: "漕船江心倾覆,白银落水", effect: { kind: "cash", delta: -200 } },
  { id: "假道征粮", tier: "霉运", tags: ["银两", "玩家"], weight: 0.8, text: "邻镇诸侯假道征粮,你被迫输银 150 两", effect: { kind: "levy", amount: 150 } },
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

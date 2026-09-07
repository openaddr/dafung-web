// 机遇配置(#125):产品默认档位 + 单机设置屏的表单处理,全部纯函数(bun test 直测)。
// 口径与引擎 src/core/encounters.ts 的 resolveEncounterConfig 一致:
// - 触发概率 0~100(%),引擎侧夹紧;
// - 三档基准(好运/中性/霉运)为任意正数,按占比归一,**和不必为 100**;
// - 任一档 ≤0 或非数 → 引擎整体回退默认 30/45/25。
// 设置屏只做输入边界校验与透传,不归一(归一单源在引擎)。
import { ENCOUNTER_PRODUCT_DEFAULTS, type EncounterConfig } from "@core/encounters";

/** 设置屏表单四值:触发概率 % + 三档基准。 */
export interface EncounterFormValues {
  triggerRate: number;
  good: number;
  neutral: number;
  bad: number;
}

/** 默认配置文件 URL(public/ 静态资源直出站点根,与 /maps/ 同口径)。 */
export const ENCOUNTER_CONFIG_URL = "/config/jiyu.json";

/** 内置默认(与 public/config/jiyu.json 同值):fetch 失败时的回退。
 *  #125 明确要求此回退——属机遇域的显式例外(引擎 resolveEncounterConfig 本就带回退语义),
 *  非仓库「零兜底原则」的一般化破例。值单源自 core 的 ENCOUNTER_PRODUCT_DEFAULTS(#135:
 *  联机服务器同一常量回退,三处漂移只改 core 一处)。 */
export const BUILTIN_ENCOUNTER_DEFAULTS: EncounterFormValues = {
  triggerRate: ENCOUNTER_PRODUCT_DEFAULTS.triggerRate ?? 0,
  good: ENCOUNTER_PRODUCT_DEFAULTS.baseRates?.good ?? 0,
  neutral: ENCOUNTER_PRODUCT_DEFAULTS.baseRates?.neutral ?? 0,
  bad: ENCOUNTER_PRODUCT_DEFAULTS.baseRates?.bad ?? 0,
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 表单值边界校验:触发率夹紧 0~100、三档夹紧 ≥0;非数(空输入/NaN)记下界 0。 */
export function sanitizeEncounterForm(v: EncounterFormValues): EncounterFormValues {
  const num = (n: number, lo: number, hi: number = Number.POSITIVE_INFINITY): number =>
    Number.isFinite(n) ? clamp(n, lo, hi) : lo;
  return {
    triggerRate: num(v.triggerRate, 0, 100),
    good: num(v.good, 0),
    neutral: num(v.neutral, 0),
    bad: num(v.bad, 0),
  };
}

/** 单字段更新(type=number input 的 onChange 语义):原始输入串 → 数值 → 全量边界校验。 */
export function updateEncounterForm(
  prev: EncounterFormValues,
  key: keyof EncounterFormValues,
  raw: string,
): EncounterFormValues {
  const next: Record<keyof EncounterFormValues, number> = { ...prev };
  next[key] = Number(raw);
  return sanitizeEncounterForm(next);
}

/** jiyu.json 结构校验:triggerRate 与三档基准齐全且均为有限数才接受,否则 null(调用方回退内置默认)。 */
export function parseEncounterDefaults(data: unknown): EncounterFormValues | null {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Record<string, unknown>;
  const b =
    typeof o.baseRates === "object" && o.baseRates !== null
      ? (o.baseRates as Record<string, unknown>)
      : null;
  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const triggerRate = n(o.triggerRate);
  const good = b ? n(b.good) : null;
  const neutral = b ? n(b.neutral) : null;
  const bad = b ? n(b.bad) : null;
  if (triggerRate === null || good === null || neutral === null || bad === null) return null;
  return sanitizeEncounterForm({ triggerRate, good, neutral, bad });
}

/** 表单值 → EngineConfig.encounter:纯透传(不归一——三档和≠100 合法,归一在引擎 resolveEncounterConfig)。 */
export function toEncounterConfig(v: EncounterFormValues): EncounterConfig {
  return {
    triggerRate: v.triggerRate,
    baseRates: { good: v.good, neutral: v.neutral, bad: v.bad },
  };
}

/** 读产品默认:fetch /config/jiyu.json;HTTP 失败/网络失败/结构不符 → 回退内置默认(#125 要求)。 */
export async function fetchEncounterDefaults(): Promise<EncounterFormValues> {
  try {
    const res = await fetch(ENCOUNTER_CONFIG_URL);
    if (!res.ok) return BUILTIN_ENCOUNTER_DEFAULTS;
    return (await parseEncounterDefaults(await res.json())) ?? BUILTIN_ENCOUNTER_DEFAULTS;
  } catch {
    // 显式回退到与文件同值的内置默认(任务 #125 要求;不吞错——失败即用默认,不中断配置页)
    return BUILTIN_ENCOUNTER_DEFAULTS;
  }
}

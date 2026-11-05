// 机遇配置(#125;#1090 三档基准退役):单机设置屏只剩机遇总开关——三档概率=声望
// softmax 三元拉锯,唯一旋钮 TIER_SOFTMAX_K 为引擎代码常量,不再进配置。
// 口径与引擎 src/core/encounters.ts 一致(ADR-0035 机遇必出):
// - enabled 总开关(false=本局不出机遇),布尔直传不回退。
// 设置屏只做结构校验与透传。
import { ENCOUNTER_PRODUCT_DEFAULTS, type EncounterSwitch } from "@core/encounters";

/** 默认配置文件 URL(public/ 静态资源直出站点根,与 /maps/ 同口径)。 */
export const ENCOUNTER_CONFIG_URL = "/config/jiyu.json";

/** 内置默认(与 public/config/jiyu.json 同值):fetch 失败时的回退。
 *  #125 明确要求此回退——属机遇域的显式例外(产品默认开关,非逐局数据),非仓库
 *  「零兜底原则」的一般化破例。值单源自 core 的 ENCOUNTER_PRODUCT_DEFAULTS(#135:
 *  联机服务器同一常量回退,两处漂移只改 core 一处)。 */
export const BUILTIN_ENCOUNTER_DEFAULTS: boolean = ENCOUNTER_PRODUCT_DEFAULTS.enabled === true;

/** jiyu.json 结构校验:enabled 布尔才接受,否则 null(调用方回退内置默认)。 */
export function parseEncounterDefaults(data: unknown): boolean | null {
  if (typeof data !== "object" || data === null) return null;
  const enabled = (data as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? enabled : null;
}

/** 开关 → EngineConfig.encounter:纯透传。 */
export function toEncounterConfig(enabled: boolean): EncounterSwitch {
  return { enabled };
}

/** 读产品默认:fetch /config/jiyu.json;HTTP 失败/网络失败/结构不符 → 回退内置默认(#125 要求)。 */
export async function fetchEncounterDefaults(): Promise<boolean> {
  try {
    const res = await fetch(ENCOUNTER_CONFIG_URL);
    if (!res.ok) return BUILTIN_ENCOUNTER_DEFAULTS;
    return (await parseEncounterDefaults(await res.json())) ?? BUILTIN_ENCOUNTER_DEFAULTS;
  } catch {
    // 显式回退到与文件同值的内置默认(任务 #125 要求;不吞错——失败即用默认,不中断配置页)
    return BUILTIN_ENCOUNTER_DEFAULTS;
  }
}

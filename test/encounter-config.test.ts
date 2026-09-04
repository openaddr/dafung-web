// 机遇配置(#125):默认文件 public/config/jiyu.json 完整性 + 设置屏纯函数
// (结构校验/单字段边界校验/EngineConfig.encounter 透传/fetch 回退)。
// jiyu.json 按 encounters.test.ts 读 public/maps/sanguo.json 同款范式直接 import
// (bun 解析失败即 import 报错 = 测试红),fetch 路径用注入 stub 验证。
import { describe, it, expect, afterEach } from "bun:test";
import jiyuConfig from "../public/config/jiyu.json";
import {
  BUILTIN_ENCOUNTER_DEFAULTS,
  ENCOUNTER_CONFIG_URL,
  fetchEncounterDefaults,
  parseEncounterDefaults,
  sanitizeEncounterForm,
  toEncounterConfig,
  updateEncounterForm,
} from "@app/screens/setup/encounterConfig";
import { resolveEncounterConfig } from "@core/encounters";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 注入 fetch stub(路径对齐 ENCOUNTER_CONFIG_URL 断言;body/status/reject 可控)。 */
function stubFetch(body: string | null, status = 200, reject = false): number[] {
  const calls: number[] = []; // 记录调用次数
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(1);
    expect(String(input)).toBe(ENCOUNTER_CONFIG_URL);
    if (reject) throw new TypeError("network down");
    return new Response(body ?? "", { status });
  }) as typeof fetch;
  return calls;
}

describe("默认配置文件 public/config/jiyu.json(#125)", () => {
  it("可被解析(bun import 即解析)且四值字段齐全", () => {
    expect(jiyuConfig).toEqual({
      triggerRate: 40,
      baseRates: { good: 30, neutral: 45, bad: 25 },
    });
  });

  it("数值口径合法:触发 0~100、三档为正数", () => {
    expect(jiyuConfig.triggerRate).toBeGreaterThanOrEqual(0);
    expect(jiyuConfig.triggerRate).toBeLessThanOrEqual(100);
    for (const v of [jiyuConfig.baseRates.good, jiyuConfig.baseRates.neutral, jiyuConfig.baseRates.bad]) {
      expect(v).toBeGreaterThan(0); // 任一档 ≤0 引擎会整体回退,文件必须给出真档位
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("文件值过引擎解析口径:触发 40、三档归一后仍 30/45/25(和=100 原值直通)", () => {
    const r = resolveEncounterConfig(toEncounterConfig({
      triggerRate: jiyuConfig.triggerRate,
      good: jiyuConfig.baseRates.good,
      neutral: jiyuConfig.baseRates.neutral,
      bad: jiyuConfig.baseRates.bad,
    }));
    expect(r.triggerRate).toBe(40);
    expect(r.shares).toEqual({ good: 30, neutral: 45, bad: 25 });
  });
});

describe("设置屏纯函数(#125:表单 → EngineConfig.encounter)", () => {
  it("toEncounterConfig 原值透传,不归一(三档和≠100 合法)", () => {
    expect(toEncounterConfig({ triggerRate: 40, good: 30, neutral: 45, bad: 25 })).toEqual({
      triggerRate: 40,
      baseRates: { good: 30, neutral: 45, bad: 25 },
    });
    // 归一单源在引擎:10/10/10 原样交给 EngineConfig,各 1/3 由 resolveEncounterConfig 算出
    const raw = toEncounterConfig({ triggerRate: 7, good: 10, neutral: 10, bad: 10 });
    expect(raw.baseRates).toEqual({ good: 10, neutral: 10, bad: 10 });
    expect(resolveEncounterConfig(raw).shares.good).toBeCloseTo(100 / 3, 9);
  });

  it("sanitizeEncounterForm:触发夹紧 0~100、三档夹紧 ≥0、非数记下界 0", () => {
    expect(sanitizeEncounterForm({ triggerRate: 150, good: -3, neutral: 0, bad: Number.NaN })).toEqual({
      triggerRate: 100, good: 0, neutral: 0, bad: 0,
    });
    expect(sanitizeEncounterForm({ triggerRate: -5, good: 12.5, neutral: 45, bad: 25 })).toEqual({
      triggerRate: 0, good: 12.5, neutral: 45, bad: 25,
    });
  });

  it("updateEncounterForm:单字段更新后全量校验,其余字段原样保留", () => {
    const prev = { triggerRate: 40, good: 30, neutral: 45, bad: 25 };
    expect(updateEncounterForm(prev, "triggerRate", "65")).toEqual({
      triggerRate: 65, good: 30, neutral: 45, bad: 25,
    });
    expect(updateEncounterForm(prev, "bad", "-1")).toEqual({
      triggerRate: 40, good: 30, neutral: 45, bad: 0,
    });
    expect(updateEncounterForm(prev, "good", "")).toEqual({
      triggerRate: 40, good: 0, neutral: 45, bad: 25,
    }); // 清空输入(Number("")=0)→ 夹到下界,不产生 NaN
  });

  it("parseEncounterDefaults:结构齐全且为有限数才接受,缺字段/类型错 → null", () => {
    expect(parseEncounterDefaults({ triggerRate: 50, baseRates: { good: 1, neutral: 2, bad: 3 } }))
      .toEqual({ triggerRate: 50, good: 1, neutral: 2, bad: 3 });
    expect(parseEncounterDefaults({ triggerRate: "40", baseRates: { good: 1, neutral: 2, bad: 3 } })).toBeNull();
    expect(parseEncounterDefaults({ baseRates: { good: 1, neutral: 2, bad: 3 } })).toBeNull();
    expect(parseEncounterDefaults({ triggerRate: 40, baseRates: { good: 1, neutral: 2 } })).toBeNull();
    expect(parseEncounterDefaults({ triggerRate: 40, baseRates: { good: 1, neutral: 2, bad: Infinity } })).toBeNull();
    expect(parseEncounterDefaults(null)).toBeNull();
    expect(parseEncounterDefaults("junk")).toBeNull();
  });
});

describe("设置屏默认值来源(#125:fetch jiyu.json,失败回退内置默认)", () => {
  it("fetch 成功 → 以文件值为准", async () => {
    stubFetch(JSON.stringify(jiyuConfig));
    expect(await fetchEncounterDefaults()).toEqual({
      triggerRate: 40, good: 30, neutral: 45, bad: 25,
    });
  });

  it("HTTP 失败 / 网络异常 / 结构不符 → 回退内置默认(与文件同值)", async () => {
    stubFetch("{}", 404);
    expect(await fetchEncounterDefaults()).toEqual(BUILTIN_ENCOUNTER_DEFAULTS);

    stubFetch(null, 200, true); // fetch reject(网络失败)
    expect(await fetchEncounterDefaults()).toEqual(BUILTIN_ENCOUNTER_DEFAULTS);

    stubFetch('{"triggerRate":"broken"}'); // 200 但结构不符
    expect(await fetchEncounterDefaults()).toEqual(BUILTIN_ENCOUNTER_DEFAULTS);
  });
});

// 机遇配置(#125;#1090 三档基准退役):默认文件 public/config/jiyu.json 完整性 + 设置屏纯函数
// (结构校验/EngineConfig.encounter 透传/fetch 回退)。
// jiyu.json 按 encounters.test.ts 读 public/maps/guanzhong.json 同款范式直接 import
// (bun 解析失败即 import 报错 = 测试红),fetch 路径用注入 stub 验证。
import { describe, it, expect, afterEach } from "bun:test";
import jiyuConfig from "../public/config/jiyu.json";
import {
  BUILTIN_ENCOUNTER_DEFAULTS,
  ENCOUNTER_CONFIG_URL,
  fetchEncounterDefaults,
  parseEncounterDefaults,
  toEncounterConfig,
} from "@app/screens/setup/encounterConfig";
import { parseEncounterFile } from "@core/encounters";

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
  it("可被解析(bun import 即解析)且只剩开关(#1090 三档基准退役)", () => {
    expect(jiyuConfig).toEqual({ enabled: true });
  });

  it("开关为布尔且为产品默认(机遇必出=开)", () => {
    expect(typeof jiyuConfig.enabled).toBe("boolean");
    expect(jiyuConfig.enabled).toBe(BUILTIN_ENCOUNTER_DEFAULTS);
  });

  it("文件值过引擎装载口径:parseEncounterFile 接受,开关开", () => {
    const cfg = parseEncounterFile(jiyuConfig);
    expect(cfg).toEqual({ enabled: true });
  });
});

describe("设置屏纯函数(#125:开关 → EngineConfig.encounter)", () => {
  it("toEncounterConfig 布尔透传", () => {
    expect(toEncounterConfig(true)).toEqual({ enabled: true });
    expect(toEncounterConfig(false)).toEqual({ enabled: false });
  });

  it("parseEncounterDefaults:enabled 布尔才接受,缺字段/类型错 → null", () => {
    expect(parseEncounterDefaults({ enabled: true })).toBe(true);
    expect(parseEncounterDefaults({ enabled: false })).toBe(false);
    expect(parseEncounterDefaults({ enabled: "true" })).toBeNull();
    expect(parseEncounterDefaults({})).toBeNull(); // 缺 enabled 即拒
    expect(parseEncounterDefaults(null)).toBeNull();
    expect(parseEncounterDefaults("junk")).toBeNull();
  });
});

describe("设置屏默认值来源(#125:fetch jiyu.json,失败回退内置默认)", () => {
  it("fetch 成功 → 以文件值为准", async () => {
    stubFetch(JSON.stringify(jiyuConfig));
    expect(await fetchEncounterDefaults()).toBe(true);
  });

  it("HTTP 失败 / 网络异常 / 结构不符 → 回退内置默认(与文件同值)", async () => {
    stubFetch("{}", 404);
    expect(await fetchEncounterDefaults()).toBe(BUILTIN_ENCOUNTER_DEFAULTS);

    stubFetch(null, 200, true); // fetch reject(网络失败)
    expect(await fetchEncounterDefaults()).toBe(BUILTIN_ENCOUNTER_DEFAULTS);

    stubFetch('{"enabled":"broken"}'); // 200 但结构不符
    expect(await fetchEncounterDefaults()).toBe(BUILTIN_ENCOUNTER_DEFAULTS);
  });
});

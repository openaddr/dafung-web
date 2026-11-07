// 调试桥权威访问口单测(#1240 双口预置):getAuthorityEngine 直引模块级登记位
// (不读状态桥引擎单例,T2 接缝翻转后权威口纹丝不动)——无登记抛错(零兜底),
// 登记/清除翻转可见。登记/访问逻辑收成 registry.ts 可导出小函数供此处直调,
// 挂载层(installDebugHooks → window.__dafung)仅引用同模块导出,保持薄。
import { describe, expect, it } from "bun:test";
import type { GameEngine } from "@core/authority";
import {
  clearAuthorityEngine,
  getAuthorityEngine,
  registerAuthorityEngine,
} from "../src/app/controllers/registry";

describe("调试桥单机权威访问口 getAuthorityEngine(#1240)", () => {
  it("无登记时抛错(仅单机对局存在权威引擎)", () => {
    clearAuthorityEngine(); // 显式归零:与本进程内其他用例的登记残留解耦
    expect(() => getAuthorityEngine()).toThrow("仅单机对局存在权威引擎");
  });

  it("登记后返回登记对象,清除后恢复抛错", () => {
    clearAuthorityEngine();
    const engine = {} as unknown as GameEngine; // 登记位只存引用,不触引擎行为
    registerAuthorityEngine(engine);
    expect(getAuthorityEngine()).toBe(engine);
    clearAuthorityEngine();
    expect(() => getAuthorityEngine()).toThrow("仅单机对局存在权威引擎");
  });
});

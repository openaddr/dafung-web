// 扩展注册面单测(#378,ADR-0022):注册进既有注册面(HEROES/EFFECTS)的提交/冲突/
// 引用校验/精确卸载。零兜底口径的镜像:任一冲突当场炸。每个用例自清理(卸载),
// 不向同进程其他测试文件泄漏全局注册态。
import { describe, it, expect, afterEach } from "bun:test";
import { HEROES } from "@core/heroes";
import { EFFECTS } from "@core/effects";
import {
  registerExtensionAuthorityModule,
  unregisterExtensionPackage,
  registeredExtensionPackages,
} from "@core/extension-registry";
import type { ExtensionAuthorityModule } from "@core/extension-contract";

/** 最小合法贡献工厂:唯一 id 的名将(挂内置 gainCash 效果)+ 唯一 id 的效果。 */
function makeModule(overrides?: Partial<ExtensionAuthorityModule>): ExtensionAuthorityModule {
  const seq = Math.random().toString(36).slice(2, 8);
  return {
    manifest: {
      id: `test-pkg-${seq}`,
      name: `测试包 ${seq}`,
      version: "0.0.1",
      entry: "index.js",
    },
    heroes: [
      {
        id: `test-hero-${seq}`,
        name: "测试将",
        title: "试验",
        desc: "单测用",
        image: "",
        skills: [],
      },
    ],
    effects: {
      [`test-effect-${seq}`]: () => true,
    },
    ...overrides,
  };
}

const loadedIds: string[] = [];
function track(mod: ExtensionAuthorityModule): void {
  registerExtensionAuthorityModule(mod);
  loadedIds.push(mod.manifest.id);
}

afterEach(() => {
  while (loadedIds.length > 0) unregisterExtensionPackage(loadedIds.pop()!);
});

describe("扩展注册面(#378)", () => {
  it("合法贡献注册进既有注册面:名将池/效果表/台账三处可见,卸载精确还原", () => {
    const heroesBefore = HEROES.length;
    const mod = makeModule();
    track(mod);
    expect(HEROES.map((h) => h.id)).toContain(mod.heroes![0]!.id);
    expect(HEROES.length).toBe(heroesBefore + 1);
    const effectId = Object.keys(mod.effects!)[0]!;
    expect(EFFECTS[effectId]).toBe(mod.effects![effectId]);
    expect(registeredExtensionPackages().map((m) => m.id)).toContain(mod.manifest.id);
    // 卸载(afterEach 也会走,这里显式断言还原语义)
    unregisterExtensionPackage(mod.manifest.id);
    loadedIds.pop();
    expect(HEROES.length).toBe(heroesBefore);
    expect(EFFECTS[effectId]).toBeUndefined();
    expect(registeredExtensionPackages().map((m) => m.id)).not.toContain(mod.manifest.id);
  });

  it("包 id 重复装载 → 炸", () => {
    const mod = makeModule();
    track(mod);
    expect(() =>
      registerExtensionAuthorityModule({ ...makeModule(), manifest: mod.manifest }),
    ).toThrow(/重复装载/);
  });

  it("名将 id 与内置名将池冲突 → 炸", () => {
    const builtinId = HEROES[0]!.id;
    const mod = makeModule({
      heroes: [{ id: builtinId, name: "撞名", title: "", desc: "", image: "" }],
    });
    expect(() => registerExtensionAuthorityModule(mod)).toThrow(/与名将池冲突/);
  });

  it("效果 id 与内置效果注册表冲突 → 炸", () => {
    const mod = makeModule({ effects: { gainCash: () => true } });
    expect(() => registerExtensionAuthorityModule(mod)).toThrow(/与效果注册表冲突/);
  });

  it("与已装包的名将/效果 id 冲突 → 炸(已装贡献并入注册面,同表校验)", () => {
    const first = makeModule();
    track(first);
    const heroId = first.heroes![0]!.id;
    const effectId = Object.keys(first.effects!)[0]!;
    expect(() =>
      registerExtensionAuthorityModule(
        makeModule({ heroes: [{ id: heroId, name: "撞", title: "", desc: "", image: "" }] }),
      ),
    ).toThrow(new RegExp(`名将 id「${heroId}」与名将池冲突`));
    expect(() =>
      registerExtensionAuthorityModule(makeModule({ effects: { [effectId]: () => true } })),
    ).toThrow(new RegExp(`效果 id「${effectId}」与效果注册表冲突`));
  });

  it("技能挂未登记时机 / 引用不可解析效果 → 炸(装载期提前暴露派发期数据 bug)", () => {
    expect(() =>
      registerExtensionAuthorityModule(
        makeModule({
          heroes: [
            {
              id: "bad-moment-hero",
              name: "坏时机",
              title: "",
              desc: "",
              image: "",
              skills: [{ id: "s1", name: "技", when: "NoSuchMoment" as never, effect: "gainCash" }],
            },
          ],
        }),
      ),
    ).toThrow(/未登记时机/);
    expect(() =>
      registerExtensionAuthorityModule(
        makeModule({
          heroes: [
            {
              id: "bad-effect-hero",
              name: "坏效果",
              title: "",
              desc: "",
              image: "",
              skills: [{ id: "s2", name: "技", when: "DieRolled", effect: "no-such-effect" }],
            },
          ],
        }),
      ),
    ).toThrow(/不可解析效果/);
  });

  it("卸载未装载的包 → 炸", () => {
    expect(() => unregisterExtensionPackage("never-loaded")).toThrow(/未装载/);
  });
});

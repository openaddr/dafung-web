// 动效 token 锁定(C8 #107 批次 1):--dur-* / --ease-* 的唯一源是 core/theme.ts Motion,
// tokens.css 由 gen:theme(scripts/generate-theme-tokens.ts)遍历 Motion 序列化生成。
// 本测试双向钉死 Motion 与 tokens.css 的同步契约:
//   正向 — Motion.dur/ease 每个键都能在 tokens.css 找到逐字一致的声明;
//   反向 — tokens.css 中的 --dur-* / --ease-* 不存在 Motion 清单之外的键。
// 删掉 Motion、改 Motion 值而不再生成、或生成器私加/漏发键,此处即刻红。
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Motion } from "../src/core/theme";

const css = readFileSync(resolve(import.meta.dir, "../src/app/styles/tokens.css"), "utf8");

// 与生成器同一条命名规则:camelCase 键转 kebab-case token 后缀(outBack → out-back)。
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

describe("动效 token 唯一源(core/theme.ts Motion 与 tokens.css 同步)", () => {
  it("Motion.dur 每个键都有 --dur-<key>: <N>ms,值逐字一致", () => {
    for (const [key, ms] of Object.entries(Motion.dur)) {
      expect(css).toContain(`--dur-${kebab(key)}: ${ms}ms;`);
    }
  });

  it("Motion.ease 每个键都有 --ease-<key>: <曲线>,值逐字一致", () => {
    for (const [key, curve] of Object.entries(Motion.ease)) {
      expect(css).toContain(`--ease-${kebab(key)}: ${curve};`);
    }
  });

  it("反向:tokens.css 的 --dur-* / --ease-* 没有 Motion 清单之外的键", () => {
    // 只认行首声明(生成器不会把 token 写进行中),段首横幅注释里的「--dur-*」字样不误伤
    const declared = [...css.matchAll(/^\s*--(dur|ease)-([a-z0-9-]+):/gm)].map((m) => `${m[1]}-${m[2]}`);
    const expected = [
      ...Object.keys(Motion.dur).map((k) => `dur-${kebab(k)}`),
      ...Object.keys(Motion.ease).map((k) => `ease-${kebab(k)}`),
    ];
    expect(declared.sort()).toEqual(expected.sort());
  });
});

import { expect, test } from "bun:test";
import { classifyChange } from "../../scripts/change-classification";

test("TS/JS 普通注释与空白不改变语法,正则与模板内容保留字面原文", () => {
  for (const path of ["sample.ts", "sample.mjs"]) {
    expect(
      classifyChange(
        path,
        "export const value = /[/*]/.test(`raw // ${1 + 2}`);\n",
        "/** 新说明 */\nexport /* 内联说明 */ const value = /[/*]/.test(`raw // ${1 + 2}`); // 尾注\n",
      ),
    ).toBe("comment-only");
  }
});

test("类型、操作符、导出、自动分号和字面量 raw 都保留为实质变更", () => {
  for (const [before, after] of [
    ["export type T = string", "export type T = number"],
    ["type T = { value: string }", "type T = { readonly value: string }"],
    ["export const x = 1 + 2", "export const x = 1 - 2"],
    ["const x = 1", "export const x = 1"],
    ['export const x = "a"', 'export const x = "\\u0061"'],
    ["export const x = 10", "export const x = 0xa"],
    ["export const x = /a/g", "export const x = /a/i"],
    ["export const x = String.raw`a`", "export const x = String.raw`\\u0061`"],
    ["function f() { return 1 }", "function f() { return\n1 }"],
    ["export const x = <p> a </p>", "export const x = <p> b </p>"],
  ]) {
    expect(classifyChange("sample.tsx", before!, after!), before).toBe("substantive");
  }
});

test("编译指令、triple-slash 与 JSDoc 类型不能当作普通注释删除,指令位置也保留", () => {
  for (const [path, before, after] of [
    ["sample.ts", "const x = 1", "// @ts-nocheck\nconst x = 1"],
    ["sample.ts", "const x = 1", "// @ts-expect-error\nconst x = 1"],
    ["sample.ts", "const x = 1", '/// <reference types="bun"/>\nconst x = 1'],
    ["sample.tsx", "const x = <p/>", "/** @jsx h */\nconst x = <p/>"],
    ["sample.ts", "const x = create()", "const x = /* @__PURE__ */ create()"],
    ["sample.js", "/** @type {number} */\nlet x", "/** @type {string} */\nlet x"],
    [
      "sample.js",
      "/** @param {number} x */\nfunction f(x) {}",
      "/** @param {number} [x] */\nfunction f(x) {}",
    ],
    [
      "sample.ts",
      "// @ts-ignore\nconst a = 1; const b = 2;",
      "const a = 1;\n// @ts-ignore\nconst b = 2;",
    ],
  ]) {
    expect(classifyChange(path!, before!, after!), after).toBe("substantive");
  }
});

test("新增、删除和非 TS/JS 内容不缩减检查;解析失败显式报错", () => {
  expect(classifyChange("sample.ts", null, "// new")).toBe("substantive");
  expect(classifyChange("sample.ts", "// old", null)).toBe("substantive");
  expect(classifyChange("sample.json", "{}", "{ }")).toBe("substantive");
  expect(() => classifyChange("sample.ts", "const x = 1", "const = ;")).toThrow(
    "TypeScript 解析失败",
  );
});

test("TS 行抑制指令覆盖的源码行拆分仍是实质变更", () => {
  for (const directive of ["@ts-expect-error", "@ts-ignore"]) {
    expect(
      classifyChange(
        "sample.ts",
        `// ${directive}\nconst a: number = "x"; const b: number = "x";`,
        `// ${directive}\nconst a: number = "x";\nconst b: number = "x";`,
      ),
      directive,
    ).toBe("substantive");
  }
});

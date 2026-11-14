// 测试体系边界:允许单次浏览器辅助工具,拒绝常驻浏览器回归。临时小目录,毫秒级。
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectTestBoundaries } from "../../scripts/check-test-boundaries";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "dafung-test-boundaries-"));
  roots.push(root);
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {}, devDependencies: {} }));
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("Bun 与组件测试、浏览器辅助工具和文档字符串不误拒绝", () => {
  const root = fixture();
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/shot.mjs"), 'import { chromium } from "playwright";');
  writeFileSync(
    join(root, "test/example.test.ts"),
    'import { test } from "bun:test"; const text = "playwright"; // import x from "playwright"',
  );
  expect(inspectTestBoundaries(root)).toEqual([]);
});

test("浏览器回归依赖、配置、目录与测试内浏览器导入均被拒绝", () => {
  const root = fixture();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      scripts: { "test:e2e": "playwright test" },
      devDependencies: { "@playwright/test": "1" },
    }),
  );
  writeFileSync(join(root, "playwright.config.ts"), "export default {};");
  mkdirSync(join(root, "e2e"));
  writeFileSync(join(root, "e2e/flow.spec.ts"), "// 常驻浏览器回归");
  writeFileSync(join(root, "test/browser.test.ts"), 'import { chromium } from "playwright";');
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts/browser-regression.ts"),
    'const browser = await import("playwright");',
  );
  const issues = inspectTestBoundaries(root).join("\n");
  for (const marker of [
    "@playwright/test",
    "test:e2e",
    "playwright.config.ts",
    "e2e/",
    "test/browser.test.ts",
    "scripts/browser-regression.ts",
  ])
    expect(issues).toContain(marker);
});

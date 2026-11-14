// #1438:守 CLI 的放行判决,不镜像配置。临时 Bun/PW 用例不启动浏览器。
// 真实进程类:Bun 聚焦/参数组合约 3-5s,PW 判决组合约 37s,按 >=3s 判据入慢池;
// 零执行例随同一进程夹具留本文件,默认池不启动任何 CLI。
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const roots: string[] = [];
const testRelease = test.skipIf(!process.env.DAFUNG_SLOW);
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture(): string {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/test-release-"));
  roots.push(root);
  mkdirSync(join(root, "test"));
  cpSync(join(ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts }));
  writeFileSync(join(root, "bunfig.toml"), '[test]\nroot = "test"\n');
  return root;
}

function run(root: string, entry: string, args: string[] = []) {
  const child = Bun.spawnSync([process.execPath, "run", entry, ...args], {
    cwd: root,
    env: { ...process.env, DAFUNG_TEST_LOCK_PATH: join(root, "test.lock") },
  });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}

testRelease(
  "Bun 放行拒绝聚焦与筛选参数,稳定通过与文本中的 only 不误拒绝",
  () => {
    const root = fixture();
    const file = join(root, "test/fixture.test.ts");
    const stable =
      'import { test, expect } from "bun:test";\n// test.only("注释")\ntest("稳定", () => expect("test.only").toBe("test.only"));';
    writeFileSync(file, stable);
    expect(run(root, "test").code).toBe(0);
    writeFileSync(file, stable + '\ntest.only("聚焦", () => {});');
    const focused = run(root, "test");
    expect(focused.code, focused.output).not.toBe(0);
    writeFileSync(file, stable);
    for (const args of [
      ["--only"],
      ["--pass-with-no-tests"],
      ["-t", "不存在"],
      ["test/fixture.test.ts"],
    ]) {
      const selected = run(root, "test", args);
      expect(selected.code, selected.output).not.toBe(0);
    }
  },
  20_000,
);

testRelease(
  "Bun 零执行不冒充完整验证",
  () => {
    const root = fixture();
    writeFileSync(
      join(root, "test/fixture.test.ts"),
      'import { test } from "bun:test"; test.skip("未执行", () => {});',
    );
    const skipped = run(root, "test");
    expect(skipped.code, skipped.output).not.toBe(0);
  },
  10_000,
);

testRelease(
  "Playwright 稳定/重试通过/持续失败/聚焦/空集的判决贯穿定向与快池外壳",
  () => {
    const root = fixture();
    for (const dir of ["spine", "geometry", "browser", "slow"])
      mkdirSync(join(root, "e2e", dir), { recursive: true });
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.scripts["build:bundle"] = "bun scripts/synthetic-build.ts";
    // 只替换临时项目的 OS 采样边界,不拿同机活跃进程数作概率性前提。
    // 真 probeWatermark 的 CIM 读数另随票取证;生产入口无跳闸旗标。
    pkg.scripts["test:e2e:one"] = "bun --preload ./scripts/os-probe.ts scripts/e2e-one.ts";
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    writeFileSync(
      join(root, "scripts/os-probe.ts"),
      'import { mock } from "bun:test"; const real = await import("node:child_process"); mock.module("node:child_process", () => ({ ...real, execFileSync: () => Buffer.from(JSON.stringify({ cpu: 10, processes: [] })) }));',
    );
    writeFileSync(
      join(root, "scripts/synthetic-build.ts"),
      'console.log("synthetic build: zero product assets");',
    );
    writeFileSync(
      join(root, "playwright.config.ts"),
      `import real from ${JSON.stringify(join(ROOT, "playwright.config.ts"))}; export default { ...real, testDir: ${JSON.stringify(join(root, "e2e"))}, globalSetup: undefined, webServer: undefined, projects: [{ name: "synthetic" }], workers: 1, reporter: "list", timeout: 1000 };`,
    );
    const spec = join(root, "e2e/spine/synthetic.spec.ts");
    writeFileSync(
      spec,
      'import { test, expect } from "@playwright/test"; test("稳定", () => expect(true).toBe(true));',
    );
    const stable = run(root, "test:e2e");
    expect(stable.code, stable.output).toBe(0);
    expect(stable.output).toContain("1 passed");
    for (const entry of ["test:e2e", "test:e2e:slow"]) {
      for (const args of [["--grep", "稳定"], ["--list"], ["--pass-with-no-tests"]]) {
        const subset = run(root, entry, args);
        expect(subset.code, subset.output).toBe(2);
      }
    }
    writeFileSync(
      spec,
      'import { test, expect } from "@playwright/test"; test("重试通过", ({}, info) => expect(info.retry).toBeGreaterThan(0));',
    );
    const flaky = run(root, "test:e2e:one", ["e2e/spine"]);
    expect(flaky.output).toContain("1 flaky");
    expect(flaky.code, flaky.output).toBe(1);
    expect(readFileSync(join(root, "tmp/e2e-one-last.log"), "utf8")).toContain("1 flaky");
    writeFileSync(
      spec,
      'import { test, expect } from "@playwright/test"; test("持续失败", () => expect(true).toBe(false));',
    );
    const failed = run(root, "test:e2e");
    expect(failed.output).toContain("1 failed");
    expect(failed.code, failed.output).toBe(1);
    writeFileSync(spec, 'import { test } from "@playwright/test"; test.only("聚焦", () => {});');
    const focused = run(root, "test:e2e:one", ["e2e/spine"]);
    expect(focused.output).toContain("focused with '.only' is not allowed");
    expect(focused.code, focused.output).toBe(1);
    const empty = run(root, "test:e2e:one", ["不存在的路径"]);
    expect(empty.output).toContain("No tests found");
    expect(empty.code, empty.output).toBe(1);
    writeFileSync(spec, 'import { test } from "@playwright/test"; test.skip("未执行", () => {});');
    const skipped = run(root, "test:e2e:one", ["e2e/spine"]);
    expect(skipped.output).toContain("1 skipped");
    expect(skipped.code, skipped.output).toBe(1);
  },
  60_000,
);

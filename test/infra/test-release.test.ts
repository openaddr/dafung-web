// #1438:守 CLI 的放行判决,不镜像配置。临时 Bun/PW 用例不启动浏览器。
// CLI 子进程例仅修改放行入口时定向执行;默认池跳过。
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
    for (const binding of ["const alias = test;", "const alias = test.skipIf(false);"]) {
      writeFileSync(file, stable + `\n${binding}\nalias.only("别名聚焦", () => {});`);
      const aliased = run(root, "test");
      expect(aliased.code, aliased.output).not.toBe(0);
    }
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
    const selected = () =>
      Bun.spawnSync(
        [process.execPath, "scripts/bun-release.ts", "--files", "test/fixture.test.ts"],
        { cwd: root },
      );
    expect(selected().exitCode).not.toBe(0);
    writeFileSync(
      join(root, "test/fixture.test.ts"),
      'import { test } from "bun:test"; test("所选范围", () => {});',
    );
    writeFileSync(
      join(root, "test/unselected.test.ts"),
      'import { test } from "bun:test"; test("未选失败", () => { throw new Error("不应运行"); });',
    );
    const stable = selected();
    expect(stable.exitCode, stable.stdout.toString() + stable.stderr.toString()).toBe(0);
  },
  10_000,
);

// #1456:真实 CLI + 临时 jj 仓验证合并回执;仅 GitHub/远端操作在系统边界替换。
// 每例运行多个 jj/Bun 进程,仅本能力改动时定向执行,默认池跳过。
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const roots: string[] = [];
const testMerge = test.skipIf(!process.env.DAFUNG_SLOW);
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function command(root: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawnSync(args, { cwd: root, env: { ...process.env, ...env } });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}

function jj(root: string, ...args: string[]): string {
  const result = command(root, ["jj", ...args]);
  expect(result.code, result.output).toBe(0);
  return result.output.trim();
}

function fixture() {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/pr-merge-validation-"));
  roots.push(root);
  for (const dir of ["scripts", "docs", "tmp", "test/infra"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "docs/note.md"), "原说明\n");
  writeFileSync(
    join(root, "test/infra/canary.test.ts"),
    'import { test } from "bun:test"; import { appendFileSync } from "node:fs";\n// DAFUNG_SLOW\ntest("原慢例", () => appendFileSync("tmp/checks.log", "canary\\n"));\n',
  );
  writeFileSync(
    join(root, "scripts/check-freshness.ts"),
    'console.log("fixture freshness passed");',
  );
  writeFileSync(
    join(root, "scripts/fixture-check.ts"),
    'import { appendFileSync } from "node:fs"; appendFileSync("tmp/checks.log", `${process.argv[2]}\\n`);',
  );
  cpSync(join(ROOT, "scripts/bun-release.ts"), join(root, "scripts/bun-release.ts"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: Object.fromEntries(
        ["lint", "check:fmt", "build", "test"].map((id) => [
          id,
          `bun scripts/fixture-check.ts ${id}`,
        ]),
      ),
    }),
  );
  // preload 仅替换出站系统命令;validate 子进程和所有本地 jj 操作仍真实运行。
  writeFileSync(
    join(root, "tmp/remote-boundary.ts"),
    `import { appendFileSync } from "node:fs";
const spawn = Bun.spawnSync;
Bun.spawnSync = (args, options) => {
  const remote = args[0] === "gh" || (args[0] === "jj" && args[1] === "git" && args[2] === "push");
  if (!remote) return spawn(args, options);
  appendFileSync("tmp/remote.log", JSON.stringify(args) + "\\n");
  let output = "";
  if (args[0] === "gh") {
    if (args.includes("list")) output = process.env.FIXTURE_RECOVERY ? JSON.stringify([{url:"https://github.com/fixture/repo/pull/42", mergedAt:new Date().toISOString()}]) : "[]";
    else if (args.includes("create")) output = "https://github.com/fixture/repo/pull/42";
    else throw new Error("本测试不允许实际合并: " + JSON.stringify(args));
  }
  return { stdout: Buffer.from(output), stderr: Buffer.alloc(0), exitCode: 0 };
};`,
  );
  jj(root, "git", "init");
  jj(root, "describe", "-m", "基线");
  const base = jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  jj(root, "bookmark", "set", "master");
  const remote = join(root, "tmp/origin.git");
  const initialized = command(root, ["git", "init", "--bare", remote]);
  expect(initialized.code, initialized.output).toBe(0);
  jj(root, "git", "remote", "add", "origin", remote);
  jj(root, "git", "push", "--bookmark", "master");
  jj(root, "new", "-m", "第一提交");
  writeFileSync(join(root, "docs/note.md"), "新说明\n");
  const middle = jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  jj(root, "new", "-m", "第二提交");
  writeFileSync(
    join(root, "test/infra/canary.test.ts"),
    readFileSync(join(root, "test/infra/canary.test.ts"), "utf8") + "// 慢例修改\n",
  );
  jj(root, "bookmark", "set", "codex/fixture");
  jj(root, "new");
  return { root, base, middle, remote };
}

function receipt(root: string, base: string, name = "passed receipt.json") {
  const file = join(root, "tmp", name);
  const result = command(root, [
    process.execPath,
    join(ROOT, "scripts/validate.ts"),
    "run",
    "--base",
    base,
    "--out",
    file,
  ]);
  expect(result.code, result.output).toBe(0);
  return file;
}

function merge(root: string, file?: string, env: Record<string, string> = {}) {
  return command(
    root,
    [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      join(ROOT, "scripts/pr-merge.ts"),
      "codex/fixture",
      "--create-only",
      "--expect",
      "docs/note.md",
      "--expect",
      "test/infra/canary.test.ts",
      ...(file === undefined ? [] : ["--validation-receipt", relative(root, file)]),
    ],
    env,
  );
}

testMerge(
  "完整回执支持空格路径、等效 squash、描述变化与空停靠,合并不重复 build/canary",
  () => {
    const { root, base } = fixture();
    const file = receipt(root, base);
    const checked = readFileSync(join(root, "tmp/checks.log"), "utf8");
    expect(checked).toContain("build\n");
    expect(checked).toContain("canary\n");
    for (const description of ["等效 squash", "只改描述"]) {
      jj(root, "describe", "-r", "codex/fixture", "-m", description);
      if (description === "只改描述") jj(root, "edit", "codex/fixture");
      const result = merge(root, file);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain("fixture freshness passed");
      expect(readFileSync(join(root, "tmp/checks.log"), "utf8")).toBe(checked);
      expect(jj(root, "file", "show", "-r", "codex/fixture", "docs/note.md")).toBe("新说明");
    }
    const writes = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(writes).toContain('"push","--bookmark","codex/fixture"');
    expect(writes).toContain('"pr","create"');
  },
  60_000,
);

testMerge(
  "显式无效回执拒绝全部远端写入,包括窄基线、另一目标树与远端基线前移",
  () => {
    const { root, base, middle, remote } = fixture();
    const file = receipt(root, base);
    const original = readFileSync(file, "utf8");
    const narrow = receipt(root, middle, "narrow.json");
    const checked = readFileSync(join(root, "tmp/checks.log"), "utf8");
    const refused = (path: string) => {
      writeFileSync(join(root, "tmp/remote.log"), "");
      const result = merge(root, path);
      expect(result.code, result.output).not.toBe(0);
      const outbound = readFileSync(join(root, "tmp/remote.log"), "utf8");
      expect(outbound).not.toContain('"push"');
      expect(outbound).not.toContain('"create"');
      expect(outbound).not.toContain('"merge"');
      expect(readFileSync(join(root, "tmp/checks.log"), "utf8")).toBe(checked);
    };
    refused(join(root, "tmp/missing.json"));
    for (const invalid of ["failed", "unfinished", "missing-check", "exit-code", "command"]) {
      const record = JSON.parse(original);
      if (invalid === "failed") record.status = "failed";
      if (invalid === "unfinished") record.finishedAt = null;
      if (invalid === "missing-check") record.results.pop();
      if (invalid === "exit-code") record.results[0].exitCode = 23;
      if (invalid === "command") record.plan.checks[0].command = ["unexecuted"];
      writeFileSync(file, JSON.stringify(record));
      refused(file);
    }
    writeFileSync(file, original);
    refused(narrow);
    jj(root, "new", base);
    // 当前树与回执一致但书签另指一棵树,也不能靠物化书签掩盖。
    jj(root, "bookmark", "set", "other-target", "-r", "codex/fixture");
    jj(root, "bookmark", "move", "codex/fixture", "--to", "@", "--allow-backwards");
    jj(root, "new", "other-target");
    refused(file);
    jj(root, "bookmark", "move", "codex/fixture", "--to", "other-target", "--allow-backwards");
    writeFileSync(join(root, "docs/note.md"), "未经验证的源码修改\n");
    refused(file);
    jj(root, "new", "codex/fixture");
    // 只推进本地裸远端;调用方 master@origin 保持陈旧,合并须先刷新再核精确基线。
    const advanced = command(root, [
      "git",
      "--git-dir",
      remote,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit-tree",
      `${base}^{tree}`,
      "-p",
      base,
      "-m",
      "并行基线",
    ]);
    expect(advanced.code, advanced.output).toBe(0);
    const moved = command(root, [
      "git",
      "--git-dir",
      remote,
      "update-ref",
      "refs/heads/master",
      advanced.output.trim(),
    ]);
    expect(moved.code, moved.output).toBe(0);
    refused(file);
  },
  90_000,
);

testMerge(
  "无回执继续 build/canary,已合并恢复忽略坏回执并只清理收账",
  () => {
    const { root, base } = fixture();
    receipt(root, base);
    const before = readFileSync(join(root, "tmp/checks.log"), "utf8");
    const legacy = merge(root);
    expect(legacy.code, legacy.output).toBe(0);
    expect(legacy.output).toContain("build 闸绿");
    expect(legacy.output).toContain("慢池 canary 绿");
    const checked = readFileSync(join(root, "tmp/checks.log"), "utf8");
    expect(checked).toBe(before + "build\ncanary\n");
    writeFileSync(join(root, "tmp/remote.log"), "");
    const recovered = merge(root, join(root, "tmp/missing receipt.json"), {
      FIXTURE_RECOVERY: "1",
    });
    expect(recovered.code, recovered.output).toBe(0);
    expect(recovered.output).toContain("恢复模式");
    expect(readFileSync(join(root, "tmp/checks.log"), "utf8")).toBe(checked);
    const writes = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(writes).toContain('"push","--deleted"');
    expect(writes).not.toContain('"create"');
    expect(writes).not.toContain('"merge"');
  },
  60_000,
);

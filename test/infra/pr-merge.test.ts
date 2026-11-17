// 真实 CLI + 临时 jj 仓验证单次检查与收口;远端操作在系统边界替换。
// 每例运行多个 jj/Bun 进程,仅本能力改动时定向执行,默认池跳过。
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function fixture(extraFiles: Record<string, string> = {}) {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/pr-merge-"));
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
    `if (process.env.ADVANCE_ON_FRESHNESS) {
  const build = Bun.spawnSync([process.execPath, "scripts/fixture-check.ts", "build"], { env: { ...process.env, ADVANCE_BASE: process.env.ADVANCE_ON_FRESHNESS }, stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const fetch = Bun.spawnSync(["jj", "git", "fetch"], { stdout: "pipe", stderr: "pipe" });
  if (fetch.exitCode !== 0) throw new Error(fetch.stderr.toString());
}
console.log("fixture freshness passed");`,
  );
  writeFileSync(
    join(root, "scripts/fixture-check.ts"),
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const check = process.argv[2];
appendFileSync("tmp/checks.log", check + "\\n");
if (check === "lint" && process.env.MUTATE_CHECK) writeFileSync("docs/note.md", "检查期间改动\\n");
if (check === process.env.FAIL_CHECK) process.exit(23);
if (check === "build" && process.env.EXPECT_NOTE && readFileSync("docs/note.md", "utf8").trim() !== process.env.EXPECT_NOTE) process.exit(12);
if (check === "build" && process.env.ADVANCE_BASE) {
  const base = process.env.ADVANCE_BASE;
  const commit = spawnSync("git", ["--git-dir", "tmp/origin.git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree", base + "^{tree}", "-p", base, "-m", "并行基线"], { encoding: "utf8" });
  if (commit.status !== 0) throw new Error(commit.stderr);
  const moved = spawnSync("git", ["--git-dir", "tmp/origin.git", "update-ref", "refs/heads/master", commit.stdout.trim()], { encoding: "utf8" });
  if (moved.status !== 0) throw new Error(moved.stderr);
}`,
  );
  for (const file of [
    "bun-release.ts",
    "command-log.ts",
    "pr-merge.ts",
    "pr-merge-checks.ts",
    "pr-merge-cleanup.ts",
    "change-classification.ts",
  ])
    cpSync(join(ROOT, "scripts", file), join(root, "scripts", file));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: Object.fromEntries(
        [
          "lint",
          "check:fmt",
          "build",
          "test",
          "typecheck:scripts",
          "check:core",
          "check:goldens",
          "check:sim-bench",
          "check:board",
          "check:agents-budget",
        ].map((id) => [id, `bun scripts/fixture-check.ts ${id}`]),
      ),
    }),
  );
  for (const [path, contents] of Object.entries(extraFiles)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  // preload 替换出站命令与显式注入的收账失败;其余本地 jj 操作真实运行。
  writeFileSync(
    join(root, "tmp/remote-boundary.ts"),
    `import { appendFileSync } from "node:fs";
const spawn = Bun.spawnSync;
let fetchCount = 0;
let swapped = false;
Bun.spawnSync = (args, options) => {
  if (process.env.FIXTURE_SWAP_TARGET && !swapped && args[0] === "jj" && args[1] === "diff" && args[args.indexOf("--from") + 1] === "@") {
    const result = spawn(args, options);
    const moved = spawn(["jj", "bookmark", "move", "codex/fixture", "--to", "other-target", "--allow-backwards"], { stdout: "pipe", stderr: "pipe" });
    if (moved.exitCode !== 0) throw new Error(moved.stderr.toString());
    swapped = true;
    return result;
  }
  const isFetch = args[0] === "jj" && args[1] === "git" && args[2] === "fetch";
  if (isFetch) fetchCount++;
  const failFetch = isFetch && process.env.FIXTURE_FAIL_FETCH && fetchCount >= (process.env.FIXTURE_RECOVERY ? 1 : 3);
  const failMove = args[0] === "jj" && args[1] === "bookmark" && args[2] === "move" && args[3] === "master" && process.env.FIXTURE_FAIL_MOVE;
  const remote = failMove || failFetch || args[0] === "gh" || (args[0] === "jj" && args[1] === "git" && args[2] === "push");
  if (!remote) return spawn(args, options);
  appendFileSync("tmp/remote.log", JSON.stringify(args) + "\\n");
  if (failFetch) return { stdout: Buffer.alloc(0), stderr: Buffer.from("fixture fetch failed"), exitCode: 1 };
  if (failMove) return { stdout: Buffer.alloc(0), stderr: Buffer.from("fixture move failed"), exitCode: 1 };
  if (args[0] === "jj" && process.env.FIXTURE_REAL_PUSH) return spawn(args, options);
  let output = "";
  if (args[0] === "gh") {
    if (args.includes("list") && args.includes("open")) output = process.env.FIXTURE_OPEN_PR ? JSON.stringify([{url:"https://github.com/fixture/repo/pull/43"}]) : "[]";
    else if (args.includes("list")) output = process.env.FIXTURE_EMPTY_GH ? "" : process.env.FIXTURE_RECOVERY ? JSON.stringify([{url:"https://github.com/fixture/repo/pull/42", mergedAt:new Date().toISOString()}]) : "[]";
    else if (args.includes("create")) output = "https://github.com/fixture/repo/pull/42";
    else if (args.includes("view") && args.includes("baseRefName,baseRefOid")) {
      const base = spawn(["jj", "log", "-r", "master@origin", "--no-graph", "-T", "commit_id"], { stdout: "pipe", stderr: "pipe" });
      if (base.exitCode !== 0) throw new Error(base.stderr.toString());
      output = JSON.stringify({baseRefName: process.env.FIXTURE_BAD_PR_NAME ? "other" : "master", baseRefOid: process.env.FIXTURE_BAD_PR_BASE ? "f".repeat(40) : base.stdout.toString().trim()});
    }
    else if (process.env.FIXTURE_COMPLETE && args.includes("merge")) {
      const target = spawn(["jj", "log", "-r", "codex/fixture", "--no-graph", "-T", "commit_id"], { stdout: "pipe", stderr: "pipe" });
      if (target.exitCode !== 0 || args[args.indexOf("--match-head-commit") + 1] !== target.stdout.toString().trim()) throw new Error("合并未绑定已检查的目标提交");
      output = "";
    }
    else if (process.env.FIXTURE_COMPLETE && args.includes("view")) output = "MERGED";
    else throw new Error("本测试不允许实际合并: " + JSON.stringify(args));
  }
  return { stdout: Buffer.from(output), stderr: Buffer.alloc(0), exitCode: 0 };
};`,
  );
  jj(root, "git", "init");
  jj(root, "config", "set", "--repo", "user.name", "Fixture");
  jj(root, "config", "set", "--repo", "user.email", "fixture@example.invalid");
  jj(root, "metaedit", "--update-author");
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
    readFileSync(join(root, "test/infra/canary.test.ts"), "utf8") + 'test("新增慢例", () => {});\n',
  );
  jj(root, "bookmark", "set", "codex/fixture");
  jj(root, "new");
  return { root, base, middle, remote };
}

function merge(root: string, env: Record<string, string> = {}, extraPaths: string[] = []) {
  return command(
    root,
    [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      join(root, "scripts/pr-merge.ts"),
      "codex/fixture",
      "--create-only",
      "--expect",
      "docs/note.md",
      "--expect",
      "test/infra/canary.test.ts",
      ...extraPaths.flatMap((path) => ["--expect", path]),
    ],
    env,
  );
}

testMerge(
  "收口只执行一次基础检查和受影响的慢例,通过后才推送",
  () => {
    const { root } = fixture();
    const result = merge(root);
    expect(result.code, result.output).toBe(0);
    expect(readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n")).toEqual([
      "lint",
      "check:fmt",
      "build",
      "test",
      "canary",
    ]);
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).toContain('"push"');
  },
  30_000,
);

testMerge(
  "每个被修改的慢例都必须实际执行",
  () => {
    const { root } = fixture();
    jj(root, "edit", "codex/fixture");
    writeFileSync(
      join(root, "test/infra/skipped.test.ts"),
      'import { test } from "bun:test"; // DAFUNG_SLOW\ntest.skip("漏执行", () => {});\n',
    );
    jj(root, "new");
    const result = merge(root, {}, ["test/infra/skipped.test.ts"]);
    expect(result.code, result.output).not.toBe(0);
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
  },
  30_000,
);

testMerge(
  "检查失败或检查期间改码时禁止推送",
  () => {
    const cases: Record<string, string>[] = [{ FAIL_CHECK: "lint" }, { MUTATE_CHECK: "1" }];
    for (const env of cases) {
      const { root } = fixture();
      const result = merge(root, env);
      expect(result.code, result.output).not.toBe(0);
      expect(readFileSync(join(root, "tmp/checks.log"), "utf8").trim()).toBe("lint");
      expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
    }
  },
  30_000,
);

testMerge(
  "检查期间远端基线推进时禁止推送",
  () => {
    const { root, base } = fixture();
    const result = merge(root, { ADVANCE_BASE: base });
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("基线发生变化");
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
  },
  30_000,
);

testMerge(
  "推送后发现基线推进时不创建 PR",
  () => {
    const { root, base } = fixture();
    const result = merge(root, { ADVANCE_ON_FRESHNESS: base });
    expect(result.code, result.output).not.toBe(0);
    const remote = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(remote).toContain('"push"');
    expect(remote).not.toContain('"create"');
  },
  30_000,
);

testMerge(
  "创建 PR 后发现基线或目标分支不符时不合并",
  () => {
    const cases: Record<string, string>[] = [
      { FIXTURE_BAD_PR_BASE: "1" },
      { FIXTURE_BAD_PR_NAME: "1" },
    ];
    for (const env of cases) {
      const { root } = fixture();
      const result = merge(root, env);
      expect(result.code, result.output).not.toBe(0);
      const remote = readFileSync(join(root, "tmp/remote.log"), "utf8");
      expect(remote).toContain('"create"');
      expect(remote).not.toContain('"merge"');
    }
  },
  45_000,
);

testMerge(
  "核对工作区期间书签移动时禁止推送",
  () => {
    const { root } = fixture();
    const other = join(root, "tmp/other-target-workspace");
    jj(
      root,
      "workspace",
      "add",
      "--name",
      "other-target-workspace",
      "--revision",
      "codex/fixture",
      other,
    );
    writeFileSync(join(other, "docs/note.md"), "其他工作区的变更\n");
    jj(other, "bookmark", "set", "other-target");
    const result = merge(root, { FIXTURE_SWAP_TARGET: "1" });
    expect(result.code, result.output).not.toBe(0);
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
  },
  30_000,
);

testMerge(
  "禁止从其他工作区加载收口脚本",
  () => {
    const { root } = fixture();
    const result = command(root, [
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
    ]);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("当前工作区");
  },
  30_000,
);

testMerge(
  "生产协议变化会选慢例,相关测试同时修改也不重复执行",
  () => {
    const makeTest = (name: string) =>
      `import { test } from "bun:test"; import { appendFileSync } from "node:fs"; test("${name}", () => appendFileSync("tmp/checks.log", "${name}\\n"));`;
    const protocolTest = `${makeTest("protocol")}\n// DAFUNG_SLOW\n`;
    for (const changeTest of [false, true]) {
      const { root } = fixture({
        "test/online/protocol-online.test.ts": protocolTest,
        "test/online/server-cmd-error.test.ts": makeTest("command-error"),
      });
      jj(root, "edit", "codex/fixture");
      writeFileSync(join(root, "scripts/wire.ts"), "export const protocol = true;\n");
      if (changeTest)
        writeFileSync(
          join(root, "test/online/protocol-online.test.ts"),
          `${protocolTest}test("新增", () => {});\n`,
        );
      jj(root, "new");
      const extraPaths = [
        "scripts/wire.ts",
        ...(changeTest ? ["test/online/protocol-online.test.ts"] : []),
      ];
      const result = merge(root, {}, extraPaths);
      expect(result.code, result.output).toBe(0);
      const checks = readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n");
      expect(checks).toContain("typecheck:scripts");
      expect(checks.filter((check) => check === "protocol")).toHaveLength(1);
      expect(checks.filter((check) => check === "command-error")).toHaveLength(1);
    }
  },
  30_000,
);

testMerge(
  "反应窗截止逻辑由默认池覆盖,不额外跑无关故障慢例",
  () => {
    const makeTest = (name: string) =>
      `import { test } from "bun:test"; import { appendFileSync } from "node:fs"; test("${name}", () => appendFileSync("tmp/checks.log", "${name}\\n"));`;
    const { root } = fixture({
      "test/online/protocol-online.test.ts": makeTest("protocol"),
      "test/online/server-cmd-error.test.ts": makeTest("command-error"),
    });
    jj(root, "edit", "codex/fixture");
    writeFileSync(join(root, "scripts/reaction-deadline.ts"), "export const deadline = 1;\n");
    jj(root, "new");
    const result = merge(root, {}, ["scripts/reaction-deadline.ts"]);
    expect(result.code, result.output).toBe(0);
    const checks = readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n");
    expect(checks).toContain("test");
    expect(checks).toContain("typecheck:scripts");
    expect(checks).not.toContain("protocol");
    expect(checks).not.toContain("command-error");
  },
  30_000,
);

testMerge(
  "行为改动选专项,仅注释改动不重复运行专项",
  () => {
    const original = "export const value = 1;\n";
    for (const commentOnly of [false, true]) {
      const { root } = fixture({
        "scripts/build-dist.ts": original,
        "test/infra/build-dist.test.ts":
          'import { test } from "bun:test"; import { appendFileSync } from "node:fs"; test("build-check", () => appendFileSync("tmp/checks.log", "build-check\\n"));',
      });
      jj(root, "edit", "codex/fixture");
      writeFileSync(
        join(root, "scripts/build-dist.ts"),
        commentOnly ? `// 新说明\n${original}` : "export const value = 2;\n",
      );
      jj(root, "new");
      const result = merge(root, {}, ["scripts/build-dist.ts"]);
      expect(result.code, result.output).toBe(0);
      const checks = readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n");
      expect(checks).toContain("typecheck:scripts");
      expect(checks.filter((check) => check === "build-check")).toHaveLength(commentOnly ? 0 : 1);
    }
  },
  45_000,
);

testMerge(
  "只改引擎规则时自动追加引擎、黄金台账和 bot 基准",
  () => {
    const { root } = fixture();
    jj(root, "edit", "codex/fixture");
    mkdirSync(join(root, "src/core"), { recursive: true });
    writeFileSync(join(root, "src/core/encounters.ts"), "export const rule = 1;\n");
    jj(root, "new");
    const result = merge(root, {}, ["src/core/encounters.ts"]);
    expect(result.code, result.output).toBe(0);
    const checks = readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n");
    for (const name of ["check:core", "check:goldens", "check:sim-bench"])
      expect(checks.filter((check) => check === name)).toHaveLength(1);
  },
  30_000,
);

testMerge(
  "节拍和客户端改动不误触发无关模拟或服务端故障慢例",
  () => {
    const makeTest = (name: string) =>
      `import { test } from "bun:test"; import { appendFileSync } from "node:fs"; test("${name}", () => appendFileSync("tmp/checks.log", "${name}\\n"));`;
    const { root } = fixture({
      "src/core/timings.ts": "export const delay = 1;\n",
      "src/app/controllers/registry.ts": "export const registry = 1;\n",
      "src/app/store/gameStore.ts": "export const state = 1;\n",
      "src/app/net/reconnecting-socket.ts": "export const socket = 1;\n",
      "test/online/protocol-online.test.ts": makeTest("protocol"),
      "test/online/server-cmd-error.test.ts": makeTest("command-error"),
      "test/online/room-recovery.test.ts": makeTest("recovery"),
    });
    jj(root, "edit", "codex/fixture");
    writeFileSync(join(root, "src/core/timings.ts"), "export const delay = 2;\n");
    writeFileSync(join(root, "src/app/controllers/registry.ts"), "export const registry = 2;\n");
    writeFileSync(join(root, "src/app/store/gameStore.ts"), "export const state = 2;\n");
    writeFileSync(join(root, "src/app/net/reconnecting-socket.ts"), "export const socket = 2;\n");
    jj(root, "new");
    const result = merge(root, {}, [
      "src/core/timings.ts",
      "src/app/controllers/registry.ts",
      "src/app/store/gameStore.ts",
      "src/app/net/reconnecting-socket.ts",
    ]);
    expect(result.code, result.output).toBe(0);
    const checks = readFileSync(join(root, "tmp/checks.log"), "utf8").trim().split("\n");
    expect(checks).toContain("check:core");
    for (const name of [
      "check:goldens",
      "check:sim-bench",
      "protocol",
      "command-error",
      "recovery",
    ])
      expect(checks).not.toContain(name);
  },
  30_000,
);

testMerge(
  "新增未知影响域时在检查和推送前停止",
  () => {
    const { root } = fixture();
    jj(root, "edit", "codex/fixture");
    mkdirSync(join(root, "deployment"), { recursive: true });
    writeFileSync(join(root, "deployment/future.conf"), "unknown\n");
    jj(root, "new");
    const result = merge(root, {}, ["deployment/future.conf"]);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("未知影响域:deployment/future.conf");
    expect(() => readFileSync(join(root, "tmp/checks.log"), "utf8")).toThrow();
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
  },
  20_000,
);

testMerge(
  "新增未登记脚本不会静默只跑类型检查",
  () => {
    const { root } = fixture();
    jj(root, "edit", "codex/fixture");
    writeFileSync(join(root, "scripts/future-adapter.ts"), "export const value = 1;\n");
    jj(root, "new");
    const result = merge(root, {}, ["scripts/future-adapter.ts"]);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("未知影响域:scripts/future-adapter.ts");
    expect(readFileSync(join(root, "tmp/remote.log"), "utf8")).not.toContain('"push"');
  },
  20_000,
);

testMerge(
  "自动归拢收口保留旧链上其他工作区与书签",
  () => {
    const { root, middle } = fixture();
    const other = join(root, "tmp/other-workspace");
    jj(root, "bookmark", "set", "other-work", "-r", middle);
    jj(root, "workspace", "add", "--name", "other", "--revision", middle, other);
    const before = jj(other, "log", "-r", "@", "--no-graph", "-T", "commit_id");
    const result = command(
      root,
      [
        process.execPath,
        "--preload",
        join(root, "tmp/remote-boundary.ts"),
        join(root, "scripts/pr-merge.ts"),
        "codex/fixture",
        "--expect",
        "docs/note.md",
        "--expect",
        "test/infra/canary.test.ts",
      ],
      { FIXTURE_COMPLETE: "1" },
    );
    expect(result.code, result.output).toBe(0);
    expect(jj(root, "log", "-r", "other-work", "--no-graph", "-T", "commit_id")).toBe(middle);
    expect(jj(other, "log", "-r", "@", "--no-graph", "-T", "commit_id")).toBe(before);
  },
  60_000,
);

testMerge(
  "同树工作区安全起空层并保留原提交",
  () => {
    const { root } = fixture();
    jj(root, "edit", "codex/fixture");
    const before = jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
    const result = merge(root);
    expect(result.code, result.output).toBe(0);
    expect(jj(root, "file", "show", "-r", before, "docs/note.md")).toBe("新说明");
    expect(jj(root, "file", "show", "-r", "codex/fixture", "docs/note.md")).toBe("新说明");
  },
  30_000,
);

testMerge(
  "不同树时拒绝收口,切到目标树后才检查",
  () => {
    const { root, base } = fixture();
    jj(root, "new", base, "-m", "单提交");
    writeFileSync(join(root, "docs/note.md"), "目标树\n");
    jj(root, "bookmark", "move", "codex/fixture", "--to", "@", "--allow-backwards");
    jj(root, "new", base);
    const args = [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      join(root, "scripts/pr-merge.ts"),
      "codex/fixture",
      "--create-only",
      "--expect",
      "docs/note.md",
    ];
    const refused = command(root, args, { EXPECT_NOTE: "目标树" });
    expect(refused.code, refused.output).not.toBe(0);
    expect(refused.output).toContain("工作区与目标书签内容不同");
    expect(() => readFileSync(join(root, "tmp/checks.log"), "utf8")).toThrow();
    jj(root, "new", "codex/fixture");
    const accepted = command(root, args, { EXPECT_NOTE: "目标树" });
    expect(accepted.code, accepted.output).toBe(0);
  },
  30_000,
);

testMerge(
  "收账前置失败时不假报已停靠新基线",
  () => {
    for (const failure of ["fetch", "move"]) {
      const { root, base } = fixture();
      const main = join(root, "tmp/main-workspace");
      jj(root, "workspace", "rename", "integration");
      jj(root, "workspace", "add", "--name", "default", "--revision", base, main);
      const mainBefore = jj(main, "log", "-r", "@", "--no-graph", "-T", "commit_id");
      const result = command(
        root,
        [
          process.execPath,
          "--preload",
          join(root, "tmp/remote-boundary.ts"),
          join(root, "scripts/pr-merge.ts"),
          "codex/fixture",
          "--expect",
          "docs/note.md",
          "--expect",
          "test/infra/canary.test.ts",
        ],
        {
          FIXTURE_COMPLETE: "1",
          [failure === "fetch" ? "FIXTURE_FAIL_FETCH" : "FIXTURE_FAIL_MOVE"]: "1",
        },
      );
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain(failure === "fetch" ? "fetch 失败" : "master 书签移动失败");
      expect(jj(root, "file", "show", "-r", "@-", "docs/note.md")).toBe("新说明");
      expect(jj(main, "log", "-r", "@", "--no-graph", "-T", "commit_id")).toBe(mainBefore);
    }
  },
  60_000,
);

testMerge(
  "同名未合 PR 存在时不进入恢复清理",
  () => {
    const { root } = fixture();
    const result = merge(root, { FIXTURE_RECOVERY: "1", FIXTURE_OPEN_PR: "1" });
    expect(result.code, result.output).not.toBe(0);
    const writes = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(writes).not.toContain('"push"');
    expect(jj(root, "log", "-r", "codex/fixture", "--no-graph", "-T", "commit_id")).toMatch(
      /^[a-f0-9]{40}$/,
    );
  },
  20_000,
);

testMerge(
  "帮助不连接远端,缺少书签时直接拒绝参数",
  () => {
    const { root } = fixture();
    const cli = join(root, "scripts/pr-merge.ts");
    const help = command(root, [process.execPath, cli, "--help"]);
    expect(help.code, help.output).toBe(0);
    expect(help.output).toContain("--expect");

    const invalid = command(root, [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      cli,
      "--title",
      "不是书签",
    ]);
    expect(invalid.code, invalid.output).toBe(2);
    expect(invalid.output).toContain("书签");
    expect(() => readFileSync(join(root, "tmp/remote.log"), "utf8")).toThrow();
  },
  20_000,
);

testMerge(
  "远端恢复查询返回空内容时停止,不推送或创建 PR",
  () => {
    const { root } = fixture();
    const result = merge(root, { FIXTURE_EMPTY_GH: "1" });
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("解析失败");
    const writes = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(writes).not.toContain('"push"');
    expect(writes).not.toContain('"create"');
  },
  20_000,
);

testMerge(
  "正文不存在时在归拢提交前停止",
  () => {
    const { root } = fixture();
    const before = jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
    const target = jj(root, "log", "-r", "codex/fixture", "--no-graph", "-T", "commit_id");
    const result = command(root, [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      join(root, "scripts/pr-merge.ts"),
      "codex/fixture",
      "--create-only",
      "--expect",
      "docs/note.md",
      "--expect",
      "test/infra/canary.test.ts",
      "--body-file",
      "tmp/missing.md",
    ]);
    expect(result.code, result.output).not.toBe(0);
    expect(jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id")).toBe(before);
    expect(jj(root, "log", "-r", "codex/fixture", "--no-graph", "-T", "commit_id")).toBe(target);
  },
  20_000,
);

testMerge(
  "文件集不符时列出缺失与多出的路径并拒绝推送",
  () => {
    const { root } = fixture();
    const result = command(root, [
      process.execPath,
      "--preload",
      join(root, "tmp/remote-boundary.ts"),
      join(root, "scripts/pr-merge.ts"),
      "codex/fixture",
      "--create-only",
      "--expect",
      "docs/note.md",
      "--expect",
      "docs/missing.md",
    ]);
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain("test/infra/canary.test.ts");
    expect(result.output).toContain("docs/missing.md");
    const writes = readFileSync(join(root, "tmp/remote.log"), "utf8");
    expect(writes).not.toContain('"push"');
  },
  20_000,
);

testMerge(
  "合入后及中断恢复仅删除本票远端书签,其他待删除书签不受影响",
  () => {
    for (const alreadyDeleted of [false, true]) {
      const { root, remote } = fixture();
      jj(root, "bookmark", "set", "codex/other", "-r", "codex/fixture");
      jj(
        root,
        "git",
        "push",
        "--allow-empty-description",
        "--bookmark",
        "codex/fixture",
        "--bookmark",
        "codex/other",
      );
      jj(root, "bookmark", "delete", "codex/other");
      if (alreadyDeleted) jj(root, "bookmark", "delete", "codex/fixture");

      const recovered = merge(root, { FIXTURE_RECOVERY: "1", FIXTURE_REAL_PUSH: "1" });
      expect(recovered.code, recovered.output).toBe(0);
      expect(() => readFileSync(join(root, "tmp/checks.log"), "utf8")).toThrow();
      const refs = command(root, [
        "git",
        "--git-dir",
        remote,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads/codex",
      ]);
      expect(refs.code, refs.output).toBe(0);
      expect(refs.output).toContain("refs/heads/codex/other");
      expect(refs.output).not.toContain("refs/heads/codex/fixture");
    }
  },
  60_000,
);

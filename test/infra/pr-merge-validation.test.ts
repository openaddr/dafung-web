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
    'import { appendFileSync, readFileSync } from "node:fs"; appendFileSync("tmp/checks.log", `${process.argv[2]}\\n`); if (process.argv[2] === "build" && process.env.EXPECT_NOTE && readFileSync("docs/note.md", "utf8").trim() !== process.env.EXPECT_NOTE) process.exit(12);',
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
  // preload 替换出站命令与显式注入的收账失败;其余本地 jj 操作真实运行。
  writeFileSync(
    join(root, "tmp/remote-boundary.ts"),
    `import { appendFileSync } from "node:fs";
const spawn = Bun.spawnSync;
Bun.spawnSync = (args, options) => {
  const failMove = args[0] === "jj" && args[1] === "bookmark" && args[2] === "move" && args[3] === "master" && process.env.FIXTURE_FAIL_MOVE;
  const remote = failMove || args[0] === "gh" || (args[0] === "jj" && args[1] === "git" && (args[2] === "push" || (args[2] === "fetch" && process.env.FIXTURE_FAIL_FETCH)));
  if (!remote) return spawn(args, options);
  appendFileSync("tmp/remote.log", JSON.stringify(args) + "\\n");
  if (args[0] === "jj" && args[2] === "fetch") return { stdout: Buffer.alloc(0), stderr: Buffer.from("fixture fetch failed"), exitCode: 1 };
  if (failMove) return { stdout: Buffer.alloc(0), stderr: Buffer.from("fixture move failed"), exitCode: 1 };
  if (args[0] === "jj" && process.env.FIXTURE_REAL_PUSH) return spawn(args, options);
  let output = "";
  if (args[0] === "gh") {
    if (args.includes("list") && args.includes("open")) output = process.env.FIXTURE_OPEN_PR ? JSON.stringify([{url:"https://github.com/fixture/repo/pull/43"}]) : "[]";
    else if (args.includes("list")) output = process.env.FIXTURE_EMPTY_GH ? "" : process.env.FIXTURE_RECOVERY ? JSON.stringify([{url:"https://github.com/fixture/repo/pull/42", mergedAt:new Date().toISOString()}]) : "[]";
    else if (args.includes("create")) output = "https://github.com/fixture/repo/pull/42";
    else if (process.env.FIXTURE_COMPLETE && args.includes("merge")) output = "";
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
  "自动归拢收口保留旧链上其他工作区与书签",
  () => {
    const { root, base, middle } = fixture();
    const other = join(root, "tmp/other-workspace");
    jj(root, "bookmark", "set", "other-work", "-r", middle);
    jj(root, "workspace", "add", "--name", "other", "--revision", middle, other);
    const before = jj(other, "log", "-r", "@", "--no-graph", "-T", "commit_id");
    const file = receipt(root, base);
    const result = command(
      root,
      [
        process.execPath,
        "--preload",
        join(root, "tmp/remote-boundary.ts"),
        join(ROOT, "scripts/pr-merge.ts"),
        "codex/fixture",
        "--expect",
        "docs/note.md",
        "--expect",
        "test/infra/canary.test.ts",
        "--validation-receipt",
        file,
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
  "无回执时同树工作区安全起空层并保留原提交",
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
  "无回执检查目标树而不是当前空停靠的基线",
  () => {
    const { root, base } = fixture();
    jj(root, "new", base, "-m", "单提交");
    writeFileSync(join(root, "docs/note.md"), "目标树\n");
    jj(root, "bookmark", "move", "codex/fixture", "--to", "@", "--allow-backwards");
    jj(root, "new", base);
    const result = command(
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
      ],
      { EXPECT_NOTE: "目标树" },
    );
    expect(result.code, result.output).toBe(0);
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
          join(ROOT, "scripts/pr-merge.ts"),
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
    const result = merge(root, undefined, { FIXTURE_RECOVERY: "1", FIXTURE_OPEN_PR: "1" });
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
    const cli = join(ROOT, "scripts/pr-merge.ts");
    const help = command(root, [process.execPath, cli, "--help"]);
    expect(help.code, help.output).toBe(0);
    expect(help.output).toContain("--validation-receipt");

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
    const result = merge(root, undefined, { FIXTURE_EMPTY_GH: "1" });
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
      join(ROOT, "scripts/pr-merge.ts"),
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
      join(ROOT, "scripts/pr-merge.ts"),
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
    expect(writes).toContain('"push","--bookmark","exact:codex/fixture"');
    expect(writes).not.toContain('"create"');
    expect(writes).not.toContain('"merge"');
  },
  60_000,
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

      const recovered = merge(root, undefined, { FIXTURE_RECOVERY: "1", FIXTURE_REAL_PUSH: "1" });
      expect(recovered.code, recovered.output).toBe(0);
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

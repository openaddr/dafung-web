// #1439:真实 CLI + 临时 jj 仓守选择、退出与结果绑定,产品检查仅在临时 package 替换。
// 每例包含 jj 初始化/快照与多个 CLI 进程,按真实进程 >=3s 判据入慢池;
// 默认池不启动子进程。普通/协议生产变更/未知域/失败与改码失效均经公开命令验证。
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = join(ROOT, "scripts/validate.ts");
const roots: string[] = [];
const testValidation = test.skipIf(!process.env.DAFUNG_SLOW);

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

function fixture(files: Record<string, string> = {}) {
  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  const root = mkdtempSync(join(ROOT, "tmp/validation-selection-"));
  roots.push(root);
  for (const dir of ["scripts", "docs", "tmp"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, ".gitignore"), "tmp/\n");
  writeFileSync(join(root, "docs/note.md"), "原说明\n");
  writeFileSync(
    join(root, "scripts/fixture-check.ts"),
    'import { appendFileSync } from "node:fs"; const id = process.argv[2]; appendFileSync("tmp/checks.log", `${id}\\n`); console.log(id); if (id === "lint" && process.env.FIXTURE_FAIL) process.exit(23);',
  );
  const scripts = Object.fromEntries(
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
    ].map((id) => [id, `bun scripts/fixture-check.ts ${id}`]),
  );
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  jj(root, "git", "init");
  jj(root, "config", "set", "--repo", "user.name", "Fixture");
  jj(root, "config", "set", "--repo", "user.email", "fixture@example.invalid");
  jj(root, "metaedit", "--update-author");
  const base = jj(root, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  jj(root, "new");
  return { root, base };
}

function run(root: string, ...args: string[]) {
  return command(root, [process.execPath, CLI, ...args]);
}

testValidation(
  "预览默认简洁,完整 JSON 保留文件与理由且基础检查不逐文件重复",
  () => {
    const { root, base } = fixture();
    for (let i = 0; i < 12; i++) writeFileSync(join(root, `docs/change-${i}.md`), "变更\n");

    const preview = run(root, "plan", "--base", base);
    expect(preview.code, preview.output).toBe(0);
    expect(preview.output).toContain("12");
    expect(preview.output).toContain("lint");
    expect(preview.output.length).toBeLessThan(1200);

    const detail = run(root, "plan", "--base", base, "--json");
    expect(detail.code, detail.output).toBe(0);
    const plan = JSON.parse(detail.output);
    expect(plan.changes).toHaveLength(12);
    expect(plan.checks.map((check: { id: string }) => check.id)).toEqual([
      "lint",
      "check:fmt",
      "build",
      "test",
    ]);
    for (const check of plan.checks) expect(check.reasons).toHaveLength(1);
  },
  20_000,
);

testValidation(
  "固定基线的纯注释保留静态基础门,行为门由实质变更或显式 profile 追加且回执仍绑定原文",
  () => {
    const original = "export const value = 1;\n";
    const { root, base } = fixture({
      "src/core/authority.ts": original,
      "scripts/room.ts": original,
    });
    for (const path of ["src/core/authority.ts", "scripts/room.ts"])
      writeFileSync(join(root, path), `// 新说明\n${original}`);
    const preview = run(root, "plan", "--base", base, "--json");
    expect(preview.code, preview.output).toBe(0);
    const ids = JSON.parse(preview.output).checks.map((check: { id: string }) => check.id);
    expect(ids).toEqual(["lint", "check:fmt", "build", "test", "typecheck:scripts", "check:core"]);

    const explicit = run(
      root,
      "plan",
      "--base",
      base,
      "--profile",
      "engine",
      "--profile",
      "economy",
      "--profile",
      "protocol",
      "--profile",
      "recovery",
      "--json",
    );
    expect(explicit.code, explicit.output).toBe(0);
    expect(JSON.parse(explicit.output).checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining([
        "check:goldens",
        "check:sim-bench",
        "test:protocol",
        "test:recovery",
      ]),
    );

    const receipt = join(root, "tmp/comments.json");
    const executed = run(root, "run", "--base", base, "--out", receipt);
    expect(executed.code, executed.output).toBe(0);
    writeFileSync(join(root, "scripts/room.ts"), `// 再改说明\n${original}`);
    const stale = run(root, "verify", receipt);
    expect(stale.code, stale.output).not.toBe(0);
    expect(stale.output).toContain("内容已变化");

    writeFileSync(join(root, "src/core/authority.ts"), "export const value: number = 1;\n");
    rmSync(join(root, "scripts/room.ts"));
    writeFileSync(join(root, "scripts/wire.ts"), "// 新增文件仍是实质变更\n");
    writeFileSync(
      join(root, "scripts/change-classification.ts"),
      "export const classify = true;\n",
    );
    const changed = run(root, "plan", "--base", base, "--json");
    expect(changed.code, changed.output).toBe(0);
    const checks = JSON.parse(changed.output).checks;
    expect(checks.map((check: { id: string }) => check.id)).toEqual(
      expect.arrayContaining([
        "typecheck:scripts",
        "check:core",
        "check:goldens",
        "check:sim-bench",
        "test:protocol",
        "test:recovery",
      ]),
    );
    expect(
      checks.find((check: { id: string }) => check.id === "test:protocol").reasons,
    ).toContainEqual({ path: "scripts/wire.ts", reason: "protocol 生产影响域" });
    expect(
      checks.find((check: { id: string }) => check.id === "test:recovery").reasons,
    ).toContainEqual({ path: "scripts/room.ts", reason: "recovery 生产影响域" });
  },
  30_000,
);

testValidation(
  "普通变更预览与执行绑定当前内容,描述变化仍有效而改码后旧结果拒绝",
  () => {
    const { root, base } = fixture();
    writeFileSync(join(root, "docs/note.md"), "新说明\n");
    const preview = run(root, "plan", "--base", base, "--json");
    expect(preview.code, preview.output).toBe(0);
    const plan = JSON.parse(preview.output);
    expect(plan.checks.map((check: { id: string }) => check.id)).toEqual([
      "lint",
      "check:fmt",
      "build",
      "test",
    ]);
    expect(plan.changes).toEqual(["docs/note.md"]);
    const receipt = join(root, "tmp/ordinary.json");
    const executed = run(root, "run", "--base", base, "--out", receipt);
    expect(executed.code, executed.output).toBe(0);
    const result = JSON.parse(readFileSync(receipt, "utf8"));
    expect(result.base.commit).toBe(base);
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.results.map((check: { exitCode: number }) => check.exitCode)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(run(root, "verify", receipt).code).toBe(0);
    expect(run(root, "run", "--base", base, "--out", receipt).code).not.toBe(0);
    jj(root, "describe", "-m", "只改描述");
    expect(run(root, "verify", receipt).code).toBe(0);
    writeFileSync(join(root, "docs/note.md"), "再次修改\n");
    const stale = run(root, "verify", receipt);
    expect(stale.code, stale.output).not.toBe(0);
    expect(stale.output).toContain("内容已变化");
  },
  30_000,
);

testValidation(
  "只改生产协议也选定向慢例,影响域叠加后检查不重复",
  () => {
    const { root, base } = fixture();
    writeFileSync(join(root, "scripts/wire.ts"), 'export const protocol = "changed";\n');
    const preview = run(root, "plan", "--base", base, "--profile", "recovery", "--json");
    expect(preview.code, preview.output).toBe(0);
    const plan = JSON.parse(preview.output);
    const ids = plan.checks.map((check: { id: string }) => check.id);
    expect(ids).toContain("typecheck:scripts");
    expect(ids).toContain("test:protocol");
    expect(ids).toContain("test:recovery");
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.changes).toEqual(["scripts/wire.ts"]);
    const protocol = plan.checks.find((check: { id: string }) => check.id === "test:protocol");
    expect(protocol.env.DAFUNG_SLOW).toBe("1");
    expect(protocol.command.slice(1)).toEqual([
      "scripts/bun-release.ts",
      "--files",
      "test/online/protocol-online.test.ts",
      "test/online/server-cmd-error.test.ts",
    ]);
    expect(protocol.reasons).toContainEqual({
      path: "scripts/wire.ts",
      reason: "protocol 生产影响域",
    });
    expect(ids).not.toContain("test:e2e");
    writeFileSync(join(root, "scripts/build-dist.ts"), "// 构建生产入口变化\n");
    writeFileSync(join(root, "scripts/bun-release.ts"), "// 放行守门变化\n");
    writeFileSync(join(root, "scripts/validate.ts"), "// 验证生产入口变化\n");
    writeFileSync(join(root, "scripts/pr-merge-cleanup.ts"), "// 合并收账变化\n");
    writeFileSync(join(root, "scripts/sim-bench.ts"), "export const changed = true;\n");
    mkdirSync(join(root, "test/infra"), { recursive: true });
    writeFileSync(join(root, "test/infra/build-dist.test.ts"), "// DAFUNG_SLOW 的现有慢例变化\n");
    const extended = run(root, "plan", "--base", base, "--json");
    expect(extended.code, extended.output).toBe(0);
    const selected = JSON.parse(extended.output).checks;
    expect(selected.map((check: { id: string }) => check.id)).toContain("test:build");
    expect(selected.map((check: { id: string }) => check.id)).toContain("test:release-guard");
    expect(selected.map((check: { id: string }) => check.id)).toContain("test:validation");
    expect(selected.map((check: { id: string }) => check.id)).toContain("check:sim-bench");
    expect(
      selected.find((check: { id: string }) => check.id === "test:validation").reasons,
    ).toContainEqual({
      path: "scripts/pr-merge-cleanup.ts",
      reason: "validation 生产影响域",
    });
    expect(
      selected.filter((check: { command: string[] }) =>
        check.command.includes("test/infra/build-dist.test.ts"),
      ),
    ).toHaveLength(1);
  },
  20_000,
);

testValidation(
  "未知域显式分类,UI变更只走无浏览器检查且旧浏览器参数被拒绝",
  () => {
    const { root, base } = fixture();
    mkdirSync(join(root, "deployment"));
    writeFileSync(join(root, "deployment/future.conf"), "unknown\n");
    const unknown = run(root, "plan", "--base", base);
    expect(unknown.code, unknown.output).not.toBe(0);
    expect(unknown.output).toContain("未知影响域:deployment/future.conf");
    mkdirSync(join(root, "src/app/screens/mystery"), { recursive: true });
    writeFileSync(
      join(root, "src/app/screens/mystery/View.tsx"),
      "export const View = () => null;\n",
    );
    const ui = run(root, "plan", "--base", base, "--profile", "ordinary", "--json");
    expect(ui.code, ui.output).toBe(0);
    expect(JSON.parse(ui.output).checks.map((check: { id: string }) => check.id)).toEqual([
      "lint",
      "check:fmt",
      "build",
      "test",
    ]);
    expect(ui.output).not.toContain("playwright");
    expect(run(root, "plan", "--base", base, "--e2e", "retired.spec.ts").code).not.toBe(0);
  },
  20_000,
);

testValidation(
  "子检查exit23透传并保存失败记录,失败或未完成结果不能verify",
  () => {
    const { root, base } = fixture();
    writeFileSync(join(root, "docs/note.md"), "修改说明\n");
    const receipt = join(root, "tmp/failed.json");
    const failed = command(root, [process.execPath, CLI, "run", "--base", base, "--out", receipt], {
      FIXTURE_FAIL: "1",
    });
    expect(failed.code, failed.output).toBe(23);
    const result = JSON.parse(readFileSync(receipt, "utf8"));
    expect(result.status).toBe("failed");
    expect(result.results.map((check: { exitCode: number }) => check.exitCode)).toEqual([23]);
    expect(result.results[0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(run(root, "verify", receipt).code).not.toBe(0);
    result.status = "running";
    writeFileSync(receipt, JSON.stringify(result));
    expect(run(root, "verify", receipt).code).not.toBe(0);
  },
  20_000,
);

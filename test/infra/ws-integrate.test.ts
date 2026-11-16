import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../scripts/ws-integrate.ts", import.meta.url));
const fixtures: string[] = [];

function jj(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    [
      "jj",
      '--config=user.name="Workspace Test"',
      '--config=user.email="ws@example.invalid"',
      ...args,
    ],
    { cwd },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function revision(cwd: string, revset = "@"): string {
  return jj(cwd, "log", "-r", revset, "--no-graph", "-T", "commit_id");
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "dafung-ws-integrate-"));
  fixtures.push(scratch);
  const main = join(scratch, "repo");
  const workspace = join(scratch, "work");
  mkdirSync(main);
  jj(main, "git", "init", "--colocate");
  writeFileSync(join(main, "删除 空格.txt"), "待删除");
  writeFileSync(join(main, "shared.txt"), "基线");
  jj(main, "describe", "-m", "冻结基线");
  const base = revision(main);
  jj(main, "new", base, "-m", "子票交付");
  rmSync(join(main, "删除 空格.txt"));
  writeFileSync(join(main, "shared.txt"), "子票内容");
  const bytes = Buffer.from([1, 0, 2, 255]);
  writeFileSync(join(main, "added [平].bin"), bytes);
  const delivery = revision(main);

  jj(main, "workspace", "add", "--revision", base, workspace);
  writeFileSync(join(workspace, "sibling.txt"), "兄弟票内容");
  jj(workspace, "describe", "-m", "集成尖端");
  const onto = revision(workspace);
  return { main, workspace, base, delivery, onto, bytes };
}

function integrate(
  {
    workspace,
    base,
    delivery,
    onto,
  }: Pick<ReturnType<typeof fixture>, "workspace" | "base" | "delivery" | "onto">,
  paths: string[],
) {
  return Bun.spawnSync(
    [
      process.execPath,
      cli,
      "--base",
      base,
      "--delivery",
      delivery,
      "--onto",
      onto,
      ...paths.flatMap((path) => ["--expect", path]),
    ],
    { cwd: workspace },
  );
}

const expected = ["added [平].bin", "删除 空格.txt", "shared.txt"];

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true });
});

test("定点接入增删与二进制文件，保留兄弟票，重试复用同一提交", () => {
  const f = fixture();
  const first = integrate(f, expected);
  expect(first.stderr.toString()).toBe("");
  expect(first.exitCode).toBe(0);
  const commit = revision(f.workspace);
  expect(JSON.parse(first.stdout.toString())).toEqual({ parent: f.onto, commit, pathCount: 3 });
  expect(revision(f.workspace, "@-")).toBe(f.onto);
  expect(readFileSync(join(f.workspace, "added [平].bin"))).toEqual(f.bytes);
  expect(existsSync(join(f.workspace, "删除 空格.txt"))).toBe(false);
  expect(readFileSync(join(f.workspace, "shared.txt"), "utf8")).toBe("子票内容");
  expect(readFileSync(join(f.workspace, "sibling.txt"), "utf8")).toBe("兄弟票内容");
  const repeated = integrate(f, expected);
  expect(repeated.exitCode).toBe(0);
  expect(repeated.stdout.toString()).toBe(first.stdout.toString());
  expect(revision(f.workspace)).toBe(commit);
});

test("主树、文件集不符或兄弟票覆盖时拒绝写入", () => {
  const f = fixture();
  const main = integrate({ ...f, workspace: f.main }, expected);
  expect(main.exitCode).toBe(1);
  expect(main.stderr.toString()).toContain("主树只读停靠");
  expect(revision(f.main)).toBe(f.delivery);
  const partial = integrate(f, ["shared.txt"]);
  expect(partial.exitCode).toBe(1);
  expect(partial.stderr.toString()).toContain("交付文件集不符");
  expect(revision(f.workspace)).toBe(f.onto);
  writeFileSync(join(f.workspace, "shared.txt"), "兄弟票已经修改");
  const onto = revision(f.workspace);
  const overlap = integrate({ ...f, onto }, expected);
  expect(overlap.exitCode).toBe(1);
  expect(overlap.stderr.toString()).toContain('集成树已改动声明路径：["shared.txt"]');
  expect(revision(f.workspace)).toBe(onto);
  expect(readFileSync(join(f.workspace, "shared.txt"), "utf8")).toBe("兄弟票已经修改");
});

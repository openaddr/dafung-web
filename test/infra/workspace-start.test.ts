// 真实 ws-new CLI + 本地 jj/裸远端，守固定起基与参数拒绝；不访问网络。
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../scripts/ws-new.ts");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function command(cwd: string, args: string[]) {
  const child = Bun.spawnSync(args, { cwd });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}

function jj(cwd: string, ...args: string[]) {
  const result = command(cwd, ["jj", ...args]);
  expect(result.code, result.output).toBe(0);
  return result.output.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dafung-workspace-start-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "package.json"), '{"name":"workspace-start-fixture","private":true}\n');
  jj(
    repo,
    "--config",
    "user.name=Fixture",
    "--config",
    "user.email=fixture@example.com",
    "git",
    "init",
  );
  jj(repo, "config", "set", "--repo", "user.name", "Fixture");
  jj(repo, "config", "set", "--repo", "user.email", "fixture@example.com");
  jj(repo, "describe", "-m", "远端基线");
  const master = jj(repo, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  jj(repo, "bookmark", "set", "master");
  const remote = join(root, "origin.git");
  const initialized = command(root, ["git", "init", "--bare", remote]);
  expect(initialized.code, initialized.output).toBe(0);
  jj(repo, "git", "remote", "add", "origin", remote);
  jj(repo, "git", "push", "--bookmark", "master");
  jj(repo, "new", "-m", "集成快照");
  writeFileSync(join(repo, "integration.txt"), "集成快照\n");
  const integration = jj(repo, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  jj(repo, "bookmark", "set", "integration");
  jj(repo, "new", "master", "-m", "主树停靠");
  const parked = jj(repo, "log", "-r", "@", "--no-graph", "-T", "commit_id");
  return { root, repo, remote, master, integration, parked };
}

function start(repo: string, ...args: string[]) {
  return command(repo, [process.execPath, CLI, ...args]);
}

test("显式 revision 从集成快照起基，书签后移不改写已建立工作区", () => {
  const { root, repo, integration, parked } = fixture();
  const result = start(repo, "fixed", "--revision", "integration");
  expect(result.code, result.output).toBe(0);
  const workspace = join(root, "dafung-web-ws-fixed");
  expect(jj(workspace, "log", "-r", "@-", "--no-graph", "-T", "commit_id")).toBe(integration);
  expect(existsSync(join(workspace, "tmp"))).toBe(true);
  jj(repo, "bookmark", "move", "integration", "--to", "@", "--allow-backwards");
  expect(jj(workspace, "log", "-r", "@-", "--no-graph", "-T", "commit_id")).toBe(integration);
  expect(jj(repo, "log", "-r", "@", "--no-graph", "-T", "commit_id")).toBe(parked);
});

test("坏参数和非唯一 revision 在建仓前显式失败", () => {
  const { root, repo } = fixture();
  for (const args of [
    [],
    ["missing-revision", "--revision"],
    ["option-value", "--revision", "--unknown"],
    ["extra", "surplus"],
    ["unknown", "--extra"],
    ["duplicate", "--revision", "integration", "--revision", "integration"],
    ["slash/name"],
    ["back\\name"],
    ["--revision", "integration"],
  ]) {
    const result = start(repo, ...args);
    expect(result.code, `${args.join(" ")}\n${result.output}`).toBe(2);
  }
  for (const revision of ["master | integration", "none()", "missing-bookmark"]) {
    const result = start(repo, "invalid-revision", "--revision", revision);
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain("revision");
  }
  expect(jj(repo, "workspace", "list")).not.toContain("dafung-web-ws-");
  expect(existsSync(join(root, "dafung-web-ws-invalid-revision"))).toBe(false);
});

test("缺省入口 fetch 后从最新 master@origin 起基，保留主树停靠提交", () => {
  const { root, repo, remote, master, parked } = fixture();
  const advanced = command(repo, [
    "git",
    "--git-dir",
    remote,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit-tree",
    `${master}^{tree}`,
    "-p",
    master,
    "-m",
    "远端推进",
  ]);
  expect(advanced.code, advanced.output).toBe(0);
  const tip = advanced.output.trim();
  const moved = command(repo, ["git", "--git-dir", remote, "update-ref", "refs/heads/master", tip]);
  expect(moved.code, moved.output).toBe(0);
  expect(jj(repo, "log", "-r", "master@origin", "--no-graph", "-T", "commit_id")).toBe(master);

  const result = start(repo, "default");
  expect(result.code, result.output).toBe(0);
  expect(
    jj(join(root, "dafung-web-ws-default"), "log", "-r", "@-", "--no-graph", "-T", "commit_id"),
  ).toBe(tip);
  expect(jj(repo, "log", "-r", "@", "--no-graph", "-T", "commit_id")).toBe(parked);
});

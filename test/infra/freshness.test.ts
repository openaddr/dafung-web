// 真实 jj 工作区注册边界;只用本地 bare 远端,不访问网络。多进程归入定向慢池。
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function command(root: string, args: string[]) {
  const child = Bun.spawnSync(args, {
    cwd: root,
    env: { ...process.env, JJ_USER: "Infra test", JJ_EMAIL: "infra@example.invalid" },
  });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}

function jj(root: string, ...args: string[]) {
  const result = command(root, ["jj", ...args]);
  expect(result.code, result.output).toBe(0);
  return result.output.trim();
}

test.skipIf(!process.env.DAFUNG_SLOW)(
  "次 workspace 的非空 @ 不算主树占用,default 的内容或描述仍拒绝且注册不得缺失",
  () => {
    mkdirSync(join(ROOT, "tmp"), { recursive: true });
    const root = mkdtempSync(join(ROOT, "tmp/freshness-"));
    roots.push(root);
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, "tmp"));
    writeFileSync(join(root, ".gitignore"), "node_modules/\ntmp/\n");
    writeFileSync(join(root, "note.txt"), "base\n");
    jj(root, "git", "init");
    jj(root, "describe", "-m", "基线");
    jj(root, "bookmark", "set", "master");
    const remote = join(root, "tmp/origin.git");
    const initialized = command(root, ["git", "init", "--bare", remote]);
    expect(initialized.code, initialized.output).toBe(0);
    jj(root, "git", "remote", "add", "origin", remote);
    jj(root, "git", "push", "--bookmark", "master");
    jj(root, "new");
    const worker = join(root, "tmp/worker");
    jj(root, "workspace", "add", worker, "--name", "worker", "-r", "master");
    mkdirSync(join(worker, "node_modules"));
    writeFileSync(join(worker, "note.txt"), "worker change\n");
    const check = () =>
      command(worker, [process.execPath, join(ROOT, "scripts/check-freshness.ts"), "--no-fetch"]);
    const ownWork = check();
    expect(ownWork.code, ownWork.output).toBe(0);

    writeFileSync(join(root, "note.txt"), "main change\n");
    jj(root, "st");
    const occupied = check();
    expect(occupied.code, occupied.output).toBe(1);
    expect(occupied.output).toContain("主树 @ 非空");

    jj(root, "restore", "--from", "master", "note.txt");
    jj(root, "describe", "-m", "主树在途话头");
    const described = check();
    expect(described.code, described.output).toBe(1);
    expect(described.output).toContain("主树 @ 空但带描述");

    jj(root, "workspace", "rename", "parked");
    const missing = check();
    expect(missing.code, missing.output).not.toBe(0);
    expect(missing.output).toContain("default 工作区注册缺失");
  },
  30_000,
);

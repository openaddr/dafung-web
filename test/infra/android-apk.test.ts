// 守发布缓存的源码身份与独占性;不拉起原生构建,成本为本地 git 临时仓库。
import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertApkSource, syncApkSource, withApkBuildLock } from "../../scripts/android-apk";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dafung-apk-"));
  roots.push(root);
  const repo = join(root, "repo");
  const cache = join(root, "cache");
  mkdirSync(repo);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  git("init", "--quiet");
  const commit = () => {
    git("add", "-A");
    git(
      "-c",
      "user.name=APK test",
      "-c",
      "user.email=apk@example.com",
      "commit",
      "--quiet",
      "-m",
      "snapshot",
    );
    return git("rev-parse", "HEAD");
  };
  return { root, repo, cache, commit };
}

test("切换固定源码清掉退役文件,保留未变文件时间和构建缓存;内容漂移直接拒绝", () => {
  const f = fixture();
  writeFileSync(join(f.repo, "kept.ts"), "export const kept = 1;\n");
  writeFileSync(join(f.repo, "retired.ts"), "old\n");
  const first = f.commit();
  syncApkSource(first, f.cache, f.repo);
  utimesSync(join(f.cache, "kept.ts"), 1000, 1000);
  mkdirSync(join(f.cache, "src-tauri/target"), { recursive: true });
  writeFileSync(join(f.cache, "src-tauri/target/artifact"), "compiled");
  rmSync(join(f.repo, "retired.ts"));
  writeFileSync(join(f.repo, "added.ts"), "new\n");
  const next = f.commit();
  syncApkSource(next, f.cache, f.repo);
  expect(existsSync(join(f.cache, "retired.ts"))).toBe(false);
  expect(readFileSync(join(f.cache, "added.ts"), "utf8")).toBe("new\n");
  expect(statSync(join(f.cache, "kept.ts")).mtimeMs).toBe(1000000);
  expect(readFileSync(join(f.cache, "src-tauri/target/artifact"), "utf8")).toBe("compiled");
  assertApkSource(next, f.cache, f.repo);
  writeFileSync(join(f.cache, "kept.ts"), "wrong source\n");
  expect(() => assertApkSource(next, f.cache, f.repo)).toThrow("构建源码偏离");
});

test("同一构建缓存独占锁,失败也释放,拒绝者不能删除持有者的锁", async () => {
  const f = fixture();
  await withApkBuildLock(f.cache, "first", async () => {
    await expect(withApkBuildLock(f.cache, "second", async () => {})).rejects.toThrow();
    expect(JSON.parse(readFileSync(`${f.cache}.lock/owner.json`, "utf8")).commit).toBe("first");
  });
  await expect(
    withApkBuildLock(f.cache, "third", async () => {
      throw new Error("build failed");
    }),
  ).rejects.toThrow("build failed");
  expect(existsSync(`${f.cache}.lock`)).toBe(false);
});

test("固定提交之外的环境和 public 输入不能进入 APK", () => {
  const f = fixture();
  mkdirSync(join(f.repo, "public"));
  writeFileSync(join(f.repo, "public/known.txt"), "known");
  const commit = f.commit();
  syncApkSource(commit, f.cache, f.repo);
  for (const name of [".env.production", "public/untracked.txt"]) {
    writeFileSync(join(f.cache, name), "injected");
    expect(() => assertApkSource(commit, f.cache, f.repo)).toThrow("非提交输入");
    rmSync(join(f.cache, name));
  }
});

test("缓存源码可以从目录改为文件,再从文件改为目录", () => {
  const f = fixture();
  mkdirSync(join(f.repo, "shape"));
  writeFileSync(join(f.repo, "shape/child.txt"), "child");
  syncApkSource(f.commit(), f.cache, f.repo);
  rmSync(join(f.repo, "shape"), { recursive: true });
  writeFileSync(join(f.repo, "shape"), "file");
  syncApkSource(f.commit(), f.cache, f.repo);
  expect(readFileSync(join(f.cache, "shape"), "utf8")).toBe("file");
  rmSync(join(f.repo, "shape"));
  mkdirSync(join(f.repo, "shape"));
  writeFileSync(join(f.repo, "shape/new.txt"), "new child");
  syncApkSource(f.commit(), f.cache, f.repo);
  expect(readFileSync(join(f.cache, "shape/new.txt"), "utf8")).toBe("new child");
});

test("固定源码中的 Gradle 启动脚本同步后可直接在 Linux 执行", () => {
  const f = fixture();
  const wrapper = join(f.repo, "gradlew");
  writeFileSync(wrapper, "#!/bin/sh\nprintf 'gradle-ready'\n");
  chmodSync(wrapper, 0o755);
  syncApkSource(f.commit(), f.cache, f.repo);
  const result = Bun.spawnSync([join(f.cache, "gradlew")], { cwd: f.cache });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("gradle-ready");
});

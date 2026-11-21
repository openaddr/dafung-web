import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLocalApkConfig } from "./android-apk";

function output(cwd: string, argv: string[]): string {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`${argv.join(" ")} 失败\n${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

function run(cwd: string, argv: string[]): void {
  const result = Bun.spawnSync(argv, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} 失败 (${result.exitCode})`);
}

export function preparePrRelease(): (feature: string) => void {
  const cwd = process.cwd();
  const jj = (...args: string[]) => output(cwd, ["jj", ...args]).trim();
  const main = jj("workspace", "root", "--name", "default");
  if (main === cwd) throw new Error("请从交付工作区运行 --release");
  if (
    output(main, [
      "jj",
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      'if(empty, "empty", "dirty")',
    ]).trim() !== "empty"
  ) {
    throw new Error("主树有未交付改动，发版需要主树空停靠");
  }
  const { buildRoot } = readLocalApkConfig();
  if (existsSync(`${buildRoot}.lock`)) throw new Error(`APK 构建锁已占用 ${buildRoot}.lock`);

  const rev = (revision: string) => jj("log", "-r", revision, "--no-graph", "-T", "commit_id");
  const pkgAt = (commit: string) => output(cwd, ["git", "show", `${commit}:package.json`]);

  return (feature) => {
    if (!/^[a-f0-9]{40}$/.test(feature)) throw new Error(`无效的功能 PR 合入提交 ${feature}`);
    jj("git", "fetch");
    let master = rev("master@origin");
    const originalPackage = pkgAt(feature);
    const { version: oldVersion } = JSON.parse(originalPackage) as { version: string };
    const match = /^(\d{4}\.[1-9]\d?)\.(\d+)$/.exec(oldVersion);
    if (!match) throw new Error(`非法版本 ${oldVersion}`);
    const version = `${match[1]}.${BigInt(match[2]!) + 1n}`;
    const updatedPackage = originalPackage.replace(
      /("version"\s*:\s*")([^"\n]+)(")/,
      (_entry, prefix: string, _version, suffix: string) => `${prefix}${version}${suffix}`,
    );
    if (updatedPackage === originalPackage || JSON.parse(updatedPackage).version !== version) {
      throw new Error("无法更新 package.json 的版本号");
    }
    const bookmark = `codex/release-${version}-${feature.slice(0, 12)}`;
    const localBump = rev(`bookmarks(exact:"${bookmark}")`);

    const assertBump = (commit: string) => {
      if (
        rev(`${commit}-`) !== feature ||
        jj("diff", "-r", commit, "--name-only") !== "package.json" ||
        pkgAt(commit) !== updatedPackage
      ) {
        throw new Error(`${commit} 不匹配功能提交 ${feature} 的版本变更 v${version}`);
      }
    };

    if (master !== feature) assertBump(master);
    if (master === feature) {
      if (output(cwd, ["git", "ls-remote", "origin", `refs/tags/v${version}`]).trim()) {
        throw new Error(`远端标签 v${version} 已存在，请核对版本号`);
      }
      const current = rev("@");
      const empty = jj("log", "-r", "@", "--no-graph", "-T", 'if(empty, "yes", "no")') === "yes";
      if (localBump) {
        assertBump(localBump);
        if (current !== localBump && rev("@-") !== localBump) {
          if (!empty) throw new Error("交付工作区有其他改动，版本 PR 已保留");
          jj("new", localBump);
        }
      } else {
        if (empty) {
          if (rev("@-") !== feature) throw new Error("交付工作区尚未停靠到功能合入提交");
          writeFileSync(join(cwd, "package.json"), updatedPackage);
          jj("st");
          console.log(jj("diff", "--stat"));
        }
        assertBump(rev("@"));
        jj("describe", "-m", `chore(release): v${version}`);
        jj("bookmark", "create", bookmark);
      }
    }

    if (master === feature || localBump) {
      run(cwd, [process.execPath, "scripts/pr-merge.ts", bookmark, "--expect", "package.json"]);
      master = rev("master@origin");
      assertBump(master);
    }

    console.log(`[pr-release] 发布 v${version}，提交 ${master}`);
    run(main, [process.execPath, "run", "release", "--commit", master]);
    const report = JSON.parse(
      readFileSync(join(main, "tmp/release", master, "report.json"), "utf8"),
    ) as {
      downloadUrl: string;
      sha256: string;
    };
    console.log(`[pr-release] ${report.downloadUrl}\n[pr-release] SHA-256 ${report.sha256}`);
  };
}

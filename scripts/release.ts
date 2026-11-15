// 唯一发布入口:固定提交 → arm64 APK → 签名/核验 → tag/GitHub Release。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildApk, readApkConfig, withApkBuildLock } from "./android-apk";

const REPO = "openaddr/dafung-web";

function run(argv: string[]): string {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(
      `${argv.join(" ")} 失败:\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  return result.stdout.toString().trim();
}

async function release(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set<string>();
  for (const arg of args) {
    if (["--draft", "--dry-run", "--build-only"].includes(arg) && !flags.has(arg)) {
      flags.add(arg);
    } else throw new Error(`未知或重复参数:${arg}`);
  }
  if (flags.has("--draft") && flags.has("--build-only"))
    throw new Error("--draft 与 --build-only 不能并用");
  const config = readApkConfig(join(homedir(), ".config", "dafung-web", "apk.json"));
  const buildOnly = flags.has("--build-only");
  if (!buildOnly) {
    if (run(["jj", "workspace", "root"]) !== resolve(import.meta.dir, ".."))
      throw new Error("请从发布入口所在仓库根目录运行");
    if (run(["jj", "workspace", "root", "--name", "default"]) !== process.cwd())
      throw new Error("正式发版只从主树空停靠运行");
    run(["jj", "git", "fetch"]);
  }
  const commit = run(["jj", "log", "-r", "@-", "--no-graph", "-T", "commit_id"]);
  if (run(["jj", "log", "-r", "@", "--no-graph", "-T", 'if(empty, "empty", "dirty")']) !== "empty")
    throw new Error("@ 必须为空停靠;先 describe 固定源码,再 jj new 留出停靠层");
  if (
    !buildOnly &&
    commit !== run(["jj", "log", "-r", "master@origin", "--no-graph", "-T", "commit_id"])
  )
    throw new Error("发布父提交不是最新 master@origin,先收账对齐");
  const pkg = JSON.parse(run(["git", "show", `${commit}:package.json`])) as { version: string };
  if (!/^\d{4}\.[1-9]\d?\.\d+$/.test(pkg.version)) throw new Error(`非法版本:${pkg.version}`);
  const tag = `v${pkg.version}`;
  const assertNewTag = () => {
    if (run(["git", "ls-remote", "origin", `refs/tags/${tag}`]))
      throw new Error(`远端已有 ${tag},先 bump package.json 并经 PR 合入`);
    run(["gh", "auth", "status"]);
  };
  if (!buildOnly) assertNewTag();
  console.log(`[release] commit=${commit} tag=${tag};仅构建/交付 arm64 APK`);
  if (flags.has("--dry-run")) return;

  await withApkBuildLock(config.buildRoot, commit, async () => {
    if (!buildOnly) assertNewTag();
    const out = resolve("tmp/release", commit);
    mkdirSync(out, { recursive: true });
    const report = buildApk(config, commit, tag, out);
    if (!buildOnly) {
      const localTag = Bun.spawnSync(["git", "rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
      if (localTag.exitCode === 0 && localTag.stdout.toString().trim() !== commit)
        throw new Error(`本地 ${tag} 指向其他提交,人工核对后处理`);
      if (localTag.exitCode !== 0) run(["git", "tag", tag, commit]);
      run(["git", "push", "origin", `refs/tags/${tag}`]);
      const create = [
        "gh",
        "release",
        "create",
        tag,
        report.apk,
        "--repo",
        REPO,
        "--verify-tag",
        "--generate-notes",
        "--title",
        tag,
      ];
      if (flags.has("--draft")) create.push("--draft");
      run(create);
      const remote = JSON.parse(run(["gh", "api", `repos/${REPO}/releases/tags/${tag}`])) as {
        html_url: string;
        assets: { name: string; size: number; digest: string; browser_download_url: string }[];
      };
      const [asset] = remote.assets;
      if (
        remote.assets.length !== 1 ||
        !asset ||
        asset.name !== `${tag}-aarch64.apk` ||
        asset.size !== report.size ||
        asset.digest !== `sha256:${report.sha256}`
      )
        throw new Error("远端 Release 资产或 SHA256 与本地 APK 不一致");
      Object.assign(report, {
        releaseUrl: remote.html_url,
        downloadUrl: asset.browser_download_url,
      });
      console.log(`[release] ${asset.browser_download_url}`);
    }
    if (createHash("sha256").update(readFileSync(report.apk)).digest("hex") !== report.sha256)
      throw new Error("交付前 APK 内容发生变化");
    writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[release] 完成:${report.apk};SHA256=${report.sha256}`);
  });
}

release().catch((error: unknown) => {
  console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

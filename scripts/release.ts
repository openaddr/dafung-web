// 唯一发布入口:固定提交 → arm64 APK → 签名/核验 → tag/GitHub Release。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildApk, readLocalApkConfig, withApkBuildLock } from "./android-apk";

const REPO = "openaddr/dafung-web";
type ReleaseAsset = { name: string; size: number; digest: string; browser_download_url: string };
type GitHubRelease = {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: ReleaseAsset[];
};

function run(argv: string[]): string {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(
      `${argv.join(" ")} 失败:\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  return result.stdout.toString().trim();
}

function releaseByTag(tag: string, allowMissing: boolean): GitHubRelease | undefined {
  const result = Bun.spawnSync(["gh", "api", `repos/${REPO}/releases/tags/${tag}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const error = result.stderr.toString().trim();
  if (result.exitCode === 0) return JSON.parse(result.stdout.toString()) as GitHubRelease;
  if (error.endsWith("(HTTP 404)")) {
    // gh release create 先建草稿再上传。按 tag API 可能查不到未发布草稿。
    const drafts = run([
      "gh",
      "api",
      `repos/${REPO}/releases?per_page=100`,
      "--paginate",
      "--jq",
      `.[] | select(.draft and .tag_name == ${JSON.stringify(tag)})`,
    ]);
    if (drafts) return JSON.parse(drafts) as GitHubRelease;
    if (allowMissing) return undefined;
  }
  throw new Error(`查询 GitHub Release ${tag} 失败 ${error}`);
}

async function release(): Promise<void> {
  const { values, tokens } = parseArgs({
    options: {
      draft: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "build-only": { type: "boolean" },
      commit: { type: "string" },
    },
    tokens: true,
  });
  const names = tokens.flatMap((token) => (token.kind === "option" ? [token.name] : []));
  if (new Set(names).size !== names.length) throw new Error("发版参数不能重复");
  const { draft, commit: fixedCommit, "build-only": buildOnly, "dry-run": dryRun } = values;
  if ((draft && buildOnly) || (fixedCommit !== undefined && (buildOnly || draft)))
    throw new Error("--draft、--build-only 与 --commit 互斥");
  if (fixedCommit !== undefined && !/^[a-f0-9]{40}$/.test(fixedCommit))
    throw new Error("--commit 必须是完整 commit");
  const config = readLocalApkConfig();
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
  if (fixedCommit !== undefined && commit !== fixedCommit)
    throw new Error(`预期发版提交 ${fixedCommit}，当前主树停靠 ${commit}`);
  const pkg = JSON.parse(run(["git", "show", `${commit}:package.json`])) as { version: string };
  if (!/^\d{4}\.[1-9]\d?\.\d+$/.test(pkg.version)) throw new Error(`非法版本:${pkg.version}`);
  const tag = `v${pkg.version}`;
  const hasMatchingTag = () => {
    const ref = `refs/tags/${tag}`;
    const refs = run(["git", "ls-remote", "origin", ref, `${ref}^{}`]);
    if (!refs) return false;
    const targets = new Map(
      refs.split("\n").map((row) => {
        const [oid, name] = row.split("\t");
        return [name, oid];
      }),
    );
    const target = targets.get(`${ref}^{}`) ?? targets.get(ref);
    if (fixedCommit === undefined || target !== commit)
      throw new Error(`远端已有 ${tag},先 bump package.json 并经 PR 合入`);
    return true;
  };
  if (!buildOnly) {
    run(["gh", "auth", "status"]);
    hasMatchingTag();
  }
  console.log(`[release] commit=${commit} tag=${tag};仅构建/交付 arm64 APK`);
  if (dryRun) return;

  await withApkBuildLock(config.buildRoot, commit, async () => {
    const tagged = !buildOnly && hasMatchingTag();
    const out = resolve("tmp/release", commit);
    mkdirSync(out, { recursive: true });
    const buildRecord = join(out, "build.json");
    const apk = join(out, `${tag}-aarch64.apk`);
    const report =
      fixedCommit !== undefined && existsSync(buildRecord)
        ? (JSON.parse(readFileSync(buildRecord, "utf8")) as ReturnType<typeof buildApk>)
        : buildApk(config, commit, tag, out);
    if (
      report.apk !== apk ||
      report.commit !== commit ||
      report.version !== pkg.version ||
      report.certificateSha256 !== config.certificateSha256 ||
      report.size !== statSync(apk).size ||
      createHash("sha256").update(readFileSync(apk)).digest("hex") !== report.sha256
    )
      throw new Error(`APK 与固定提交的构建回执不匹配 ${buildRecord}`);
    if (!buildOnly) {
      if (!tagged) {
        const localTag = Bun.spawnSync([
          "git",
          "rev-parse",
          "--verify",
          `refs/tags/${tag}^{commit}`,
        ]);
        if (localTag.exitCode === 0 && localTag.stdout.toString().trim() !== commit)
          throw new Error(`本地 ${tag} 指向其他提交,人工核对后处理`);
        if (localTag.exitCode !== 0) run(["git", "tag", tag, commit]);
        run(["git", "push", "origin", `refs/tags/${tag}`]);
      }
      let remote = tagged ? releaseByTag(tag, true) : undefined;
      if (!remote) {
        const create = [
          "gh",
          "release",
          "create",
          tag,
          apk,
          "--repo",
          REPO,
          "--verify-tag",
          "--generate-notes",
          "--title",
          tag,
        ];
        if (draft) create.push("--draft");
        run(create);
        remote = releaseByTag(tag, false);
      }
      if (!remote) throw new Error(`未查询到 GitHub Release ${tag}`);

      const assertAsset = (release: GitHubRelease) => {
        const [asset] = release.assets;
        if (
          release.tag_name !== tag ||
          release.prerelease ||
          release.assets.length !== 1 ||
          !asset ||
          asset.name !== `${tag}-aarch64.apk` ||
          asset.size !== report.size ||
          asset.digest !== `sha256:${report.sha256}`
        ) {
          throw new Error("远端 Release 资产或 SHA256 与本地 APK 不一致");
        }
        return asset;
      };
      if (tagged && remote.draft && remote.tag_name === tag && !remote.prerelease) {
        const api = `repos/${REPO}/releases/${remote.id}`;
        if (remote.assets.length === 0) {
          run(["gh", "release", "upload", tag, apk, "--repo", REPO]);
          remote = JSON.parse(run(["gh", "api", api])) as GitHubRelease;
        }
        assertAsset(remote);
        remote = JSON.parse(
          run(["gh", "api", "--method", "PATCH", api, "-F", "draft=false"]),
        ) as GitHubRelease;
      }
      const asset = assertAsset(remote);
      if (remote.draft !== Boolean(draft)) throw new Error("GitHub Release 发布状态不符");
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

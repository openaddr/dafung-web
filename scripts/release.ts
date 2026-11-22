// 唯一发布入口:从固定提交构建 arm64 APK 和服务端发布包，通过同一个 GitHub Release 交付。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { assertApkSource, buildApk, readApkConfig, withApkBuildLock } from "./android-apk";

const REPO = "openaddr/dafung-web";
const RELEASES = `repos/${REPO}/releases`;
type Execute = (argv: string[]) => string;
type Fingerprint = { size: number; sha256: string };
type ReleaseAsset = Fingerprint & { path: string };

interface RemoteRelease {
  id: number;
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; size: number; digest: string | null; browser_download_url: string }[];
}

function run(argv: string[], cwd = process.cwd()): string {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(
      `${argv.join(" ")} 失败:\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  return result.stdout.toString().trim();
}

function assetFingerprint(path: string) {
  const bytes = readFileSync(path);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function assertAssetUnchanged(path: string, expected: Fingerprint): void {
  const actual = assetFingerprint(path);
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw new Error(`交付前资产内容发生变化:${path}`);
  }
}

function remoteTagCommit(ref: string, execute: Execute): string | undefined {
  const output = execute(["git", "ls-remote", "origin", ref, `${ref}^{}`]);
  const refs = new Map(
    output.split("\n").map((row) => {
      const [sha, name] = row.split("\t");
      return [name, sha];
    }),
  );
  return refs.get(`${ref}^{}`) ?? refs.get(ref);
}

function releaseForTag(tag: string, execute: Execute): RemoteRelease | undefined {
  const matches = execute([
    "gh",
    "api",
    RELEASES,
    "--hostname",
    "github.com",
    "--paginate",
    "--jq",
    `.[] | select(.tag_name == ${JSON.stringify(tag)}) | @json`,
  ]);
  if (!matches) return undefined;
  const [first, ...others] = matches.split("\n");
  if (!first || others.length) throw new Error(`同一标签有多个远端 Release:${tag}`);
  const remote = JSON.parse(first) as RemoteRelease;
  if (
    !Number.isSafeInteger(remote.id) ||
    remote.id <= 0 ||
    remote.tag_name !== tag ||
    !remote.html_url
  ) {
    throw new Error(`远端 Release 身份不符:${tag}`);
  }
  return remote;
}

function releaseTarget(tag: string, commit: string, execute: Execute, reusePublished = false) {
  const ref = `refs/tags/${tag}`;
  const local = execute(["git", "tag", "--list", tag]) === tag;
  if (local && execute(["git", "rev-parse", "--verify", `${ref}^{commit}`]) !== commit) {
    throw new Error(`本地 ${tag} 指向其他提交`);
  }
  const remoteCommit = remoteTagCommit(ref, execute);
  if (remoteCommit !== undefined && remoteCommit !== commit) {
    throw new Error(`远端 ${tag} 指向其他提交`);
  }
  const release = releaseForTag(tag, execute);
  if (release) {
    if (release.draft === false && !reusePublished) throw new Error(`远端 ${tag} 已公开发布`);
    if (
      typeof release.draft !== "boolean" ||
      release.prerelease !== false ||
      remoteCommit !== commit
    ) {
      throw new Error(`远端 Release 与固定提交不符:${tag}`);
    }
  }
  return { ref, local, remoteCommit, release };
}

export function publishReleaseAssets(
  tag: string,
  apkReport: Pick<ReturnType<typeof buildApk>, "apk" | "size" | "sha256">,
  serverArchive: ReleaseAsset,
  draft: boolean,
  execute: Execute,
  commit: string,
  reusedPrepared = false,
) {
  const apk = { path: apkReport.apk, size: apkReport.size, sha256: apkReport.sha256 };
  const archive = serverArchive.path;
  if (
    basename(apk.path) !== `${tag}-aarch64.apk` ||
    basename(archive) !== `dafung-server-${tag}.tar.gz`
  ) {
    throw new Error(`待交付资产名称与标签不符:${tag}`);
  }
  const expectedAssets = new Map(
    [apk, serverArchive].map((asset) => [basename(asset.path), asset]),
  );
  const verifyAssets = (remote: RemoteRelease): Map<string, string> => {
    const verified = new Map<string, string>();
    for (const asset of remote.assets) {
      const expected = expectedAssets.get(asset.name);
      if (
        !expected ||
        verified.has(asset.name) ||
        asset.size !== expected.size ||
        asset.digest !== `sha256:${expected.sha256}` ||
        !asset.browser_download_url
      ) {
        throw new Error(`远端 Release 资产与本地文件不一致:${asset.name}`);
      }
      verified.set(asset.name, asset.browser_download_url);
    }
    return verified;
  };
  const reportFor = (remote: RemoteRelease) => {
    const verified = verifyAssets(remote);
    const downloadUrl = verified.get(basename(apk.path));
    const archiveUrl = verified.get(basename(archive));
    if (!downloadUrl || !archiveUrl) throw new Error(`远端 Release 资产缺失:${tag}`);
    return {
      releaseUrl: remote.html_url,
      downloadUrl,
      serverArchive: { ...serverArchive, downloadUrl: archiveUrl },
    };
  };

  assertAssetUnchanged(apk.path, apk);
  assertAssetUnchanged(archive, serverArchive);
  const target = releaseTarget(tag, commit, execute, !draft && reusedPrepared);
  let release = target.release;
  if (release?.draft === false) return reportFor(release);
  if (release) verifyAssets(release);
  if (!target.local) execute(["git", "tag", tag, commit]);
  if (!target.remoteCommit) {
    // 空 lease 只允许新建，避免并发认领的同名标签被覆盖。
    execute([
      "git",
      "push",
      `--force-with-lease=${target.ref}:`,
      "origin",
      `${commit}:${target.ref}`,
    ]);
  }
  if (remoteTagCommit(target.ref, execute) !== commit) {
    throw new Error(`远端 ${tag} 未指向固定提交`);
  }
  if (!release) {
    if (releaseForTag(tag, execute)) throw new Error(`远端 Release 已被其他发布认领:${tag}`);
    release = JSON.parse(
      execute([
        "gh",
        "api",
        RELEASES,
        "--hostname",
        "github.com",
        "--method",
        "POST",
        "-f",
        `tag_name=${tag}`,
        "-f",
        `target_commitish=${commit}`,
        "-f",
        `name=${tag}`,
        "-F",
        "draft=true",
        "-F",
        "generate_release_notes=true",
      ]),
    ) as RemoteRelease;
  }
  const id = release.id;
  const loadDraft = () => {
    const fresh = releaseTarget(tag, commit, execute).release;
    if (!fresh || fresh.id !== id) throw new Error(`远端 Release 草稿身份发生变化:${tag}`);
    return fresh;
  };

  // 按 Release ID 写入，GitHub 会拒绝重名资产，已核验的文件不重传。
  for (const [name, asset] of expectedAssets) {
    if (!verifyAssets(loadDraft()).has(name)) {
      execute([
        "gh",
        "api",
        `https://uploads.github.com/${RELEASES}/${id}/assets?name=${encodeURIComponent(name)}`,
        "--hostname",
        "github.com",
        "--method",
        "POST",
        "--header",
        "Content-Type: application/octet-stream",
        "--input",
        asset.path,
        "--silent",
      ]);
    }
  }
  assertAssetUnchanged(apk.path, apk);
  assertAssetUnchanged(archive, serverArchive);
  const draftReport = reportFor(loadDraft());
  if (draft) return draftReport;
  const published = JSON.parse(
    execute([
      "gh",
      "api",
      `${RELEASES}/${id}`,
      "--hostname",
      "github.com",
      "--method",
      "PATCH",
      "-F",
      "draft=false",
    ]),
  ) as RemoteRelease;
  if (
    published.id !== id ||
    published.tag_name !== tag ||
    published.draft !== false ||
    published.prerelease !== false ||
    !published.html_url ||
    remoteTagCommit(target.ref, execute) !== commit
  ) {
    throw new Error(`远端 Release 发布状态不符:${tag}`);
  }
  return reportFor(published);
}

interface PreparedRelease {
  apk: ReturnType<typeof buildApk>;
  server: Fingerprint;
}

function prepareRelease(
  config: ReturnType<typeof readApkConfig>,
  commit: string,
  tag: string,
  out: string,
  alreadyPublished: boolean,
) {
  const archive = join(out, `dafung-server-${tag}.tar.gz`);
  const receipt = join(out, "prepared.json");
  if (existsSync(receipt)) {
    const prepared = JSON.parse(readFileSync(receipt, "utf8")) as PreparedRelease;
    if (
      prepared.apk.commit !== commit ||
      prepared.apk.apk !== join(out, `${tag}-aarch64.apk`) ||
      prepared.apk.certificateSha256 !== config.certificateSha256
    ) {
      throw new Error(`发版缓存与固定提交或签名不一致:${receipt}`);
    }
    assertAssetUnchanged(prepared.apk.apk, prepared.apk);
    assertAssetUnchanged(archive, prepared.server);
    return { report: prepared.apk, archive: { path: archive, ...prepared.server }, reused: true };
  }
  if (alreadyPublished) throw new Error(`已公开的 ${tag} 缺少本地发版回执:${receipt}`);

  const report = buildApk(config, commit, tag, out);
  console.log("[release] 构建服务端发布包");
  if (
    run([config.bun, "scripts/build-server.ts", "--out-dir", out], config.buildRoot) !== archive
  ) {
    throw new Error(`服务端发布包路径与发版号不符:${archive}`);
  }
  assertApkSource(commit, config.buildRoot);
  assertAssetUnchanged(report.apk, report);
  const prepared: PreparedRelease = { apk: report, server: assetFingerprint(archive) };
  const pending = `${receipt}.tmp`;
  writeFileSync(pending, `${JSON.stringify(prepared, null, 2)}\n`);
  renameSync(pending, receipt);
  return { report, archive: { path: archive, ...prepared.server }, reused: false };
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
  const releaseOut = resolve("tmp/release", commit);
  const draft = flags.has("--draft");
  const checkTarget = () =>
    releaseTarget(tag, commit, run, !draft && existsSync(join(releaseOut, "prepared.json")));
  if (!buildOnly) {
    run(["gh", "auth", "status", "--hostname", "github.com"]);
    checkTarget();
  }
  const assets = buildOnly ? "arm64 APK" : "arm64 APK 与服务端发布包";
  console.log(`[release] commit=${commit} tag=${tag};${assets}`);
  if (flags.has("--dry-run")) return;

  await withApkBuildLock(config.buildRoot, commit, async () => {
    const out = buildOnly ? join(releaseOut, "apk") : releaseOut;
    mkdirSync(out, { recursive: true });
    let report: ReturnType<typeof buildApk>;
    if (buildOnly) {
      report = buildApk(config, commit, tag, out);
    } else {
      const remote = checkTarget().release;
      const prepared = prepareRelease(config, commit, tag, out, remote?.draft === false);
      report = prepared.report;
      const published = publishReleaseAssets(
        tag,
        report,
        prepared.archive,
        draft,
        run,
        commit,
        prepared.reused,
      );
      Object.assign(report, published);
      console.log(`[release] ${published.downloadUrl}`);
      console.log(
        `[release] ${published.serverArchive.downloadUrl};SHA256=${published.serverArchive.sha256}`,
      );
    }
    assertAssetUnchanged(report.apk, report);
    writeFileSync(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[release] 完成:${report.apk};SHA256=${report.sha256}`);
  });
}

if (import.meta.main) {
  release().catch((error: unknown) => {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

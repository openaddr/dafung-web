import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RELEASE_TAG, releaseBunVersion } from "./server-release-archive";

const REPO = "openaddr/dafung-web";
const VPS = "root@160.202.253.194";
const PORT = "9981";
const USAGE = "用法: bun run deploy [--tag v<CalVer>] [--dry-run]";
const SSH = [
  "ssh",
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "PreferredAuthentications=publickey",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=10",
  VPS,
];

const REMOTE_DEPLOY = `
set -eu
mode=$1 tag=$2 bun_version=$3 port=$4
if [ "$(id -u)" != 0 ]; then
  echo "VPS 部署需要 root" >&2
  exit 1
fi
bun=/opt/dafung/runtimes/$bun_version/bun
if [ ! -x "$bun" ]; then
  bun=$(command -v bun) || { echo "VPS 缺少 Bun $bun_version" >&2; exit 1; }
fi
actual=$("$bun" --version)
if [ "$actual" != "$bun_version" ]; then
  echo "VPS 需要 Bun $bun_version，当前为 $actual" >&2
  exit 1
fi
printf '目标 %s，监听 127.0.0.1:%s，Bun %s\\n' "$tag" "$port" "$actual"
if [ -L /opt/dafung/current ]; then
  printf '当前版本目录 %s\\n' "$(readlink -f /opt/dafung/current/release)"
fi
if [ "$mode" = check ]; then exit 0; fi
sha256=$5
archive=dafung-server-$tag.tar.gz
stage=$(mktemp -d /tmp/dafung-deploy.XXXXXX)
trap 'rm -f -- "$stage/deploy-server.js" "$stage/$archive"; rmdir -- "$stage"' EXIT
tar -xzf - --no-same-owner --no-same-permissions -C "$stage"
"$bun" "$stage/deploy-server.js" install --tag "$tag" --archive "$stage/$archive" --sha256 "$sha256" --port "$port"
`;

type Execute = (args: string[], options?: { cwd?: string; input?: Buffer }) => Buffer;

const run: Execute = (args, options) => {
  const child = Bun.spawnSync(args, { cwd: options?.cwd, stdin: options?.input ?? "ignore" });
  if (child.exitCode !== 0) {
    throw new Error(`${args[0]} 退出 ${child.exitCode}:\n${child.stdout}${child.stderr}`);
  }
  return child.stdout;
};

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; state: string; size: number; digest: string | null }[];
}

function selectRelease(tag: string | undefined, execute: Execute) {
  if (tag !== undefined && !RELEASE_TAG.test(tag)) throw new Error(`非法发布标签:${tag}`);
  const route = tag === undefined ? "latest" : `tags/${tag}`;
  const release = JSON.parse(
    execute(["gh", "api", `repos/${REPO}/releases/${route}`]).toString(),
  ) as GitHubRelease;
  const actual = release.tag_name;
  if (
    typeof actual !== "string" ||
    !RELEASE_TAG.test(actual) ||
    (tag !== undefined && actual !== tag) ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) {
    throw new Error(`对应的 GitHub Release 不是公开正式版本:${route}`);
  }
  const filename = `dafung-server-${actual}.tar.gz`;
  const matches = release.assets.filter((asset) => asset.name === filename);
  const [asset] = matches;
  if (
    matches.length !== 1 ||
    !asset ||
    asset.state !== "uploaded" ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    typeof asset.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  ) {
    throw new Error(`Release 缺少可核验的服务端归档:${filename}`);
  }
  return { tag: actual, filename, size: asset.size, sha256: asset.digest.slice("sha256:".length) };
}

function sshCommand(args: string[]): string[] {
  // OpenSSH 把远端命令交给 shell，逐个引用参数以保留脚本和参数边界。
  const command = ["sh", "-c", REMOTE_DEPLOY, "deploy-vps", ...args]
    .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
    .join(" ");
  return [...SSH, command];
}

export async function deployVps(args: string[], execute: Execute = run): Promise<string> {
  const { values } = parseArgs({
    args,
    options: { tag: { type: "string" }, "dry-run": { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) return USAGE;
  const release = selectRelease(values.tag, execute);
  const stage = mkdtempSync(join(tmpdir(), "dafung-vps-deploy-"));
  try {
    execute([
      "gh",
      "release",
      "download",
      release.tag,
      "--repo",
      REPO,
      "--pattern",
      release.filename,
      "--dir",
      stage,
    ]);
    const archive = join(stage, release.filename);
    const bytes = readFileSync(archive);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== release.size || sha256 !== release.sha256) {
      throw new Error(`发布包大小或 SHA-256 与 Release 不一致:${release.filename}`);
    }
    const manifest = JSON.parse(execute(["tar", "-xOzf", archive, "./release.json"]).toString());
    const bunVersion = releaseBunVersion(manifest, release.tag);
    const target = [release.tag, bunVersion, PORT];
    if (values["dry-run"]) {
      const checked = execute(sshCommand(["check", ...target]))
        .toString()
        .trim();
      return `预检通过，${release.filename} 的 SHA-256 已核对。\n${checked}`;
    }

    const tool = await Bun.build({
      entrypoints: [join(import.meta.dir, "deploy-server.ts")],
      outdir: stage,
      target: "bun",
    });
    if (!tool.success) throw new AggregateError(tool.logs, "构建 VPS 安装器失败");
    const bundle = execute(["tar", "-czf", "-", "--", "deploy-server.js", release.filename], {
      cwd: stage,
    });
    return execute(sshCommand(["install", ...target, sha256]), { input: bundle })
      .toString()
      .trim();
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    console.log(await deployVps(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

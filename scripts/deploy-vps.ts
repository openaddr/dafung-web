import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inspect, parseArgs, stripVTControlCharacters } from "node:util";
import { buildServer } from "./build-server";
import { createCommandLog } from "./command-log";
import { RELEASE_TAG, releaseBunVersion } from "./server-release-archive";

const SSH_HOST = "dafung-vps";
const PORT = "9981";
const USAGE = `用法: bun run deploy [--dry-run]\nSSH 目标: ${SSH_HOST}（配置见部署手册）`;
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
  SSH_HOST,
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
printf '目标 %s，计划监听 127.0.0.1:%s，Bun %s\\n' "$tag" "$port" "$actual"
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

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly stdout: Buffer,
    readonly stderr: Buffer,
  ) {
    super(message);
  }
}

const run: Execute = (args, options) => {
  const child = Bun.spawnSync(args, { cwd: options?.cwd, stdin: options?.input ?? "ignore" });
  if (child.exitCode !== 0) {
    throw new CommandFailure(`${args[0]} 退出 ${child.exitCode}`, child.stdout, child.stderr);
  }
  return child.stdout;
};

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
    options: { "dry-run": { type: "boolean" }, help: { type: "boolean" } },
  });
  if (values.help) return USAGE;
  const stage = mkdtempSync(join(tmpdir(), "dafung-vps-deploy-"));
  let phase = "构建服务端包";
  try {
    const archive = await buildServer(stage);
    phase = "核对本地发布包";
    const filename = basename(archive);
    const manifest = JSON.parse(execute(["tar", "-xOzf", archive, "./release.json"]).toString());
    const tag = `v${manifest.version}`;
    if (!RELEASE_TAG.test(tag) || filename !== `dafung-server-${tag}.tar.gz`) {
      throw new Error(`本地服务端归档与发版号不一致:${filename}`);
    }
    const bunVersion = releaseBunVersion(manifest, tag);
    const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const prepared = `本地已构建 ${filename}\nSHA-256 ${sha256}`;
    const target = [tag, bunVersion, PORT];
    if (values["dry-run"]) {
      phase = `SSH 预检 ${SSH_HOST}`;
      const checked = execute(sshCommand(["check", ...target]))
        .toString()
        .trim();
      return `${prepared}\n预检通过\n${checked}`;
    }

    phase = "构建 VPS 安装器";
    const tool = await Bun.build({
      entrypoints: [join(import.meta.dir, "deploy-server.ts")],
      outdir: stage,
      target: "bun",
    });
    if (!tool.success) throw new AggregateError(tool.logs, "构建 VPS 安装器失败");
    phase = "准备上传文件";
    const bundle = execute(["tar", "-czf", "-", "--", "deploy-server.js", filename], {
      cwd: stage,
    });
    phase = `上传并安装 ${SSH_HOST}`;
    const deployed = execute(sshCommand(["install", ...target, sha256]), { input: bundle })
      .toString()
      .trim();
    return `${prepared}\n${deployed}`;
  } catch (error) {
    const log = createCommandLog();
    const message = error instanceof Error ? error.message : String(error);
    const command = error instanceof CommandFailure ? error : null;
    writeFileSync(log.stdout, command ? command.stdout : "");
    writeFileSync(log.stderr, command ? command.stderr : inspect(error, { depth: 6 }));
    const firstLine = (value: string) =>
      stripVTControlCharacters(value).trimStart().split(/\r?\n/, 1)[0]!.slice(0, 360);
    const detail = command && firstLine(command.stderr.toString());
    const status = firstLine(message);
    throw new Error(
      `[deploy] 失败 · ${phase} · ${detail ? `${detail}（${status}）` : status} · 完整日志 ${log.dir}`,
      { cause: error },
    );
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

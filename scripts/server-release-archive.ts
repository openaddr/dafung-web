import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { scanExtensionManifests } from "../apps/server/src/extension-loader";
import { createBuiltinMapLoader } from "../apps/server/src/map-files";
import { readPackagedMaps } from "./packaged-maps";

export const RELEASE_TAG = /^v\d{4}\.[1-9]\d?\.\d+$/;
const BUN_VERSION = /^\d+\.\d+\.\d+$/;
const PAYLOAD_SEAL = "payload-sha256.json";

interface ReleaseInput {
  tag: string;
  archive: string;
  sha256: string;
}

function readBunVersion(releaseDir: string, tag: string): string {
  return releaseBunVersion(JSON.parse(readFileSync(join(releaseDir, "release.json"), "utf8")), tag);
}

export function releaseBunVersion(manifest: unknown, tag: string): string {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("version" in manifest) ||
    `v${manifest.version}` !== tag ||
    !("bunVersion" in manifest) ||
    typeof manifest.bunVersion !== "string" ||
    !BUN_VERSION.test(manifest.bunVersion)
  ) {
    throw new Error(`release.json 与发布标签 ${tag} 不符，或缺少有效 Bun 版本`);
  }
  return manifest.bunVersion;
}

function tar(args: string[]): string {
  const result = Bun.spawnSync(["tar", ...args], {
    env: { PATH: process.env.PATH, LC_ALL: "C" },
  });
  if (result.exitCode !== 0) throw new Error(`GNU tar 失败:\n${result.stderr.toString()}`);
  return result.stdout.toString();
}

function plainRelativePath(path: string): boolean {
  return path.split("/").every((part) => {
    return /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..";
  });
}

/** 在 root 解包前拒绝越界路径、链接、设备文件和重复条目。 */
function archiveFiles(archive: string): Set<string> {
  const listing = tar([
    "--list",
    "--verbose",
    "--gzip",
    "--numeric-owner",
    "--full-time",
    "--quoting-style=escape",
    "--file",
    archive,
  ]);
  const paths = new Set<string>();
  const files = new Set<string>();
  for (const line of listing.trimEnd().split("\n")) {
    const member = /^([d-])\S{9}\s+\d+\/\d+\s+\d+\s+\S+\s+\S+\s+(\S+)$/.exec(line);
    if (!member) throw new Error(`发布包含非普通文件或非法路径:${line}`);
    const [, type, name] = member;
    if (type === "d" && (name === "." || name === "./")) continue;
    const path = name.replace(/^\.\//, "").replace(/\/$/, "");
    const allowed =
      path === "release.json" || path === "server.js" || /^(maps|extensions)(\/|$)/.test(path);
    if (!plainRelativePath(path) || !allowed || paths.has(path)) {
      throw new Error(`发布包含非法或重复路径:${name}`);
    }
    paths.add(path);
    if (type === "-") files.add(path);
  }
  return files;
}

function verifyContents(releaseDir: string, files: Set<string>): void {
  if (lstatSync(join(releaseDir, "server.js")).size === 0) {
    throw new Error("发布包的 server.js 为空");
  }
  const maps = join(releaseDir, "maps");
  const loadMap = createBuiltinMapLoader(maps);
  const packagedMaps = readPackagedMaps(maps);
  const expected = new Set(["release.json", "server.js"]);
  for (const file of packagedMaps.files) expected.add(`maps/${file}`);
  for (const { id } of packagedMaps.catalog) loadMap(id);
  for (const { manifest, pkgDir } of scanExtensionManifests(join(releaseDir, "extensions"))) {
    if (extname(manifest.entry) !== ".js") {
      throw new Error(`扩展 ${manifest.id} 的发布入口必须是已编译的 JS:${manifest.entry}`);
    }
    expected.add(relative(releaseDir, join(pkgDir, "manifest.json")));
    expected.add(relative(releaseDir, join(pkgDir, manifest.entry)));
  }
  for (const file of expected) {
    if (!files.has(file)) throw new Error(`发布包缺少文件:${file}`);
  }
  for (const file of files) {
    if (!expected.has(file)) throw new Error(`发布包包含清单外文件:${file}`);
  }
}

function payloadChecksums(releaseDir: string): Record<string, string> {
  const members = new Map<string, string>();
  function visit(directory: string) {
    for (const name of readdirSync(join(releaseDir, directory)).sort()) {
      const member = join(directory, name);
      if (member === PAYLOAD_SEAL) continue;
      const path = join(releaseDir, member);
      const entry = lstatSync(path);
      if (entry.isDirectory()) {
        members.set(member, "directory");
        visit(member);
      } else if (entry.isFile()) {
        const sha256 = new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
        members.set(member, sha256);
      } else {
        throw new Error(`已安装发布包包含非普通文件:${path}`);
      }
    }
  }
  visit("");
  return Object.fromEntries(members);
}

function verifyInstalledContent(releaseDir: string, expected: Record<string, string>): void {
  if (!lstatSync(releaseDir).isDirectory()) throw new Error(`已安装发布包目录损坏:${releaseDir}`);
  const actual = payloadChecksums(releaseDir);
  const members = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const member of members) {
    if (actual[member] !== expected[member]) {
      throw new Error(`已安装发布包内容与原始归档不同:${join(releaseDir, member)}`);
    }
  }
}

export function installedBunVersion(releaseDir: string, tag: string): string {
  const seal = join(releaseDir, PAYLOAD_SEAL);
  if (!lstatSync(seal, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`已安装发布包缺少有效的文件摘要:${seal}`);
  }
  const expected: unknown = JSON.parse(readFileSync(seal, "utf8"));
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error(`已安装发布包文件摘要格式不符:${seal}`);
  }
  verifyInstalledContent(releaseDir, expected as Record<string, string>);
  return readBunVersion(releaseDir, tag);
}

export async function stageServerRelease(
  releasesDir: string,
  input: ReleaseInput,
): Promise<string> {
  const { tag, archive, sha256 } = input;
  if (!RELEASE_TAG.test(tag)) throw new Error(`非法发布标签:${tag}`);
  if (basename(archive) !== `dafung-server-${tag}.tar.gz`) {
    throw new Error(`发布包文件名应为 dafung-server-${tag}.tar.gz`);
  }
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) throw new Error("需要明确的 SHA-256 校验和");
  if (!lstatSync(archive).isFile()) throw new Error(`发布包必须是本地普通文件:${archive}`);

  mkdirSync(releasesDir, { recursive: true, mode: 0o750 });
  const staging = mkdtempSync(join(releasesDir, ".incoming-"));
  try {
    const snapshot = join(staging, "release.tar.gz");
    copyFileSync(archive, snapshot);
    const digest = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(snapshot).arrayBuffer())
      .digest("hex");
    if (digest !== sha256.toLowerCase()) throw new Error(`发布包 SHA-256 不匹配:${archive}`);

    const files = archiveFiles(snapshot);
    const payload = join(staging, "payload");
    mkdirSync(payload);
    tar([
      "--extract",
      "--gzip",
      "--no-same-owner",
      "--no-same-permissions",
      "--file",
      snapshot,
      "--directory",
      payload,
    ]);
    const bunVersion = readBunVersion(payload, tag);
    if (bunVersion !== Bun.version) {
      throw new Error(`发布包需要 bun@${bunVersion}，当前 bun@${Bun.version}`);
    }
    verifyContents(payload, files);

    const releaseDir = join(releasesDir, tag);
    const marker = join(releaseDir, "archive.sha256");
    const installed = lstatSync(releaseDir, { throwIfNoEntry: false });
    writeFileSync(join(payload, "archive.sha256"), digest + "\n");
    const sealed = payloadChecksums(payload);
    if (installed) {
      if (!installed.isDirectory() || !lstatSync(marker, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`已安装发布包目录或摘要文件损坏:${releaseDir}`);
      }
      if (readFileSync(marker, "utf8") !== digest + "\n") {
        throw new Error(`已安装 ${tag} 的摘要与所选发布包不同:${marker}`);
      }
      verifyInstalledContent(releaseDir, sealed);
    } else {
      writeFileSync(join(payload, PAYLOAD_SEAL), JSON.stringify(sealed) + "\n");
      renameSync(payload, releaseDir);
    }
    return bunVersion;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

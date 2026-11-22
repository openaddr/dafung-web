import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { scanExtensionManifests } from "../apps/server/src/extension-loader";
import { readPackagedMaps } from "./packaged-maps";

const ROOT = resolve(import.meta.dir, "..");

function copyMaps(source: string, target: string): void {
  for (const file of readPackagedMaps(source).files) {
    const path = join(target, file);
    mkdirSync(dirname(path), { recursive: true });
    copyFileSync(join(source, file), path);
  }
}

function copyExtensions(source: string, target: string): void {
  mkdirSync(target);
  for (const { manifest, pkgDir } of scanExtensionManifests(source)) {
    if (extname(manifest.entry) !== ".js") {
      throw new Error(`扩展 ${manifest.id} 的发布入口必须是已编译的 JS:${manifest.entry}`);
    }
    const dir = join(target, basename(pkgDir));
    mkdirSync(dir);
    copyFileSync(join(pkgDir, "manifest.json"), join(dir, "manifest.json"));
    copyFileSync(join(pkgDir, manifest.entry), join(dir, manifest.entry));
  }
}

export async function buildServer(outputDir = join(ROOT, "dist-server")): Promise<string> {
  const { version, packageManager } = (await Bun.file(join(ROOT, "package.json")).json()) as {
    version: string;
    packageManager?: string;
  };
  if (!/^\d{4}\.[1-9]\d?\.\d+$/.test(version)) throw new Error(`非法版本:${version}`);
  if (packageManager !== `bun@${Bun.version}`) {
    throw new Error(
      `服务端构建需要 packageManager 指定的 ${packageManager}，当前 bun@${Bun.version}`,
    );
  }

  const out = resolve(outputDir);
  mkdirSync(out, { recursive: true });
  const staging = mkdtempSync(join(out, ".server-"));
  try {
    const payload = join(staging, "payload");
    mkdirSync(payload);
    const result = await Bun.build({
      entrypoints: [join(ROOT, "apps/server/src/server.ts")],
      target: "bun",
      format: "esm",
      metafile: true,
      define: { DAFUNG_SERVER_ARTIFACT: "true" },
    });
    const [entry] = result.outputs;
    if (!result.success || !entry || result.outputs.length !== 1 || entry.kind !== "entry-point") {
      throw new Error(`服务端应构建为单一 JS 入口:\n${result.logs.join("\n")}`);
    }
    if (!result.metafile) throw new Error("服务端构建缺少依赖清单");
    for (const input of Object.keys(result.metafile.inputs)) {
      const path = relative(ROOT, resolve(input)).replaceAll("\\", "/");
      if (!path.startsWith("apps/server/src/") && !path.startsWith("packages/core/src/"))
        throw new Error(`服务端构建引入范围外文件:${path}`);
    }
    await Bun.write(join(payload, "server.js"), entry);

    const core = dirname(fileURLToPath(import.meta.resolve("@dafung/core/package.json")));
    copyMaps(join(core, "maps"), join(payload, "maps"));
    copyExtensions(join(core, "extensions"), join(payload, "extensions"));
    await Bun.write(
      join(payload, "release.json"),
      JSON.stringify({ version, bunVersion: Bun.version }, null, 2) + "\n",
    );

    const archiveName = `dafung-server-v${version}.tar.gz`;
    const stagedArchive = join(staging, archiveName);
    const tar = Bun.spawnSync(["tar", "-czf", stagedArchive, "-C", payload, "."]);
    if (tar.exitCode !== 0) throw new Error(`服务端发布包压缩失败:\n${tar.stderr.toString()}`);
    const archive = join(out, archiveName);
    renameSync(stagedArchive, archive);
    return archive;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { "out-dir": { type: "string" } },
  });
  console.log(await buildServer(values["out-dir"]));
}

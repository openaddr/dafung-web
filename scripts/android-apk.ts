// Linux 原生 Android 工具链;源码、依赖和编译缓存均留在 Linux 文件系统。
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface ApkConfig {
  buildRoot: string;
  bun: string;
  nodeDir: string;
  cargoDir: string;
  javaHome: string;
  androidHome: string;
  ndkHome: string;
  buildToolsVersion: string;
  keystore: string;
  certificateSha256: string;
}

function checked(argv: string[], cwd: string, stdin?: Uint8Array): Buffer {
  const p = Bun.spawnSync(argv, { cwd, stdin, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0)
    throw new Error(`${argv.join(" ")} 失败:\n${p.stdout.toString()}${p.stderr.toString()}`);
  return p.stdout;
}

export function readApkConfig(file: string): ApkConfig {
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("APK 配置必须是 JSON 对象");
  const fields = [
    "buildRoot",
    "bun",
    "nodeDir",
    "cargoDir",
    "javaHome",
    "androidHome",
    "ndkHome",
    "buildToolsVersion",
    "keystore",
    "certificateSha256",
  ];
  for (const field of fields) {
    if (
      !(field in data) ||
      typeof (data as Record<string, unknown>)[field] !== "string" ||
      !(data as Record<string, string>)[field]
    )
      throw new Error(`APK 配置缺少字符串:${field}`);
  }
  for (const field of Object.keys(data))
    if (!fields.includes(field)) throw new Error(`未知 APK 配置:${field}`);
  const config = data as ApkConfig;
  if (process.platform !== "linux") throw new Error("APK 构建需要 Linux 工具链");
  for (const field of [
    "buildRoot",
    "bun",
    "nodeDir",
    "cargoDir",
    "javaHome",
    "androidHome",
    "ndkHome",
    "keystore",
  ] as const) {
    if (!isAbsolute(config[field])) throw new Error(`${field} 必须是 Linux 绝对路径`);
    config[field] = resolve(config[field]);
    if (config[field].startsWith("/mnt/"))
      throw new Error(`${field} 必须放在 Linux 文件系统,不能使用 Windows 挂载目录`);
    if (field !== "buildRoot" && !existsSync(config[field]))
      throw new Error(`${field} 不存在:${config[field]}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(config.buildToolsVersion))
    throw new Error("buildToolsVersion 必须显式指定 SDK 版本");
  if (!/^[a-f0-9]{64}$/.test(config.certificateSha256))
    throw new Error("certificateSha256 必须是既有发布证书的 SHA256");
  return config;
}

export function readLocalApkConfig(): ApkConfig {
  return readApkConfig(join(homedir(), ".config", "dafung-web", "apk.json"));
}

export async function withApkBuildLock<T>(
  root: string,
  commit: string,
  work: () => Promise<T>,
): Promise<T> {
  const lock = `${root}.lock`;
  mkdirSync(dirname(root), { recursive: true });
  // mkdir 的独占创建保证两会话不会同时改缓存;残锁须核实原进程后人工清理。
  mkdirSync(lock);
  try {
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({ commit, pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await work();
  } finally {
    rmSync(lock, { recursive: true });
  }
}

interface SourceFile {
  path: string;
  oid: string;
  mode: number;
}
const SOURCE_MARKER = ".dafung-apk-source.json";

function sourceFiles(commit: string, repo: string): SourceFile[] {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("构建源码必须是完整 commit");
  return checked(["git", "ls-tree", "-rz", commit], repo)
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf("\t");
      const [mode, kind, oid] = row.slice(0, tab).split(" ");
      const file = row.slice(tab + 1);
      if (
        kind !== "blob" ||
        !["100644", "100755"].includes(mode!) ||
        !oid ||
        file.split("/").some((part) => part === "..") ||
        file.startsWith("/")
      )
        throw new Error(`不支持的源码条目:${row}`);
      return { path: file, oid, mode: Number.parseInt(mode!.slice(-3), 8) };
    });
}

export function assertApkSource(commit: string, root: string, repo = process.cwd()): void {
  const files = sourceFiles(commit, repo);
  const expected = new Set(files.map((entry) => entry.path));
  const generated = [
    "node_modules",
    "dist",
    "tmp",
    "src-tauri/target",
    "src-tauri/gen/android/.gradle",
    "src-tauri/gen/android/.kotlin",
    "src-tauri/gen/android/build",
    "src-tauri/gen/android/buildSrc/build",
    "src-tauri/gen/android/buildSrc/.gradle",
    "src-tauri/gen/android/buildSrc/.kotlin",
    "src-tauri/gen/android/app/build",
    "src-tauri/gen/android/app/src/main/jniLibs",
    "src-tauri/gen/schemas",
  ];
  // Tauri/Cargo 生成件保留以复用原生缓存;精确列出源码目录中的生成文件。
  const generatedFiles = new Set([
    "src-tauri/gen/android/local.properties",
    "src-tauri/gen/android/tauri.settings.gradle",
    "src-tauri/gen/android/app/proguard-tauri.pro",
    "src-tauri/gen/android/app/tauri.build.gradle.kts",
    "src-tauri/gen/android/app/tauri.properties",
    "src-tauri/gen/android/app/src/main/assets/tauri.conf.json",
    ...[
      "Ipc.kt",
      "Logger.kt",
      "PermissionHelper.kt",
      "proguard-wry.pro",
      "Rust.kt",
      "RustWebChromeClient.kt",
      "RustWebView.kt",
      "RustWebViewClient.kt",
      "TauriActivity.kt",
      "WryActivity.kt",
    ].map((file) => `src-tauri/gen/android/app/src/main/java/com/dafung/web/generated/${file}`),
  ]);
  const unexpected: string[] = [];
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (generated.includes(file) || file === SOURCE_MARKER || generatedFiles.has(file)) continue;
      if (entry.isDirectory()) visit(file);
      else if (!entry.isFile() || !expected.has(file)) unexpected.push(file);
    }
  };
  visit("");
  if (unexpected.length) throw new Error(`APK 缓存含非提交输入:\n${unexpected.join("\n")}`);
  for (const entry of files) {
    if ((statSync(join(root, entry.path)).mode & 0o777) !== entry.mode)
      throw new Error(`构建源码权限偏离 ${commit}:${entry.path}`);
    const bytes = readFileSync(join(root, entry.path));
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (oid !== entry.oid) throw new Error(`构建源码偏离 ${commit}:${entry.path}`);
  }
}

export function syncApkSource(commit: string, root: string, repo = process.cwd()): void {
  if (existsSync(join(root, ".git")) || existsSync(join(root, ".jj")))
    throw new Error("APK 缓存目录必须独占,不能是 git/jj 工作区");
  mkdirSync(root, { recursive: true });
  const marker = join(root, SOURCE_MARKER);
  const entries = sourceFiles(commit, repo);
  if (existsSync(marker)) {
    const old = JSON.parse(readFileSync(marker, "utf8")) as { commit: string };
    const next = new Set(entries.map((entry) => entry.path));
    for (const entry of sourceFiles(old.commit, repo)) {
      if (!next.has(entry.path)) {
        const file = join(root, entry.path);
        rmSync(file);
        let parent = dirname(file);
        while (parent !== root && readdirSync(parent).length === 0) {
          rmdirSync(parent);
          parent = dirname(parent);
        }
      }
    }
  } else if (readdirSync(root).length) throw new Error("首次构建必须使用空的独占缓存目录");
  // 只覆盖内容有变的文件,保留未变源文件 mtime,让 Cargo/Gradle 真正复用缓存。
  const blobs = checked(
    ["git", "cat-file", "--batch"],
    repo,
    Buffer.from(entries.map((entry) => entry.oid).join("\n") + "\n"),
  );
  let offset = 0;
  for (const entry of entries) {
    const end = blobs.indexOf(10, offset);
    const [oid, kind, sizeText] = blobs.subarray(offset, end).toString().split(" ");
    const size = Number(sizeText);
    if (oid !== entry.oid || kind !== "blob" || !Number.isInteger(size))
      throw new Error(`git blob 响应异常:${entry.path}`);
    const bytes = blobs.subarray(end + 1, end + 1 + size);
    const file = join(root, entry.path);
    if (!existsSync(file) || !readFileSync(file).equals(bytes)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
    if ((statSync(file).mode & 0o777) !== entry.mode) chmodSync(file, entry.mode);
    offset = end + size + 2;
  }
  assertApkSource(commit, root, repo);
  writeFileSync(marker, JSON.stringify({ commit }));
}

export function buildApk(config: ApkConfig, commit: string, tag: string, out: string) {
  const startedAt = new Date().toISOString();
  const root = config.buildRoot;
  syncApkSource(commit, root);
  const tools = join(config.androidHome, "build-tools", config.buildToolsVersion);
  for (const name of ["zipalign", "apksigner", "aapt"])
    if (!existsSync(join(tools, name))) throw new Error(`SDK 工具不存在:${name}`);
  const generated = "src-tauri/gen/android/app";
  for (const relative of [
    `${generated}/build/outputs/apk`,
    `${generated}/build/outputs/bundle`,
    `${generated}/src/main/jniLibs`,
    "tmp/apk-output",
  ]) {
    const file = join(root, relative);
    if (existsSync(file)) rmSync(file, { recursive: true });
  }
  mkdirSync(join(root, "tmp/apk-output"), { recursive: true });
  const apkName = `${tag}-aarch64.apk`;
  const unsigned = join(
    root,
    generated,
    "build/outputs/apk/universal/release/app-universal-release-unsigned.apk",
  );
  const aligned = join(root, "tmp/apk-output/aligned.apk");
  const signed = join(root, "tmp/apk-output", apkName);
  const env = {
    ...process.env,
    JAVA_HOME: config.javaHome,
    ANDROID_HOME: config.androidHome,
    NDK_HOME: config.ndkHome,
    ANDROID_NDK_HOME: config.ndkHome,
    GRADLE_OPTS: "-Dorg.gradle.daemon=false",
    PATH: [
      config.cargoDir,
      dirname(config.bun),
      config.nodeDir,
      join(config.javaHome, "bin"),
      join(config.androidHome, "platform-tools"),
      process.env.PATH,
    ].join(":"),
  };
  const command = (label: string, argv: string[], output?: string) => {
    console.log(`[apk] ${label}`);
    const result = Bun.spawnSync(argv, {
      cwd: root,
      env,
      stdout: output ? "pipe" : "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) throw new Error(`${label} 失败:${result.exitCode}`);
    if (output) writeFileSync(join(root, output), result.stdout!);
  };
  command("安装依赖", [config.bun, "install", "--frozen-lockfile"]);
  command("构建 APK", [
    config.bun,
    "x",
    "tauri",
    "android",
    "build",
    "--apk",
    "--target",
    "aarch64",
    "--ci",
  ]);
  command("对齐 APK", [join(tools, "zipalign"), "-f", "4", unsigned, aligned]);
  command("签名", [
    join(tools, "apksigner"),
    "sign",
    "--ks",
    config.keystore,
    "--ks-key-alias",
    "androiddebugkey",
    "--ks-pass",
    "pass:android",
    "--key-pass",
    "pass:android",
    "--out",
    signed,
    aligned,
  ]);
  command(
    "验证签名",
    [join(tools, "apksigner"), "verify", "--verbose", "--print-certs", signed],
    "tmp/apk-output/signature.txt",
  );
  command(
    "核对包信息",
    [join(tools, "aapt"), "dump", "badging", signed],
    "tmp/apk-output/badging.txt",
  );
  assertApkSource(commit, root);
  const badging = readFileSync(join(root, "tmp/apk-output/badging.txt"), "utf8");
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  const { identifier } = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  ) as { identifier: string };
  const packageLine = /^package: name='([^']+)' versionCode='\d+' versionName='([^']+)'/m.exec(
    badging,
  );
  if (!packageLine || packageLine[1] !== identifier || packageLine[2] !== version)
    throw new Error("APK 包名/版本与固定源码不一致");
  if (!/^native-code: 'arm64-v8a'\s*$/m.test(badging))
    throw new Error("APK 必须只包含 arm64-v8a native 库");
  const signature = readFileSync(join(root, "tmp/apk-output/signature.txt"), "utf8");
  const certificate = /^Signer #1 certificate SHA-256 digest: ([a-f0-9]+)\s*$/m.exec(signature);
  if (!certificate) throw new Error("签名核验未返回证书 SHA256");
  if (certificate[1] !== config.certificateSha256)
    throw new Error("APK 签名证书与既有发布身份不一致");
  const apk = join(out, apkName);
  copyFileSync(signed, apk);
  copyFileSync(join(root, "tmp/apk-output/signature.txt"), join(out, "signature.txt"));
  copyFileSync(join(root, "tmp/apk-output/badging.txt"), join(out, "badging.txt"));
  const bytes = readFileSync(apk);
  const report = {
    commit,
    host: process.platform,
    version,
    identifier,
    apk,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    certificateSha256: certificate[1],
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(out, "build.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

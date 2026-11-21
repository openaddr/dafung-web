import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

test.skipIf(!process.env.DAFUNG_SLOW)(
  "合入后自动提交版本，上传中断后续用原标签和 APK",
  () => {
    const temp = mkdtempSync(join(tmpdir(), "dafung-pr-release-"));
    try {
      const main = join(temp, "main");
      const delivery = join(temp, "delivery");
      const origin = join(temp, "origin.git");
      const bin = join(temp, "bin");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      const spawn = (cwd: string, ...args: string[]) => Bun.spawnSync(args, { cwd, env });
      const run = (cwd: string, ...args: string[]) => {
        const result = spawn(cwd, ...args);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        return result.stdout.toString().trim();
      };
      const rev = (cwd: string, revision: string) =>
        run(cwd, "jj", "log", "-r", revision, "--no-graph", "-T", "commit_id");
      mkdirSync(join(main, "scripts"), { recursive: true });
      mkdirSync(bin);
      const configPath = join(temp, "apk.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          buildRoot: join(temp, "build"),
          bun: process.execPath,
          nodeDir: bin,
          cargoDir: bin,
          javaHome: bin,
          androidHome: bin,
          ndkHome: bin,
          keystore: process.execPath,
          buildToolsVersion: "1.0.0",
          certificateSha256: "f".repeat(64),
        }),
      );
      for (const file of ["pr-release.ts", "release.ts"])
        cpSync(join(ROOT, "scripts", file), join(main, "scripts", file));
      const apkModule = readFileSync(join(ROOT, "scripts/android-apk.ts"), "utf8");
      writeFileSync(
        join(main, "scripts/android-apk.ts"),
        apkModule.replace(
          'join(homedir(), ".config", "dafung-web", "apk.json")',
          JSON.stringify(configPath),
        ),
      );
      writeFileSync(join(main, ".gitignore"), "tmp/\n");
      writeFileSync(
        join(main, "package.json"),
        '{"version":"2026.11.77","scripts":{"release":"bun scripts/release.ts"}}\n',
      );
      // 版本 PR 收口边界更新本地裸远端，并留下已签名构建的模拟回执。
      writeFileSync(
        join(main, "scripts/pr-merge.ts"),
        String.raw`
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [bookmark, flag, file] = process.argv.slice(2);
if (!/^codex\/release-2026\.11\.78-[a-f0-9]{12}$/.test(bookmark) || flag !== "--expect" || file !== "package.json") throw new Error("版本 PR 参数错误");
const jj = (cwd, ...args) => {
  const p = Bun.spawnSync(["jj", ...args], { cwd });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};
const dir = process.cwd();
const main = jj(dir, "workspace", "root", "--name", "default");
const commit = jj(dir, "log", "-r", bookmark, "--no-graph", "-T", "commit_id");
jj(dir, "bookmark", "move", "master", "--to", commit);
jj(dir, "git", "push", "--bookmark", "master");
jj(dir, "bookmark", "delete", bookmark);
jj(dir, "new", "master");
jj(main, "new", "master");
const out = join(main, "tmp/release", commit);
mkdirSync(out, { recursive: true });
const apk = join(out, "v2026.11.78-aarch64.apk");
const bytes = Buffer.from("verified arm64 apk fixture");
writeFileSync(apk, bytes);
writeFileSync(join(out, "build.json"), JSON.stringify({ commit, apk, size: bytes.length, version: "2026.11.78",
  certificateSha256: "f".repeat(64), sha256: createHash("sha256").update(bytes).digest("hex") }));
`,
      );
      writeFileSync(
        join(bin, "gh"),
        `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const [verb, mode, tag, apk] = process.argv.slice(2);
const record = "tmp/fixture-remote-release.json";
const readRecord = () => JSON.parse(readFileSync(record, "utf8"));
if (verb === "auth" && mode === "status") process.exit(0);
if (verb === "api") {
  const remote = readRecord();
  if (mode === "--method" && tag === "PATCH") {
    if (remote.assets.length !== 1) throw new Error("草稿缺少 APK");
    remote.draft = false;
    writeFileSync(record, JSON.stringify(remote));
  } else if (mode.includes("/tags/") && remote.draft) {
    console.error("gh: Not Found (HTTP 404)");
    process.exit(1);
  }
  console.log(JSON.stringify(remote));
} else if (verb === "release" && mode === "create" && tag === "v2026.11.78") {
  if (existsSync(record)) throw new Error("重复创建 Release");
  writeFileSync(record, JSON.stringify({ id: 1, tag_name: tag, prerelease: false,
    draft: true, html_url: "https://example.invalid/release", assets: [] }));
  throw new Error("模拟上传中断");
} else if (verb === "release" && mode === "upload" && tag === "v2026.11.78") {
  const { size, sha256 } = JSON.parse(readFileSync(dirname(apk) + "/build.json", "utf8"));
  const remote = readRecord();
  if (!remote.draft || remote.assets.length) throw new Error("重复上传 APK");
  remote.assets.push({ name: "v2026.11.78-aarch64.apk", size, digest: "sha256:" + sha256,
    browser_download_url: "https://example.invalid/apk" });
  writeFileSync(record, JSON.stringify(remote));
} else throw new Error("意外的 gh 命令 " + process.argv.slice(2));
`,
        { mode: 0o755 },
      );
      run(main, "jj", "git", "init");
      run(main, "jj", "config", "set", "--repo", "user.name", "Fixture");
      run(main, "jj", "config", "set", "--repo", "user.email", "fixture@example.invalid");
      run(main, "jj", "metaedit", "--update-author");
      run(main, "jj", "describe", "-m", "功能已合入");
      run(main, "jj", "bookmark", "set", "master");
      run(main, "git", "init", "--bare", origin);
      run(main, "jj", "git", "remote", "add", "origin", origin);
      run(main, "jj", "git", "push", "--bookmark", "master");
      const feature = rev(main, "master@origin");
      run(main, "jj", "new", feature);
      run(main, "jj", "workspace", "add", "--revision", feature, delivery);

      const flow = [
        process.execPath,
        "-e",
        `import { preparePrRelease } from "./scripts/pr-release"; preparePrRelease()("${feature}");`,
      ];
      const interrupted = spawn(delivery, ...flow);
      expect(interrupted.exitCode).not.toBe(0);
      expect(interrupted.stderr.toString()).toContain("模拟上传中断");
      const release = rev(main, "master@origin");
      expect(rev(main, `${release}-`)).toBe(feature);
      expect(run(main, "jj", "diff", "-r", release, "--name-only")).toBe("package.json");
      expect(run(main, "git", "ls-remote", "origin", "refs/tags/v2026.11.78")).toStartWith(release);
      expect(run(delivery, ...flow)).toContain("https://example.invalid/apk");
      expect(run(delivery, ...flow)).toContain("https://example.invalid/apk");
      expect(rev(main, "master@origin")).toBe(release);
      const remotePath = join(main, "tmp/fixture-remote-release.json");
      const remote = JSON.parse(readFileSync(remotePath, "utf8"));
      remote.assets[0].digest = "sha256:" + "0".repeat(64);
      writeFileSync(remotePath, JSON.stringify(remote));
      const mismatch = spawn(delivery, ...flow);
      expect(mismatch.exitCode).not.toBe(0);
      expect(mismatch.stderr.toString()).toContain("远端 Release 资产或 SHA256 与本地 APK 不一致");
    } finally {
      rmSync(temp, { recursive: true });
    }
  },
  30_000,
);

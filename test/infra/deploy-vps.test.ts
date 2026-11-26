import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { deployVps } from "../../scripts/deploy-vps";
import pkg from "../../package.json";

const TAG = `v${pkg.version}`;
const ARCHIVE = `dafung-server-${TAG}.tar.gz`;

test.skipIf(process.platform === "win32")("SSH 失败只返回阶段和原因，完整输出留在日志", () => {
  const root = mkdtempSync(join(tmpdir(), "dafung-ssh-test-"));
  let log: string | undefined;
  try {
    writeFileSync(
      join(root, "ssh"),
      '#!/bin/sh\nprintf "远端状态\\n"\nprintf "Host key verification failed.\\n" >&2\nprintf "%012000d\\n" 0 >&2\nexit 255\n',
      { mode: 0o700 },
    );
    const cli = resolve(import.meta.dir, "../../scripts/deploy-vps.ts");
    const result = Bun.spawnSync([process.execPath, cli, "--dry-run"], {
      env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH}` },
    });
    const stderr = result.stderr.toString();
    log = /完整日志 (.+)$/m.exec(stderr)?.[1];
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("SSH 预检 dafung-vps");
    expect(stderr).toContain("Host key verification failed.");
    expect(stderr.length).toBeLessThan(500);
    expect(log).toBeDefined();
    expect(readFileSync(join(log!, "stdout.log"), "utf8")).toBe("远端状态\n");
    expect(readFileSync(join(log!, "stderr.log"), "utf8")).toContain("0".repeat(12000));
  } finally {
    rmSync(root, { recursive: true });
    if (log) rmSync(log, { recursive: true });
  }
});

function fixture() {
  const ssh: { args: string[]; input?: Buffer }[] = [];
  const execute: NonNullable<Parameters<typeof deployVps>[1]> = (args, options) => {
    if (args[0] === "tar") {
      const tar = Bun.spawnSync(args, { cwd: options?.cwd });
      expect(tar.exitCode, tar.stderr.toString()).toBe(0);
      return tar.stdout;
    }
    if (args[0] === "ssh") {
      ssh.push({ args, input: options?.input });
      return Buffer.from("VPS 检查通过");
    }
    throw new Error(`意外子进程:${args[0]}`);
  };
  return { ssh, execute };
}

test("预检从本地构建，SSH 核对目标时不上传归档", async () => {
  const { ssh, execute } = fixture();
  expect(await deployVps(["--dry-run"], execute)).toContain("VPS 检查通过");
  expect(ssh).toHaveLength(1);
  expect(ssh[0]?.args).toContain("PreferredAuthentications=publickey");
  expect(ssh[0]?.args).toContain("StrictHostKeyChecking=yes");
  expect(ssh[0]?.args.at(-2)).toBe("dafung-vps");
  expect(ssh[0]?.args.at(-1)).toEndWith(`'check' '${TAG}' '${Bun.version}' '9981'`);
  expect(ssh[0]?.input).toBeUndefined();
});

test("部署上传本地新构建的归档，远端收到对应版本和摘要", async () => {
  const { ssh, execute } = fixture();
  await deployVps([], execute);
  expect(ssh).toHaveLength(1);
  expect(ssh[0]?.args.at(-2)).toBe("dafung-vps");
  const contents = Bun.spawnSync(["tar", "-tzf", "-"], { stdin: ssh[0]?.input });
  expect(contents.exitCode, contents.stderr.toString()).toBe(0);
  expect(contents.stdout.toString().trim().split("\n")).toEqual(["deploy-server.js", ARCHIVE]);
  const archive = Bun.spawnSync(["tar", "-xOzf", "-", ARCHIVE], { stdin: ssh[0]?.input });
  expect(archive.exitCode, archive.stderr.toString()).toBe(0);
  const sha256 = createHash("sha256").update(archive.stdout).digest("hex");
  expect(ssh[0]?.args.at(-1)).toEndWith(`'install' '${TAG}' '${Bun.version}' '9981' '${sha256}'`);
  const manifest = Bun.spawnSync(["tar", "-xOzf", "-", "./release.json"], {
    stdin: archive.stdout,
  });
  expect(manifest.exitCode, manifest.stderr.toString()).toBe(0);
  expect(JSON.parse(manifest.stdout.toString())).toEqual({
    version: pkg.version,
    bunVersion: Bun.version,
  });
});

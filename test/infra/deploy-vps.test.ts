import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { deployVps } from "../../scripts/deploy-vps";
import pkg from "../../package.json";

const TAG = `v${pkg.version}`;
const ARCHIVE = `dafung-server-${TAG}.tar.gz`;

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

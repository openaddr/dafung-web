import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deployVps } from "../../scripts/deploy-vps";

const TAG = "v2026.11.83";
const ARCHIVE = `dafung-server-${TAG}.tar.gz`;

function fixture(corrupt = false) {
  const calls: {
    args: string[];
    input: Buffer | undefined;
  }[] = [];
  const archive = Buffer.from("fixture archive bytes");
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const execute: NonNullable<Parameters<typeof deployVps>[1]> = (args, options) => {
    calls.push({ args, input: options?.input });
    if (args[0] === "gh" && args[1] === "api") {
      return Buffer.from(
        JSON.stringify({
          tag_name: TAG,
          draft: false,
          prerelease: false,
          assets: [
            {
              name: ARCHIVE,
              size: archive.length,
              digest: `sha256:${sha256}`,
              state: "uploaded",
            },
          ],
        }),
      );
    }
    if (args[0] === "gh" && args[1] === "release") {
      writeFileSync(join(args.at(-1)!, ARCHIVE), corrupt ? Buffer.alloc(archive.length) : archive);
      return Buffer.alloc(0);
    }
    if (args[0] === "tar" && args[1] === "-xOzf") {
      return Buffer.from(JSON.stringify({ version: TAG.slice(1), bunVersion: "1.4.0" }));
    }
    if (args[0] === "tar" && args[1] === "-czf") {
      const tar = Bun.spawnSync(args, { cwd: options?.cwd });
      expect(tar.exitCode, tar.stderr.toString()).toBe(0);
      return tar.stdout;
    }
    if (args[0] === "ssh") return Buffer.from("VPS 检查通过");
    throw new Error(`意外子进程:${args[0]}`);
  };
  return { calls, execute, sha256 };
}

test("默认选择最新公开 Release，预检通过公钥连接且无上传数据", async () => {
  const { calls, execute } = fixture();
  expect(await deployVps(["--dry-run"], execute)).toContain("VPS 检查通过");
  expect(calls[0]?.args).toEqual(["gh", "api", "repos/openaddr/dafung-web/releases/latest"]);
  const ssh = calls.filter((call) => call.args[0] === "ssh");
  expect(ssh).toHaveLength(1);
  expect(ssh[0]?.args).toContain("PreferredAuthentications=publickey");
  expect(ssh[0]?.args).toContain("StrictHostKeyChecking=yes");
  expect(ssh[0]?.args).toContain("root@160.202.253.194");
  expect(ssh[0]?.args.at(-1)).toEndWith(`'check' '${TAG}' '1.4.0' '9981'`);
  expect(ssh[0]?.input).toBeUndefined();
});

test("部署指定版本，向 VPS 发送安装器和归档并传入核验摘要", async () => {
  const { calls, execute, sha256 } = fixture();
  await deployVps(["--tag", TAG], execute);
  expect(calls[0]?.args.at(-1)).toBe(`repos/openaddr/dafung-web/releases/tags/${TAG}`);
  const ssh = calls.filter((call) => call.args[0] === "ssh");
  expect(ssh).toHaveLength(1);
  expect(ssh[0]?.args.at(-1)).toEndWith(`'install' '${TAG}' '1.4.0' '9981' '${sha256}'`);
  const contents = Bun.spawnSync(["tar", "-tzf", "-"], { stdin: ssh[0]?.input });
  expect(contents.exitCode, contents.stderr.toString()).toBe(0);
  expect(contents.stdout.toString().trim().split("\n")).toEqual(["deploy-server.js", ARCHIVE]);
});

test("下载归档摘要不符时在 SSH 之前中止", async () => {
  const { calls, execute } = fixture(true);
  await expect(deployVps([], execute)).rejects.toThrow("SHA-256");
  expect(calls.some((call) => call.args[0] === "ssh")).toBe(false);
});

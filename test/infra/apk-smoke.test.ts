// CLI 错误出口缝:守住参数缺失/SDK 缺失时非零退出且不伪报通过;无需设备,约 0.1s。
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("APK 冒烟 CLI 在参数或 SDK 缺失时明确失败并留下失败报告", () => {
  const root = resolve(import.meta.dir, "../..");
  const temp = mkdtempSync(join(tmpdir(), "dafung-apk-smoke-"));
  try {
    const invoke = (args: string[]) =>
      Bun.spawnSync([process.execPath, "scripts/apk-smoke.ts", ...args], {
        cwd: root,
        env: { ...process.env, ANDROID_HOME: "" },
        stdout: "pipe",
        stderr: "pipe",
      });
    const missingArgs = invoke([]);
    expect(missingArgs.exitCode).toBe(1);
    expect(missingArgs.stderr.toString()).toContain("必须显式提供 --apk");

    const out = join(temp, "evidence");
    const missingSdk = invoke([
      "--apk",
      join(temp, "sample.apk"),
      "--device",
      "chosen-device",
      "--package",
      "com.dafung.web",
      "--version",
      "2026.11.52",
      "--out",
      out,
    ]);
    expect(missingSdk.exitCode).toBe(1);
    expect(missingSdk.stderr.toString()).toContain("ANDROID_HOME");
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.status).toBe("failed");
    expect(report.steps.at(-1)).toMatchObject({ name: "SDK 前置", status: "failed" });
    expect(report.expected.device).toBe("chosen-device");
  } finally {
    rmSync(temp, { recursive: true });
  }
});

// #1465:真实 CLI 与子进程守双流完整日志、参数边界和原始退出码,预计数百毫秒。
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../../scripts/command-log.ts");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("长命令双流完整落盘,失败尾部有界,路径空格与 shell 字符作为原样参数并保留退出 23", () => {
  const root = mkdtempSync(join(tmpdir(), "command log test-"));
  roots.push(root);
  const script = join(root, "emit logs with spaces.ts");
  const argument = 'space ; $(not a command) & "quoted"';
  writeFileSync(
    script,
    'process.stdout.write("stdout-head\\n" + "O".repeat(12000) + "\\n" + process.argv[2] + "\\nstdout-tail\\n"); process.stderr.write("stderr-head\\n" + "E".repeat(12000) + "\\nstderr-tail\\n"); process.exit(23);',
  );
  const child = Bun.spawnSync([process.execPath, CLI, "--", process.execPath, script, argument]);
  const output = child.stdout.toString() + child.stderr.toString();
  expect(child.exitCode, output).toBe(23);
  const stdoutPath = /^\[command-log\] stdout: (.+)$/m.exec(output)![1]!.trim();
  const stderrPath = /^\[command-log\] stderr: (.+)$/m.exec(output)![1]!.trim();
  roots.push(dirname(stdoutPath));
  expect(readFileSync(stdoutPath, "utf8")).toBe(
    `stdout-head\n${"O".repeat(12000)}\n${argument}\nstdout-tail\n`,
  );
  expect(readFileSync(stderrPath, "utf8")).toBe(`stderr-head\n${"E".repeat(12000)}\nstderr-tail\n`);
  expect(output.length).toBeLessThan(6000);
  expect(output).toContain("stdout-tail");
  expect(output).toContain("stderr-tail");
  expect(output).not.toContain("stdout-head");
  expect(output).not.toContain("stderr-head");
});

test("成功只显示结果和日志位置,帮助不启动命令,启动失败响亮且非零退出", () => {
  const success = Bun.spawnSync([
    process.execPath,
    CLI,
    "--",
    process.execPath,
    "-e",
    'console.log("private stdout"); console.error("private stderr");',
  ]);
  const output = success.stdout.toString() + success.stderr.toString();
  expect(success.exitCode, output).toBe(0);
  expect(output).toContain("exit 0; elapsed");
  expect(output).not.toContain("private stdout");
  expect(output).not.toContain("private stderr");
  const stdoutPath = /^\[command-log\] stdout: (.+)$/m.exec(output)![1]!.trim();
  const stderrPath = /^\[command-log\] stderr: (.+)$/m.exec(output)![1]!.trim();
  roots.push(dirname(stdoutPath));
  expect(readFileSync(stdoutPath, "utf8")).toBe("private stdout\n");
  expect(readFileSync(stderrPath, "utf8")).toBe("private stderr\n");
  const help = Bun.spawnSync([process.execPath, CLI, "--help"]);
  expect(help.exitCode, help.stderr.toString()).toBe(0);
  expect(help.stdout.toString()).toContain("-- <命令>");
  const missing = join(dirname(stdoutPath), "missing command.exe");
  const failure = Bun.spawnSync([process.execPath, CLI, "--", missing]);
  expect(failure.exitCode).not.toBe(0);
  expect(failure.stdout.toString() + failure.stderr.toString()).toContain("missing command.exe");
  const failureLog = /^\[command-log\] stdout: (.+)$/m.exec(failure.stdout.toString())![1]!.trim();
  roots.push(dirname(failureLog));
});

test("过长的启动错误也完整落盘,终端仍只显示有界尾部", () => {
  const missing = `dafung-missing-${"x".repeat(6000)}`;
  const child = Bun.spawnSync([process.execPath, CLI, "--", missing]);
  const output = child.stdout.toString() + child.stderr.toString();
  const stderrPath = /^\[command-log\] stderr: (.+)$/m.exec(output)![1]!.trim();
  roots.push(dirname(stderrPath));
  expect(child.exitCode).not.toBe(0);
  expect(output.length).toBeLessThan(6000);
  expect(readFileSync(stderrPath, "utf8")).toContain(missing);
});

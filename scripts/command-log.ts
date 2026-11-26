// 长命令输出限额(#1465):直接执行 argv,双流原样写系统临时文件,失败才展示有界尾部。
import { appendFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const TAIL_BYTES = 2000;
const RESULT_PREFIX = "[result] ";
const HELP = `用法:
  bun scripts/command-log.ts -- <命令> [参数...]
  bun scripts/command-log.ts --help

命令按 argv 直接执行,含空格路径按当前 shell 加引号。
完整 stdout/stderr 写系统临时目录;成功显示日志路径、退出码、耗时和子命令的 ${RESULT_PREFIX.trim()} 回执。
失败附两路各最多 ${TAIL_BYTES} 字节的尾部,子命令非零退出码原样返回;启动错误明确报告。
交互服务继续直接运行。

示例:
  bun scripts/command-log.ts -- bun run build
  bun scripts/command-log.ts -- bun run test`;

export function createCommandLog() {
  const dir = mkdtempSync(join(tmpdir(), "dafung-command-"));
  return { dir, stdout: join(dir, "stdout.log"), stderr: join(dir, "stderr.log") };
}

type CommandLog = ReturnType<typeof createCommandLog>;

export async function runLoggedCommand(args: string[], log: CommandLog = createCommandLog()) {
  const started = performance.now();
  let failedToStart = false;
  let code: number;
  try {
    const child = Bun.spawn(args, {
      stdin: "inherit",
      stdout: Bun.file(log.stdout),
      stderr: Bun.file(log.stderr),
    });
    code = await child.exited;
  } catch (error) {
    appendFileSync(log.stdout, "");
    appendFileSync(log.stderr, `${String(error)}\n`);
    failedToStart = true;
    code = 1;
  }
  return { code, failedToStart, elapsedMs: Math.round(performance.now() - started), log };
}

export function reportCommandResult(message: string): void {
  console.log(RESULT_PREFIX + message);
}

export async function readLogTail(path: string, bytes = TAIL_BYTES): Promise<string> {
  const size = statSync(path).size;
  const tail = await Bun.file(path)
    .slice(Math.max(0, size - bytes), size)
    .text();
  return stripVTControlCharacters(tail);
}

export async function commandFailureTail(log: CommandLog): Promise<string> {
  const details: string[] = [];
  for (const stream of ["stderr", "stdout"] as const) {
    const tail = (await readLogTail(log[stream])).trimEnd();
    if (tail) details.push(`[command-log] ${stream} tail (last <=${TAIL_BYTES} bytes):\n${tail}`);
  }
  return details.join("\n");
}

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(HELP);
    return 0;
  }
  // Bun 消耗脚本路径后的首个 --;process.argv 中已是后续命令及参数。
  if (args.length === 0) throw new Error("用法:bun scripts/command-log.ts -- <命令> [参数...]");
  const log = createCommandLog();
  console.log(`[command-log] stdout: ${log.stdout}`);
  console.log(`[command-log] stderr: ${log.stderr}`);
  const { code, failedToStart, elapsedMs } = await runLoggedCommand(args, log);
  console.log(`[command-log] exit ${code}; elapsed ${elapsedMs}ms`);
  if (code === 0) {
    const result = (await readLogTail(log.stdout)).trimEnd().split("\n").at(-1);
    if (result?.startsWith(RESULT_PREFIX)) console.log(result);
  } else {
    if (failedToStart) console.error(`[command-log] 执行失败,完整错误见 ${log.stderr}`);
    const detail = await commandFailureTail(log);
    if (detail) console.error(detail);
  }
  return code;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`[command-log] ${String(error)}`);
    process.exitCode = 1;
  }
}
